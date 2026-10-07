# Model cards

Two models live in this repository: a price-range forecaster (`forecasting/`) and a cherry-leaf image classifier (`models/`, shipped in `public/models/cherry_multiclass/`). Neither has been validated on real Moroccan market prices or field photos. Each card says what has and has not been checked.

## 1. Cherry price-range forecaster

| | |
|---|---|
| Version | `lgbm-quantile-1w8w-1.0.0` |
| Code | `forecasting/sweetcherry_forecasting/` |
| Output | Weekly P10, P50 and P90 wholesale price (MAD/kg) per grade (A, AA, AAA) and market (Casablanca, Rabat, Marrakech), 1 to 8 weeks after a cutoff date |
| Trained and evaluated on | **Simulated data only**: generator 1.0.0, seed 20260524, 2018-01-01 to 2026-05-24 (see [DATA.md](DATA.md)) |
| Sample output | `forecasting/samples/sweetcherry_forecast_SIMULATED_2026-05-24.xlsx` and `.json`, a fixed demonstration snapshot, not current market data |

### What it predicts

The target is the change in the log weekly price between the last observed week (the origin) and a target week 1 to 8 weeks later. The weekly price is the median modal price of local fruit (fresh or cold-stored) on that market and grade. Imported fruit is excluded because it is a different product. Lines that a data check would hold back (`suspect_entry`) are excluded too.

Forecasts are made only while the local market trades. If no local fruit was quoted in the two weeks before the cutoff, the export is empty, and its About sheet says why. Target weeks after the usual end of the season are left out.

### Method

- **Features**, all known at the origin week:
  - horizon, market, grade, day of year of the origin and of the target;
  - the origin price, and its change over the last one and two weeks;
  - how many weeks of the season have been seen, and the number of reports;
  - market arrivals and their change;
  - last season's price path between the same days of the year, and this season's level against last season's;
  - whether the target week contains the (approximate) Eid al-Adha closure.
- **Models:** three LightGBM boosters with the quantile objective (alpha 0.1, 0.5 and 0.9), 400 rounds, 15 leaves, learning rate 0.03, deterministic, single-threaded. Quantiles are sorted to prevent crossing.
- **Calibration:** conformalized quantile regression, per horizon. The P10–P90 interval is widened or narrowed so that 80% of past out-of-sample weeks would have fallen inside. A horizon with fewer than 30 calibration rows uses the pooled value.
- **Baselines:**
  - *Naive:* the origin week's price.
  - *Seasonal naive:* the origin price moved along last season's path.

### How it was evaluated

The backtest is rolling by season. Every season from 2020 to 2025 is predicted by models trained only on samples whose target week lies in an earlier season. Each test season from 2021 to 2025 is calibrated only on the out-of-sample predictions of the seasons before it. `forecasting/tests/test_pipeline.py` checks both rules: corrupting later seasons does not change earlier forecasts, and altering data after an origin does not change its features.

<!-- BEGIN GENERATED: forecast-backtest -->
Rolling-season backtest on **simulated** seasons 2021-2025 (generator 1.0.0, seed 20260524, model lgbm-quantile-1w8w-1.0.0). A code check, not real-world accuracy. Generated from `forecasting/reports/backtest_metrics.json`.

| Horizon | n | MAE (MAD/kg) | MAPE | P10-P90 coverage | Naive MAE | Seasonal-naive MAE |
|---|---:|---:|---:|---:|---:|---:|
| 1w | 544 | 4.31 | 11.9% | 76% | 6.75 | 6.37 |
| 2w | 500 | 4.92 | 14.2% | 75% | 11.00 | 8.97 |
| 3w | 459 | 5.48 | 15.4% | 77% | 14.43 | 10.28 |
| 4w | 415 | 5.96 | 16.3% | 81% | 17.39 | 11.07 |
| 5w | 370 | 6.31 | 16.7% | 79% | 20.02 | 12.42 |
| 6w | 325 | 6.95 | 18.7% | 82% | 22.48 | 14.37 |
| 7w | 280 | 7.31 | 19.0% | 79% | 24.40 | 17.28 |
| 8w | 235 | 7.85 | 19.1% | 75% | 26.17 | 20.03 |
| All | 3128 | 5.84 | 15.8% | 78% | 16.21 | 11.53 |
<!-- END GENERATED: forecast-backtest -->

