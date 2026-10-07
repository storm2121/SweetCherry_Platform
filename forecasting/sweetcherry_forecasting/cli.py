"""Command line: python -m sweetcherry_forecasting <command>.

  generate     write the simulated market workbook
  run          backtest and forecast from a market workbook; writes the
               forecast samples, the backtest report and the model-card table
  all          generate, then run, with the defaults (rebuilds every sample)
  check-docs   fail if docs/MODEL_CARDS.md does not match the backtest report
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import DEFAULT_CUTOFF, DEFAULT_SEED, DEFAULT_START, GENERATOR_VERSION, MODEL_VERSION, SOURCE_NAME
from .backtest import run_backtest
from .export import about_values, write_forecast_json, write_forecast_workbook
from .features import build_samples
from .forecast import forecast_at_cutoff
from .report import update_doc, write_metrics
from .synthetic import generate
from .weekly import weekly_series
from .workbook_raw import read_observations, read_provenance, write_market_workbook

ROOT = Path(__file__).resolve().parent.parent  # forecasting/
SAMPLES = ROOT / "samples"
REPORTS = ROOT / "reports"
MODEL_CARDS = ROOT.parent / "docs" / "MODEL_CARDS.md"


def market_workbook_name(seed: int) -> str:
    return f"sweetcherry_market_data_SIMULATED_seed{seed}.xlsx"


def forecast_name(cutoff: str, suffix: str) -> str:
    return f"sweetcherry_forecast_SIMULATED_{cutoff}.{suffix}"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def command_generate(args) -> Path:
    market = generate(seed=args.seed, start=args.start, cutoff=args.cutoff)
    path = Path(args.out) if args.out else SAMPLES / market_workbook_name(args.seed)
    write_market_workbook(market, path, generated_at=_now())
    print(f"wrote {path} ({len(market.observations)} lines, {len(market.events)} simulated events)")
    return path


def command_run(args) -> None:
    data = Path(args.data) if args.data else SAMPLES / market_workbook_name(args.seed)
    info = read_provenance(data)
    if info.get("provenance") != "synthetic":
        print("note: the input workbook is not marked provenance=synthetic; outputs are labelled from its Read me")
    seed = int(info.get("seed", args.seed))
    cutoff = args.cutoff or info.get("dataCutoff", DEFAULT_CUTOFF)
    observations = read_observations(data)
    observations = observations[observations["date"] <= cutoff]
    weekly = weekly_series(observations)
    samples = build_samples(weekly)
    result = run_backtest(samples, seed=seed)
    forecast = forecast_at_cutoff(weekly, cutoff, seed, result.offsets)
    generated_at = _now()
    about = about_values(
        forecast, generated_at=generated_at, model_version=MODEL_VERSION, source_name=info.get("sourceName", SOURCE_NAME),
        seed=seed, generator_version=info.get("generatorVersion", GENERATOR_VERSION), input_workbook=data.name,
        first_evaluated=result.first_evaluated_season, test_seasons=result.test_seasons,
    )
    out_dir = Path(args.samples) if args.samples else SAMPLES
    workbook = write_forecast_workbook(forecast, about, result.metrics, out_dir / forecast_name(cutoff, "xlsx"))
    payload = write_forecast_json(forecast, about, result.metrics, out_dir / forecast_name(cutoff, "json"))
    reports = Path(args.reports) if args.reports else REPORTS
    metrics_path = write_metrics(reports / "backtest_metrics.json", result.metrics, {
        "provenance": info.get("provenance", "unknown"),
        "generatorVersion": info.get("generatorVersion", GENERATOR_VERSION),
        "seed": seed,
        "modelVersion": MODEL_VERSION,
        "dataCutoff": cutoff,
        "generatedAt": generated_at,
        "inputWorkbook": data.name,
        "firstEvaluatedSeason": result.first_evaluated_season,
        "testSeasons": list(result.test_seasons),
        "notice": "Computed on simulated data. A check of the code, not real-world accuracy.",
    })
    print(f"wrote {workbook}\nwrote {payload}\nwrote {metrics_path}")
    if not args.no_docs and MODEL_CARDS.exists():
        update_doc(MODEL_CARDS, metrics_path)
        print(f"updated {MODEL_CARDS}")
    print(f"{forecast.row_count} forecast rows. {forecast.note}")


def command_check_docs(_args) -> int:
    ok = update_doc(MODEL_CARDS, REPORTS / "backtest_metrics.json", check=True)
    print("docs/MODEL_CARDS.md matches the backtest report" if ok else
          "docs/MODEL_CARDS.md is out of date: run `python -m sweetcherry_forecasting run`")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m sweetcherry_forecasting", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    def shared(sub):
        sub.add_argument("--seed", type=int, default=DEFAULT_SEED)
        sub.add_argument("--cutoff", default=None, help="last date of data (YYYY-MM-DD)")

    gen = commands.add_parser("generate", help="write the simulated market workbook")
    shared(gen)
    gen.add_argument("--start", default=DEFAULT_START)
    gen.add_argument("--out", default=None)

    run = commands.add_parser("run", help="backtest and forecast from a market workbook")
    shared(run)
    run.add_argument("--data", default=None, help="market workbook (default: the simulated sample)")
    run.add_argument("--samples", default=None, help="folder for the forecast workbook and JSON")
    run.add_argument("--reports", default=None, help="folder for backtest_metrics.json")
    run.add_argument("--no-docs", action="store_true", help="do not update docs/MODEL_CARDS.md")

    everything = commands.add_parser("all", help="generate, then run, with the defaults")
    shared(everything)
    everything.add_argument("--start", default=DEFAULT_START)

    commands.add_parser("check-docs", help="check the generated table in docs/MODEL_CARDS.md")

    args = parser.parse_args(argv)
    if args.command == "check-docs":
        return command_check_docs(args)
    if args.command in ("generate", "all"):
        args.cutoff = args.cutoff or DEFAULT_CUTOFF
        if args.command == "all":
            args.out = None
        path = command_generate(args)
        if args.command == "generate":
            return 0
        args.data, args.samples, args.reports, args.no_docs = str(path), None, None, False
    command_run(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
