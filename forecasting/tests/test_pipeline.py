"""No look-ahead, and sensible behaviour on the simulated seasons. The metric
bounds here are smoke checks of the code on simulated data, not claims about
accuracy on a real market."""

from __future__ import annotations

import numpy as np
import pandas as pd

from sweetcherry_forecasting import DEFAULT_SEED
from sweetcherry_forecasting.backtest import REPORTED_HORIZONS, run_backtest
from sweetcherry_forecasting.features import FEATURES, build_samples
from sweetcherry_forecasting.forecast import forecast_at_cutoff


def test_features_ignore_everything_after_the_origin(weekly):
    origin = pd.Timestamp("2024-06-10")
    key = ("M02", "AA")
    full = build_samples(weekly, with_target=False, origins={key: origin})
    altered = weekly.copy()
    later = altered["week"] > origin
    altered.loc[later, "price"] = altered.loc[later, "price"] * 3.0
    altered.loc[later, "market_arrivals_t"] = 0.0
    shifted = build_samples(altered, with_target=False, origins={key: origin})
    pd.testing.assert_frame_equal(full[FEATURES], shifted[FEATURES])


def test_backtest_never_trains_on_later_seasons(samples):
    seasons = (2021, 2022)
    baseline = run_backtest(samples, seed=DEFAULT_SEED, test_seasons=seasons).evaluated
    corrupted = samples.copy()
    later = corrupted["season_target"] >= 2023
    corrupted.loc[later, "target"] = corrupted.loc[later, "target"] + 5.0
    again = run_backtest(corrupted, seed=DEFAULT_SEED, test_seasons=seasons).evaluated
    columns = ["low", "expected", "high"]
    pd.testing.assert_frame_equal(baseline[columns], again[columns])


def test_backtest_reports_every_horizon_and_beats_the_naive_forecast(backtest):
    by_horizon = backtest.metrics["by_horizon"]
    assert list(by_horizon) == [f"{h}w" for h in REPORTED_HORIZONS]
    errors = [by_horizon[f"{h}w"]["mae"] for h in REPORTED_HORIZONS]
    assert errors[-1] > errors[0], "longer horizons should be harder"
    for block in by_horizon.values():
        assert block["n"] > 50
        assert block["mae"] < block["naive_mae"]
    overall = backtest.metrics["all_horizons"]
    assert 65 <= overall["coverage_pct"] <= 92, "P10-P90 should hold roughly 80% of simulated weeks"


def test_backtest_intervals_are_ordered(backtest):
    evaluated = backtest.evaluated
    assert (evaluated["low"] <= evaluated["expected"]).all()
    assert (evaluated["expected"] <= evaluated["high"]).all()
    assert (evaluated["low"] > 0).all()


def test_in_season_forecast_covers_eight_weeks_for_every_series(weekly, backtest):
    forecast = forecast_at_cutoff(weekly, "2026-05-24", DEFAULT_SEED, backtest.offsets)
    assert forecast.cutoff_week == pd.Timestamp("2026-05-18")
    for grade, rows in forecast.rows.items():
        frame = pd.DataFrame(rows)
        assert set(frame["market"]) == {"M01", "M02", "M03"}, grade
        assert sorted(frame["horizon"].unique(), key=lambda h: int(h[:-1])) == [f"{h}w" for h in range(1, 9)]
        assert (frame["date"] > "2026-05-24").all()
        assert (frame["low"] <= frame["expected"]).all() and (frame["expected"] <= frame["high"]).all()
        assert (frame["horizonType"] == "short_term").all()
        assert np.isfinite(frame[["low", "expected", "high"]].to_numpy()).all()


def test_off_season_cutoff_gives_no_rows_and_says_why(weekly, backtest):
    history = weekly[weekly["week"] <= pd.Timestamp("2025-10-13")]
    forecast = forecast_at_cutoff(history, "2025-10-15", DEFAULT_SEED, backtest.offsets)
    assert forecast.row_count == 0
    assert "nothing to forecast" in forecast.note
