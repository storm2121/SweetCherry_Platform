"""P10/P50/P90 forecast for the eight weeks after a cutoff date."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from . import config as C
from .features import MAX_HORIZON, build_samples
from .model import QuantileForecaster, to_prices

MAX_LEAD = 8  # weeks after the cutoff week; the v1 contract publishes 1w-8w only
STALE_DAYS = 14  # a series with no price in the two weeks before the cutoff is not forecast


@dataclass
class Forecast:
    cutoff: pd.Timestamp
    cutoff_week: pd.Timestamp
    rows: dict[str, list[dict]] = field(default_factory=dict)  # grade -> contract rows
    note: str = ""

    @property
    def row_count(self) -> int:
        return sum(len(rows) for rows in self.rows.values())


def _typical_last_week_doy(weekly: pd.DataFrame, before_year: int) -> int:
    past = weekly[weekly["season"] < before_year]
    last_weeks = past.groupby("season")["week"].max()
    return int(last_weeks.dt.dayofyear.median())


def forecast_at_cutoff(weekly: pd.DataFrame, cutoff: str | pd.Timestamp, seed: int,
                       offsets: dict[int, float]) -> Forecast:
    cutoff = pd.Timestamp(cutoff).normalize()
    cutoff_week = cutoff - pd.Timedelta(days=cutoff.dayofweek)
    history = weekly[weekly["week"] <= cutoff_week]
    result = Forecast(cutoff=cutoff, cutoff_week=cutoff_week, rows={grade: [] for grade in C.GRADES})

    origins = {}
    for (market, grade), series in history.groupby(["market_id", "grade"]):
        last = series["week"].max()
        if (cutoff_week - last).days <= STALE_DAYS:
            origins[(market, grade)] = last
    if not origins:
        result.note = ("No local cherries traded in the two weeks before the cutoff: the local season is over or "
                       "has not started, so there is nothing to forecast for the next eight weeks.")
        return result

    training = build_samples(history, with_target=True)
    training = training[training["target_week"] <= cutoff_week]
    model = QuantileForecaster(seed).fit(training)

    candidates = build_samples(history, with_target=False, origins=origins)
    lead = (candidates["target_week"] - cutoff_week).dt.days // 7
    last_doy = _typical_last_week_doy(weekly, cutoff.year)
    keep = (lead >= 1) & (lead <= MAX_LEAD) & (candidates["horizon"] <= MAX_HORIZON) \
        & (candidates["target_week"].dt.dayofyear <= last_doy)
    selected = candidates[keep].copy()
    selected["lead"] = lead[keep]
    if selected.empty:
        result.note = "The eight weeks after the cutoff fall after the usual end of the local season."
        return result

    prices = to_prices(selected, model.predict(selected), offsets)
    selected = selected.join(prices)
    for record in selected.sort_values(["grade", "market", "target_week"]).itertuples(index=False):
        result.rows[str(record.grade)].append({
            "date": record.target_week.date().isoformat(),
            "market": str(record.market),
            "low": round(float(record.low), 2),
            "expected": round(float(record.expected), 2),
            "high": round(float(record.high), 2),
            "horizonType": "short_term",
            "horizon": f"{int(record.lead)}w",
        })
    weeks = sorted(selected["target_week"].unique())
    result.note = (f"Forecasts for the weeks starting {pd.Timestamp(weeks[0]).date()} to {pd.Timestamp(weeks[-1]).date()}, "
                   f"made with data up to {cutoff.date()}.")
    return result
