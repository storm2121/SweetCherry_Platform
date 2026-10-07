# Leaf classifier: training and conversion

The scripts that produced the browser model in `public/models/cherry_multiclass/`, plus two earlier models that are not shipped. The model card, with its evaluation status and limitations, is in [../docs/MODEL_CARDS.md](../docs/MODEL_CARDS.md).

| Script | Produces | Shipped |
|---|---|---|
| `train_cherry_multiclass.py` | Six-class cherry-leaf model: healthy, powdery mildew, brown spot, leaf scorch, purple leaf spot, shot hole (MobileNetV2 + small head) | Yes, as `public/models/cherry_multiclass/` |
| `convert_keras_to_tfjs.py` | TensorFlow.js graph model from the trained SavedModel (float16 by default; `TFJS_QUANTIZE=none\|float16\|uint8`) | Yes |
| `verify_cherry_multiclass.py` | Prints the converted model's predictions on sample folders | Tool |
| `train_cherry_binary.py`, `verify_cherry_binary.py`, `verify_cherry_binary.mjs` | Earlier two-class model (healthy vs powdery mildew) | No |
| `convert.py`, `verify.mjs` | Converts the third-party Hugging Face model `linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification` (38 PlantVillage classes), used in an early prototype | No; licence not verified |

## Data

The training images are not in this repository. The scripts expect two public Kaggle datasets on disk:

| Variable | Default | Content |
|---|---|---|
| `CHERRY_AUGMENTED_DIR` | `D:\FarmData\Leaves\Kaggle_Leaves_7.5\New Plant Diseases Dataset(Augmented)` | "New Plant Diseases Dataset (Augmented)": its `train/` and `valid/` cherry folders |
| `CHERRY_FIVE_CLASS_DIR` | `D:\FarmData\Leaves\Kaggle_Leaves_6.88_diseases\Cherry` | A five-class cherry-leaf set with `train/` and `test/` folders |

`train_cherry_binary.py` reads only `CHERRY_AUGMENTED_DIR`. Its default omits the `Leaves` folder level.

The exact Kaggle pages and licences were not recorded. Confirm them before redistributing anything trained on these images.

## Retrain and convert

TensorFlow 2.15 and tensorflowjs are needed. They aren't listed in `forecasting/requirements.txt`, because the forecasting code does not use them.

```bash
python models/train_cherry_multiclass.py          # trains, prints a validation confusion matrix, writes the SavedModel
python models/convert_keras_to_tfjs.py            # writes the TF.js model
node scripts/fingerprint-edge-model.mjs           # updates src/data/edgeModelFingerprint.json
```

Read any validation figure with care:
- The dataset versions and their train/validation split are not recorded, so overlap between related or augmented images in the two folders cannot be ruled out. This is a possible bias, not a verified finding.
- Early stopping uses the same validation set.
