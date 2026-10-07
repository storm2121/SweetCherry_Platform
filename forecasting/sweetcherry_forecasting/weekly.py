"""Weekly local-price series: the forecasting target."""

from __future__ import annotations

import pandas as pd

LOCAL_SUPPLY = ("fresh_local", "cold_storage")


def week_start(dates: pd.Series) -> pd.Series:
    """Monday of the ISO week containing each date."""
    dates = pd.to_datetime(dates).dt.normalize()
    return dates - pd.to_timedelta(dates.dt.dayofweek, unit="D")


def weekly_series(observations: pd.DataFrame) -> pd.DataFrame:
    """Median modal price per market, grade and week, from reported local lines.

    Lines flagged suspect_entry are left out (a data-quality check would hold
    them back); explained outliers are real transactions and stay in, where the
    weekly median limits their weight. Imported fruit is a different product and
    is not part of the local series.
    """
    usable = observations[
        (observations["status"] == "reported")
        & observations["supply_type"].isin(LOCAL_SUPPLY)
        & (observations["quality_flag"] != "suspect_entry")
        & observations["price_modal_mad_kg"].notna()
    ].copy()
    usable["week"] = week_start(usable["date"])
    by_line = usable.groupby(["market_id", "grade", "week"]).agg(
        price=("price_modal_mad_kg", "median"),
        n_reports=("price_modal_mad_kg", "size"),
        arrivals_t=("arrivals_t", "sum"),
    )
    market_arrivals = usable.groupby(["market_id", "week"])["arrivals_t"].sum().rename("market_arrivals_t")
    weekly = by_line.reset_index().merge(market_arrivals.reset_index(), on=["market_id", "week"], how="left")
    weekly["season"] = weekly["week"].dt.year
    return weekly.sort_values(["market_id", "grade", "week"], kind="mergesort").reset_index(drop=True)
