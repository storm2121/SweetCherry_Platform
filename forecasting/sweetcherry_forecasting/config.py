"""Simulation settings. Every number here is an illustrative assumption, not an
observation; the same values are written to the workbook's Assumptions sheet
so the data and its description cannot drift apart."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Market:
    code: str
    name: str
    spread_low: float  # premium over Casablanca, drawn once per year
    spread_high: float
    arrivals_share: float  # share of the three markets' local arrivals
    import_reports_per_week: int


@dataclass(frozen=True)
class Region:
    name: str
    altitude_m: int
    crop_share: float  # share of the local crop reaching the three markets
    start: tuple[int, int]  # typical (month, day) of first, peak and last harvest
    peak: tuple[int, int]
    end: tuple[int, int]


MARKETS = (
    Market("M01", "Casablanca", 0.00, 0.00, 0.50, 3),
    Market("M02", "Rabat", 0.03, 0.06, 0.28, 2),
    Market("M03", "Marrakech", 0.05, 0.09, 0.22, 1),
)

# Lower orchards ripen first; harvest moves up the Middle Atlas into July.
REGIONS = (
    Region("Taounate", 600, 0.14, (5, 8), (5, 24), (6, 15)),
    Region("Sefrou", 850, 0.30, (5, 14), (6, 2), (6, 28)),
    Region("El Hajeb", 1000, 0.18, (5, 20), (6, 7), (7, 2)),
    Region("Azrou", 1250, 0.20, (5, 28), (6, 16), (7, 12)),
    Region("Ifrane", 1650, 0.18, (6, 8), (6, 28), (7, 22)),
)

GRADES = ("A", "AA", "AAA")
GRADE_VOLUME_SHARE = {"A": 0.40, "AA": 0.42, "AAA": 0.18}

# AA price in Casablanca at the 2018 price level, as a function of the supply
# index s = local arrivals / typical peak arrivals and of the days t since the
# first local fruit: floor + span * exp(-decay * s) * novelty(t), where the
# first-fruit premium novelty(t) = late + (1 - late) * exp(-t / days).
PRICE_FLOOR = 19.0
PRICE_SPAN = 52.0
PRICE_DECAY = 3.5
NOVELTY_LATE = 0.30
NOVELTY_DAYS = 12.0

ANNUAL_DRIFT = 0.025  # nominal, per year
CROP_ELASTICITY = -0.45  # price response to the national crop index
DEMAND_SIGMA = 0.04  # year-to-year demand level, log scale
PHENOLOGY_SIGMA_DAYS = 4.0  # shared shift of the whole season, per year
REGION_JITTER_DAYS = 1.5
CROP_SIGMA = 0.10  # region-year crop size, log scale

# Grade price relative to AA. Scarcity = 1 - min(1, s): premiums are wider
# when little fruit is on the market.
A_RATIO_BASE, A_RATIO_SCARCITY = 0.72, -0.04
AAA_RATIO_BASE, AAA_RATIO_SCARCITY = 1.38, 0.17

COMMON_AR, COMMON_SIGMA = 0.80, 0.035  # daily factor shared by markets and grades
MARKET_AR, MARKET_SIGMA = 0.85, 0.035  # daily deviation per market
ROW_SIGMA = 0.025  # per bulletin line
HETERO_SCARCITY = 1.2  # noise grows with scarcity: sigma * (1 + 1.2 * scarcity)
AAA_NOISE_FACTOR = 1.3
WEEKDAY_EFFECT = {0: 0.015, 5: -0.020}  # Monday, Saturday

EID_PRE_DAYS, EID_PRE_EFFECT = 4, -0.06  # trading days before Eid al-Adha
EID_POST_EFFECT = -0.04  # first trading day after the closure

COLD_STORAGE_SHARE = 0.05  # of the season's local volume
COLD_STORAGE_DAYS = 28
# Stored fruit sells at (floor + span * late novelty) times a factor rising
# from START to END as the stock runs down.
COLD_PRICE_START, COLD_PRICE_END = 1.25, 1.55

IMPORT_WINDOW = ((12, 1), (2, 28))  # counter-season imports, December to February
IMPORT_AA_PRICE = 125.0  # at the 2018 price level
IMPORT_A_RATIO, IMPORT_AAA_RATIO = 0.80, 1.25
IMPORT_SIGMA = 0.08

SEASON_ARRIVALS_T = 2500.0  # local arrivals across the three markets, crop index 1
MIN_TRADED_T = 0.3  # a grade below this volume on a market-day is not quoted
MISSING_RATE = (0.05, 0.12)  # bulletins missing, drawn per market-year
PARTIAL_MISSING_RATE = 0.02  # one grade line missing from a published bulletin
SPREAD_BELOW = (0.04, 0.12)  # min price below modal
SPREAD_ABOVE = (0.04, 0.15)  # max price above modal
OUTLIER_RATE = 0.006
SUSPECT_RATE = 0.0025

EVENT_PROBABILITY = {
    "frost": 0.25,
    "bumper": 0.15,
    "harvest_rain": 0.30,
    "heat": 0.20,
    "transport_cost": 0.15,
}

FIXED_HOLIDAYS = {  # (month, day): name; markets closed
    (1, 1): "New Year's Day",
    (1, 11): "Independence Manifesto Day",
    (5, 1): "Labour Day",
    (7, 30): "Throne Day",
    (8, 14): "Oued Ed-Dahab Day",
    (8, 20): "Revolution of the King and the People",
    (8, 21): "Youth Day",
    (11, 6): "Green March",
    (11, 18): "Independence Day",
}

# Eid al-Adha in Morocco, approximate (+/- 1 day): used only to simulate a
# two-day closure and the demand dip around it.
EID_AL_ADHA = {
    2018: "2018-08-22",
    2019: "2019-08-12",
    2020: "2020-07-31",
    2021: "2021-07-21",
    2022: "2022-07-10",
    2023: "2023-06-29",
    2024: "2024-06-17",
    2025: "2025-06-07",
    2026: "2026-05-27",
}


def _pct(value: float) -> str:
    return f"{value * 100:+.1f}%"


def assumption_rows() -> list[tuple[str, str, str]]:
    """(topic, assumption, value) rows for the workbook's Assumptions sheet."""
    rows: list[tuple[str, str, str]] = []
    for region in REGIONS:
        rows.append((
            "Harvest window",
            f"{region.name} ({region.altitude_m} m), share of local crop {region.crop_share:.0%}",
            "first {0:02d}-{1:02d}, peak {2:02d}-{3:02d}, last {4:02d}-{5:02d} (month-day, typical year)".format(
                *region.start, *region.peak, *region.end),
        ))
    rows += [
        ("Harvest window", "Shared shift of the whole season, per year", f"normal, sd {PHENOLOGY_SIGMA_DAYS:g} days; region jitter sd {REGION_JITTER_DAYS:g} days"),
        ("Crop size", "Region-year crop size around its typical level", f"lognormal, sd {CROP_SIGMA:g} (log scale), plus simulated events"),
        ("Volumes", "Local arrivals at the three markets in a typical season", f"{SEASON_ARRIVALS_T:,.0f} t x national crop index"),
        ("Volumes", "Market shares of local arrivals", ", ".join(f"{m.name} {m.arrivals_share:.0%}" for m in MARKETS)),
        ("Volumes", "Grade shares of local arrivals", ", ".join(f"{g} {GRADE_VOLUME_SHARE[g]:.0%}" for g in GRADES)),
        ("Volumes", "A grade is not quoted on a market-day when its volume is below", f"{MIN_TRADED_T:g} t"),
        ("Price level", "AA modal price in Casablanca at the 2018 level; s = arrivals / typical peak arrivals, t = days since the first local fruit",
         f"{PRICE_FLOOR:g} + {PRICE_SPAN:g} x exp(-{PRICE_DECAY:g} x s) x novelty(t) MAD/kg"),
        ("Price level", "First-fruit premium novelty(t)",
         f"{NOVELTY_LATE:g} + {1 - NOVELTY_LATE:g} x exp(-t / {NOVELTY_DAYS:g})"),
        ("Price level", "Nominal drift", f"{ANNUAL_DRIFT:.1%} per year"),
        ("Price level", "Response to the national crop index", f"price x crop_index^{CROP_ELASTICITY:g}"),
        ("Price level", "Year-to-year demand level", f"lognormal, sd {DEMAND_SIGMA:g}"),
        ("Grades", "A price relative to AA", f"{A_RATIO_BASE:g} {A_RATIO_SCARCITY:+g} x scarcity (scarcity = 1 - min(1, s))"),
        ("Grades", "AAA price relative to AA", f"{AAA_RATIO_BASE:g} {AAA_RATIO_SCARCITY:+g} x scarcity"),
        ("Markets", "Premium over Casablanca, redrawn each year",
         "; ".join(f"{m.name} {m.spread_low:.0%} to {m.spread_high:.0%}" for m in MARKETS[1:])),
        ("Noise", "Daily factor shared by all markets and grades", f"AR(1), phi {COMMON_AR:g}, sd {COMMON_SIGMA:g} (log)"),
        ("Noise", "Daily deviation per market", f"AR(1), phi {MARKET_AR:g}, sd {MARKET_SIGMA:g} (log)"),
        ("Noise", "Per bulletin line", f"sd {ROW_SIGMA:g} x (1 + {HETERO_SCARCITY:g} x scarcity), x {AAA_NOISE_FACTOR:g} for AAA"),
        ("Calendar", "Trading days", "Monday to Saturday; closed on public holidays and for two days at Eid al-Adha"),
        ("Calendar", "Weekday effect", f"Monday {_pct(WEEKDAY_EFFECT[0])}, Saturday {_pct(WEEKDAY_EFFECT[5])}"),
        ("Calendar", "Eid al-Adha dates", "approximate (+/- 1 day): " + ", ".join(EID_AL_ADHA.values())),
        ("Calendar", "Demand around Eid al-Adha",
         f"{_pct(EID_PRE_EFFECT)} over the {EID_PRE_DAYS} trading days before, {_pct(EID_POST_EFFECT)} on the first day after"),
        ("Cold storage", "Local fruit sold from cold storage after the harvest",
         f"{COLD_STORAGE_SHARE:.0%} of the season's volume over {COLD_STORAGE_DAYS} days"),
        ("Cold storage", "Cold-storage AA price at the 2018 level",
         f"({PRICE_FLOOR:g} + {PRICE_SPAN:g} x {NOVELTY_LATE:g}) x factor rising from {COLD_PRICE_START:g} to {COLD_PRICE_END:g} as stock runs down"),
        ("Imports", "Counter-season imports",
         f"December to February; AA about {IMPORT_AA_PRICE:g} MAD/kg at the 2018 level; A x {IMPORT_A_RATIO:g}, AAA x {IMPORT_AAA_RATIO:g}"),
        ("Imports", "Import reports per week", ", ".join(f"{m.name} {m.import_reports_per_week}" for m in MARKETS)),
        ("Recording", "Bulletins missing", f"{MISSING_RATE[0]:.0%} to {MISSING_RATE[1]:.0%} of trading days, drawn per market-year"),
        ("Recording", "One grade line missing from a published bulletin", f"{PARTIAL_MISSING_RATE:.0%}"),
        ("Recording", "Minimum and maximum around the modal price",
         f"min {SPREAD_BELOW[0]:.0%}-{SPREAD_BELOW[1]:.0%} below, max {SPREAD_ABOVE[0]:.0%}-{SPREAD_ABOVE[1]:.0%} above; rounded to 0.5 MAD"),
        ("Recording", "Explained outliers (remark given)", f"about {OUTLIER_RATE:.1%} of local lines"),
        ("Recording", "Suspect entries (decimal slip or grade mix-up)", f"about {SUSPECT_RATE:.2%} of local lines"),
    ]
    for name, probability in EVENT_PROBABILITY.items():
        rows.append(("Simulated events", f"Chance per year of a '{name.replace('_', ' ')}' event", f"{probability:.0%}"))
    return rows
