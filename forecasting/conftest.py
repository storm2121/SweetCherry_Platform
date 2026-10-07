"""Keeps pytest's temporary files in forecasting/.pytest-tmp (git-ignored),
whatever the working directory. Some Windows machines deny access to the
default folder under %TEMP%."""

from pathlib import Path

import pytest


@pytest.hookimpl(tryfirst=True)
def pytest_configure(config):
    if not config.option.basetemp:
        config.option.basetemp = str(Path(__file__).resolve().parent / ".pytest-tmp")