These figures come from simulated data whose rules the model can learn. They show that the code works and that the intervals are calibrated as designed. **They are not evidence of accuracy on a real market.** No accuracy figure from earlier phases of the project is reproduced here, because none could be traced to code or data.

### Limitations

- Real prices will behave differently. Before the forecaster is used for decisions, it must be re-evaluated on observed data with the same backtest.
- Longer horizons (9–52 weeks, 1–5 years) are not produced. With about 15 trading weeks per season, they could not be validated honestly.
- The data cover one season per year, eight complete seasons in all. Unusual years, such as frost or bumper crops, are rare in the training data, and intervals for them are less reliable.
- Eid al-Adha dates are approximate (±1 day). The model knows nothing about imports, exports or prices outside the three markets.

### Reproduce

```bash
cd forecasting
python -m sweetcherry_forecasting all      # regenerate the data, backtest, forecast and this table
python -m pytest                            # generator, no-look-ahead, contract and reproducibility tests
```

## 2. Cherry-leaf disease classifier

| | |
|---|---|
| Shipped as | `public/models/cherry_multiclass/` (TensorFlow.js graph model, float16 weights) |
| Integrity | SHA-256 fingerprint in `src/data/edgeModelFingerprint.json`, written by `scripts/fingerprint-edge-model.mjs` |
| Used by | The admin dashboard's model tester only. Farmers' photos go to an agronomist; the model's output is never shown to farmers as advice. |
| Classes | healthy, powdery mildew, brown spot, leaf scorch, purple leaf spot, shot hole |
| Training code | `models/train_cherry_multiclass.py`; conversion in `models/convert_keras_to_tfjs.py` |

### Architecture and training

**Network:**
- **Input:** 224×224 RGB scaled to [0, 1], then rescaled inside the model to [-1, 1].
- **Backbone:** MobileNetV2 with ImageNet weights and no top.
- **Head:** global average pooling, dropout 0.3, a 128-unit ReLU layer, and a 6-unit softmax.

**Training:**
- **Phase A:** the head only, for up to 10 epochs at a learning rate of 1e-3.
- **Phase B:** the last 20 backbone layers are fine-tuned for up to 5 epochs at 1e-5.
- Both phases use early stopping on validation accuracy, class weights against imbalance, and seed 42.

**Training data** come from two public Kaggle leaf datasets:
- the cherry folders of "New Plant Diseases Dataset (Augmented)": healthy and powdery mildew;
- a five-class cherry-leaf set: normal, brown spot, leaf scorch, purple leaf spot, shot hole.

The script uses each dataset's own train and validation (or test) folders. The exact Kaggle pages and their licences are not recorded in the project and still need to be confirmed. The images are not included in this repository.

### Evaluation status

**Not re-evaluated for this release.** The datasets were not available on the build machine, and no evaluation report was kept from earlier runs. When retrained, the training script prints a validation confusion matrix. Read any such figure with care:

- The exact dataset versions and how their training and validation folders were split are not recorded. Overlap between related or augmented images in the two folders therefore cannot be ruled out. If present, it would inflate validation accuracy. This is a possible bias, not a verified finding.
- Early stopping picks the epoch on that same validation set.
- Nothing has been measured on photos taken in Moroccan orchards, which may differ from the public dataset images in background, lighting and leaf condition.

### Not shipped

- **`models/train_cherry_binary.py`:** an earlier two-class model (healthy vs powdery mildew).
- **`models/convert.py`:** converts the third-party Hugging Face model `linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification` (38 PlantVillage classes), used in an early prototype. Its weights are not included, and its licence has not been verified.
