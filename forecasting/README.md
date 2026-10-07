# Forecasting

This folder contains:
- a deterministic generator of **simulated** wholesale cherry prices;
- a 1–8 week P10/P50/P90 forecaster (LightGBM quantile models);
- a causal backtest;
- exports in the format the admin dashboard uploads.

Everything here runs on simulated data. See [../docs/DATA.md](../docs/DATA.md) and [../docs/MODEL_CARDS.md](../docs/MODEL_CARDS.md).

## Set up

Python 3.11 or newer.

```bash
cd forecasting
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
# .venv/bin/python -m pip install -r requirements.txt     # macOS / Linux
```

## Run

Activate the venv first, or call `.venv/Scripts/python` directly.

```bash
python -m sweetcherry_forecasting all          # generate the data, backtest, forecast, update the model card (~20 s)
python -m sweetcherry_forecasting generate     # only the simulated market workbook
python -m sweetcherry_forecasting run          # backtest and forecast from the market workbook
python -m sweetcherry_forecasting check-docs   # fail if docs/MODEL_CARDS.md is out of date
python -m pytest                               # all tests (~1 minute)
```

Options:
- `--seed` and `--cutoff YYYY-MM-DD` work with `generate`, `run` and `all`.
- `run --data PATH` reads another market workbook with the same `Observations` sheet.
- `run --no-docs` leaves the model card alone.

## Files

| Path | What |
|---|---|
| `sweetcherry_forecasting/config.py` | Every simulation assumption; also written to the workbook's Assumptions sheet |
| `sweetcherry_forecasting/synthetic.py` | The generator |
| `sweetcherry_forecasting/workbook_raw.py` | Market workbook writer and reader |
| `sweetcherry_forecasting/weekly.py` | Weekly local-price series (the target) |
| `sweetcherry_forecasting/features.py` | Forecast samples; every feature is known at the origin week |
| `sweetcherry_forecasting/model.py` | Quantile models, conformal calibration, baselines |
| `sweetcherry_forecasting/backtest.py` | Rolling-season backtest and metrics |
| `sweetcherry_forecasting/forecast.py` | The forecast for the eight weeks after a cutoff |
| `sweetcherry_forecasting/export.py` | Forecast workbook (Grade sheets + About) and JSON |
| `samples/` | Committed outputs: the simulated market workbook and the 2026-05-24 forecast (xlsx, json) |
| `reports/backtest_metrics.json` | Backtest figures behind the model-card table |
| `tests/` | pytest suite |

## Limits

- **Simulated data only.** Backtest figures check the code, not real-world accuracy.
- **Horizons 1w–8w only,** and only while local fruit is trading. An off-season cutoff gives an empty forecast with the reason in its About sheet.
- **The 2026-05-24 forecast is a fixed demonstration snapshot,** not current market data.
