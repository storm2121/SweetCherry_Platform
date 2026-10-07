"""The simulated market behaves like its documented assumptions. Bounds are
deliberately loose: they catch a broken generator, not a different seed."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from sweetcherry_forecasting import config as C
from sweetcherry_forecasting.synthetic import COLUMNS, generate
from sweetcherry_forecasting.workbook_raw import read_observations, read_provenance, write_market_workbook


def _clean_local(observations: pd.DataFrame) -> pd.DataFrame:
    return observations[(observations["status"] == "reported") & (observations["supply_type"] != "import")
                        & (observations["quality_flag"] == "")]


def test_same_seed_same_data_and_different_seed_different_data(market):
    again = generate()
    pd.testing.assert_frame_equal(market.observations, again.observations)
    pd.testing.assert_frame_equal(market.events, again.events)
    other = generate(seed=market.seed + 1)
    assert not market.observations["price_modal_mad_kg"].equals(other.observations["price_modal_mad_kg"])


def test_columns_dates_and_cutoff(market):
    observations = market.observations
    assert list(observations.columns) == COLUMNS
    assert observations["date"].min() >= market.start
    assert observations["date"].max() <= market.cutoff
    assert (observations["date"].dt.dayofweek < 6).all(), "no bulletin or closure on a Sunday"


def test_supply_types_follow_the_calendar(market):
    reported = market.observations[market.observations["status"] == "reported"]
    months = reported.groupby("supply_type")["date"].apply(lambda dates: set(dates.dt.month))
    assert months["fresh_local"] <= {4, 5, 6, 7, 8}
    assert months["cold_storage"] <= {7, 8, 9}
    assert months["import"] <= {12, 1, 2}


def test_prices_are_rounded_and_ordered(market):
    reported = market.observations[market.observations["status"] == "reported"]
    for column in ("price_min_mad_kg", "price_modal_mad_kg", "price_max_mad_kg"):
        assert np.allclose(reported[column] * 2, np.round(reported[column] * 2))
    assert (reported["price_min_mad_kg"] < reported["price_modal_mad_kg"]).all()
    assert (reported["price_modal_mad_kg"] < reported["price_max_mad_kg"]).all()
    closed = market.observations[market.observations["status"] == "closed_holiday"]
    assert closed["price_modal_mad_kg"].isna().all()


def test_grade_premiums_and_market_spreads(market):
    local = _clean_local(market.observations)
    grades = local.pivot_table(index=["date", "market_id"], columns="grade", values="price_modal_mad_kg").dropna()
    assert ((grades["A"] < grades["AA"]) & (grades["AA"] < grades["AAA"])).mean() > 0.98
    assert 0.66 < (grades["A"] / grades["AA"]).median() < 0.74
    assert 1.38 < (grades["AAA"] / grades["AA"]).median() < 1.52
    markets = local[local["grade"] == "AA"].pivot_table(index="date", columns="market_id", values="price_modal_mad_kg")
    assert 1.01 < (markets["M02"] / markets["M01"]).median() < 1.09
    assert 1.03 < (markets["M03"] / markets["M01"]).median() < 1.12


def test_season_shape_peak_and_shoulders(weekly):
    casablanca = weekly[(weekly["market_id"] == "M01") & (weekly["grade"] == "AA") & (weekly["season"] < 2026)]
    for season, part in casablanca.groupby("season"):
        part = part.sort_values("week")
        assert 12 <= part["price"].min() <= 32, f"{season}: implausible peak-season price"
        assert part["price"].iloc[0] > 1.5 * part["price"].min(), f"{season}: no first-fruit premium"


def test_markets_move_together_but_not_identically(weekly):
    aa = weekly[weekly["grade"] == "AA"].pivot(index="week", columns="market_id", values="price")
    changes = np.log(aa).diff()
    changes = changes[changes.index.to_series().diff().dt.days == 7]
    correlations = changes.corr().to_numpy()[np.triu_indices(3, 1)]
    assert (correlations > 0.7).all() and (correlations < 0.97).all()


def test_noise_is_larger_at_the_shoulders_than_at_the_peak(market):
    local = _clean_local(market.observations)
    series = local[(local["market_id"] == "M01") & (local["grade"] == "AA") & (local["supply_type"] == "fresh_local")].copy()
    series["season"] = series["date"].dt.year
    series["day"] = (series["date"] - series.groupby("season")["date"].transform("min")).dt.days
    series["change"] = np.log(series["price_modal_mad_kg"]).groupby(series["season"]).diff()
    early = series[series["day"] < 10]["change"].std()
    peak = series[(series["day"] >= 20) & (series["day"] <= 40)]["change"].std()
    assert early > peak


def test_recording_imperfections_are_present_but_rare(market):
    observations = market.observations
    local = observations[(observations["status"] == "reported") & (observations["supply_type"] != "import")]
    outliers = (local["quality_flag"] == "explained_outlier").mean()
    suspect = (local["quality_flag"] == "suspect_entry").mean()
    assert 0 < outliers < 0.015 and 0 < suspect < 0.006
    assert (local.loc[local["quality_flag"] != "", "remark"] != "").all(), "every flagged line has a remark"
    assert (observations["status"] == "closed_holiday").any()
    # Share of trading days on which each market published a bulletin, over all years.
    reported_days = local.groupby("market_id")["date"].nunique()
    union_days = local["date"].nunique()
    share = reported_days / union_days
    assert ((share > 0.7) & (share < 0.97)).all(), "every market misses some bulletins, none misses most"


def test_simulated_events_cover_frost_and_bumper_years(market):
    events = market.events
    complete = events[events["year"] < market.cutoff.year]
    assert {"frost", "bumper"} <= set(complete["event"])
    assert (events["start"] <= market.cutoff).all()
    both = events.groupby("year")["event"].apply(set)
    assert not any({"frost", "bumper"} <= kinds for kinds in both), "frost and bumper never share a year"


def test_workbook_round_trip_and_provenance(market, tmp_path):
    path = write_market_workbook(market, tmp_path / "market.xlsx", generated_at="2026-01-01T00:00:00Z")
    back = read_observations(path)
    expected = market.observations.copy()
    pd.testing.assert_frame_equal(back, expected, check_dtype=False)
    info = read_provenance(path)
    assert info["provenance"] == "synthetic"
    assert info["seed"] == str(market.seed)
    assert info["dataCutoff"] == market.cutoff.date().isoformat()


@pytest.mark.parametrize("cutoff", ["2017-06-01", "2018-01-01"])
def test_cutoff_must_follow_start(cutoff):
    with pytest.raises(ValueError):
        generate(start="2018-01-01", cutoff=cutoff)


def test_assumptions_sheet_lists_every_region_and_event():
    rows = C.assumption_rows()
    text = " ".join(" ".join(row) for row in rows)
    for region in C.REGIONS:
        assert region.name in text
    for name in C.EVENT_PROBABILITY:
        assert name.replace("_", " ") in text
