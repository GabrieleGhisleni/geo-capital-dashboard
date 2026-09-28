#!/usr/bin/env python3
"""Build the static datasets served by the dashboard (public/data, public/fonts).

Every source is an aggregated, worldwide dataset: nothing is scraped country by country.

- Natural Earth 1:50m admin-0 and 1:10m admin-1 boundaries (public domain)
- World Bank WDI API: SP.POP.TOTL, AG.SRF.TOTL.K2 (CC BY 4.0) -> country population / surface
- Wikidata SPARQL (CC0) -> capitals, admin-1 population / area / capital, fallbacks
- GeoNames cities5000 (CC BY 4.0) -> major cities with population

Usage: npm run data   (requires network and `npm install`, which provides mapshaper)
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".data-cache"
OUT = ROOT / "public" / "data"
FONTS_OUT = ROOT / "public" / "fonts"
MAPSHAPER = ROOT / "node_modules" / ".bin" / "mapshaper"
USER_AGENT = "geo-capital-dashboard/0.1 (static data build; https://github.com/GabrieleGhisleni)"

NE_ADMIN0 = "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"
NE_ADMIN1 = "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip"
GEONAMES_CITIES = "https://download.geonames.org/export/dump/cities5000.zip"
WORLD_BANK = "https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&mrnev=1&per_page=1000"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
FONT_URL = "https://tiles.openfreemap.org/fonts/{font}/{start}-{end}.pbf"
FONTS = ["Noto Sans Regular", "Noto Sans Bold"]
FONT_RANGES = range(0, 33)  # 0-8447: Latin, Greek, Cyrillic, Latin Extended Additional, punctuation

CITIES_PER_COUNTRY = 20
CAPITAL_DEDUP_KM = 7.0
EXCLUDED_FEATURE_CODES = {"PPLX", "PPLH", "PPLQ", "PPLW", "PPLCH", "PPLR"}

# Natural Earth models these countries with provinces/departments/municipalities:
# merge them into the real first-level regions using the given attribute.
DISSOLVE_FIELD = {
    "ITA": "region",
    "FRA": "region",
    "ESP": "region",
    "PHL": "region",
    "SVN": "region",
    "GBR": "geonunit",
}
# ISO 3166-2 codes for merged regions whose Natural Earth `region_cod` is missing or not ISO.
DISSOLVED_ISO = {
    "GBR|England": "GB-ENG",
    "GBR|Scotland": "GB-SCT",
    "GBR|Wales": "GB-WLS",
    "GBR|Northern Ireland": "GB-NIR",
    "ESP|Andalucía": "ES-AN",
    "ESP|Aragón": "ES-AR",
    "ESP|Asturias": "ES-AS",
    "ESP|Canary Is.": "ES-CN",
    "ESP|Cantabria": "ES-CB",
    "ESP|Castilla y León": "ES-CL",
    "ESP|Castilla-La Mancha": "ES-CM",
    "ESP|Cataluña": "ES-CT",
    "ESP|Ceuta": "ES-CE",
    "ESP|Extremadura": "ES-EX",
    "ESP|Foral de Navarra": "ES-NC",
    "ESP|Galicia": "ES-GA",
    "ESP|Islas Baleares": "ES-IB",
    "ESP|La Rioja": "ES-RI",
    "ESP|Madrid": "ES-MD",
    "ESP|Melilla": "ES-ML",
    "ESP|Murcia": "ES-MC",
    "ESP|País Vasco": "ES-PV",
    "ESP|Valenciana": "ES-VC",
}
ISO_3166_2 = re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,3}$")

AREA_UNIT_TO_KM2 = {
    "Q712226": 1.0,  # square kilometre
    "Q25343": 1e-6,  # square metre
    "Q35852": 0.01,  # hectare
    "Q232291": 2.589988,  # square mile
    "Q81292": 0.004046856,  # acre
}
RANK_ORDER = {"PreferredRank": 2, "NormalRank": 1, "DeprecatedRank": -1}


# --------------------------------------------------------------------------- utils


def log(msg: str) -> None:
    print(f"[data] {msg}", flush=True)


def http_get(url: str, *, data: bytes | None = None, headers: dict | None = None, retries: int = 5) -> bytes:
    req_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=req_headers)
            with urllib.request.urlopen(req, timeout=180) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            if err.code == 404:
                raise
            wait = 5 * (attempt + 1)
            log(f"HTTP {err.code} on {url[:90]}… retrying in {wait}s")
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError) as err:
            wait = 5 * (attempt + 1)
            log(f"{err} on {url[:90]}… retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url}")


def download(url: str, name: str) -> Path:
    path = CACHE / name
    if not path.exists():
        log(f"downloading {url}")
        path.write_bytes(http_get(url))
    return path


def unzip(path: Path, dest: Path) -> Path:
    if not dest.exists():
        with zipfile.ZipFile(path) as zf:
            zf.extractall(dest)
    return dest


def mapshaper(*args: str) -> None:
    cmd = [str(MAPSHAPER), *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"mapshaper failed:\n{' '.join(cmd)}\n{result.stderr}")


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlmb = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def clean_str(value) -> str:
    return str(value).strip() if value not in (None, -99, "-99") else ""


# --------------------------------------------------------------------------- Wikidata


def sparql(query: str) -> list[dict]:
    body = urllib.parse.urlencode({"query": query}).encode()
    raw = http_get(
        WIKIDATA_SPARQL,
        data=body,
        headers={
            "Accept": "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    return json.loads(raw)["results"]["bindings"]


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def parse_point(wkt: str) -> tuple[float, float] | None:
    m = re.match(r"Point\(([-\d.eE]+) ([-\d.eE]+)\)", wkt)
    return (float(m.group(2)), float(m.group(1))) if m else None


def wikidata_resolve(prop: str, codes: list[str]) -> dict[str, str]:
    """Map external identifiers (e.g. P300 ISO 3166-2, P1566 GeoNames ID) to Wikidata items."""
    out: dict[str, str] = {}
    for i in range(0, len(codes), 200):
        values = " ".join(f'"{c}"' for c in codes[i : i + 200])
        rows = sparql(f"SELECT ?code ?item WHERE {{ VALUES ?code {{ {values} }} ?item wdt:{prop} ?code . }}")
        for r in rows:
            out.setdefault(r["code"]["value"], qid(r["item"]["value"]))
    return out


def wikidata_stats(qids: list[str], label: str) -> dict[str, dict]:
    """Latest population, area (km²), Italian label and capitals for each item."""
    cache_file = CACHE / f"wikidata_{label}.json"
    if cache_file.exists():
        cached = json.loads(cache_file.read_text())
        if set(qids) <= set(cached["_qids"]):
            return cached["stats"]

    pops: dict[str, list] = defaultdict(list)
    areas: dict[str, list] = defaultdict(list)
    caps: dict[str, dict] = defaultdict(dict)
    labels: dict[str, str] = {}
    batch = 120
    for i in range(0, len(qids), batch):
        chunk = qids[i : i + batch]
        log(f"wikidata {label}: {i + len(chunk)}/{len(qids)}")
        values = " ".join(f"wd:{q}" for q in chunk)
        rows = sparql(
            f"""
            SELECT ?item ?itemLabel ?pop ?popDate ?popRank ?area ?areaUnit ?areaRank
                   ?cap ?capLabel ?capCoord ?capPop WHERE {{
              VALUES ?item {{ {values} }}
              {{ ?item p:P1082 ?ps . ?ps ps:P1082 ?pop ; wikibase:rank ?popRank .
                 OPTIONAL {{ ?ps pq:P585 ?popDate }} }}
              UNION
              {{ ?item p:P2046 ?as . ?as wikibase:rank ?areaRank ; psv:P2046 ?av .
                 ?av wikibase:quantityAmount ?area ; wikibase:quantityUnit ?areaUnit . }}
              UNION
              {{ ?item wdt:P36 ?cap . OPTIONAL {{ ?cap wdt:P625 ?capCoord }}
                 OPTIONAL {{ ?cap wdt:P1082 ?capPop }} }}
              SERVICE wikibase:label {{ bd:serviceParam wikibase:language "it,en,mul" . }}
            }}"""
        )
        for r in rows:
            item = qid(r["item"]["value"])
            if "itemLabel" in r and not re.fullmatch(r"Q\d+", r["itemLabel"]["value"]):
                labels[item] = r["itemLabel"]["value"]
            if "pop" in r:
                rank = RANK_ORDER.get(qid(r["popRank"]["value"]), 0)
                if rank >= 0:
                    date = r.get("popDate", {}).get("value", "")
                    date = date if re.match(r"^\d{4}-", date) else ""  # skip "unknown value" nodes
                    pops[item].append((date, rank, float(r["pop"]["value"])))
            if "area" in r:
                rank = RANK_ORDER.get(qid(r["areaRank"]["value"]), 0)
                factor = AREA_UNIT_TO_KM2.get(qid(r["areaUnit"]["value"]))
                if rank >= 0 and factor:
                    areas[item].append((rank, float(r["area"]["value"]) * factor))
            if "cap" in r:
                cap_id = qid(r["cap"]["value"])
                cap = caps[item].setdefault(cap_id, {"name": cap_id, "lat": None, "lon": None, "population": None})
                if "capLabel" in r and not re.fullmatch(r"Q\d+", r["capLabel"]["value"]):
                    cap["name"] = r["capLabel"]["value"]
                if "capCoord" in r and cap["lat"] is None:
                    point = parse_point(r["capCoord"]["value"])
                    if point:
                        cap["lat"], cap["lon"] = round(point[0], 4), round(point[1], 4)
                if "capPop" in r:
                    cap["population"] = max(cap["population"] or 0, int(float(r["capPop"]["value"])))
        time.sleep(1)

    stats: dict[str, dict] = {}
    for q in qids:
        entry: dict = {"label": labels.get(q)}
        if pops[q]:
            dated = [p for p in pops[q] if p[0]]
            if dated:
                date, _, value = max(dated, key=lambda p: (p[0], p[1]))
                entry["population"], entry["populationYear"] = int(value), int(date[:4])
            else:
                entry["population"] = int(max(pops[q], key=lambda p: (p[1], p[2]))[2])
        if areas[q]:
            best_rank = max(a[0] for a in areas[q])
            entry["area"] = round(max(a[1] for a in areas[q] if a[0] == best_rank), 1)
        entry["capitals"] = [c for c in caps[q].values() if c["lat"] is not None]
        stats[q] = entry
    write_json(cache_file, {"_qids": qids, "stats": stats})
    return stats


# --------------------------------------------------------------------------- World Bank


def world_bank(indicator: str) -> dict[str, tuple[float, int]]:
    raw = json.loads(http_get(WORLD_BANK.format(indicator=indicator)))
    out = {}
    for row in raw[1]:
        if row["value"] is not None and row["countryiso3code"]:
            out[row["countryiso3code"]] = (row["value"], int(row["date"]))
    log(f"world bank {indicator}: {len(out)} values")
    return out


# --------------------------------------------------------------------------- geometry


def polygon_parts(geometry: dict) -> list[list]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def ring_area(ring: list) -> float:
    """Planar shoelace area in degrees², good enough to rank polygon parts."""
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))) / 2


def geodesic_area_km2(geometry: dict) -> float:
    """Spherical polygon area (Chamberlain & Duquette), outer rings minus holes."""

    def ring(coords: list) -> float:
        total = 0.0
        for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
            total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
        return abs(total) * 6371.0088**2 / 2

    return sum(ring(p[0]) - sum(ring(h) for h in p[1:]) for p in polygon_parts(geometry))


def focus_bbox(geometry: dict) -> list[float]:
    """Bounding box of the main land mass (+ parts >= 15% of it), antimeridian aware."""
    parts = polygon_parts(geometry)
    if not parts:
        return [-180, -85, 180, 85]
    sized = [(ring_area(p[0]), p[0]) for p in parts]
    largest = max(a for a, _ in sized)
    rings = [r for a, r in sized if a >= largest * 0.15]
    lons = [x for r in rings for x, _ in r]
    lats = [y for r in rings for _, y in r]
    west, east = min(lons), max(lons)
    shifted = [x + 360 if x < 0 else x for x in lons]
    if max(shifted) - min(shifted) < east - west:  # crossing the antimeridian (Russia, Fiji…)
        west, east = min(shifted), max(shifted)
        if west > 180:
            west, east = west - 360, east - 360
    return [round(west, 3), round(min(lats), 3), round(east, 3), round(max(lats), 3)]


# --------------------------------------------------------------------------- build steps


def build_countries_geometry(admin0_shp: Path) -> list[dict]:
    log("countries geometry")
    mapshaper(
        "-i", str(admin0_shp), "encoding=utf8",
        "-each", "id = ADM0_A3",
        "-simplify", "50%", "keep-shapes",
        "-filter-fields", "id",
        "-o", str(OUT / "countries.topo.json"), "format=topojson", "quantization=1e5", "id-field=id",
    )  # fmt: skip
    detail = CACHE / "admin0.geojson"
    mapshaper(
        "-i", str(admin0_shp), "encoding=utf8",
        "-filter-fields", "ADM0_A3,ISO_A2_EH,ISO_A3_EH,NAME,NAME_IT,CONTINENT,SUBREGION,TYPE,WIKIDATAID",
        "-o", str(detail), "format=geojson", "precision=0.001",
    )  # fmt: skip
    return json.loads(detail.read_text())["features"]


def admin1_key(props: dict) -> str:
    field = DISSOLVE_FIELD.get(props["adm0_a3"])
    group = clean_str(props.get(field)) if field else ""
    return f"{props['adm0_a3']}|{group}" if group else props["adm1_code"]


def build_admin1_geometry(admin1_shp: Path) -> tuple[list[dict], dict[str, Path]]:
    log("admin-1 geometry (dissolve + simplify + split per country)")
    fields = "adm0_a3,adm1_code,name,name_it,region,region_cod,geonunit,type_en,iso_3166_2,wikidataid"
    attrs = CACHE / "admin1_attrs.json"
    mapshaper("-i", str(admin1_shp), "encoding=utf8", "-filter-fields", fields, "-o", str(attrs), "format=json")
    rows = json.loads(attrs.read_text())

    rules = json.dumps(DISSOLVE_FIELD)
    split_dir = CACHE / "admin1_split"
    shutil.rmtree(split_dir, ignore_errors=True)
    split_dir.mkdir(parents=True)
    mapshaper(
        "-i", str(admin1_shp), "encoding=utf8",
        "-each", f"var f = {rules}[adm0_a3]; var g = f ? this.properties[f] : null;"
                 " key = (g && g !== -99 && String(g).trim()) ? adm0_a3 + '|' + String(g).trim() : adm1_code",
        "-dissolve", "key", "copy-fields=adm0_a3",
        "-simplify", "8%", "keep-shapes",
        "-filter-fields", "key,adm0_a3",
        "-split", "adm0_a3",
        "-o", str(split_dir) + "/", "format=topojson", "quantization=1e5", "singles",
    )  # fmt: skip
    files = {p.stem: p for p in split_dir.glob("*.json")}
    return rows, files


def build_admin1(rows: list[dict], files: dict[str, Path], countries: dict[str, dict]) -> dict[str, dict]:
    """Attach stats to each admin-1 feature and write public/data/admin1/<ADM0>.json."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[admin1_key(r)].append(r)

    dissolved_iso: dict[str, str] = {}
    for key, members in groups.items():
        if "|" not in key:
            continue
        code = DISSOLVED_ISO.get(key) or clean_str(members[0].get("region_cod"))
        if ISO_3166_2.match(code):
            dissolved_iso[key] = code
    iso_to_qid = wikidata_resolve("P300", sorted(set(dissolved_iso.values())))

    member_qids = sorted({clean_str(r["wikidataid"]) for r in rows if clean_str(r["wikidataid"])})
    group_qids = sorted({iso_to_qid[c] for c in dissolved_iso.values() if c in iso_to_qid})
    stats = wikidata_stats(sorted(set(member_qids) | set(group_qids)), "admin1")

    summary: dict[str, dict] = {}
    for key, members in groups.items():
        adm0 = members[0]["adm0_a3"]
        if "|" in key:
            group_qid = iso_to_qid.get(dissolved_iso.get(key, ""))
            s = stats.get(group_qid, {}) if group_qid else {}
            children = [stats.get(clean_str(m["wikidataid"]), {}) for m in members]
            name = s.get("label") or key.split("|", 1)[1]
            population = s.get("population")
            year = s.get("populationYear")
            if not population and all(c.get("population") for c in children):
                population = sum(c["population"] for c in children)
                year = min((c.get("populationYear") or 9999) for c in children)
                year = None if year == 9999 else year
            area = s.get("area") or (sum(c.get("area") or 0 for c in children) or None)
            kind = "Region"
            iso = dissolved_iso.get(key)
        else:
            m = members[0]
            s = stats.get(clean_str(m["wikidataid"]), {})
            name = s.get("label") or clean_str(m.get("name_it")) or clean_str(m["name"])
            population, year, area = s.get("population"), s.get("populationYear"), s.get("area")
            kind = clean_str(m.get("type_en"))
            iso = clean_str(m.get("iso_3166_2"))
        country_area = (countries.get(adm0) or {}).get("area")
        if area and country_area and area > country_area * 1.05:
            area = None  # implausible Wikidata value (wrong unit or scope)
        caps = s.get("capitals") or []
        cap = max(caps, key=lambda c: c["population"] or 0) if caps else None
        summary[key] = {
            "adm0": adm0,
            "name": name,
            "type": kind,
            "iso": iso or None,
            "population": population,
            "populationYear": year,
            "area": area,
            "capName": cap["name"] if cap else None,
            "capLat": cap["lat"] if cap else None,
            "capLon": cap["lon"] if cap else None,
            "capPop": cap["population"] if cap else None,
        }

    admin_dir = OUT / "admin1"
    shutil.rmtree(admin_dir, ignore_errors=True)
    admin_dir.mkdir(parents=True)
    for adm0, path in files.items():
        topo = json.loads(path.read_text())
        for obj in topo["objects"].values():
            for geom in obj.get("geometries", []):
                key = geom["properties"]["key"]
                props = {k: v for k, v in summary[key].items() if k != "adm0" and v is not None}
                geom["properties"] = {"id": key, **props}
        write_json(admin_dir / f"{adm0}.json", topo)
    return summary


