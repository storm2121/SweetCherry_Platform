"""Backtest report files and the generated table in docs/MODEL_CARDS.md.

The table in the model card is rendered from reports/backtest_metrics.json
and checked by a test, so no figure in the documentation is typed by hand.
"""

from __future__ import annotations

import json
from pathlib import Path

BEGIN = "<!-- BEGIN GENERATED: forecast-backtest -->"
END = "<!-- END GENERATED: forecast-backtest -->"


def _round(value):
    if isinstance(value, float):
        return round(value, 3)
    if isinstance(value, dict):
        return {key: _round(item) for key, item in value.items()}
    return value


def write_metrics(path: Path, metrics: dict, meta: dict) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema": "sweetcherry.backtest.v1", **meta, "metrics": _round(metrics)}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def render_table(report: dict) -> str:
    metrics = report["metrics"]
    seasons = report["testSeasons"]
    lines = [
        BEGIN,
        f"Rolling-season backtest on **simulated** seasons {seasons[0]}-{seasons[-1]} "
        f"(generator {report['generatorVersion']}, seed {report['seed']}, model {report['modelVersion']}). "
        "A code check, not real-world accuracy. Generated from `forecasting/reports/backtest_metrics.json`.",
        "",
        "| Horizon | n | MAE (MAD/kg) | MAPE | P10-P90 coverage | Naive MAE | Seasonal-naive MAE |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    rows = list(metrics["by_horizon"].items()) + [("All", metrics["all_horizons"])]
    for label, block in rows:
        lines.append(
            f"| {label} | {block['n']} | {block['mae']:.2f} | {block['mape_pct']:.1f}% | "
            f"{block['coverage_pct']:.0f}% | {block['naive_mae']:.2f} | {block['seasonal_naive_mae']:.2f} |"
        )
    lines.append(END)
    return "\n".join(lines)


def update_doc(doc_path: Path, metrics_path: Path, check: bool = False) -> bool:
    """Rewrite (or, with check=True, compare) the generated block. Returns True
    when the document already matches the metrics file."""
    doc_path, metrics_path = Path(doc_path), Path(metrics_path)
    report = json.loads(metrics_path.read_text(encoding="utf-8"))
    text = doc_path.read_text(encoding="utf-8")
    if BEGIN not in text or END not in text:
        raise ValueError(f"{doc_path} has no generated block markers")
    head, rest = text.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    updated = head + render_table(report) + tail
    if check:
        return updated == text
    if updated != text:
        doc_path.write_text(updated, encoding="utf-8")
    return True
