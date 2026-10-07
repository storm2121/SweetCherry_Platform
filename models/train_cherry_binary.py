"""
SweetCherry — train a binary cherry-leaf classifier (healthy vs powdery mildew).

Uses the Kaggle "New Plant Diseases Dataset (Augmented)" subset containing only
the two Cherry_(including_sour)___{healthy, Powdery_mildew} folders. Fine-tunes
a MobileNetV2 backbone pretrained on ImageNet, exports a TF SavedModel with a
serving signature that expects NHWC float32 pixel values in [0, 1].

Pipeline:
    1. Load train / valid ImageFolders via image_dataset_from_directory
    2. Phase A — frozen backbone, train head only (10 epochs @ LR=1e-3)
    3. Phase B — unfreeze last 20 layers, fine-tune (5 epochs @ LR=1e-5)
    4. Print a confusion matrix on the validation set
    5. Export TF SavedModel at models/cherry_binary_savedmodel/

Run:
    cd models
    .\.venv\Scripts\activate          # Windows PowerShell
    python train_cherry_binary.py
"""

from __future__ import annotations

import os
import sys
import shutil
from pathlib import Path

# Force UTF-8 so Unicode (e.g., progress bars) doesn't crash Windows cp1252 consoles.
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
# Set CHERRY_AUGMENTED_DIR to override the dataset folder.
DATA_ROOT = Path(os.environ.get("CHERRY_AUGMENTED_DIR", r"D:\FarmData\Kaggle_Leaves_7.5\New Plant Diseases Dataset(Augmented)"))
TRAIN_DIR = DATA_ROOT / "train"
VALID_DIR = DATA_ROOT / "valid"

SAVED_DIR = HERE / "cherry_binary_savedmodel"

IMG_SIZE = (224, 224)
BATCH_SIZE = 32
SEED = 42

# Lock class index order: 0 = healthy, 1 = powdery mildew.
# Keras assigns alphabetically otherwise (capital P < lowercase h), so we set
# it explicitly to match the labels.json shipped to the browser.
CLASS_NAMES = [
    "Cherry_(including_sour)___healthy",
    "Cherry_(including_sour)___Powdery_mildew",
]


# --------------------------------------------------------------------------- #
# Datasets
# --------------------------------------------------------------------------- #
def load_datasets():
    train_ds = tf.keras.utils.image_dataset_from_directory(
        str(TRAIN_DIR),
        class_names=CLASS_NAMES,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        shuffle=True,
        seed=SEED,
    )
    valid_ds = tf.keras.utils.image_dataset_from_directory(
        str(VALID_DIR),
        class_names=CLASS_NAMES,
        image_size=IMG_SIZE,
        batch_size=BATCH_SIZE,
        shuffle=False,
    )

    # uint8 [0, 255] -> float32 [0, 1]. The model's internal Rescaling layer
    # then maps [0, 1] -> [-1, 1] for MobileNetV2.
    def to_unit_range(x, y):
        return tf.cast(x, tf.float32) / 255.0, y

    train_ds = train_ds.map(to_unit_range, num_parallel_calls=tf.data.AUTOTUNE).prefetch(tf.data.AUTOTUNE)
    valid_ds = valid_ds.map(to_unit_range, num_parallel_calls=tf.data.AUTOTUNE).prefetch(tf.data.AUTOTUNE)
    return train_ds, valid_ds


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #
def build_model():
    # Light augmentation — dataset is already augmented on disk.
    augment = tf.keras.Sequential(
        [
            layers.RandomFlip("horizontal"),
            layers.RandomRotation(0.05),
            layers.RandomBrightness(0.1),
        ],
        name="augmentation",
    )

    # MobileNetV2 expects inputs in [-1, 1]; we do this in-graph so serving is simple.
    rescale = layers.Rescaling(scale=2.0, offset=-1.0, name="rescale_neg1_1")

    inputs = Input(shape=IMG_SIZE + (3,), name="pixel_values")
    x = augment(inputs)   # active only when training=True
    x = rescale(x)        # always active

    base = MobileNetV2(
        input_shape=IMG_SIZE + (3,),
        include_top=False,
        weights="imagenet",
    )
    base.trainable = False  # Phase A will keep this frozen

    # IMPORTANT: training=False keeps BatchNorm in inference mode even during
    # Phase B fine-tuning. This matches the TF transfer-learning best practice.
    x = base(x, training=False)

    x = layers.GlobalAveragePooling2D(name="gap")(x)
    x = layers.Dropout(0.3, name="dropout")(x)
    x = layers.Dense(128, activation="relu", name="head_fc")(x)
    outputs = layers.Dense(len(CLASS_NAMES), activation="softmax", name="probabilities")(x)

    return Model(inputs, outputs, name="cherry_binary"), base


