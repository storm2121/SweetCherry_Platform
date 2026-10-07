"""
Headless verification of the cherry_binary SavedModel.

Loads 3 known-healthy and 3 known-mildew images from the Kaggle VALID set
and prints the model's probabilities for each. If any row shows the wrong
class, the bug is in TRAINING. If all rows look correct here but the
website still shows wrong answers, the bug is in the BROWSER wiring.

Run:
    cd models
    .venv\\Scripts\\activate.bat
    python verify_cherry_binary.py
"""

import os
import sys
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
SAVED_DIR = HERE / "cherry_binary_savedmodel"
DATA_ROOT = Path(r"D:\FarmData\Kaggle_Leaves_7.5\New Plant Diseases Dataset(Augmented)\valid")
HEALTHY_DIR = DATA_ROOT / "Cherry_(including_sour)___healthy"
MILDEW_DIR = DATA_ROOT / "Cherry_(including_sour)___Powdery_mildew"

LABELS = {0: "healthy", 1: "mildew"}


def image_to_tensor(path: Path) -> np.ndarray:
    img = Image.open(path).convert("RGB").resize((224, 224), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0  # matches the React-side preprocessing
    return arr[np.newaxis, ...]  # [1, 224, 224, 3]


def main():
    print(f"Loading SavedModel from {SAVED_DIR}...")
    loaded = tf.saved_model.load(str(SAVED_DIR))
    infer = loaded.signatures["serving_default"]

    # Introspect signature to confirm input/output names
    print("Signature inputs :", list(infer.structured_input_signature[1].keys()))
    print("Signature outputs:", list(infer.structured_outputs.keys()))

    for label_id, directory in [(0, HEALTHY_DIR), (1, MILDEW_DIR)]:
        print(f"\n=== {LABELS[label_id].upper()}  (expected class {label_id}) ===")
        files = sorted(directory.glob("*.JPG"))[:5] + sorted(directory.glob("*.jpg"))[:0]
        if not files:
            print(f"   (no images in {directory})")
            continue
        for f in files[:5]:
            x = tf.constant(image_to_tensor(f))
            out = infer(pixel_values=x)
            probs = out["probabilities"].numpy()[0]  # shape [2]
            pred = int(np.argmax(probs))
            mark = "✓" if pred == label_id else "✗"
            print(
                f"{mark}  {f.name[:44]:<44}  "
                f"P(healthy)={probs[0]:.4f}  P(mildew)={probs[1]:.4f}  → pred={pred} ({LABELS[pred]})"
            )


if __name__ == "__main__":
    main()
