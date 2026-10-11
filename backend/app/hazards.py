"""Quality control and hazard detection on one grid point's daily series.

Everything here is pure (no I/O). Input is a DataFrame indexed by date with
columns tmax (°C), tmin (°C) and precip (mm/day).
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import NamedTuple

import numpy as np
import pandas as pd

# Thresholds come from a fixed reference period, not from the years the user
# selects. Otherwise the threshold would move with the selection, and a
# warming period would partly define its own "normal" and hide its own trend.
BASELINE = (1981, 2010)

PLAUSIBLE_RANGE = {"tmax": (-90.0, 60.0), "tmin": (-95.0, 50.0), "precip": (0.0, 2000.0)}
OUTLIER_Z = 6.0
MAX_MISSING_FRACTION = 0.05
CALENDAR_WINDOW_HALF_WIDTH = 7  # 15-day window, as in the ETCCDI percentile indices
WET_DAY_MM = 1.0
DRY_DAY_MM = 1.0
LONG_DRY_SPELL_DAYS = 30

EVENT_COLUMNS = ["start", "end", "days", "peak", "mean_excess"]


@dataclass(frozen=True)
class HazardParams:
    percentile: float = 95.0
    min_days: int = 3
    method: str = "annual"  # "annual" or "calendar_day"


@dataclass
class Detection:
    annual: pd.DataFrame  # one row per year, one column per metric
    events: pd.DataFrame  # EVENT_COLUMNS
    threshold: pd.Series  # daily threshold aligned with the input


def clean(daily: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Put the series on a gap-free daily calendar and blank out impossible values.

    Bad values become NaN rather than being filled in. A hazard should never be
    built out of data we made up.
    """
    daily = daily[~daily.index.duplicated()].sort_index()
    df = daily.reindex(pd.date_range(daily.index.min(), daily.index.max(), freq="D"))
    missing_days = int(df[["tmax", "precip"]].isna().any(axis=1).sum())

    flagged = 0
    for column, (low, high) in PLAUSIBLE_RANGE.items():
        bad = (df[column] < low) | (df[column] > high)
        flagged += int(bad.sum())
        df.loc[bad, column] = np.nan

    swapped = df["tmin"] > df["tmax"]
    flagged += 2 * int(swapped.sum())
    df.loc[swapped, ["tmin", "tmax"]] = np.nan

    # A value 6 standard deviations away from the normal for that calendar day
    # is a data error, not weather. Precipitation is skipped because heavy rain
    # is supposed to be extreme.
    day_of_year = df.index.dayofyear
    for column in ("tmax", "tmin"):
        by_day = df[column].groupby(day_of_year)
        z = (df[column] - by_day.transform("mean")) / by_day.transform("std")
        bad = z.abs() > OUTLIER_Z
        flagged += int(bad.sum())
        df.loc[bad, column] = np.nan

    missing_share = df[["tmax", "precip"]].isna().any(axis=1).groupby(df.index.year).mean()
    qc = {
        "missing_days": missing_days,
        "flagged_values": flagged,
        "incomplete_years": [int(y) for y in missing_share[missing_share > MAX_MISSING_FRACTION].index],
    }
    return df, qc


def percentile_threshold(values: pd.Series, percentile: float, method: str) -> pd.Series:
    """Daily threshold from the baseline period, aligned with `values`.

    "annual": one number, the percentile of all baseline days. Only the hot
    season can cross it, which matches the usual idea of a heatwave.
    "calendar_day": a separate percentile for each day of the year from a 15-day
    window, so an unusually warm spell in winter also counts.
    """
    base = values.loc[str(BASELINE[0]) : str(BASELINE[1])].dropna()
    if method == "annual":
        return pd.Series(np.percentile(base, percentile), index=values.index)

    base_days = base.index.dayofyear.to_numpy()
    base_values = base.to_numpy()
    by_day = {}
    for day in range(1, 367):
        distance = np.abs(base_days - day)
        distance = np.minimum(distance, 366 - distance)  # the window wraps around New Year
        by_day[day] = np.percentile(base_values[distance <= CALENDAR_WINDOW_HALF_WIDTH], percentile)
    # Leap years shift day-of-year by one after February. That is well inside
    # the 15-day window, so Feb 29 needs no special handling.
    return pd.Series(values.index.dayofyear.map(by_day).to_numpy(), index=values.index)


def find_runs(mask: np.ndarray, min_length: int) -> list[tuple[int, int]]:
    """(start, end) index pairs, end inclusive, of True runs at least `min_length` long."""
    edges = np.diff(np.concatenate(([0], mask.astype(int), [0])))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1) - 1
    keep = ends - starts + 1 >= min_length
    return list(zip(starts[keep].tolist(), ends[keep].tolist(), strict=True))


