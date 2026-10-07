"""
Convert a SavedModel produced by one of the train_*.py scripts into a
quantized TFJS GraphModel ready for the browser.

Default model: cherry_multiclass (6-class). Override with MODEL_NAME env var.

Output artifacts go to public/models/<MODEL_NAME>/:
    - model.json              (graph topology + weight manifest)
    - group1-shard1of1.bin    (quantized weights — float16 by default)
    - labels.json             (Arabic label map)

Run:
    cd models
    .\\.venv\\Scripts\\activate.bat
    python convert_keras_to_tfjs.py

    # or, to convert the older binary model
    set MODEL_NAME=cherry_binary
    python convert_keras_to_tfjs.py

    # or, to skip quantization (full float32, ~9 MB)
    set TFJS_QUANTIZE=none
    python convert_keras_to_tfjs.py
"""

from __future__ import annotations

import json
import os
import sys
import types
from pathlib import Path


# --------------------------------------------------------------------------- #
# Windows compatibility shims
# --------------------------------------------------------------------------- #
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass

# tensorflow_decision_forests has no Windows wheel and isn't needed for the
# SavedModel -> TFJS path. Stub it before importing tensorflowjs.
if "tensorflow_decision_forests" not in sys.modules:
    sys.modules["tensorflow_decision_forests"] = types.ModuleType("tensorflow_decision_forests")


# --------------------------------------------------------------------------- #
# Per-model registry: SavedModel folder name + Arabic label map
# --------------------------------------------------------------------------- #
HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent

MODEL_REGISTRY = {
    "cherry_binary": {
        "saved_dir": HERE / "cherry_binary_savedmodel",
        "tfjs_dir": PROJECT / "public" / "models" / "cherry_binary",
        "labels_ar": {
            "0": "نبتة كرز سليمة",
            "1": "كرز مصاب بالبياض الدقيقي",
        },
    },
    "cherry_multiclass": {
        "saved_dir": HERE / "cherry_multiclass_savedmodel",
        "tfjs_dir": PROJECT / "public" / "models" / "cherry_multiclass",
        "labels_ar": {
            "0": "نبتة كرز سليمة",
            "1": "كرز مصاب بالبياض الدقيقي",
            "2": "كرز مصاب بالتبقع البني",
            "3": "كرز مصاب بحرق الأوراق",
            "4": "كرز مصاب بالتبقع الأرجواني",
            "5": "كرز مصاب بمرض ثقب الرصاص",
        },
    },
}


def main():
    model_name = os.environ.get("MODEL_NAME", "cherry_multiclass").lower()
    if model_name not in MODEL_REGISTRY:
        raise SystemExit(
            f"Unknown MODEL_NAME={model_name}. "
            f"Choose from: {list(MODEL_REGISTRY.keys())}"
        )

    spec = MODEL_REGISTRY[model_name]
    saved_dir = spec["saved_dir"]
    tfjs_dir = spec["tfjs_dir"]
    labels_ar = spec["labels_ar"]

    print(f"Converting model: {model_name}")
    print(f"  SavedModel:  {saved_dir}")
    print(f"  TFJS output: {tfjs_dir}")
    print(f"  Classes:     {len(labels_ar)}")

    if not saved_dir.exists():
        raise SystemExit(
            f"SavedModel not found at {saved_dir}.\n"
            f"Run train_{model_name}.py first."
        )

    tfjs_dir.mkdir(parents=True, exist_ok=True)
    # Wipe any stale artifacts so old shard names don't linger
    for f in tfjs_dir.glob("*"):
        if f.is_file():
            f.unlink()

    from tensorflowjs.converters import converter as tfjs_converter

    # Quantization mode — controls weight precision in the shipped model.
    #   "uint8"   : 1 byte per weight, smallest (~2.3 MB) but can break sensitive
    #                decision boundaries (observed: class-flip on cherry_binary)
    #   "float16" : 2 bytes per weight (~4.5 MB), near-zero accuracy loss
    #   "none"    : 4 bytes per weight (~9 MB), identical to SavedModel
    # Set via env var: set TFJS_QUANTIZE=none  OR  float16  OR  uint8
    quantize_mode = os.environ.get("TFJS_QUANTIZE", "float16").lower()

    argv = [
        "--input_format=tf_saved_model",
        "--output_format=tfjs_graph_model",
        "--signature_name=serving_default",
        "--saved_model_tags=serve",
    ]
    if quantize_mode == "uint8":
        argv.append("--quantize_uint8=*")
    elif quantize_mode == "float16":
        argv.append("--quantize_float16=*")
    elif quantize_mode == "none":
        pass  # no quantize flag = full float32
    else:
        raise SystemExit(f"Unknown TFJS_QUANTIZE={quantize_mode}. Use uint8, float16, or none.")

    argv += [str(saved_dir), str(tfjs_dir)]
    print(f"Quantization mode: {quantize_mode}")
    print("Running tensorflowjs_converter...")
    print("  $ tensorflowjs_converter " + " ".join(argv))
    # tfjs_converter.main expects argv[0] to be a single space-joined flag string
    tfjs_converter.main([" ".join(argv)])

    (tfjs_dir / "labels.json").write_text(
        json.dumps(labels_ar, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print()
    print("=" * 72)
    print("SUCCESS.")
    print(f"  TFJS artifacts at: {tfjs_dir}")
    for f in sorted(tfjs_dir.iterdir()):
        size_kb = f.stat().st_size / 1024
        print(f"    - {f.name}  ({size_kb:.1f} KB)")
    print("=" * 72)


if __name__ == "__main__":
    main()
