"""MongoDB storage.

weather_daily: raw NASA POWER values, one document per grid cell per year (the
    bucket pattern: about 45 small documents per cell instead of 16,000 rows).
    Values are stored before QC, so changing QC rules never needs a re-download.
analyses: finished analysis responses, expired after a week.
places: state outlines from Nominatim, expired after a month.
"""

import os
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
from pymongo import AsyncMongoClient, ReplaceOne

ANALYSIS_TTL = timedelta(days=7)
PLACE_TTL = timedelta(days=30)
COLUMNS = ["tmax", "tmin", "precip"]

client = AsyncMongoClient(os.environ.get("MONGO_URI", "mongodb://localhost:27017"))
db = client["climate_hazards"]
weather = db["weather_daily"]
analyses = db["analyses"]
places = db["places"]


async def create_indexes() -> None:
    await weather.create_index([("lat", 1), ("lon", 1), ("year", 1)])
    await analyses.create_index("saved_at", expireAfterSeconds=int(ANALYSIS_TTL.total_seconds()))
    await places.create_index("saved_at", expireAfterSeconds=int(PLACE_TTL.total_seconds()))


def now() -> datetime:
    return datetime.now(UTC)


async def load_daily(lat: float, lon: float) -> pd.DataFrame | None:
    docs = await weather.find({"lat": lat, "lon": lon}).sort("year").to_list()
    if not docs:
        return None
    frames = [
        pd.DataFrame(
            {column: doc[column] for column in COLUMNS},
            index=pd.date_range(f"{doc['year']}-01-01", periods=len(doc["tmax"]), freq="D"),
            dtype=float,  # turns stored nulls back into NaN
        )
        for doc in docs
    ]
    return pd.concat(frames)


async def save_daily(lat: float, lon: float, daily: pd.DataFrame) -> None:
    writes = []
    for year, chunk in daily.groupby(daily.index.year):
        doc = {"lat": lat, "lon": lon, "year": int(year), "saved_at": now()}
        for column in COLUMNS:
            doc[column] = [None if np.isnan(v) else round(float(v), 2) for v in chunk[column]]
        writes.append(ReplaceOne({"_id": f"{lat}_{lon}_{year}"}, doc, upsert=True))
    await weather.bulk_write(writes)


async def load_analysis(key: str) -> dict | None:
    doc = await analyses.find_one({"_id": key}, {"result": 1})
    return doc["result"] if doc else None


async def save_analysis(key: str, result: dict) -> None:
    await analyses.replace_one({"_id": key}, {"result": result, "saved_at": now()}, upsert=True)


async def load_place(place_id: str) -> dict | None:
    return await places.find_one({"_id": place_id}, {"_id": 0, "saved_at": 0})


async def save_places(found: list[dict]) -> None:
    for place in found:
        await places.replace_one({"_id": place["id"]}, {**place, "saved_at": now()}, upsert=True)
