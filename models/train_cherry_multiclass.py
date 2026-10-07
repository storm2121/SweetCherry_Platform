"""
SweetCherry — train a 6-class cherry-leaf classifier.

Combines two Kaggle datasets (a binary mildew/healthy set and a 5-class
disease set whose Cherry Normal leaf folder is folded into healthy):

    Index  Class id            Sources
    -----  -----------------   ----------------------------------------------
        0  healthy             new "Cherry Normal leaf" + old "...___healthy"
        1  powdery_mildew      old "Cherry_(including_sour)___Powdery_mildew"
        2  brown_spot          new "Cherry brown_spot"
        3  leaf_scorch         new "Cherry Leaf Scorch"
        4  purple_leaf_spot    new "Cherry purple leaf spot"
        5  shot_hole           new "Cherry_shot hole disease"

Why this script (and not train_cherry_binary.py edited in place):
- New file leaves the binary script intact as historical reference.
- Two dataset roots → can't use image_dataset_from_directory; we build an
  explicit (filepath, label) tuple list and feed tf.data.Dataset directly,
  avoiding any file copying.
- Class imbalance (shot_hole 440 vs healthy 2326) → class_weight applied.
- Real-world photo robustness → much stronger augmentation than binary.

Pipeline:
    1. Walk both dataset roots, build (path, label) lists for train + valid
    2. Phase A — frozen backbone, train head only (10 epochs @ LR=1e-3)
    3. Phase B — unfreeze last 20 layers, fine-tune (5 epochs @ LR=1e-5)
    4. Print full 6×6 confusion matrix on the validation set
    5. Export TF SavedModel to models/cherry_multiclass_savedmodel/

Run:
    cd models
    .venv\\Scripts\\activate.bat
    python train_cherry_multiclass.py
"""

from __future__ import annotations

import os
import sys
import shutil
from collections import Counter
from pathlib import Path

# Force UTF-8 so progress bars / class names with Arabic don't crash cp1252.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import tensorflow as tf
from tensorflow.keras import Input, Model, layers
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
from tensorflow.keras.optimizers import Adam


# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #
HERE = Path(__file__).resolve().parent

# Existing 2-class dataset (cherry healthy / powdery mildew, augmented)
# Dataset folders; set CHERRY_AUGMENTED_DIR / CHERRY_FIVE_CLASS_DIR to override.
OLD_ROOT = Path(os.environ.get("CHERRY_AUGMENTED_DIR", r"D:\FarmData\Leaves\Kaggle_Leaves_7.5\New Plant Diseases Dataset(Augmented)"))
OLD_TRAIN = OLD_ROOT / "train"
OLD_VALID = OLD_ROOT / "valid"
OLD_HEALTHY = "Cherry_(including_sour)___healthy"
OLD_MILDEW = "Cherry_(including_sour)___Powdery_mildew"

# New 5-class dataset (uses test/ rather than valid/)
NEW_ROOT = Path(os.environ.get("CHERRY_FIVE_CLASS_DIR", r"D:\FarmData\Leaves\Kaggle_Leaves_6.88_diseases\Cherry"))
NEW_TRAIN = NEW_ROOT / "train"
NEW_VALID = NEW_ROOT / "test"
NEW_NORMAL = "Cherry Normal leaf"
NEW_DISEASE_FOLDERS = {
    2: "Cherry brown_spot",
    3: "Cherry Leaf Scorch",
    4: "Cherry purple leaf spot",
    5: "Cherry_shot hole disease",
}

SAVED_DIR = HERE / "cherry_multiclass_savedmodel"

CLASS_NAMES = [
    "healthy",
    "powdery_mildew",
    "brown_spot",
    "leaf_scorch",
    "purple_leaf_spot",
    "shot_hole",
]
NUM_CLASSES = len(CLASS_NAMES)

IMG_SIZE = (224, 224)
BATCH_SIZE = 32
SEED = 42
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".JPG", ".JPEG", ".PNG"}