def load_cities() -> list[dict]:
    path = unzip(download(GEONAMES_CITIES, "cities5000.zip"), CACHE / "cities5000")
    cities = []
    with open(path / "cities5000.txt", encoding="utf-8") as fh:
        for row in csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            if row[7] in EXCLUDED_FEATURE_CODES or not row[14]:
                continue
            cities.append(
                {
                    "geonameid": row[0],
                    "name": row[1],
                    "lat": round(float(row[4]), 4),
                    "lon": round(float(row[5]), 4),
                    "iso2": row[8],
                    "code": row[7],
                    "population": int(row[14]),
                }
            )
    log(f"geonames: {len(cities)} cities")
    return cities


def build_countries(features: list[dict], admin1_files: dict[str, Path]) -> dict[str, dict]:
    population_wb = world_bank("SP.POP.TOTL")
    area_wb = world_bank("AG.SRF.TOTL.K2")
    wd = wikidata_stats(sorted({clean_str(f["properties"]["WIKIDATAID"]) for f in features} - {""}), "countries")

    countries: dict[str, dict] = {}
    for feat in features:
        p = feat["properties"]
        cid = p["ADM0_A3"]
        iso2, iso3 = clean_str(p["ISO_A2_EH"]), clean_str(p["ISO_A3_EH"])
        w = wd.get(clean_str(p["WIKIDATAID"]), {})

        population, pop_year, pop_source = None, None, None
        if iso3 in population_wb:
            (population, pop_year), pop_source = population_wb[iso3], "World Bank"
        elif w.get("population"):
            population, pop_year, pop_source = w["population"], w.get("populationYear"), "Wikidata"

        # World Bank first; Wikidata only when consistent with the boundary's own geodesic area.
        measured = geodesic_area_km2(feat["geometry"])
        if iso3 in area_wb:
            area, area_source = area_wb[iso3][0], "World Bank"
        elif w.get("area") and 0.6 < w["area"] / max(measured, 1e-9) < 1.6:
            area, area_source = w["area"], "Wikidata"
        else:
            area, area_source = measured, "Natural Earth (calcolata)"

        countries[cid] = {
            "id": cid,
            "name": clean_str(p["NAME_IT"]) or p["NAME"],
            "nameEn": p["NAME"],
            "iso2": iso2 or None,
            "iso3": iso3 or None,
            "continent": p["CONTINENT"],
            "subregion": p["SUBREGION"],
            "type": p["TYPE"],
            "population": int(population) if population else None,
            "populationYear": pop_year,
            "populationSource": pop_source,
            "area": round(area, 1) if area else None,
            "areaSource": area_source,
            "capitals": sorted(w.get("capitals") or [], key=lambda c: -(c["population"] or 0)),
            "bbox": focus_bbox(feat["geometry"]),
            "admin1Count": 0,
        }
    missing = sorted(set(admin1_files) - set(countries))
    if missing:
        log(f"admin-1 files without a matching country: {missing}")
    log(f"missing population: {[c for c, v in countries.items() if not v['population']]}")
    return countries