# --------------------------------------------------------------------------- #
# Evaluation
# --------------------------------------------------------------------------- #
def evaluate_with_confusion(model, valid_ds):
    y_true, y_pred = [], []
    for batch_x, batch_y in valid_ds:
        probs = model.predict(batch_x, verbose=0)
        y_true.append(batch_y.numpy())
        y_pred.append(np.argmax(probs, axis=1))
    y_true = np.concatenate(y_true)
    y_pred = np.concatenate(y_pred)

    # 0 = healthy, 1 = mildew
    tp_h = int(np.sum((y_true == 0) & (y_pred == 0)))
    fn_h = int(np.sum((y_true == 0) & (y_pred == 1)))
    fp_m = int(np.sum((y_true == 1) & (y_pred == 0)))
    tn_m = int(np.sum((y_true == 1) & (y_pred == 1)))
    total = len(y_true)

    accuracy = (tp_h + tn_m) / total if total else 0.0
    precision_mildew = tn_m / (tn_m + fn_h) if (tn_m + fn_h) else 0.0
    recall_mildew = tn_m / (tn_m + fp_m) if (tn_m + fp_m) else 0.0

    print()
    print("Validation confusion matrix")
    print("                   Predicted")
    print("                   healthy   mildew")
    print(f"Actual  healthy    {tp_h:6d}   {fn_h:6d}")
    print(f"Actual  mildew     {fp_m:6d}   {tn_m:6d}")
    print(f"Accuracy:        {accuracy:.4f}  ({tp_h + tn_m} / {total})")
    print(f"Precision mildew:{precision_mildew:.4f}")
    print(f"Recall mildew:   {recall_mildew:.4f}")


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
def export_saved_model(trained_model):
    if SAVED_DIR.exists():
        shutil.rmtree(SAVED_DIR)

    # Wrap in a tf.Module so tf.saved_model.save tracks the Keras variables
    # (matches the serving pattern used by the older convert.py).
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

    print("\n[1/4] Loading datasets...")
    train_ds, valid_ds = load_datasets()
    print(f"      train batches: {tf.data.experimental.cardinality(train_ds).numpy()}")
    print(f"      valid batches: {tf.data.experimental.cardinality(valid_ds).numpy()}")

    print("\n[2/4] Phase A — train head only (10 epochs, LR=1e-3, backbone frozen)")
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
        callbacks=[
            EarlyStopping(monitor="val_accuracy", patience=3, restore_best_weights=True),
            ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=2, min_lr=1e-6),
        ],
        verbose=2,
    )

    print("\n[3/4] Phase B — fine-tune last 20 backbone layers (5 epochs, LR=1e-5)")
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
        callbacks=[EarlyStopping(monitor="val_accuracy", patience=3, restore_best_weights=True)],
        verbose=2,
    )

    print("\n[4/4] Evaluating + exporting SavedModel...")
    evaluate_with_confusion(model, valid_ds)
    export_saved_model(model)

    print(f"\nSUCCESS. SavedModel at: {SAVED_DIR}")
    print("Next: run convert_keras_to_tfjs.py to produce browser artifacts.")


if __name__ == "__main__":
    main()
