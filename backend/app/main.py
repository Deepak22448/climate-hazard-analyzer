"""HTTP layer: input validation, rate limits and caching. The climate logic lives in analysis.py."""

import hashlib
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal

import httpx
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app import analysis, sources, store
from app.hazards import HAZARDS, HazardParams

MAX_BOX_DEGREES = 10
MIN_RANGE_YEARS = 10
# Browsers send the origin with no trailing slash, and CORS matching is exact, so
# tidy up what was typed into the dashboard ("https://a.app/, http://b" still works).
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
log = logging.getLogger("uvicorn.error")


class HazardQuery(BaseModel):
    hazard: str = "heatwave"
    percentile: float = Field(95, ge=80, le=99.9)
    min_days: int = Field(3, ge=2, le=10)
    method: Literal["annual", "calendar_day"] = "annual"

    @field_validator("hazard")
    @classmethod
    def known_hazard(cls, value: str) -> str:
        if value not in HAZARDS:
            raise ValueError(f"must be one of: {', '.join(HAZARDS)}")
        return value

    def params(self) -> HazardParams:
        return HazardParams(self.percentile, self.min_days, self.method)


class AnalysisQuery(HazardQuery):
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)
    bbox: str | None = Field(None, max_length=80, description="south,west,north,east in degrees")
    state: str | None = Field(None, pattern=r"^[NWR]\d{1,12}$", description="id from /api/places?kind=state")
    start: int = Field(analysis.FIRST_YEAR, ge=analysis.FIRST_YEAR)
    end: int = Field(default_factory=analysis.last_complete_year)

    @property
    def box(self) -> list[float] | None:
        return [float(part) for part in self.bbox.split(",")] if self.bbox else None

    @model_validator(mode="after")
    def check_region_and_years(self):
        given = [self.lat is not None and self.lon is not None, self.bbox is not None, self.state is not None]
        if sum(given) != 1:
            raise ValueError("give exactly one region: lat and lon, bbox, or state")
        if self.bbox is not None:
            box = self.box
            if len(box) != 4:
                raise ValueError("bbox must be south,west,north,east")
            south, west, north, east = box
            if not (-90 <= south < north <= 90 and -180 <= west < east <= 180):
                raise ValueError("bbox corners are out of range or in the wrong order")
            if north - south > MAX_BOX_DEGREES or east - west > MAX_BOX_DEGREES:
                raise ValueError(f"bbox can be at most {MAX_BOX_DEGREES}° on each side")
        last = analysis.last_complete_year()
        if self.end > last:
            raise ValueError(f"end can be at most {last}, the last complete year of data")
        if self.end - self.start + 1 < MIN_RANGE_YEARS:
            raise ValueError(f"pick at least {MIN_RANGE_YEARS} years so a trend means something")
        return self

    def cache_key(self) -> str:
        fields = self.model_dump()
        if self.lat is not None:
            fields["lat"], fields["lon"] = analysis.snap(self.lat, self.lon)
        if self.bbox is not None:
            fields["bbox"] = ",".join(f"{value:.3f}" for value in self.box)
        fields["version"] = analysis.ALGO_VERSION
        return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()


class DailyQuery(HazardQuery):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    year: int = Field(ge=analysis.FIRST_YEAR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await store.create_indexes()
    yield
    await sources.http.aclose()
    await store.client.close()


limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Climate Hazard Trend Analyzer", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET"])


@app.exception_handler(httpx.HTTPError)
async def upstream_unavailable(request: Request, error: httpx.HTTPError) -> JSONResponse:
    log.warning("Upstream request failed: %r", error)
    return JSONResponse(
        {"detail": "The weather data provider is not responding. Please try again in a minute."},
        status_code=502,
    )


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok"}


@app.get("/api/meta")
async def meta() -> dict:
    return {
        "first_year": analysis.FIRST_YEAR,
        "last_year": analysis.last_complete_year(),
        "hazards": [
            {"id": key, "label": hazard.label, "params": list(hazard.params)}
            for key, hazard in HAZARDS.items()
        ],
    }


@app.get("/api/places")
@limiter.limit("30/minute")
async def places(
    request: Request,
    response: Response,
    q: Annotated[str, Query(min_length=2, max_length=80)],
    kind: Literal["city", "state"] = "city",
) -> list[dict]:
    if kind == "city":
        found = await sources.search_cities(q)
    else:
        text = " ".join(q.lower().split())  # "  Raja " and "raja" share one cache entry
        found = await store.load_state_search(text)
        if found is None:
            found = await sources.search_states(text)
            await store.save_state_search(text, found)
    response.headers["Cache-Control"] = "public, max-age=86400"
    return found


async def cached_analysis(query: AnalysisQuery) -> dict:
    key = query.cache_key()
    result = await store.load_analysis(key)
    if result is not None:
        return result
    region = await analysis.resolve_region(query.lat, query.lon, query.box, query.state)
    if region is None:
        raise HTTPException(404, "Unknown state id")
    # ponytail: synchronous even when NASA must be called (about 2-5 s per new
    # cell, all cells in parallel). Switch to a 202 + polling job if cold
    # regions get slow.
    result = await analysis.run_analysis(query.hazard, query.params(), query.start, query.end, region)
    await store.save_analysis(key, result)
    return result


@app.get("/api/analysis")
@limiter.limit("20/minute")
async def get_analysis(request: Request, query: Annotated[AnalysisQuery, Query()]) -> dict:
    # No browser Cache-Control here on purpose: results are cached in Mongo and
    # reset by ALGO_VERSION, but a browser-cached copy would stay stale after a deploy.
    return await cached_analysis(query)


@app.get("/api/analysis.csv")
@limiter.limit("20/minute")
async def get_analysis_csv(request: Request, query: Annotated[AnalysisQuery, Query()]) -> Response:
    result = await cached_analysis(query)
    headers = {key: f"{meta['label']} ({meta['unit']})" for key, meta in result["metrics"].items()}
    headers |= {"rolling": "5-year mean (headline)", "points_affected_pct": "Grid points affected (%)"}
    table = pd.DataFrame(result["annual"]).rename(columns=headers).round(2)
    filename = f"{query.hazard}_{query.start}-{query.end}.csv"
    return Response(
        table.to_csv(index=False),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/daily")
@limiter.limit("60/minute")
async def get_daily(request: Request, query: Annotated[DailyQuery, Query()]) -> dict:
    if query.year > analysis.last_complete_year():
        raise HTTPException(422, "year is past the last complete year of data")
    return await analysis.daily_detail(query.hazard, query.params(), query.lat, query.lon, query.year)