def build_cities(countries: dict[str, dict], admin1_summary: dict[str, dict]) -> None:
    """Pick the major cities of each country, enrich them from Wikidata, write countries/cities JSON."""
    cities_by_iso2: dict[str, list[dict]] = defaultdict(list)
    for c in load_cities():
        cities_by_iso2[c["iso2"]].append(c)
    admin1_by_country: dict[str, list[dict]] = defaultdict(list)
    for s in admin1_summary.values():
        admin1_by_country[s["adm0"]].append(s)

    selected: dict[str, list[dict]] = {}
    for cid, country in countries.items():
        country["admin1Count"] = len(admin1_by_country.get(cid, []))
        iso2 = country["iso2"]
        own = sorted(cities_by_iso2.get(iso2, []), key=lambda c: -c["population"]) if iso2 else []
        if not country["capitals"]:
            country["capitals"] = [
                {"name": c["name"], "lat": c["lat"], "lon": c["lon"], "population": c["population"]}
                for c in own
                if c["code"] == "PPLC"
            ][:1]
        # National capitals live in countries.json; drop their GeoNames duplicates.
        anchors = [(c["lat"], c["lon"]) for c in country["capitals"]]
        major = [
            c
            for c in own
            if c["code"] != "PPLC"
            and all(haversine_km(c["lat"], c["lon"], la, lo) > CAPITAL_DEDUP_KM for la, lo in anchors)
        ][:CITIES_PER_COUNTRY]
        if major:
            selected[cid] = major

    # GeoNames gives undated populations and English names: prefer Wikidata's dated figure and Italian label.
    ids = sorted({c["geonameid"] for major in selected.values() for c in major})
    gn_to_qid = wikidata_resolve("P1566", ids)
    wd = wikidata_stats(sorted(set(gn_to_qid.values())), "cities")
    enriched = 0
    cities_out: dict[str, list] = {}
    for cid, major in selected.items():
        rows = []
        for c in major:
            w = wd.get(gn_to_qid.get(c["geonameid"], ""), {})
            name, population = w.get("label") or c["name"], c["population"]
            if w.get("population") and (w.get("populationYear") or 0) >= 2010:
                population = w["population"]
                enriched += 1
            rows.append([name, c["lat"], c["lon"], population])
        cities_out[cid] = sorted(rows, key=lambda r: -r[3])
    log(f"cities: {sum(len(v) for v in cities_out.values())} ({enriched} with Wikidata population)")

    write_json(OUT / "countries.json", countries)
    write_json(OUT / "cities.json", cities_out)
    log(f"countries: {len(countries)} · countries with cities: {len(cities_out)}")


