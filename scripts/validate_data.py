#!/usr/bin/env python3
"""Plausibility checks on the static datasets in public/data (run after `npm run data`).

Usage: npm run validate   (or python3 scripts/validate_data.py [-v])

Checks every country, admin-1 region and city against hard bounds and against the geometry it is drawn with
(geodesic area of the TopoJSON polygons, point-in-polygon for capitals). Prints a summary per check and the
worst offenders (top 15), exits with status 1 when a check of severity "error" has flags that are not in
ALLOWLIST. Warnings are reported but never fail the run.

`-v` also lists the allowlisted flags with their reasons.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import distance_to_polygon_km, geodesic_area_km2, topo_features  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
TOP = 15
THIS_YEAR = dt.date.today().year
OLD_YEAR = 2015

MAX_POPULATION = 1.6e9
COUNTRY_AREA_RATIO = (0.5, 2.0)  # stated area / polygon area, for polygons > COUNTRY_MIN_POLYGON km²
COUNTRY_MIN_POLYGON = 50.0
COUNTRY_DENSITY = (0.1, 30_000.0)  # inhabitants per km²
GDP_PC_TOLERANCE = 0.25  # gdpPerCapita vs gdp / population (years may differ by one or two)
GDP_PC_RANGE = (100.0, 300_000.0)  # current US$
REGION_POP_SUM = (0.8, 1.2)  # sum of region populations / country population
REGION_AREA_SUM = (0.8, 1.25)  # sum of region areas / country area
REGION_AREA_RATIO = (0.4, 2.5)  # stated area / polygon area, for polygons > REGION_MIN_POLYGON km²
REGION_MIN_POLYGON = 200.0
REGION_DENSITY = (0.01, 30_000.0)
CAPITAL_TOLERANCE_KM = 30.0
CITY_BBOX_MARGIN_DEG = 2.0
CITY_POLYGON_TOLERANCE_KM = 50.0  # cities outside the framing bbox (Anchorage, Honolulu) near the country shape

# Flags that were investigated and are real (or an accepted limitation of the sources), per check id.
# Keys are country ids (ADM0_A3), region ids (the feature `id`) or "ADM0/City name" for cities.
ALLOWLIST: dict[str, dict[str, str]] = {
    "country.density": {
        # Real city-states and dense territories: the density is correct, just extreme.
        "MCO": "Monaco: 38k inhabitants on 2.1 km² (~18k/km²), the densest sovereign state",
        "MAC": "Macao: ~700k on 33 km² (~21k/km²)",
    },
}

SEVERITY = {
    "country.population": "error",
    "country.missing": "warn",
    "country.area_polygon": "error",
    "country.density": "error",
    "country.gdp_consistency": "error",
    "country.gdp_pc_range": "error",
    "country.year_future": "error",
    "country.year_old": "warn",
    "country.capital_location": "warn",
    "region.population": "error",
    "region.gt_country": "error",
    "region.area_polygon": "error",
    "region.density": "warn",
    "region.pop_sum": "warn",
    "region.area_sum": "warn",
    "region.capital_location": "warn",
    "region.year_future": "error",
    "city.population": "error",
    "city.gt_country": "error",
    "city.location": "warn",
    "city.duplicate": "warn",
}
DESCRIPTION = {
    "country.population": f"population < 0, 0 with a capital, or >= {MAX_POPULATION:.1e}",
    "country.missing": "population, area or GDP missing",
    "country.area_polygon": f"area / polygon area outside {COUNTRY_AREA_RATIO} (polygon > {COUNTRY_MIN_POLYGON:g} km²)",
    "country.density": f"density outside {COUNTRY_DENSITY} per km²",
    "country.gdp_consistency": f"gdpPerCapita vs gdp/population off by > {GDP_PC_TOLERANCE:.0%}",
    "country.gdp_pc_range": f"gdpPerCapita outside {GDP_PC_RANGE} US$",
    "country.year_future": f"a year after {THIS_YEAR}",
    "country.year_old": f"population/GDP year before {OLD_YEAR}",
    "country.capital_location": f"capital > {CAPITAL_TOLERANCE_KM:g} km from the country polygon",
    "region.population": "population < 0",
    "region.gt_country": "region population > country population",
    "region.area_polygon": f"area / polygon area outside {REGION_AREA_RATIO} (polygon > {REGION_MIN_POLYGON:g} km²)",
    "region.density": f"density outside {REGION_DENSITY} per km²",
    "region.pop_sum": f"sum of region populations / country population outside {REGION_POP_SUM}",
    "region.area_sum": f"sum of region areas / country area outside {REGION_AREA_SUM}",
    "region.capital_location": f"capital > {CAPITAL_TOLERANCE_KM:g} km from the region polygon",
    "region.year_future": f"populationYear after {THIS_YEAR}",
    "city.population": "population <= 0",
    "city.gt_country": "city population > country population",
    "city.location": f"outside the country bbox + {CITY_BBOX_MARGIN_DEG:g}° and > {CITY_POLYGON_TOLERANCE_KM:g} km from its polygon",
    "city.duplicate": "same name twice in a country",
}


# --------------------------------------------------------------------------- geometry


def distance_km(lat: float, lon: float, shapes: list[dict | None]) -> float:
    """Distance to the nearest of several polygons (0 inside one of them)."""
    return min((distance_to_polygon_km(lat, lon, g) for g in shapes if g), default=math.inf)


def in_bbox(lat: float, lon: float, bbox: list[float], margin: float) -> bool:
    west, south, east, north = bbox
    if not south - margin <= lat <= north + margin:
        return False
    if west <= east:
        return west - margin <= lon <= east + margin
    return lon >= west - margin or lon <= east + margin  # bbox crossing the antimeridian


# --------------------------------------------------------------------------- report


class Report:
    def __init__(self) -> None:
        self.flags: dict[str, list[tuple[float, str, str]]] = defaultdict(list)  # check -> (score, key, text)
        self.checked: Counter = Counter()
        self.notes: list[str] = []

    def count(self, check: str, n: int = 1) -> None:
        self.checked[check] += n

    def flag(self, check: str, key: str, text: str, score: float = 0.0) -> None:
        self.flags[check].append((score, key, text))

    def print(self, verbose: bool) -> int:
        errors = 0
        print(f"{'check':<26} {'sev':<5} {'checked':>7} {'flagged':>7} {'allowed':>7}  description")
        for check in SEVERITY:
            flags = self.flags.get(check, [])
            allowed = [f for f in flags if f[1] in ALLOWLIST.get(check, {})]
            open_ = len(flags) - len(allowed)
            if SEVERITY[check] == "error":
                errors += open_
            print(
                f"{check:<26} {SEVERITY[check]:<5} {self.checked[check]:>7} {open_:>7} {len(allowed):>7}  "
                f"{DESCRIPTION[check]}"
            )
        for check in SEVERITY:
            flags = sorted(self.flags.get(check, []), key=lambda f: -f[0])
            allow = ALLOWLIST.get(check, {})
            open_ = [f for f in flags if f[1] not in allow]
            if open_:
                more = f" (top {TOP} of {len(open_)})" if len(open_) > TOP else ""
                print(f"\n[{SEVERITY[check].upper()}] {check}{more}")
                for _, _, text in open_[:TOP]:
                    print(f"  {text}")
            if verbose and allow:
                hit = [f for f in flags if f[1] in allow]
                if hit:
                    print(f"\n[ALLOWED] {check}")
                    for _, key, text in hit:
                        print(f"  {text}\n      -> {allow[key]}")
        for note in self.notes:
            print(f"\n{note}")
        print(f"\n{'FAILED' if errors else 'OK'}: {errors} error(s), "
              f"{sum(len(v) for c, v in self.flags.items() if SEVERITY[c] == 'warn')} warning(s)")
        return errors


def fmt(n: float | None) -> str:
    if n is None:
        return "—"
    if abs(n) >= 100:
        return f"{n:,.0f}"
    return f"{n:.3g}"


def log_off(ratio: float) -> float:
    return abs(math.log(ratio)) if ratio > 0 else math.inf


# --------------------------------------------------------------------------- checks


def check_countries(rep: Report, countries: dict, shapes: dict[str, list], admin1: dict[str, list]) -> None:
    for cid, c in countries.items():
        tag = f"{cid} {c['nameEn']}"
        pop, area = c.get("population"), c.get("area")
        rep.count("country.population")
        if pop is not None and (pop < 0 or pop >= MAX_POPULATION or (pop == 0 and c["capitals"])):
            rep.flag("country.population", cid, f"{tag}: population {fmt(pop)}", float(pop))
        rep.count("country.missing")
        missing = [k for k in ("population", "area", "gdp", "gdpPerCapita") if c.get(k) is None]
        if missing:
            rep.flag("country.missing", cid, f"{tag}: missing {', '.join(missing)} ({c['type']})", len(missing))

        geom = shapes.get(cid, [])
        # Natural Earth 1:50m drops small islands (Tarawa, Wallis, the Northern Marianas): the 1:10m admin-1
        # shapes of the same country, when larger, are the better measure.
        polygon = max(
            sum(geodesic_area_km2(g) for g in geom[:1] if g),
            sum(geodesic_area_km2(g) for _, g in admin1.get(cid, []) if g),
        )
        if area and polygon > COUNTRY_MIN_POLYGON:
            rep.count("country.area_polygon")
            ratio = area / polygon
            if not COUNTRY_AREA_RATIO[0] <= ratio <= COUNTRY_AREA_RATIO[1]:
                rep.flag(
                    "country.area_polygon", cid,
                    f"{tag}: area {fmt(area)} km² ({c['areaSource']}) vs polygon {fmt(polygon)} km² → ×{ratio:.2f}",
                    log_off(ratio),
                )  # fmt: skip

        if pop and area:
            rep.count("country.density")
            density = pop / area
            if not COUNTRY_DENSITY[0] <= density <= COUNTRY_DENSITY[1]:
                rep.flag(
                    "country.density", cid,
                    f"{tag}: {fmt(density)}/km² ({fmt(pop)} / {fmt(area)} km², {c['areaSource']})",
                    log_off(density / math.sqrt(COUNTRY_DENSITY[0] * COUNTRY_DENSITY[1])),
                )  # fmt: skip

        gdp, gdp_pc = c.get("gdp"), c.get("gdpPerCapita")
        if gdp and gdp_pc and pop:
            rep.count("country.gdp_consistency")
            implied = gdp / pop
            if abs(implied / gdp_pc - 1) > GDP_PC_TOLERANCE:
                rep.flag(
                    "country.gdp_consistency", cid,
                    f"{tag}: gdpPerCapita {fmt(gdp_pc)} ({c['gdpPerCapitaYear']}) vs gdp/pop {fmt(implied)} "
                    f"(gdp {c['gdpYear']}, pop {c['populationYear']} {c['populationSource']})",
                    log_off(implied / gdp_pc),
                )  # fmt: skip
        if gdp_pc:
            rep.count("country.gdp_pc_range")
            if not GDP_PC_RANGE[0] <= gdp_pc <= GDP_PC_RANGE[1]:
                rep.flag("country.gdp_pc_range", cid, f"{tag}: gdpPerCapita {fmt(gdp_pc)} US$", gdp_pc)

        for field in ("populationYear", "gdpYear", "gdpPerCapitaYear"):
            year = c.get(field)
            if year is None:
                continue
            rep.count("country.year_future")
            rep.count("country.year_old")
            if year > THIS_YEAR:
                rep.flag("country.year_future", cid, f"{tag}: {field} {year}", year)
            elif year < OLD_YEAR:
                source = c["populationSource"] if field == "populationYear" else "World Bank"
                rep.flag("country.year_old", f"{cid}.{field}", f"{tag}: {field} {year} ({source})", -year)

        for cap in c.get("capitals") or []:
            rep.count("country.capital_location")
            d = distance_km(cap["lat"], cap["lon"], geom)
            if d > CAPITAL_TOLERANCE_KM:
                rep.flag(
                    "country.capital_location", cid,
                    f"{tag}: capital {cap['name']} ({cap['lat']}, {cap['lon']}) {fmt(d)} km from the polygon",
                    d,
                )  # fmt: skip


def check_regions(rep: Report, countries: dict, admin1: dict[str, list]) -> None:
    years: Counter = Counter()
    for adm0, feats in sorted(admin1.items()):
        country = countries.get(adm0, {})
        cpop, carea = country.get("population"), country.get("area")
        pop_sum, area_sum, with_pop, with_area = 0, 0.0, 0, 0
        for props, geom in feats:
            rid = props["id"]
            tag = f"{adm0} {props.get('name', rid)} [{rid}]"
            pop, area = props.get("population"), props.get("area")
            if pop is not None:
                with_pop += 1
                pop_sum += pop
                years[props.get("populationYear")] += 1
                rep.count("region.population")
                if pop < 0:
                    rep.flag("region.population", rid, f"{tag}: population {fmt(pop)}", -pop)
                if cpop:
                    rep.count("region.gt_country")
                    if pop > cpop:
                        rep.flag(
                            "region.gt_country", rid,
                            f"{tag}: population {fmt(pop)} ({props.get('populationYear')}) > country {fmt(cpop)}",
                            pop / cpop,
                        )  # fmt: skip
                year = props.get("populationYear")
                if year:
                    rep.count("region.year_future")
                    if year > THIS_YEAR:
                        rep.flag("region.year_future", rid, f"{tag}: populationYear {year}", year)
            if area:
                with_area += 1
                area_sum += area
            polygon = geodesic_area_km2(geom) if geom else 0.0
            if area and polygon > REGION_MIN_POLYGON:
                rep.count("region.area_polygon")
                ratio = area / polygon
                if not REGION_AREA_RATIO[0] <= ratio <= REGION_AREA_RATIO[1]:
                    rep.flag(
                        "region.area_polygon", rid,
                        f"{tag}: area {fmt(area)} km² ({props.get('areaSource', 'Wikidata')}) vs polygon "
                        f"{fmt(polygon)} km² → ×{ratio:.2f}",
                        log_off(ratio),
                    )  # fmt: skip
            if pop and area:
                rep.count("region.density")
                density = pop / area
                if not REGION_DENSITY[0] <= density <= REGION_DENSITY[1]:
                    rep.flag(
                        "region.density", rid,
                        f"{tag}: {fmt(density)}/km² ({fmt(pop)} / {fmt(area)} km²)",
                        log_off(density / math.sqrt(REGION_DENSITY[0] * REGION_DENSITY[1])),
                    )  # fmt: skip
            if props.get("capLat") is not None:
                rep.count("region.capital_location")
                d = distance_km(props["capLat"], props["capLon"], [geom])
                if d > CAPITAL_TOLERANCE_KM:
                    bbox = country.get("bbox")
                    where = "inside" if bbox and in_bbox(props["capLat"], props["capLon"], bbox, 0) else "outside"
                    rep.flag(
                        "region.capital_location", rid,
                        f"{tag}: capital {props.get('capName')} ({props['capLat']}, {props['capLon']}) "
                        f"{fmt(d)} km from the region, {where} the country bbox",
                        d,
                    )  # fmt: skip

        n = len(feats)
        # Sums are only meaningful when (nearly) every region has a value.
        if cpop and n > 1 and with_pop == n:
            rep.count("region.pop_sum")
            ratio = pop_sum / cpop
            if not REGION_POP_SUM[0] <= ratio <= REGION_POP_SUM[1]:
                rep.flag(
                    "region.pop_sum", adm0,
                    f"{adm0} {country.get('nameEn')}: Σ regions {fmt(pop_sum)} vs country {fmt(cpop)} → ×{ratio:.2f}",
                    log_off(ratio),
                )  # fmt: skip
        if carea and n > 1 and with_area == n:
            rep.count("region.area_sum")
            ratio = area_sum / carea
            if not REGION_AREA_SUM[0] <= ratio <= REGION_AREA_SUM[1]:
                rep.flag(
                    "region.area_sum", adm0,
                    f"{adm0} {country.get('nameEn')}: Σ regions {fmt(area_sum)} km² vs country {fmt(carea)} km² "
                    f"→ ×{ratio:.2f}",
                    log_off(ratio),
                )  # fmt: skip

    total = sum(years.values())
    undated = years.pop(None, 0)
    old = sum(v for y, v in years.items() if y < OLD_YEAR)
    buckets = Counter("<2000" if y < 2000 else f"{y // 5 * 5}-{y // 5 * 5 + 4}" for y in years.elements())
    dist = ", ".join(f"{k}: {v}" for k, v in sorted(buckets.items()))
    rep.notes.append(
        f"Region populationYear ({total} regions with population): {old} older than {OLD_YEAR}, "
        f"{undated} undated.\n  {dist}"
    )


def check_cities(rep: Report, countries: dict, cities: dict, shapes: dict[str, list]) -> None:
    for cid, rows in cities.items():
        country = countries.get(cid, {})
        cpop, bbox = country.get("population"), country.get("bbox")
        names = Counter(r[0] for r in rows)
        for name, n in names.items():
            rep.count("city.duplicate")
            if n > 1:
                rep.flag("city.duplicate", f"{cid}/{name}", f"{cid}: {name} ×{n}", n)
        for name, lat, lon, pop in rows:
            key, tag = f"{cid}/{name}", f"{cid} {name}"
            rep.count("city.population")
            if not pop or pop <= 0:
                rep.flag("city.population", key, f"{tag}: population {pop}", 0)
            if cpop:
                rep.count("city.gt_country")
                if pop > cpop:
                    rep.flag("city.gt_country", key, f"{tag}: {fmt(pop)} > country {fmt(cpop)}", pop / cpop)
            if bbox:
                rep.count("city.location")
                if not in_bbox(lat, lon, bbox, CITY_BBOX_MARGIN_DEG):
                    d = distance_km(lat, lon, shapes.get(cid))
                    if d > CITY_POLYGON_TOLERANCE_KM:
                        rep.flag("city.location", key, f"{tag} ({lat}, {lon}): {fmt(d)} km from {cid}", d)


def main() -> int:
    verbose = "-v" in sys.argv[1:]
    countries = json.loads((DATA / "countries.json").read_text(encoding="utf-8"))
    cities = json.loads((DATA / "cities.json").read_text(encoding="utf-8"))
    admin1 = {path.stem: topo_features(path) for path in sorted((DATA / "admin1").glob("*.json"))}
    # Country shape for location checks: the 1:50m outline plus its 1:10m admin-1 polygons.
    shapes: dict[str, list] = defaultdict(list)
    for props, geom in topo_features(DATA / "countries.topo.json"):
        shapes[props["id"]].append(geom)
    for adm0, feats in admin1.items():
        shapes[adm0].extend(g for _, g in feats)
    rep = Report()
    check_countries(rep, countries, shapes, admin1)
    check_regions(rep, countries, admin1)
    check_cities(rep, countries, cities, shapes)
    stale = [
        f"{check}:{key}"
        for check, keys in ALLOWLIST.items()
        for key in keys
        if key not in {f[1] for f in rep.flags.get(check, [])}
    ]
    if stale:
        rep.notes.append(f"Allowlist entries that no longer match a flag (remove them): {', '.join(stale)}")
    return 1 if rep.print(verbose) else 0


if __name__ == "__main__":
    sys.exit(main())
