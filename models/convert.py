"""
SweetCherry Tier 1 Edge AI — Model Conversion Pipeline (Solution A, final)

Converts linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification
from a PyTorch checkpoint to a browser-ready, quantized TensorFlow.js GraphModel.

Pipeline (2 hops, pure Python, Windows-compatible):

    PyTorch model (HF checkpoint)
        |
        |  nobuco.pytorch_to_keras
        v
    TensorFlow Keras model (NHWC, native TF ops)
        |
        |  tf.saved_model.save + tensorflowjs_converter (uint8 quantization)
        v
    TFJS GraphModel  (public/models/plant_disease/)

Why nobuco over the original 4-hop path:
  - nobuco traces PyTorch modules op-by-op and emits TF/Keras nodes directly.
  - No ONNX in the middle: eliminates onnx-tf (POSIX-only) and onnx2tf
    (breaks on HF's tf_padding=true convention) in one move.
  - Pure Python, no native deps, no Protobuf ABI collisions.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# -- Windows stdout UTF-8 shim ----------------------------------------------- #
# nobuco prints a Unicode tree diagram (box-drawing chars like U+251C) after
# conversion succeeds. The default Windows console uses cp1252, which can't
# encode these and raises UnicodeEncodeError — AFTER the model is already
# built successfully. Force stdout to UTF-8 so the benign cosmetic print
# doesn't nuke the pipeline.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass  # pre-Python-3.7 fallback — won't hit on 3.10
# --------------------------------------------------------------------------- #


# --------------------------------------------------------------------------- #
# Paths and config
# --------------------------------------------------------------------------- #
MODEL_ID   = "linkanjarad/mobilenet_v2_1.0_224-plant-disease-identification"
HERE       = Path(__file__).resolve().parent
PROJECT    = HERE.parent
SAVED_DIR  = HERE / "saved_model"
TFJS_DIR   = PROJECT / "public" / "models" / "plant_disease"


# --------------------------------------------------------------------------- #
# Step 1: PyTorch -> Keras (via nobuco)
# --------------------------------------------------------------------------- #
def pytorch_to_keras():
    print("[1/3] Loading HF PyTorch checkpoint and converting to Keras via nobuco...", flush=True)

    import torch
    from transformers import MobileNetV2ForImageClassification
    import nobuco
    from nobuco import ChannelOrder

    pt_model = MobileNetV2ForImageClassification.from_pretrained(MODEL_ID)
    pt_model.eval()

    class LogitsOnly(torch.nn.Module):
        """Strip HF's ImageClassifierOutput wrapper so nobuco sees a plain tensor."""
        def __init__(self, inner):
            super().__init__()
            self.inner = inner
        def forward(self, pixel_values):
            return self.inner(pixel_values=pixel_values).logits

    wrapped = LogitsOnly(pt_model).eval()
    dummy = torch.randn(1, 3, 224, 224, dtype=torch.float32)

    keras_model = nobuco.pytorch_to_keras(
        wrapped,
        args=[dummy],
        # PyTorch is NCHW; emit a NHWC-input Keras graph (web-friendly).
        inputs_channel_order=ChannelOrder.TENSORFLOW,
        outputs_channel_order=ChannelOrder.TENSORFLOW,
        trace_shape=True,
    )
    print(f"      -> Keras model with {len(keras_model.weights)} weight tensors", flush=True)
    return keras_model


# --------------------------------------------------------------------------- #
# Step 2: Keras -> TF SavedModel (explicit serving signature)
# --------------------------------------------------------------------------- #
def keras_to_saved_model(keras_model):
    print("[2/3] Saving Keras model as TF SavedModel with serving signature...", flush=True)

    import tensorflow as tf

    if SAVED_DIR.exists():
        shutil.rmtree(SAVED_DIR)

    # Wrap the Keras model in a tf.Module that TRACKS it as an attribute.
    # TF's SavedModel export only serializes variables owned by tracked objects;
    # if keras_model were captured via a plain closure, we'd get
    # "untracked resource" errors.
    class ServingModule(tf.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner  # <- tracked by tf.Module

        @tf.function(input_signature=[
            tf.TensorSpec(shape=[1, 224, 224, 3], dtype=tf.float32, name="pixel_values"),
        ])
        def classify(self, pixel_values):
            logits = self.inner(pixel_values, training=False)
            return {"probabilities": tf.nn.softmax(logits, axis=-1)}

    module = ServingModule(keras_model)
    tf.saved_model.save(
        module,
        str(SAVED_DIR),
        signatures={"serving_default": module.classify},
    )
    print(f"      -> {SAVED_DIR}", flush=True)


# --------------------------------------------------------------------------- #
# Step 3: SavedModel -> TFJS GraphModel (uint8 quantized)
# --------------------------------------------------------------------------- #
def saved_model_to_tfjs():
    print("[3/3] Converting SavedModel -> TFJS GraphModel (uint8 quantization)...", flush=True)

    TFJS_DIR.mkdir(parents=True, exist_ok=True)
    for f in TFJS_DIR.glob("*"):
        if f.is_file():
            f.unlink()

    # Stub tensorflow_decision_forests before importing tensorflowjs.
    # The tensorflowjs converter unconditionally does `import tensorflow_decision_forests`
    # at module load, but TFDF has no Windows wheel. We only convert SavedModels
    # (not decision forests), so a no-op stub is safe.
    import types as _types
    if "tensorflow_decision_forests" not in sys.modules:
        sys.modules["tensorflow_decision_forests"] = _types.ModuleType("tensorflow_decision_forests")

    # Run the converter in-process (simpler error handling than subprocess).
    from tensorflowjs.converters import converter as tfjs_converter

    argv = [
        "--input_format=tf_saved_model",
        "--output_format=tfjs_graph_model",
        "--signature_name=serving_default",
        "--saved_model_tags=serve",
        "--quantize_uint8=*",
        str(SAVED_DIR),
        str(TFJS_DIR),
    ]
    print("      $ tensorflowjs_converter " + " ".join(argv), flush=True)

    # tfjs_converter.main expects argv[0] to be a single space-joined flag string.
    tfjs_converter.main([" ".join(argv)])

    print(f"      -> {TFJS_DIR}", flush=True)


# --------------------------------------------------------------------------- #
# Housekeeping: emit labels.json from HF config
# --------------------------------------------------------------------------- #
def emit_labels():
    print("[+]  Emitting labels.json from HF config...", flush=True)

    from transformers import AutoConfig
    cfg = AutoConfig.from_pretrained(MODEL_ID)
    labels = {int(k): v for k, v in cfg.id2label.items()}
    (TFJS_DIR / "labels.json").write_text(
        json.dumps(labels, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"      -> {TFJS_DIR / 'labels.json'} ({len(labels)} classes)", flush=True)


# --------------------------------------------------------------------------- #
# Entrypoint
# --------------------------------------------------------------------------- #
def main():
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

    keras_model = pytorch_to_keras()
    keras_to_saved_model(keras_model)
    saved_model_to_tfjs()
    emit_labels()

    print("")
    print("=" * 72)
    print("SUCCESS.")
    print(f"  TFJS artifacts at: {TFJS_DIR}")
    for f in sorted(TFJS_DIR.iterdir()):
        size_kb = f.stat().st_size / 1024
        print(f"    - {f.name}  ({size_kb:.1f} KB)")
    print("=" * 72)


if __name__ == "__main__":
    main()
