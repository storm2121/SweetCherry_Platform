"""LightGBM quantile models (P10, P50, P90) on the log price change, with
conformal calibration of the P10-P90 interval and two simple baselines."""

from __future__ import annotations

import math

import lightgbm as lgb
import numpy as np
import pandas as pd

from .features import CATEGORICAL, FEATURES

QUANTILES = (0.1, 0.5, 0.9)
INTERVAL_COVERAGE = 0.8  # P10 to P90
MIN_CALIBRATION_ROWS = 30
BOOST_ROUNDS = 400
LGBM_PARAMS = {
    "objective": "quantile",
    "learning_rate": 0.03,
    "num_leaves": 15,
    "min_data_in_leaf": 20,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "feature_fraction": 0.8,
    "lambda_l2": 1.0,
    "deterministic": True,
    "force_row_wise": True,
    "num_threads": 1,
    "verbosity": -1,
}


class QuantileForecaster:
    def __init__(self, seed: int):
        self.seed = seed
        self.models: dict[float, lgb.Booster] = {}

    def fit(self, samples: pd.DataFrame) -> "QuantileForecaster":
        if samples.empty:
            raise ValueError("no training samples")
        for quantile in QUANTILES:
            dataset = lgb.Dataset(samples[FEATURES], label=samples["target"], categorical_feature=CATEGORICAL,
                                  free_raw_data=False)
            params = {**LGBM_PARAMS, "alpha": quantile, "seed": self.seed}
            self.models[quantile] = lgb.train(params, dataset, num_boost_round=BOOST_ROUNDS)
        return self

    def predict(self, samples: pd.DataFrame) -> pd.DataFrame:
        raw = np.column_stack([self.models[quantile].predict(samples[FEATURES]) for quantile in QUANTILES])
        raw.sort(axis=1)  # no quantile crossing
        return pd.DataFrame(raw, columns=["q10", "q50", "q90"], index=samples.index)


def _finite_sample_quantile(scores: np.ndarray, level: float) -> float:
    ordered = np.sort(scores)
    rank = math.ceil((len(ordered) + 1) * level)
    return float(ordered[min(rank, len(ordered)) - 1])


def conformal_offsets(predictions: pd.DataFrame) -> dict[int, float]:
    """Conformalized quantile regression: widen (or narrow) the P10-P90 interval
    so that about 80% of past out-of-sample targets fall inside, per horizon,
    falling back to all horizons pooled when a horizon has few rows."""
    scores = np.maximum(predictions["q10"] - predictions["target"], predictions["target"] - predictions["q90"])
    pooled = _finite_sample_quantile(scores.to_numpy(), INTERVAL_COVERAGE)
    offsets = {}
    for horizon in sorted(predictions["horizon"].unique()):
        mask = predictions["horizon"] == horizon
        offsets[int(horizon)] = (
            _finite_sample_quantile(scores[mask].to_numpy(), INTERVAL_COVERAGE)
            if mask.sum() >= MIN_CALIBRATION_ROWS else pooled
        )
    offsets[0] = pooled  # used for any horizon without its own offset
    return offsets


def to_prices(samples: pd.DataFrame, predictions: pd.DataFrame, offsets: dict[int, float]) -> pd.DataFrame:
    """Calibrated price quantiles (MAD/kg), ordered low <= expected <= high."""
    offset = samples["horizon"].map(lambda horizon: offsets.get(int(horizon), offsets[0])).astype(float)
    low_log = np.minimum(predictions["q10"] - offset, predictions["q50"])
    high_log = np.maximum(predictions["q90"] + offset, predictions["q50"])
    origin = samples["price_origin"]
    return pd.DataFrame({
        "low": origin * np.exp(low_log),
        "expected": origin * np.exp(predictions["q50"]),
        "high": origin * np.exp(high_log),
    }, index=samples.index)


def baselines(samples: pd.DataFrame) -> pd.DataFrame:
    """Naive: the origin week's price. Seasonal naive: the origin price moved
    along last season's path between the same days of the year."""
    path = samples["last_season_path"].fillna(0.0)
    return pd.DataFrame({
        "naive": samples["price_origin"],
        "seasonal_naive": samples["price_origin"] * np.exp(path),
    }, index=samples.index)
