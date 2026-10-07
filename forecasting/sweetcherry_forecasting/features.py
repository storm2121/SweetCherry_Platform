"""Forecast samples: one row per (series, origin week, horizon).

Every feature is known at the origin week: prices and arrivals up to that week,
last season's series, and the calendar (day of year, the approximate Eid
al-Adha closure). The target is the log change in the weekly price between the
origin week and the target week.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C

MAX_HORIZON = 10  # trained lead times; exports use leads 1-8 after the cutoff week
MARKET_CATEGORIES = [market.code for market in C.MARKETS]
GRADE_CATEGORIES = list(C.GRADES)
FEATURES = [
    "horizon",
    "market",
    "grade",
    "target_doy",
    "origin_doy",
    "log_price",
    "ret_1w",
    "ret_2w",
    "weeks_in_season",
    "n_reports",
    "log_market_arrivals",
    "arrivals_change",
    "last_season_path",
    "season_level",
    "eid_target_week",
]
CATEGORICAL = ["market", "grade"]
NEAREST_DAYS = 10  # last season's price is matched to the nearest week within this many days


def _eid_weeks() -> set[pd.Timestamp]:
    weeks = set()
    for date in C.EID_AL_ADHA.values():
        for day in (pd.Timestamp(date), pd.Timestamp(date) + pd.Timedelta(days=1)):
            weeks.add(day - pd.Timedelta(days=day.dayofweek))
    return weeks


EID_WEEKS = _eid_weeks()


def _season_lookup(series: pd.DataFrame) -> dict[int, tuple[np.ndarray, np.ndarray]]:
    lookup = {}
    for season, part in series.groupby("season"):
        lookup[int(season)] = (part["week"].dt.dayofyear.to_numpy(), np.log(part["price"].to_numpy()))
    return lookup


def _nearest(lookup: dict, season: int, doy: int) -> float:
    if season not in lookup:
        return np.nan
    doys, logs = lookup[season]
    distance = np.abs(doys - doy)
    position = int(np.argmin(distance))
    return float(logs[position]) if distance[position] <= NEAREST_DAYS else np.nan


def _origin_features(series: pd.DataFrame, lookup: dict, row: pd.Series, by_week: dict) -> dict:
    origin = row["week"]
    log_price = float(np.log(row["price"]))
    previous = by_week.get(origin - pd.Timedelta(days=7))
    before = by_week.get(origin - pd.Timedelta(days=14))
    season = int(row["season"])
    in_season = series[(series["season"] == season) & (series["week"] <= origin)]
    arrivals = float(np.log1p(row["market_arrivals_t"]))
    return {
        "origin_week": origin,
        "season_origin": season,
        "price_origin": float(row["price"]),
        "log_price": log_price,
        "ret_1w": log_price - np.log(previous["price"]) if previous is not None else np.nan,
        "ret_2w": log_price - np.log(before["price"]) if before is not None else np.nan,
        "weeks_in_season": len(in_season),
        "n_reports": int(row["n_reports"]),
        "log_market_arrivals": arrivals,
        "arrivals_change": arrivals - np.log1p(previous["market_arrivals_t"]) if previous is not None else np.nan,
        "origin_doy": origin.dayofyear,
        "_last_season_origin": _nearest(lookup, season - 1, origin.dayofyear),
    }


def build_samples(weekly: pd.DataFrame, with_target: bool = True, origins: dict | None = None,
                  horizons: range = range(1, MAX_HORIZON + 1)) -> pd.DataFrame:
    """Rows for model training (with_target) or prediction.

    `origins` optionally maps (market_id, grade) to the single origin week to
    use; by default every observed week is an origin.
    """
    rows = []
    for (market, grade), series in weekly.groupby(["market_id", "grade"], sort=True):
        series = series.sort_values("week")
        by_week = {week: record for week, record in zip(series["week"], series.to_dict("records"))}
        lookup = _season_lookup(series)
        if origins is not None:
            if (market, grade) not in origins:
                continue
            origin_rows = series[series["week"] == origins[(market, grade)]]
        else:
            origin_rows = series
        for _, row in origin_rows.iterrows():
            base = _origin_features(series, lookup, row, by_week)
            for horizon in horizons:
                target_week = row["week"] + pd.Timedelta(days=7 * horizon)
                target = by_week.get(target_week)
                if with_target and target is None:
                    continue
                target_doy = target_week.dayofyear
                last_target = _nearest(lookup, base["season_origin"] - 1, target_doy)
                record = {
                    **{key: value for key, value in base.items() if not key.startswith("_")},
                    "market": market,
                    "grade": grade,
                    "horizon": horizon,
                    "target_week": target_week,
                    "season_target": target_week.year,
                    "target_doy": target_doy,
                    "last_season_path": last_target - base["_last_season_origin"],
                    "season_level": base["log_price"] - base["_last_season_origin"],
                    "eid_target_week": int(target_week in EID_WEEKS),
                }
                if with_target:
                    record["price_target"] = float(target["price"])
                    record["target"] = float(np.log(target["price"]) - base["log_price"])
                rows.append(record)
    samples = pd.DataFrame(rows)
    if samples.empty:
        return samples
    samples["market"] = pd.Categorical(samples["market"], categories=MARKET_CATEGORIES)
    samples["grade"] = pd.Categorical(samples["grade"], categories=GRADE_CATEGORIES)
    return samples.sort_values(["market", "grade", "origin_week", "horizon"], kind="mergesort").reset_index(drop=True)