def find_events(values: pd.Series, threshold: pd.Series, mask: np.ndarray, min_days: int) -> pd.DataFrame:
    rows = []
    for start, end in find_runs(mask, min_days):
        days = values.iloc[start : end + 1]
        rows.append(
            {
                "start": days.index[0],
                "end": days.index[-1],
                "days": len(days),
                "peak": days.max(),
                "mean_excess": (days - threshold.iloc[start : end + 1]).mean(),
            }
        )
    return pd.DataFrame(rows, columns=EVENT_COLUMNS)


def by_start_year(events: pd.DataFrame):
    # An event that crosses New Year counts toward the year it started in.
    return events.groupby(pd.DatetimeIndex(events["start"]).year)


def all_years(daily: pd.DataFrame) -> pd.Index:
    return pd.Index(range(daily.index.year.min(), daily.index.year.max() + 1))


def heatwaves(daily: pd.DataFrame, params: HazardParams) -> Detection:
    tmax = daily["tmax"]
    threshold = percentile_threshold(tmax, params.percentile, params.method)
    # NaN > threshold is False, so a data gap ends a heatwave instead of being bridged.
    hot = (tmax > threshold).to_numpy()
    events = find_events(tmax, threshold, hot, params.min_days)

    grouped = by_start_year(events)
    annual = pd.DataFrame(
        {
            "days": grouped["days"].sum(),
            "events": grouped.size(),
            "longest": grouped["days"].max(),
            "mean_excess": grouped["mean_excess"].mean(),
            "peak": grouped["peak"].max(),
        }
    ).reindex(all_years(daily))
    counts = ["days", "events", "longest"]
    annual[counts] = annual[counts].fillna(0)
    return Detection(annual, events, threshold)


def heavy_rain(daily: pd.DataFrame, params: HazardParams) -> Detection:
    precip = daily["precip"]
    wet_days = precip.where(precip >= WET_DAY_MM)
    # Only one threshold for the whole year: a 15-day window holds too few wet
    # days for a stable 95th percentile.
    threshold = percentile_threshold(wet_days, params.percentile, "annual")
    heavy = (precip > threshold).to_numpy()
    events = find_events(precip, threshold, heavy, 1)

    heavy_precip = precip.where(heavy)
    by_year = precip.groupby(precip.index.year)
    annual = pd.DataFrame(
        {
            "days": heavy_precip.groupby(precip.index.year).count(),
            "events": by_start_year(events).size(),
            "heavy_total": heavy_precip.groupby(precip.index.year).sum(),
            "wettest_day": by_year.max(),
        }
    ).reindex(all_years(daily))
    annual["events"] = annual["events"].fillna(0)
    return Detection(annual, events, threshold)


def drought(daily: pd.DataFrame, params: HazardParams) -> Detection:
    """Drought proxy from rainfall alone: dry-spell length and annual rainfall deficit.

    A proper drought index (SPI/SPEI) needs evapotranspiration and a fitted
    distribution, which is out of scope here. The README says so.
    """
    precip = daily["precip"]
    threshold = pd.Series(DRY_DAY_MM, index=precip.index)
    dry = (precip < DRY_DAY_MM).to_numpy()
    spells = find_events(precip, threshold, dry, 1)

    total = precip.groupby(precip.index.year).sum(min_count=1)
    normal = total.loc[BASELINE[0] : BASELINE[1]].mean()
    long_spells = spells[spells["days"] >= LONG_DRY_SPELL_DAYS]
    annual = pd.DataFrame(
        {
            "longest": by_start_year(spells)["days"].max(),
            "events": by_start_year(long_spells).size(),
            "rainfall_anomaly": 100 * (total - normal) / normal,
            "rainfall": total,
        }
    ).reindex(all_years(daily))
    annual["events"] = annual["events"].fillna(0)
    return Detection(annual, long_spells, threshold)


class Hazard(NamedTuple):
    detect: Callable[[pd.DataFrame, HazardParams], Detection]
    variable: str  # daily column the threshold applies to
    metrics: dict[str, tuple[str, str]]  # column -> (label, unit). The first one is the headline.


HAZARDS = {
    "heatwave": Hazard(
        heatwaves,
        "tmax",
        {
            "days": ("Heatwave days", "days"),
            "events": ("Heatwave events", "events"),
            "longest": ("Longest heatwave", "days"),
            "mean_excess": ("Mean heat above threshold", "°C"),
            "peak": ("Hottest heatwave day", "°C"),
        },
    ),
    "heavy_rain": Hazard(
        heavy_rain,
        "precip",
        {
            "days": ("Heavy-rain days", "days"),
            "events": ("Heavy-rain events", "events"),
            "heavy_total": ("Rain on heavy-rain days", "mm"),
            "wettest_day": ("Wettest day", "mm"),
        },
    ),
    "drought": Hazard(
        drought,
        "precip",
        {
            "longest": ("Longest dry spell", "days"),
            "events": (f"Dry spells ≥ {LONG_DRY_SPELL_DAYS} days", "events"),
            "rainfall_anomaly": (f"Rainfall vs {BASELINE[0]}–{BASELINE[1]} normal", "%"),
            "rainfall": ("Annual rainfall", "mm"),
        },
    ),
}
