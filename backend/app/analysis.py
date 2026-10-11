"""Region + hazard + years in, the JSON the frontend draws out.

Flow: region -> sample grid cells -> daily data (Mongo, else NASA POWER) ->
QC -> hazard detection per cell -> regional average -> trends + insights.
"""

import asyncio
import math
from collections import defaultdict
from datetime import date

import numpy as np
import pandas as pd
from shapely.geometry import Point, shape

from app import sources, store
from app.hazards import BASELINE, HAZARDS, HazardParams, clean
from app.trends import (
    describe_change,
    describe_peak,
    describe_side_trend,
    describe_trend,
    fit_trend,
    rolling_mean,
)

FIRST_YEAR = 1981  # NASA POWER daily data (MERRA-2) starts here
GRID_LAT, GRID_LON = 0.5, 0.625  # MERRA-2 grid spacing in degrees
MAX_POINTS = 9
SHORT_RANGE_YEARS = 20
ALGO_VERSION = 1  # bump when hazard logic changes so cached analyses are recomputed


def last_complete_year(today: date | None = None) -> int:
    # NASA advises staying about two months behind real time for climate work.
    today = today or date.today()
    return today.year - 1 if today.month >= 3 else today.year - 2


def snap(lat: float, lon: float) -> tuple[float, float]:
    """Nearest grid-cell centre, so nearby requests share one cached download."""
    return round(round(lat / GRID_LAT) * GRID_LAT, 3), round(round(lon / GRID_LON) * GRID_LON, 3)


def sample_points(bbox: list[float], outline=None) -> list[tuple[float, float]]:
    """Up to MAX_POINTS grid cells spread evenly over a box or state.

    ponytail: a 4x4 lattice thinned to 9 cells. Enough to see a regional signal,
    and it caps upstream downloads. A huge state gets the same 9 cells as a
    small one; use a denser lattice if that ever matters.
    """
    south, west, north, east = bbox
    steps = (np.arange(4) + 0.5) / 4
    lattice = [(south + (north - south) * a, west + (east - west) * b) for a in steps for b in steps]
    if outline is not None:
        lattice = [(lat, lon) for lat, lon in lattice if outline.contains(Point(lon, lat))]
    cells = list(dict.fromkeys(snap(lat, lon) for lat, lon in lattice))  # snapping can merge neighbours
    if not cells:  # tiny or oddly shaped region
        middle = outline.representative_point() if outline is not None else None
        return [snap(middle.y, middle.x) if middle else snap((south + north) / 2, (west + east) / 2)]
    keep = np.linspace(0, len(cells) - 1, min(MAX_POINTS, len(cells))).round().astype(int)
    return [cells[i] for i in keep]


async def resolve_region(
    lat: float | None, lon: float | None, bbox: list[float] | None, state: str | None
) -> dict | None:
    if lat is not None and lon is not None:
        cell = snap(lat, lon)
        return {"kind": "point", "name": f"{cell[0]}, {cell[1]}", "points": [cell]}
    if bbox is not None:
        return {"kind": "box", "name": "Custom area", "bbox": bbox, "points": sample_points(bbox)}

    place = await store.load_place(state)
    if place is None:
        place = await sources.lookup_state(state)
        if place is None:
            return None
        await store.save_places([place])
    return {
        "kind": "state",
        "name": place["name"],
        "bbox": place["bbox"],
        "polygon": place["polygon"],
        "points": sample_points(place["bbox"], shape(place["polygon"])),
    }


# ponytail: one lock per grid cell ever requested, never cleaned up. Fine for
# thousands of cells; swap for a bounded cache if this ever serves millions.
cell_locks: dict[tuple[float, float], asyncio.Lock] = defaultdict(asyncio.Lock)


async def daily_for_cell(lat: float, lon: float) -> pd.DataFrame:
    # The lock makes concurrent requests for the same cell wait for a single
    # download instead of each hitting NASA.
    async with cell_locks[(lat, lon)]:
        cached = await store.load_daily(lat, lon)
        have_until = cached.index.year.max() if cached is not None else FIRST_YEAR - 1
        need_until = last_complete_year()
        if have_until >= need_until:
            return cached
        fresh = await sources.fetch_daily(lat, lon, have_until + 1, need_until)
        await store.save_daily(lat, lon, fresh)
        return fresh if cached is None else pd.concat([cached, fresh])


