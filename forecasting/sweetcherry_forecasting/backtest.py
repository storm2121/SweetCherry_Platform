"""Causal rolling-season backtest.

For each season S from FIRST_EVALUATED_SEASON on, models are trained only on
samples whose target week lies in an earlier season, then predict every
origin week of season S. A test season's P10-P90 interval is calibrated on the
out-of-sample predictions of the seasons before it, never on itself.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .model import QuantileForecaster, baselines, conformal_offsets, to_prices

FIRST_EVALUATED_SEASON = 2020
TEST_SEASONS = (2021, 2022, 2023, 2024, 2025)
REPORTED_HORIZONS = tuple(range(1, 9))


@dataclass
class BacktestResult:
    evaluated: pd.DataFrame  # test-season rows: actual price, calibrated quantiles, baselines
    metrics: dict
    offsets: dict[int, float]  # calibration for forecasts made after the last test season
    first_evaluated_season: int
    test_seasons: tuple[int, ...]


def _pinball(actual: np.ndarray, forecast: np.ndarray, quantile: float) -> float:
    error = actual - forecast
    return float(np.mean(np.maximum(quantile * error, (quantile - 1) * error)))


def _block(frame: pd.DataFrame) -> dict:
    actual = frame["price_target"].to_numpy()
    expected = frame["expected"].to_numpy()
    mae = float(np.mean(np.abs(actual - expected)))
    naive_mae = float(np.mean(np.abs(actual - frame["naive"].to_numpy())))
    return {
        "n": int(len(frame)),
        "mae": mae,
        "mape_pct": float(np.mean(np.abs(actual - expected) / actual) * 100),
        "pinball": float(np.mean([
            _pinball(actual, frame["low"].to_numpy(), 0.1),
            _pinball(actual, expected, 0.5),
            _pinball(actual, frame["high"].to_numpy(), 0.9),
        ])),
        "coverage_pct": float(np.mean((frame["low"] <= frame["price_target"]) & (frame["price_target"] <= frame["high"])) * 100),
        "mean_width": float(np.mean(frame["high"] - frame["low"])),
        "naive_mae": naive_mae,
        "seasonal_naive_mae": float(np.mean(np.abs(actual - frame["seasonal_naive"].to_numpy()))),
        "skill_vs_naive_pct": float((1 - mae / naive_mae) * 100) if naive_mae > 0 else float("nan"),
    }


def compute_metrics(evaluated: pd.DataFrame) -> dict:
    return {
        "by_horizon": {f"{h}w": _block(evaluated[evaluated["horizon"] == h]) for h in REPORTED_HORIZONS
                       if (evaluated["horizon"] == h).any()},
        "by_season": {str(season): _block(part) for season, part in evaluated.groupby("season_origin")},
        "by_grade": {str(grade): _block(part) for grade, part in evaluated.groupby("grade", observed=True)},
        "all_horizons": _block(evaluated),
    }


def run_backtest(samples: pd.DataFrame, seed: int, test_seasons: tuple[int, ...] = TEST_SEASONS,
                 first_evaluated: int = FIRST_EVALUATED_SEASON) -> BacktestResult:
    out_of_sample = []
    for season in range(first_evaluated, max(test_seasons) + 1):
        train = samples[samples["season_target"] < season]
        part = samples[samples["season_origin"] == season]
        if train.empty or part.empty:
            continue
        model = QuantileForecaster(seed).fit(train)
        out_of_sample.append(part.join(model.predict(part)))
    if not out_of_sample:
        raise ValueError("not enough seasons for a backtest")
    oos = pd.concat(out_of_sample)

    evaluated = []
    for season in test_seasons:
        calibration = oos[oos["season_origin"] < season]
        test = oos[oos["season_origin"] == season]
        if calibration.empty or test.empty:
            continue
        prices = to_prices(test, test[["q10", "q50", "q90"]], conformal_offsets(calibration))
        evaluated.append(test.join(prices).join(baselines(test)))
    evaluated_frame = pd.concat(evaluated)
    evaluated_frame = evaluated_frame[evaluated_frame["horizon"].isin(REPORTED_HORIZONS)].copy()
    return BacktestResult(
        evaluated=evaluated_frame,
        metrics=compute_metrics(evaluated_frame),
        offsets=conformal_offsets(oos),
        first_evaluated_season=first_evaluated,
        test_seasons=tuple(test_seasons),
    )
