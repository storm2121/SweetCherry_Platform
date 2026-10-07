"""Deterministic generator of SIMULATED wholesale cherry price bulletins for
Casablanca, Rabat and Marrakech.

The same seed and generator version always give the same rows. Nothing here
is an observation: harvest windows, price levels and the events in the
"Simulated events" table are assumptions (see config.py) chosen to make the
series behave like a fresh-produce market, so that the forecasting code can
be built and tested without private data.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import DEFAULT_CUTOFF, DEFAULT_SEED, DEFAULT_START, GENERATOR_VERSION
from . import config as C

COLUMNS = [
    "date",
    "market_id",
    "market_name",
    "grade",
    "supply_type",
    "main_origin",
    "price_min_mad_kg",
    "price_modal_mad_kg",
    "price_max_mad_kg",
    "arrivals_t",
    "status",
    "quality_flag",
    "remark",
]

PRICE_BASE_DATE = pd.Timestamp("2018-01-01")
STREAMS = ("years", "events", "common", "market", "missing", "lines", "origin", "outliers", "imports")

OUTLIER_TYPES = (
    # (remark, applies to grades, low, high)
    ("Premium export-standard lot sold at auction", ("AAA",), 1.25, 1.45),
    ("Rain-cracked lot sold at a discount", ("A", "AA", "AAA"), 0.60, 0.75),
    ("End-of-day clearance of unsold fruit", ("A", "AA", "AAA"), 0.70, 0.82),
    ("Lot refused by an exporter and resold locally", ("AA", "AAA"), 0.80, 0.88),
)
SUSPECT_REMARK = "Value inconsistent with the rest of the bulletin; kept as recorded"


@dataclass
class SyntheticMarket:
    observations: pd.DataFrame
    events: pd.DataFrame
    seed: int
    start: pd.Timestamp
    cutoff: pd.Timestamp
    generator_version: str = GENERATOR_VERSION


def _round_half(value: float) -> float:
    return float(np.round(value * 2.0) / 2.0)


def _md(year: int, month_day: tuple[int, int]) -> pd.Timestamp:
    return pd.Timestamp(year=year, month=month_day[0], day=month_day[1])


def _harvest_weights(days: pd.DatetimeIndex, start: pd.Timestamp, peak: pd.Timestamp, end: pd.Timestamp) -> np.ndarray:
    """Asymmetric bell over [start, end], peaking at `peak`, summing to 1."""
    offset = (days - peak).days.to_numpy(dtype=float)
    left = max((peak - start).days, 1) / 2.2
    right = max((end - peak).days, 1) / 2.2
    sigma = np.where(offset < 0, left, right)
    weights = np.exp(-0.5 * (offset / sigma) ** 2)
    weights[(days < start) | (days > end)] = 0.0
    total = weights.sum()
    return weights / total if total > 0 else weights


def _typical_peak_arrivals() -> float:
    """Highest daily local arrivals in a typical year (no shift, crop 1, no events)."""
    year = 2021
    days = pd.date_range(f"{year}-04-01", f"{year}-08-31", freq="D")
    total = np.zeros(len(days))
    for region in C.REGIONS:
        weights = _harvest_weights(days, _md(year, region.start), _md(year, region.peak), _md(year, region.end))
        total += C.SEASON_ARRIVALS_T * region.crop_share * weights
    return float(total.max())


TYPICAL_PEAK_T = _typical_peak_arrivals()


def _draw_years(rng: np.random.Generator, years: list[int]) -> dict[int, dict]:
    latent = {}
    for year in years:
        latent[year] = {
            "shift": rng.normal(0.0, C.PHENOLOGY_SIGMA_DAYS),
            "jitter": {r.name: rng.normal(0.0, C.REGION_JITTER_DAYS) for r in C.REGIONS},
            "crop": {r.name: float(np.exp(rng.normal(0.0, C.CROP_SIGMA))) for r in C.REGIONS},
            "demand": float(np.exp(rng.normal(0.0, C.DEMAND_SIGMA))),
            "spread": {m.code: (rng.uniform(m.spread_low, m.spread_high) if m.spread_high > 0 else 0.0) for m in C.MARKETS},
            "missing": {m.code: rng.uniform(*C.MISSING_RATE) for m in C.MARKETS},
        }
    return latent


def _draw_events(rng: np.random.Generator, years: list[int], latent: dict, cutoff: pd.Timestamp) -> list[dict]:
    """Simulated supply and cost shocks. At least one frost-like year and one
    bumper year are guaranteed among the complete seasons."""
    drawn: dict[int, set[str]] = {year: set() for year in years}
    for year in years:
        for name in ("frost", "bumper", "harvest_rain", "heat", "transport_cost"):
            if rng.uniform() < C.EVENT_PROBABILITY[name]:
                drawn[year].add(name)
        if {"frost", "bumper"} <= drawn[year]:
            drawn[year].discard("bumper")
    complete = [year for year in years if _md(year, (8, 31)) <= cutoff]
    for name, other in (("frost", "bumper"), ("bumper", "frost")):
        if complete and not any(name in drawn[year] for year in complete):
            candidates = [year for year in complete if other not in drawn[year]]
            if candidates:
                drawn[candidates[int(rng.integers(len(candidates)))]].add(name)

    events = []
    for year in years:
        national_peak = _md(year, (6, 2)) + pd.Timedelta(days=round(latent[year]["shift"]))
        if "frost" in drawn[year]:
            date = _md(year, (3, 15)) + pd.Timedelta(days=int(rng.integers(0, 37)))
            factors = {"El Hajeb": rng.uniform(0.45, 0.75), "Azrou": rng.uniform(0.45, 0.75),
                       "Ifrane": rng.uniform(0.45, 0.75), "Sefrou": rng.uniform(0.85, 0.95)}
            events.append({"year": year, "event": "frost", "start": date, "end": date,
                           "scope": ", ".join(factors), "factors": factors,
                           "effect": "Frost-like night during flowering; crop " + ", ".join(
                               f"{name} {factor - 1:+.0%}" for name, factor in factors.items())})
        if "bumper" in drawn[year]:
            factor = rng.uniform(1.18, 1.30)
            events.append({"year": year, "event": "bumper", "start": _md(year, (4, 15)), "end": _md(year, (4, 15)),
                           "scope": "All regions", "factor": factor,
                           "effect": f"Heavy fruit set in every region; crop {factor - 1:+.0%}"})
        if "harvest_rain" in drawn[year]:
            start = national_peak + pd.Timedelta(days=int(rng.integers(-10, 11)))
            length = int(rng.integers(3, 7))
            events.append({"year": year, "event": "harvest_rain", "start": start,
                           "end": start + pd.Timedelta(days=length - 1), "scope": "All markets",
                           "effect": "Rain and hail at harvest: fewer AAA, more A, cracked lots; A -8%, AAA +6%"})
        if "heat" in drawn[year]:
            start = _md(year, (5, 20)) + pd.Timedelta(days=int(rng.integers(0, 17)))
            cut = int(rng.integers(5, 10))
            events.append({"year": year, "event": "heat", "start": start, "end": start + pd.Timedelta(days=4),
                           "scope": "Taounate, Sefrou, El Hajeb", "days_cut": cut,
                           "effect": f"Heat spell: harvest in the lower regions ends {cut} days early"})
        if "transport_cost" in drawn[year]:
            start = _md(year, (6, 1)) + pd.Timedelta(days=int(rng.integers(-10, 11)))
            length = int(rng.integers(21, 43))
            extra = rng.uniform(0.06, 0.10)
            events.append({"year": year, "event": "transport_cost", "start": start,
                           "end": start + pd.Timedelta(days=length - 1), "scope": "Rabat, Marrakech", "extra": extra,
                           "effect": f"Transport costs up: Rabat and Marrakech premiums {extra:+.0%}"})
    return [event for event in events if event["start"] <= cutoff]


def _regional_arrivals(days: pd.DatetimeIndex, years: list[int], latent: dict, events: list[dict]):
    """Daily fresh arrivals per region (tonnes, three markets combined), the
    cold-storage release with its progress (0 to 1), and the national crop
    index per year."""
    fresh = {region.name: np.zeros(len(days)) for region in C.REGIONS}
    cold = np.zeros(len(days))
    cold_progress = np.zeros(len(days))
    crop_index = {}
    for year in years:
        year_events = [event for event in events if event["year"] == year]
        heat = next((event for event in year_events if event["event"] == "heat"), None)
        volumes = {}
        last_day = None
        for region in C.REGIONS:
            shift = pd.Timedelta(days=round(latent[year]["shift"] + latent[year]["jitter"][region.name]))
            start = _md(year, region.start) + shift
            peak = _md(year, region.peak) + shift
            end = _md(year, region.end) + shift
            if heat and region.name in heat["scope"]:
                end -= pd.Timedelta(days=heat["days_cut"])
                peak -= pd.Timedelta(days=2)
            factor = latent[year]["crop"][region.name]
            for event in year_events:
                if event["event"] == "frost":
                    factor *= event["factors"].get(region.name, 1.0)
                if event["event"] == "bumper":
                    factor *= event["factor"]
            volume = C.SEASON_ARRIVALS_T * region.crop_share * factor
            volumes[region.name] = volume
            fresh[region.name] += volume * _harvest_weights(days, start, peak, end)
            last_day = end if last_day is None else max(last_day, end)
        crop_index[year] = sum(volumes.values()) / C.SEASON_ARRIVALS_T
        release = (days > last_day) & (days <= last_day + pd.Timedelta(days=C.COLD_STORAGE_DAYS))
        if release.any():
            ramp = np.arange(release.sum(), 0, -1, dtype=float)
            cold[release] += C.COLD_STORAGE_SHARE * sum(volumes.values()) * ramp / ramp.sum()
            cold_progress[release] = np.linspace(0.0, 1.0, int(release.sum()))
    return fresh, cold, cold_progress, crop_index


def _ar1(rng: np.random.Generator, n: int, phi: float, sigma: float) -> np.ndarray:
    series = np.empty(n)
    series[0] = rng.normal(0.0, sigma / np.sqrt(1 - phi**2))
    shocks = rng.normal(0.0, sigma, n)
    for index in range(1, n):
        series[index] = phi * series[index - 1] + shocks[index]
    return series


def _closures(years: list[int]) -> dict[pd.Timestamp, str]:
    """Holidays that fall on a trading day (Monday to Saturday)."""
    closed = {}
    for year in years:
        for month_day, name in C.FIXED_HOLIDAYS.items():
            closed[_md(year, month_day)] = name
        if year in C.EID_AL_ADHA:
            eid = pd.Timestamp(C.EID_AL_ADHA[year])
            closed[eid] = "Eid al-Adha (approximate date)"
            closed[eid + pd.Timedelta(days=1)] = "Eid al-Adha (approximate date)"
    return {day: name for day, name in closed.items() if day.dayofweek < 6}


def _eid_effects(days: pd.DatetimeIndex, years: list[int], closed: dict) -> np.ndarray:
    effect = np.ones(len(days))
    position = {day: index for index, day in enumerate(days)}
    for year in years:
        if year not in C.EID_AL_ADHA:
            continue
        eid = pd.Timestamp(C.EID_AL_ADHA[year])
        before, cursor = 0, eid - pd.Timedelta(days=1)
        while before < C.EID_PRE_DAYS and cursor >= days[0]:
            if cursor.dayofweek < 6 and cursor not in closed and cursor in position:
                effect[position[cursor]] *= 1 + C.EID_PRE_EFFECT
                before += 1
            cursor -= pd.Timedelta(days=1)
        cursor = eid + pd.Timedelta(days=2)
        while cursor <= days[-1]:
            if cursor.dayofweek < 6 and cursor not in closed:
                effect[position[cursor]] *= 1 + C.EID_POST_EFFECT
                break
            cursor += pd.Timedelta(days=1)
    return effect


def _in_import_window(day: pd.Timestamp) -> bool:
    (start_month, start_day), (end_month, end_day) = C.IMPORT_WINDOW
    return (day.month, day.day) >= (start_month, start_day) or (day.month, day.day) <= (end_month, end_day)


def generate(seed: int = DEFAULT_SEED, start: str = DEFAULT_START, cutoff: str = DEFAULT_CUTOFF) -> SyntheticMarket:
    start_ts, cutoff_ts = pd.Timestamp(start), pd.Timestamp(cutoff)
    if cutoff_ts <= start_ts:
        raise ValueError("cutoff must be after start")
    streams = dict(zip(STREAMS, np.random.SeedSequence(seed).spawn(len(STREAMS))))
    rng = {name: np.random.default_rng(sequence) for name, sequence in streams.items()}

    days = pd.date_range(start_ts, cutoff_ts, freq="D")
    years = list(range(start_ts.year, cutoff_ts.year + 1))
    latent = _draw_years(rng["years"], years)
    events = _draw_events(rng["events"], years, latent, cutoff_ts)
    fresh, cold, cold_progress, crop_index = _regional_arrivals(days, years, latent, events)
    fresh_total = sum(fresh.values())
    supply = (fresh_total + cold) / TYPICAL_PEAK_T
    scarcity = 1.0 - np.minimum(1.0, supply)
    since_first_fruit = np.zeros(len(days))
    for year in years:
        in_year = days.year == year
        trading = in_year & (fresh_total >= C.MIN_TRADED_T)
        if trading.any():
            first = days[trading][0]
            since_first_fruit[in_year] = np.maximum((days[in_year] - first).days.to_numpy(dtype=float), 0.0)
    novelty = C.NOVELTY_LATE + (1 - C.NOVELTY_LATE) * np.exp(-since_first_fruit / C.NOVELTY_DAYS)

    closed = _closures(years)
    eid = _eid_effects(days, years, closed)
    common = _ar1(rng["common"], len(days), C.COMMON_AR, C.COMMON_SIGMA)
    market_noise = {m.code: _ar1(rng["market"], len(days), C.MARKET_AR, C.MARKET_SIGMA) for m in C.MARKETS}
    drift = (1 + C.ANNUAL_DRIFT) ** ((days - PRICE_BASE_DATE).days.to_numpy() / 365.25)
    year_level = np.array([crop_index[day.year] ** C.CROP_ELASTICITY * latent[day.year]["demand"] for day in days])
    fresh_price = C.PRICE_FLOOR + C.PRICE_SPAN * np.exp(-C.PRICE_DECAY * supply) * novelty
    cold_price = (C.PRICE_FLOOR + C.PRICE_SPAN * C.NOVELTY_LATE) * (
        C.COLD_PRICE_START + (C.COLD_PRICE_END - C.COLD_PRICE_START) * cold_progress)
    cold_only = (fresh_total <= 1e-9) & (cold > 0)
    reference = np.where(cold_only, cold_price, fresh_price) * drift * year_level * eid

    rain_days = {
        day for event in events if event["event"] == "harvest_rain"
        for day in pd.date_range(event["start"], event["end"], freq="D")
    }
    transport = [event for event in events if event["event"] == "transport_cost"]
    region_names = [region.name for region in C.REGIONS]

    rows = []
    for index, day in enumerate(days):
        local_t = fresh_total[index] + cold[index]
        local = local_t >= C.MIN_TRADED_T
        imports = _in_import_window(day) and not local
        if not (local or imports):
            continue
        weekday_effect = 1 + C.WEEKDAY_EFFECT.get(day.dayofweek, 0.0)
        for market in C.MARKETS:
            if day in closed:
                for grade in C.GRADES:
                    rows.append({"date": day, "market_id": market.code, "market_name": market.name, "grade": grade,
                                 "supply_type": "fresh_local" if local and not cold_only[index] else ("cold_storage" if local else "import"),
                                 "main_origin": "", "status": "closed_holiday", "quality_flag": "", "remark": closed[day]})
                continue
            if day.dayofweek == 6:
                continue
            if rng["missing"].uniform() < latent[day.year]["missing"][market.code]:
                continue
            if imports and rng["imports"].uniform() >= market.import_reports_per_week / 6:
                continue
            spread = latent[day.year]["spread"][market.code]
            for event in transport:
                if market.code != "M01" and event["start"] <= day <= event["end"]:
                    spread += event["extra"]
            raining = day in rain_days
            shares = dict(C.GRADE_VOLUME_SHARE)
            if raining:
                shares["AAA"] *= 0.6
                shares["A"] *= 1.3
                total_share = sum(shares.values())
                shares = {grade: share / total_share for grade, share in shares.items()}
            for grade in C.GRADES:
                if rng["missing"].uniform() < C.PARTIAL_MISSING_RATE:
                    continue
                if local:
                    supply_type = "cold_storage" if cold_only[index] else "fresh_local"
                    volume = local_t * market.arrivals_share * shares[grade] * float(np.exp(rng["lines"].normal(0, 0.15)))
                    if volume < C.MIN_TRADED_T:
                        continue
                    if grade == "A":
                        ratio = C.A_RATIO_BASE + C.A_RATIO_SCARCITY * scarcity[index]
                    elif grade == "AAA":
                        ratio = C.AAA_RATIO_BASE + C.AAA_RATIO_SCARCITY * scarcity[index]
                    else:
                        ratio = 1.0
                    if raining:
                        ratio *= {"A": 0.92, "AA": 1.0, "AAA": 1.06}[grade]
                    base = reference[index] * weekday_effect
                    sigma = C.ROW_SIGMA * (1 + C.HETERO_SCARCITY * scarcity[index])
                    if supply_type == "fresh_local":
                        weights = np.array([fresh[name][index] for name in region_names])
                        origin = region_names[int(rng["origin"].choice(len(region_names), p=weights / weights.sum()))]
                    else:
                        origin = region_names[int(rng["origin"].choice(len(region_names)))]
                else:
                    supply_type = "import"
                    volume = rng["imports"].uniform(0.5, 3.0) * shares[grade] / shares["AA"]
                    ratio = {"A": C.IMPORT_A_RATIO, "AA": 1.0, "AAA": C.IMPORT_AAA_RATIO}[grade]
                    base = C.IMPORT_AA_PRICE * drift[index] * float(np.exp(rng["imports"].normal(0, C.IMPORT_SIGMA)))
                    sigma = C.ROW_SIGMA * 2
                    origin = "Import"
                if grade == "AAA":
                    sigma *= C.AAA_NOISE_FACTOR
                noise = common[index] + market_noise[market.code][index] + rng["lines"].normal(0.0, sigma)
                modal = base * (1 + spread) * ratio * float(np.exp(noise))

                quality_flag, remark = "", ""
                if supply_type != "import":
                    outlier_rate = C.OUTLIER_RATE * (3 if raining else 1)
                    draw = rng["outliers"].uniform()
                    if draw < outlier_rate:
                        choices = [kind for kind in OUTLIER_TYPES if grade in kind[1]]
                        if raining:
                            choices = [kind for kind in choices if kind[0].startswith("Rain")] or choices
                        kind = choices[int(rng["outliers"].integers(len(choices)))]
                        modal *= rng["outliers"].uniform(kind[2], kind[3])
                        quality_flag, remark = "explained_outlier", kind[0]
                    elif draw < outlier_rate + C.SUSPECT_RATE:
                        if grade == "A" and rng["outliers"].uniform() < 0.5:
                            modal *= (C.AAA_RATIO_BASE / C.A_RATIO_BASE)
                        else:
                            modal *= 10.0 if rng["outliers"].uniform() < 0.5 else 0.1
                        quality_flag, remark = "suspect_entry", SUSPECT_REMARK

                modal_r = max(_round_half(modal), 0.5)
                low = _round_half(modal * (1 - rng["lines"].uniform(*C.SPREAD_BELOW)))
                high = _round_half(modal * (1 + rng["lines"].uniform(*C.SPREAD_ABOVE)))
                low = min(max(low, 0.5), modal_r - 0.5) if modal_r > 0.5 else 0.5
                high = max(high, modal_r + 0.5)
                rows.append({
                    "date": day, "market_id": market.code, "market_name": market.name, "grade": grade,
                    "supply_type": supply_type, "main_origin": origin,
                    "price_min_mad_kg": low, "price_modal_mad_kg": modal_r, "price_max_mad_kg": high,
                    "arrivals_t": round(volume, 1), "status": "reported", "quality_flag": quality_flag, "remark": remark,
                })

    observations = pd.DataFrame(rows, columns=COLUMNS)
    grade_order = {grade: position for position, grade in enumerate(C.GRADES)}
    observations = (
        observations.assign(_g=observations["grade"].map(grade_order))
        .sort_values(["date", "market_id", "_g"], kind="mergesort")
        .drop(columns="_g")
        .reset_index(drop=True)
    )
    event_table = pd.DataFrame(
        [{"year": event["year"], "event": event["event"].replace("_", " "), "start": event["start"],
          "end": event["end"], "scope": event["scope"], "simulated_effect": event["effect"]} for event in events],
        columns=["year", "event", "start", "end", "scope", "simulated_effect"],
    ).sort_values(["start", "event"], kind="mergesort").reset_index(drop=True)
    return SyntheticMarket(observations, event_table, seed, start_ts, cutoff_ts)