# --------------------------------------------------------------------------- #
# Sample collection
# --------------------------------------------------------------------------- #
def collect_split(old_root: Path, new_root: Path) -> list[tuple[str, int]]:
    """Build list of (filepath, class_index) tuples for one split (train or valid)."""
    samples: list[tuple[str, int]] = []

    def add_folder(folder: Path, label: int) -> int:
        if not folder.exists():
            print(f"  WARNING: folder missing — {folder}")
            return 0
        n = 0
        for p in folder.iterdir():
            if p.is_file() and p.suffix in IMAGE_EXTS:
                samples.append((str(p), label))
                n += 1
        return n

    print(f"  + class 0 (healthy)         from {new_root / NEW_NORMAL}")
    n0a = add_folder(new_root / NEW_NORMAL, 0)
    print(f"      → {n0a} images")
    print(f"  + class 0 (healthy)         from {old_root / OLD_HEALTHY}")
    n0b = add_folder(old_root / OLD_HEALTHY, 0)
    print(f"      → {n0b} images")

    print(f"  + class 1 (powdery_mildew)  from {old_root / OLD_MILDEW}")
    n1 = add_folder(old_root / OLD_MILDEW, 1)
    print(f"      → {n1} images")

    for cls_id, folder_name in NEW_DISEASE_FOLDERS.items():
        path = new_root / folder_name
        print(f"  + class {cls_id} ({CLASS_NAMES[cls_id]}) from {path}")
        n = add_folder(path, cls_id)
        print(f"      → {n} images")

    return samples


# --------------------------------------------------------------------------- #
# tf.data pipeline
# --------------------------------------------------------------------------- #
def load_image(path: tf.Tensor, label: tf.Tensor):
    """Decode image from path, resize to IMG_SIZE, normalize to [0, 1]."""
    raw = tf.io.read_file(path)
    # decode_image with expand_animations=False handles JPG/PNG/BMP without breaking shape
    img = tf.io.decode_image(raw, channels=3, expand_animations=False)
    img.set_shape([None, None, 3])
    img = tf.image.resize(img, IMG_SIZE, method=tf.image.ResizeMethod.BILINEAR)
    img = tf.cast(img, tf.float32) / 255.0  # model has internal Rescaling [0,1]→[-1,1]
    return img, label


def make_dataset(samples: list[tuple[str, int]], shuffle: bool) -> tf.data.Dataset:
    paths = [s[0] for s in samples]
    labels = [s[1] for s in samples]
    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if shuffle:
        ds = ds.shuffle(buffer_size=min(len(samples), 4096), seed=SEED, reshuffle_each_iteration=True)
    ds = ds.map(load_image, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)
    return ds


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #
def build_model():
    # Geometric-only augmentation — color-based aug (Brightness/Contrast) was
    # removed after v1 testing: it washed out the purple/brown color distinction
    # needed to separate purple_leaf_spot from brown_spot and leaf_scorch.
    # Geometric augmentations still help generalization without destroying the
    # disease's color signature.
    augment = tf.keras.Sequential(
        [
            layers.RandomFlip("horizontal"),
            layers.RandomRotation(0.10),
            layers.RandomTranslation(0.10, 0.10),
            layers.RandomZoom(0.20),
        ],
        name="augmentation",
    )

    rescale = layers.Rescaling(scale=2.0, offset=-1.0, name="rescale_neg1_1")

    inputs = Input(shape=IMG_SIZE + (3,), name="pixel_values")
    x = augment(inputs)   # active only during training
    x = rescale(x)        # always active — [0, 1] -> [-1, 1] for MobileNetV2

    base = MobileNetV2(input_shape=IMG_SIZE + (3,), include_top=False, weights="imagenet")
    base.trainable = False
    # training=False keeps BN in inference mode even during Phase B fine-tuning
    x = base(x, training=False)

    x = layers.GlobalAveragePooling2D(name="gap")(x)
    x = layers.Dropout(0.3, name="dropout")(x)
    x = layers.Dense(128, activation="relu", name="head_fc")(x)
    outputs = layers.Dense(NUM_CLASSES, activation="softmax", name="probabilities")(x)

    return Model(inputs, outputs, name="cherry_multiclass"), base


# --------------------------------------------------------------------------- #
# Class weights for imbalance
# --------------------------------------------------------------------------- #
def compute_class_weights(samples: list[tuple[str, int]]) -> dict[int, float]:
    """
    Inverse-frequency weighting so under-represented classes (shot_hole, ~440)
    don't get drowned out by healthy (~2,326).
    weight_i = total / (num_classes * count_i)
    """
    counts = Counter(s[1] for s in samples)
    total = sum(counts.values())

    # Hard-fail if any class has 0 samples — usually means a folder path is wrong.
    empty = [i for i in range(NUM_CLASSES) if counts.get(i, 0) == 0]
    if empty:
        empty_names = ", ".join(f"{i}={CLASS_NAMES[i]}" for i in empty)
        raise SystemExit(
            f"\nERROR: classes with 0 samples: {empty_names}.\n"
            f"Check the WARNINGs above for missing folder paths and fix OLD_ROOT / NEW_ROOT.\n"
        )

    weights = {i: total / (NUM_CLASSES * counts[i]) for i in range(NUM_CLASSES)}
    print("\nClass weights (inverse frequency):")
    for i in range(NUM_CLASSES):
        print(f"  class {i} ({CLASS_NAMES[i]:<18}): count={counts[i]:5d}  weight={weights[i]:.3f}")
    return weights


