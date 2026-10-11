"""Trend statistics on annual series and the plain-English insights built from them."""

import numpy as np
import pandas as pd
from scipy import stats

MIN_YEARS_FOR_TREND = 10
COMPARE_YEARS = 10
ROLLING_YEARS = 5
SIGNIFICANCE = 0.05
# Percent change only makes sense for counts and totals, and only when the
# starting value is not tiny ("+300%" from 0.5 to 2 days a year misleads).
PERCENT_UNITS = {"days", "events", "mm"}
MIN_BASE_FOR_PERCENT = 1.0


def format_p(p: float) -> str:
    return "p < 0.001" if p < 0.001 else f"p = {p:.3f}"


def rolling_mean(values: pd.Series) -> pd.Series:
    return values.rolling(ROLLING_YEARS, center=True, min_periods=3).mean()


def fit_trend(values: pd.Series) -> dict | None:
    """Linear regression plus Mann-Kendall test and Sen's slope, slopes per decade.

    Mann-Kendall/Sen is the headline because it is rank-based: one extreme year
    can't drag it around, and it assumes no particular distribution of counts.
    It does assume independent years. Climate series are mildly autocorrelated,
    so treat p-values near 0.05 as borderline.
    """
    values = values.dropna()
    if len(values) < MIN_YEARS_FOR_TREND:
        return None
    years = values.index.to_numpy(dtype=float)
    y = values.to_numpy(dtype=float)

    ols = stats.linregress(years, y)
    t_crit = stats.t.ppf(0.975, len(y) - 2)
    _, mk_p = stats.kendalltau(years, y)
    sen = stats.theilslopes(y, years)
    first, last = years[0], years[-1]
    return {
        "sen_per_decade": sen.slope * 10,
        "mk_p": mk_p,  # NaN when the series never changes
        "significant": bool(mk_p < SIGNIFICANCE),
        "ols_per_decade": ols.slope * 10,
        "ols_ci95": [(ols.slope - t_crit * ols.stderr) * 10, (ols.slope + t_crit * ols.stderr) * 10],
        "ols_p": ols.pvalue,
        "sen_line": [
            {"year": int(first), "value": sen.intercept + sen.slope * first},
            {"year": int(last), "value": sen.intercept + sen.slope * last},
        ],
    }


def describe_change(label: str, unit: str, values: pd.Series) -> str:
    """Compare the first and last decade means. Single end-point years are too noisy."""
    values = values.dropna()
    window = min(COMPARE_YEARS, len(values) // 2)
    early, late = values.iloc[:window], values.iloc[-window:]
    change = late.mean() - early.mean()
    text = (
        f"{label}: {early.mean():.1f} {unit} a year on average in {early.index[0]}–{early.index[-1]}, "
        f"{late.mean():.1f} in {late.index[0]}–{late.index[-1]} ({change:+.1f} {unit}"
    )
    if unit in PERCENT_UNITS and early.mean() >= MIN_BASE_FOR_PERCENT:
        text += f", {100 * change / early.mean():+.0f}%"
    return text + ")."


def describe_trend(unit: str, trend: dict | None) -> str:
    if trend is None:
        return f"Too few complete years for a trend test (need at least {MIN_YEARS_FOR_TREND})."
    if np.isnan(trend["mk_p"]):
        return "No change at all across these years, so there is no trend to test."
    if trend["significant"]:
        direction = "increase" if trend["sen_per_decade"] > 0 else "decrease"
        return (
            f"Statistically significant {direction}: {trend['sen_per_decade']:+.1f} {unit} per decade "
            f"(Sen's slope; Mann-Kendall {format_p(trend['mk_p'])})."
        )
    return (
        f"No statistically significant trend (Mann-Kendall p = {trend['mk_p']:.2f}). "
        "Year-to-year swings are larger than any steady change."
    )


def describe_peak(label: str, unit: str, values: pd.Series) -> str:
    values = values.dropna()
    if values.max() <= 0:
        return f"No {label.lower()} at all in this period."
    year = int(values.idxmax())
    return f"Most extreme year: {year} ({round(values[year], 1):g} {unit})."


def describe_side_trend(label: str, unit: str, trend: dict | None) -> str | None:
    """One line for a secondary metric, only when its trend is significant."""
    if trend is None or not trend["significant"]:
        return None
    direction = "rising" if trend["sen_per_decade"] > 0 else "falling"
    return f"{label}: also {direction}, {trend['sen_per_decade']:+.2f} {unit} per decade ({format_p(trend['mk_p'])})."
