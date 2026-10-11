import numpy as np
import pandas as pd

from app.hazards import HazardParams, clean, find_runs, heatwaves
from app.trends import describe_change, fit_trend

PARAMS = HazardParams(percentile=95, min_days=3, method="annual")


def daily_series(tmax: np.ndarray, start: str = "1981-01-01") -> pd.DataFrame:
    index = pd.date_range(start, periods=len(tmax), freq="D")
    return pd.DataFrame({"tmax": tmax, "tmin": tmax - 10, "precip": np.zeros(len(tmax))}, index=index)


def calm_years(first: int = 1981, last: int = 2012) -> pd.DataFrame:
    """Mild noise around 30 °C with no day above 35 °C, so any heatwave is one we planted."""
    rng = np.random.default_rng(0)
    days = len(pd.date_range(f"{first}-01-01", f"{last}-12-31"))
    return daily_series(30 + rng.uniform(-2, 2, days), start=f"{first}-01-01")


def test_find_runs_respects_min_length():
    mask = np.array([1, 1, 0, 1, 1, 1, 0, 1], dtype=bool)
    assert find_runs(mask, 3) == [(3, 5)]
    assert find_runs(mask, 1) == [(0, 1), (3, 5), (7, 7)]


def test_three_hot_days_make_one_heatwave_two_do_not():
    df = calm_years()
    df.loc["2011-06-01":"2011-06-03", "tmax"] = 45.0
    df.loc["2012-06-01":"2012-06-02", "tmax"] = 45.0
    result = heatwaves(df, PARAMS)
    assert len(result.events) == 1
    assert result.annual.loc[2011, "days"] == 3
    assert result.annual.loc[2012, "days"] == 0


def test_missing_day_breaks_a_heatwave():
    df = calm_years()
    df.loc["2011-06-01":"2011-06-05", "tmax"] = 45.0
    df.loc["2011-06-03", "tmax"] = np.nan  # leaves two 2-day runs
    assert len(heatwaves(df, PARAMS).events) == 0


def test_clean_flags_impossible_values_and_fills_calendar_gaps():
    df = calm_years(1981, 1990)
    df.loc["1985-07-01", "tmax"] = 75.0  # outside the plausible range
    df = df.drop(pd.Timestamp("1986-03-01"))  # missing row
    cleaned, qc = clean(df)
    assert np.isnan(cleaned.loc["1985-07-01", "tmax"])
    assert np.isnan(cleaned.loc["1986-03-01", "tmax"])
    assert qc["missing_days"] == 1
    assert qc["flagged_values"] >= 1


def test_mann_kendall_finds_a_planted_trend_and_not_noise():
    rng = np.random.default_rng(1)
    years = range(1981, 2021)
    rising = pd.Series([0.5 * i + rng.normal(0, 2) for i in range(40)], index=years)
    noise = pd.Series(rng.normal(10, 2, 40), index=years)
    assert fit_trend(rising)["significant"]
    assert fit_trend(rising)["sen_per_decade"] > 0
    assert not fit_trend(noise)["significant"]


def test_percent_change_hidden_when_base_is_tiny():
    tiny = pd.Series([0.2] * 10 + [2.0] * 10, index=range(2001, 2021))
    assert "%" not in describe_change("Heatwave days", "days", tiny)