def download_fonts() -> None:
    for font in FONTS:
        folder = FONTS_OUT / font
        folder.mkdir(parents=True, exist_ok=True)
        for i in FONT_RANGES:
            start, end = i * 256, i * 256 + 255
            target = folder / f"{start}-{end}.pbf"
            if target.exists():
                continue
            url = FONT_URL.format(font=urllib.parse.quote(font), start=start, end=end)
            try:
                target.write_bytes(http_get(url, retries=2))
            except (urllib.error.HTTPError, RuntimeError):
                log(f"font range missing: {font} {start}-{end}")
    log("fonts ready")


def write_meta() -> None:
    write_json(
        OUT / "meta.json",
        {
            "generatedAt": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d"),
            "sources": [
                {"name": "World Bank WDI (SP.POP.TOTL, AG.SRF.TOTL.K2)", "url": "https://data.worldbank.org", "license": "CC BY 4.0", "usedFor": "Popolazione e superficie degli Stati"},
                {"name": "Wikidata", "url": "https://www.wikidata.org", "license": "CC0", "usedFor": "Capitali, regioni (popolazione, superficie, capoluogo)"},
                {"name": "GeoNames cities5000", "url": "https://www.geonames.org", "license": "CC BY 4.0", "usedFor": "Città principali e popolazione"},
                {"name": "Natural Earth", "url": "https://www.naturalearthdata.com", "license": "Public domain", "usedFor": "Confini di Stati e regioni"},
            ],
        },
    )  # fmt: skip


def main() -> None:
    if not MAPSHAPER.exists():
        sys.exit("mapshaper not found: run `npm install` first")
    CACHE.mkdir(exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    admin0_dir = unzip(download(NE_ADMIN0, "ne_50m_admin_0_countries.zip"), CACHE / "ne_admin0")
    admin1_dir = unzip(download(NE_ADMIN1, "ne_10m_admin_1_states_provinces.zip"), CACHE / "ne_admin1")

    countries_features = build_countries_geometry(admin0_dir / "ne_50m_admin_0_countries.shp")
    rows, files = build_admin1_geometry(admin1_dir / "ne_10m_admin_1_states_provinces.shp")
    countries = build_countries(countries_features, files)
    summary = build_admin1(rows, files, countries)
    build_cities(countries, summary)
    download_fonts()
    write_meta()
    log("done")


if __name__ == "__main__":
    main()
