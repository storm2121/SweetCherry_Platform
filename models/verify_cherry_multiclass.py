"""
Headless verification of the cherry_multiclass SavedModel.

Loads up to 5 images per class from the validation splits and runs them
through the SavedModel, printing a 6x6 confusion matrix and per-class
recall. If everything looks good here but the website still misbehaves,
the bug is in the BROWSER pipeline (preprocessing / cache).

Run:
    cd models
    .venv\\Scripts\\activate.bat
    python verify_cherry_multiclass.py
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except AttributeError:
    pass

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import tensorflow as tf
from PIL import Image

HERE = Path(__file__).resolve().parent
SAVED_DIR = HERE / "cherry_multiclass_savedmodel"

# Same dataset roots as the training script
OLD_VALID = Path(r"D:\FarmData\Leaves\Kaggle_Leaves_7.5\New Plant Diseases Dataset(Augmented)\valid")
NEW_VALID = Path(r"D:\FarmData\Leaves\Kaggle_Leaves_6.88_diseases\Cherry\test")

CLASS_NAMES = [
    "healthy",
    "powdery_mildew",
    "brown_spot",
    "leaf_scorch",
    "purple_leaf_spot",
    "shot_hole",
]

# (class_index, root_path, folder_name)
SOURCES = [
    (0, NEW_VALID, "Cherry Normal leaf"),
    (0, OLD_VALID, "Cherry_(including_sour)___healthy"),
    (1, OLD_VALID, "Cherry_(including_sour)___Powdery_mildew"),
    (2, NEW_VALID, "Cherry brown_spot"),
    (3, NEW_VALID, "Cherry Leaf Scorch"),
    (4, NEW_VALID, "Cherry purple leaf spot"),
    (5, NEW_VALID, "Cherry_shot hole disease"),
]

PER_CLASS_SAMPLE = 8  # how many images to test per source folder


def image_to_tensor(path: Path) -> np.ndarray:
    img = Image.open(path).convert("RGB").resize((224, 224), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return arr[np.newaxis, ...]


def main():
    if not SAVED_DIR.exists():
        raise SystemExit(f"SavedModel not found at {SAVED_DIR}. Run train_cherry_multiclass.py first.")

    print(f"Loading SavedModel from {SAVED_DIR}...")
    loaded = tf.saved_model.load(str(SAVED_DIR))
    infer = loaded.signatures["serving_default"]
    print("Signature inputs :", list(infer.structured_input_signature[1].keys()))
    print("Signature outputs:", list(infer.structured_outputs.keys()))

    cm = np.zeros((len(CLASS_NAMES), len(CLASS_NAMES)), dtype=np.int64)
    misclassified_examples = defaultdict(list)

    for class_id, root, folder in SOURCES:
        directory = root / folder
        if not directory.exists():
            print(f"  ⚠ skipping missing folder: {directory}")
            continue
        files = sorted(p for p in directory.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})[:PER_CLASS_SAMPLE]
        print(f"\n=== {CLASS_NAMES[class_id].upper()} ({folder}) — {len(files)} samples ===")
        for f in files:
            x = tf.constant(image_to_tensor(f))
            out = infer(pixel_values=x)
            probs = out["probabilities"].numpy()[0]
            pred = int(np.argmax(probs))
            cm[class_id, pred] += 1
            mark = "✓" if pred == class_id else "✗"
            top_label = CLASS_NAMES[pred]
            print(f"{mark}  {f.name[:48]:<48}  pred={top_label:<18}  P={probs[pred]:.3f}")
            if pred != class_id:
                misclassified_examples[class_id].append((str(f), pred, probs.copy()))

    print("\n" + "=" * 72)
    print("Confusion matrix")
    header = "actual \\ pred  " + "  ".join(f"{c[:10]:>10s}" for c in CLASS_NAMES)
    print(header)
    for i in range(len(CLASS_NAMES)):
        row = "  ".join(f"{cm[i, j]:10d}" for j in range(len(CLASS_NAMES)))
        print(f"{CLASS_NAMES[i]:<13}  {row}")

    total = cm.sum()
    correct = np.trace(cm)
    print(f"\nOverall accuracy on sample: {correct / total:.4f}  ({correct} / {total})")

    print("\nPer-class recall:")
    for i in range(len(CLASS_NAMES)):
        actual = cm[i].sum()
        recall = cm[i, i] / actual if actual else 0.0
        flag = " ⚠ below 0.80 floor" if recall < 0.80 else ""
        print(f"  {CLASS_NAMES[i]:<18}: {recall:.4f}{flag}")


if __name__ == "__main__":
    main()
