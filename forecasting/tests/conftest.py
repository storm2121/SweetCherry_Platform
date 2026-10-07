from __future__ import annotations

import pytest

from sweetcherry_forecasting import DEFAULT_SEED
from sweetcherry_forecasting.backtest import run_backtest
from sweetcherry_forecasting.features import build_samples
from sweetcherry_forecasting.synthetic import generate
from sweetcherry_forecasting.weekly import weekly_series


@pytest.fixture(scope="session")
def market():
    return generate()


@pytest.fixture(scope="session")
def weekly(market):
    return weekly_series(market.observations)


@pytest.fixture(scope="session")
def samples(weekly):
    return build_samples(weekly)


@pytest.fixture(scope="session")
def backtest(samples):
    return run_backtest(samples, seed=DEFAULT_SEED)