# --------------------------------------------------------------------------- #
# Confusion matrix
# --------------------------------------------------------------------------- #
def evaluate_with_confusion(model, valid_ds, valid_samples):
    y_true, y_pred = [], []
    for batch_x, batch_y in valid_ds:
        probs = model.predict(batch_x, verbose=0)
        y_true.append(batch_y.numpy())
        y_pred.append(np.argmax(probs, axis=1))
    y_true = np.concatenate(y_true)
    y_pred = np.concatenate(y_pred)

    cm = np.zeros((NUM_CLASSES, NUM_CLASSES), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1

    print("\nValidation confusion matrix")
    header = "actual \\ pred  " + "  ".join(f"{CLASS_NAMES[i][:10]:>10s}" for i in range(NUM_CLASSES))
    print(header)
    for i in range(NUM_CLASSES):
        row = "  ".join(f"{cm[i, j]:10d}" for j in range(NUM_CLASSES))
        print(f"{CLASS_NAMES[i]:<13}  {row}")

    total = cm.sum()
    correct = np.trace(cm)
    accuracy = correct / total if total else 0.0
    print(f"\nOverall accuracy: {accuracy:.4f}  ({correct} / {total})")

    print("\nPer-class recall (true positives / actual class total):")
    for i in range(NUM_CLASSES):
        actual = cm[i].sum()
        recall = cm[i, i] / actual if actual else 0.0
        flag = " ⚠ below 0.80 floor" if recall < 0.80 else ""
        print(f"  {CLASS_NAMES[i]:<18}: {recall:.4f}{flag}")


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
def export_saved_model(trained_model):
    if SAVED_DIR.exists():
        shutil.rmtree(SAVED_DIR)

    class ServingModule(tf.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        @tf.function(
            input_signature=[
                tf.TensorSpec(shape=[1, 224, 224, 3], dtype=tf.float32, name="pixel_values"),
            ]
        )
        def classify(self, pixel_values):
            probs = self.inner(pixel_values, training=False)
            return {"probabilities": probs}

    module = ServingModule(trained_model)
    tf.saved_model.save(
        module,
        str(SAVED_DIR),
        signatures={"serving_default": module.classify},
    )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main():
    print(f"TensorFlow {tf.__version__}")
    gpus = tf.config.list_physical_devices("GPU")
    print(f"GPUs: {gpus if gpus else 'none — training on CPU'}")

    print("\n[1/5] Collecting training samples from both datasets...")
    train_samples = collect_split(OLD_TRAIN, NEW_TRAIN)
    print(f"\n  total train samples: {len(train_samples)}")
    print("\n[2/5] Collecting validation samples (old/valid + new/test)...")
    valid_samples = collect_split(OLD_VALID, NEW_VALID)
    print(f"\n  total valid samples: {len(valid_samples)}")

    train_ds = make_dataset(train_samples, shuffle=True)
    valid_ds = make_dataset(valid_samples, shuffle=False)

    class_weights = compute_class_weights(train_samples)

    print("\n[3/5] Phase A — train head only (10 epochs, LR=1e-3, backbone frozen)")
    model, base = build_model()
    model.compile(
        optimizer=Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        train_ds,
        validation_data=valid_ds,
        epochs=10,
        class_weight=class_weights,
        callbacks=[
            EarlyStopping(monitor="val_accuracy", patience=3, restore_best_weights=True),
            ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=2, min_lr=1e-6),
        ],
        verbose=2,
    )

    print("\n[4/5] Phase B — fine-tune last 20 backbone layers (5 epochs, LR=1e-5)")
    base.trainable = True
    for layer in base.layers[:-20]:
        layer.trainable = False
    model.compile(
        optimizer=Adam(learning_rate=1e-5),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.fit(
        train_ds,
        validation_data=valid_ds,
        epochs=5,
        class_weight=class_weights,
        callbacks=[EarlyStopping(monitor="val_accuracy", patience=3, restore_best_weights=True)],
        verbose=2,
    )

    print("\n[5/5] Evaluating + exporting SavedModel...")
    evaluate_with_confusion(model, valid_ds, valid_samples)
    export_saved_model(model)

    print(f"\nSUCCESS. SavedModel at: {SAVED_DIR}")
    print("Next: run convert_keras_to_tfjs.py (it now defaults to cherry_multiclass)")


if __name__ == "__main__":
    main()