async def run_analysis(hazard_name: str, params: HazardParams, first: int, last: int, region: dict) -> dict:
    hazard = HAZARDS[hazard_name]
    metrics = list(hazard.metrics)
    headline = metrics[0]
    dailies = await asyncio.gather(*(daily_for_cell(lat, lon) for lat, lon in region["points"]))

    per_point, events, points = [], [], []
    qc = {"missing_days": 0, "flagged_values": 0, "incomplete_years": set()}
    for index, ((lat, lon), daily) in enumerate(zip(region["points"], dailies, strict=True)):
        df, point_qc = clean(daily)
        found = hazard.detect(df, params)
        annual = found.annual.loc[first:last].copy()
        # A year with many gaps undercounts events and would fake a dip in the
        # trend, so it is left out rather than shown as zero.
        annual.loc[annual.index.isin(point_qc["incomplete_years"])] = np.nan
        per_point.append(annual)

        in_range = found.events[pd.DatetimeIndex(found.events["start"]).year.isin(range(first, last + 1))]
        events.append(in_range.assign(point=index))
        threshold = found.threshold.loc[str(BASELINE[0]) : str(BASELINE[1])]
        points.append(
            {
                "lat": lat,
                "lon": lon,
                "threshold": [float(threshold.min()), float(threshold.max())],
                "trend_per_decade": (fit_trend(annual[headline]) or {}).get("sen_per_decade"),
            }
        )
        qc["missing_days"] += point_qc["missing_days"]
        qc["flagged_values"] += point_qc["flagged_values"]
        qc["incomplete_years"].update(y for y in point_qc["incomplete_years"] if first <= y <= last)

    regional = pd.concat(per_point).groupby(level=0).mean()
    regional["rolling"] = rolling_mean(regional[headline])
    regional["points_affected_pct"] = 100 * pd.concat([a["events"] > 0 for a in per_point], axis=1).mean(
        axis=1
    )
    trends = {metric: fit_trend(regional[metric]) for metric in metrics}

    all_events = pd.concat(events)
    for column in ("start", "end"):
        all_events[column] = pd.DatetimeIndex(all_events[column]).strftime("%Y-%m-%d")

    result = {
        "hazard": hazard_name,
        "params": {"percentile": params.percentile, "min_days": params.min_days, "method": params.method},
        "years": [first, last],
        "baseline": list(BASELINE),
        "variable": hazard.variable,
        "region": {**region, "points": points},
        "metrics": {key: {"label": label, "unit": unit} for key, (label, unit) in hazard.metrics.items()},
        "annual": regional.rename_axis("year").reset_index().to_dict("records"),
        "trends": trends,
        "insights": write_insights(hazard.metrics, regional, trends),
        "caveats": write_caveats(first, last, len(points), sorted(qc["incomplete_years"])),
        "events": all_events.to_dict("records"),
        "qc": {**qc, "incomplete_years": sorted(qc["incomplete_years"])},
    }
    return without_nan(result)


def write_insights(metrics: dict, regional: pd.DataFrame, trends: dict) -> list[str]:
    headline, *others = metrics
    label, unit = metrics[headline]
    values = regional[headline]
    if values.notna().sum() < 2:
        return ["Not enough complete years in this range to say anything reliable."]
    lines = [
        describe_change(label, unit, values),
        describe_trend(unit, trends[headline]),
        describe_peak(label, unit, values),
    ]
    side = (describe_side_trend(*metrics[metric], trends[metric]) for metric in others)
    return lines + [line for line in side if line]


def write_caveats(first: int, last: int, point_count: int, incomplete_years: list[int]) -> list[str]:
    caveats = [
        "Data: NASA POWER daily (MERRA-2 reanalysis, ~50 km grid). Reanalysis smooths local extremes, so "
        "absolute counts run lower than at a weather station. The trend is the more reliable signal."
    ]
    if last - first + 1 < SHORT_RANGE_YEARS:
        caveats.append(
            f"Only {last - first + 1} years selected. Over short periods natural variability can hide or "
            "mimic a trend."
        )
    if incomplete_years:
        caveats.append(f"Left out years with over 5% missing data: {', '.join(map(str, incomplete_years))}.")
    if point_count > 1:
        caveats.append(
            f"Regional values average {point_count} grid points, each analysed on its own, so local "
            "extremes are not smoothed away before detection."
        )
    return caveats


def without_nan(value):
    """JSON has no NaN. Turn it into null and numpy scalars into plain Python."""
    if isinstance(value, dict):
        return {key: without_nan(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [without_nan(item) for item in value]
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


async def daily_detail(hazard_name: str, params: HazardParams, lat: float, lon: float, year: int) -> dict:
    """One year of daily values with the threshold, for the drill-down chart."""
    hazard = HAZARDS[hazard_name]
    lat, lon = snap(lat, lon)
    df, _ = clean(await daily_for_cell(lat, lon))
    found = hazard.detect(df, params)
    days = slice(f"{year}-01-01", f"{year}-12-31")
    starts, ends = pd.DatetimeIndex(found.events["start"]), pd.DatetimeIndex(found.events["end"])
    events = found.events[(starts.year <= year) & (ends.year >= year)]
    return without_nan(
        {
            "lat": lat,
            "lon": lon,
            "year": year,
            "variable": hazard.variable,
            "dates": df.loc[days].index.strftime("%Y-%m-%d").tolist(),
            "values": df.loc[days, hazard.variable].round(2).tolist(),
            "threshold": found.threshold.loc[days].round(2).tolist(),
            "events": [
                {
                    "start": e.start.strftime("%Y-%m-%d"),
                    "end": e.end.strftime("%Y-%m-%d"),
                    "days": int(e.days),
                }
                for e in events.itertuples()
            ],
        }
    )
