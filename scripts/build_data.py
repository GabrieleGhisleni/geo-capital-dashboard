#!/usr/bin/env python3
"""Build the static datasets served by the dashboard (public/data, public/fonts).

Every source is an aggregated, worldwide dataset: nothing is scraped country by country.

- Natural Earth 1:50m admin-0 and 1:10m admin-1 boundaries (public domain)
- World Bank WDI API (CC BY 4.0) -> country population, surface, GDP, life expectancy and WB_INDICATORS
- Wikidata SPARQL (CC0) -> capitals, admin-1 population / area / capital, fallbacks
- GeoNames cities5000 (CC BY 4.0) -> major cities with population
- DOSE v2 (MCC-PIK, CC BY 4.0) -> admin-1 GDP per capita (current US$) for ~1,600 regions in 83 countries
- OECD Regional Statistics (CC BY 4.0) -> admin-1 life expectancy for OECD and partner countries

Usage: npm run data   (requires network and `npm install`, which provides mapshaper)
"""

from __future__ import annotations

import csv
import datetime as dt
import difflib
import io
import json
import math
import re
import shutil
import subprocess
import sys
import time
import unicodedata
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
GEONAMES_ALT_NAMES = "https://download.geonames.org/export/dump/alternateNamesV2.zip"  # ~200 MB, cached
WORLD_BANK = "https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&mrnev=1&per_page=1000"
WORLD_BANK_SERIES = "https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&date=1960:{end}&per_page=20000"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
DOSE_CSV = "https://zenodo.org/api/records/13773040/files/DOSE_V2.9.csv/content"  # v2.9, 2024-09
OECD_SDMX = "https://sdmx.oecd.org/public/rest"
OECD_LIFE_EXP = "OECD.CFE.EDS,DSD_REG_DEMO@DF_LIFE_EXP"
FONT_URL = "https://tiles.openfreemap.org/fonts/{font}/{start}-{end}.pbf"
FONTS = ["Noto Sans Regular", "Noto Sans Bold"]
FONT_RANGES = range(0, 33)  # 0-8447: Latin, Greek, Cyrillic, Latin Extended Additional, punctuation

CITIES_PER_COUNTRY = 20
CITY_CANDIDATES = CITIES_PER_COUNTRY * 3  # GeoNames candidates per country before de-duplication
CAPITAL_DEDUP_KM = 7.0
# Greedy suppression in population order: a city within CITY_MERGE_KM of a more populous kept one is the same
# urban core (Brooklyn/Manhattan vs New York, Paris arrondissements, Pudong). 10 km keeps Kawasaki (11.5 km from
# Yokohama), Sakai (12.5 km from Osaka) and the Ruhr cities (Essen-Bochum 14 km).
CITY_MERGE_KM = 10.0
# Farther parts of the same city (Queens 15 km, the Bronx 19 km from New York) are caught through Wikidata:
# dropped when located in (P131) a kept city within this distance.
CITY_PART_OF_KM = 25.0
CAPITAL_POP_KM = 10.0  # GeoNames fallback for capitals without a Wikidata population
# Further country indicators: output field -> (World Bank code, decimals). Each also gets a `<field>Year`.
WB_INDICATORS = {
    "gdpPerCapitaPpp": ("NY.GDP.PCAP.PP.CD", 0),  # GDP per capita, PPP (current international $)
    "elderlyShare": ("SP.POP.65UP.TO.ZS", 1),  # population aged 65+ (% of total)
    "fertility": ("SP.DYN.TFRT.IN", 2),  # births per woman
    "urbanShare": ("SP.URB.TOTL.IN.ZS", 1),  # urban population (% of total)
    "co2PerCapita": ("EN.GHG.CO2.PC.CE.AR5", 2),  # CO2 excluding LULUCF, t CO2e per capita
}
# Time series for the timeline: metric -> (World Bank code, rounding: decimals, or None = 4 significant digits).
# Written to public/data/history/<metric>.json, loaded only when the timeline is opened.
HISTORY_INDICATORS = {
    "population": ("SP.POP.TOTL", 0),
    "urbanShare": ("SP.URB.TOTL.IN.ZS", 1),
    "gdp": ("NY.GDP.MKTP.CD", None),
    "gdpPerCapita": ("NY.GDP.PCAP.CD", 0),
    "gdpPerCapitaPpp": ("NY.GDP.PCAP.PP.CD", 0),
    "lifeExpectancy": ("SP.DYN.LE00.IN", 1),
    "elderlyShare": ("SP.POP.65UP.TO.ZS", 1),
    "fertility": ("SP.DYN.TFRT.IN", 2),
    "co2PerCapita": ("EN.GHG.CO2.PC.CE.AR5", 2),
}
# The slider spans the years in which at least this share of the series' countries have a value (a series'
# newest year is often reported by a handful of countries only).
HISTORY_MIN_COVERAGE = 0.4
CAPITAL_TZ_KM = 150.0  # the capital takes the time zone of the nearest GeoNames place within this distance
# IANA's zone -> country table: GeoNames gives a few border places a neighbour's zone (two Indian towns on
# Asia/Karachi, Akrotiri on Asia/Nicosia under GB); a country keeps only its own zones. Missing file: no filter.
ZONE_TAB = Path("/usr/share/zoneinfo/zone.tab")
# Wikidata's P1566 link often lands on the city's district or province (Masvingo: 1.6 M for a city of 90 k): a
# Wikidata population more than this many times GeoNames' is not the city's.
CITY_WIKIDATA_MAX_RATIO = 10
# Natural Earth leaves ISO_A3_EH at -99 for these; the World Bank uses a user-assigned code.
WORLD_BANK_ALIASES = {"KOS": "XKX"}
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
    """Map external identifiers (e.g. P300 ISO 3166-2, P1566 GeoNames ID) to Wikidata items (cached per code)."""
    cache_file = CACHE / f"wikidata_resolve_{prop}.json"
    cached = json.loads(cache_file.read_text()) if cache_file.exists() else {"_codes": [], "map": {}}
    known = set(cached["_codes"])
    todo = [c for c in codes if c not in known]
    for i in range(0, len(todo), 200):
        values = " ".join(f'"{c}"' for c in todo[i : i + 200])
        rows = sparql(f"SELECT ?code ?item WHERE {{ VALUES ?code {{ {values} }} ?item wdt:{prop} ?code . }}")
        for r in rows:
            cached["map"].setdefault(r["code"]["value"], qid(r["item"]["value"]))
    if todo:
        cached["_codes"] = sorted(known | set(todo))
        write_json(cache_file, cached)
    return {c: cached["map"][c] for c in codes if c in cached["map"]}


def wikidata_parents(qids: list[str]) -> dict[str, list[str]]:
    """Direct P131 ("located in the administrative territorial entity") of each item (cached per item)."""
    cache_file = CACHE / "wikidata_p131.json"
    cached = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    todo = [q for q in qids if q not in cached]
    for i in range(0, len(todo), 300):
        chunk = todo[i : i + 300]
        values = " ".join(f"wd:{q}" for q in chunk)
        rows = sparql(f"SELECT ?item ?parent WHERE {{ VALUES ?item {{ {values} }} ?item wdt:P131 ?parent . }}")
        for q in chunk:
            cached.setdefault(q, [])
        for r in rows:
            cached[qid(r["item"]["value"])].append(qid(r["parent"]["value"]))
    if todo:
        log(f"wikidata P131: {len(todo)} items queried")
        write_json(cache_file, cached)
    return {q: cached.get(q, []) for q in qids}


def wikidata_stats(qids: list[str], label: str) -> dict[str, dict]:
    """Latest population, area (km²), Italian label and capitals for each item."""
    cache_file = CACHE / f"wikidata_{label}.json"
    cached_stats: dict[str, dict] = {}
    if cache_file.exists():
        cached = json.loads(cache_file.read_text())
        cached_stats = {q: cached["stats"][q] for q in cached["_qids"] if q in cached["stats"]}
    todo = [q for q in qids if q not in cached_stats]  # incremental: only items not seen before
    if not todo:
        return cached_stats

    pops: dict[str, list] = defaultdict(list)
    areas: dict[str, list] = defaultdict(list)
    caps: dict[str, dict] = defaultdict(dict)
    labels: dict[str, str] = {}
    batch = 120
    for i in range(0, len(todo), batch):
        chunk = todo[i : i + batch]
        log(f"wikidata {label}: {i + len(chunk)}/{len(todo)} new items")
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

    stats: dict[str, dict] = dict(cached_stats)
    for q in todo:
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
    write_json(cache_file, {"_qids": sorted(stats), "stats": stats})
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


def world_bank_series(indicator: str) -> dict[str, dict[int, float]]:
    """All yearly values since 1960 per ISO3 code."""
    end = dt.date.today().year
    raw = json.loads(http_get(WORLD_BANK_SERIES.format(indicator=indicator, end=end)))
    out: dict[str, dict[int, float]] = defaultdict(dict)
    for row in raw[1] or []:
        if row["value"] is not None and row["countryiso3code"]:
            out[row["countryiso3code"]][int(row["date"])] = row["value"]
    return out


def zone_countries() -> dict[str, str]:
    """IANA zone -> ISO2 country from the system tzdata (empty when unavailable)."""
    if not ZONE_TAB.exists():
        log(f"{ZONE_TAB} not found: country time zones are not filtered")
        return {}
    out = {}
    for line in ZONE_TAB.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            cc, _, zone = line.split("\t")[:3]
            out[zone] = cc
    return out


def round_value(v: float, decimals: int | None) -> float | int:
    if decimals is None:  # 4 significant digits: GDP in US$ does not need more
        return float(f"{v:.4g}") if abs(v) < 1e15 else round(v)
    return round(v) if decimals == 0 else round(v, decimals)


def write_history(countries: dict[str, dict], wb_codes: dict[str, str]) -> None:
    """public/data/history/<metric>.json: {"from": first year, "values": {ADM0: [value or null per year]}}."""
    out_dir = OUT / "history"
    out_dir.mkdir(parents=True, exist_ok=True)
    for metric, (code, decimals) in HISTORY_INDICATORS.items():
        series = world_bank_series(code)
        rows = {cid: series[wb] for cid, wb in wb_codes.items() if wb in series and series[wb]}
        counts: dict[int, int] = defaultdict(int)
        for values in rows.values():
            for year in values:
                counts[year] += 1
        years = [y for y, n in counts.items() if n >= HISTORY_MIN_COVERAGE * len(rows)]
        first, last = min(years), max(years)
        values = {
            cid: [round_value(v[y], decimals) if y in v else None for y in range(first, last + 1)]
            for cid, v in sorted(rows.items())
        }
        write_json(out_dir / f"{metric}.json", {"from": first, "values": values})
        log(f"history {metric}: {first}-{last}, {len(values)} countries")


def polygon_parts(geometry: dict) -> list[list]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def geodesic_ring_km2(coords: list) -> float:
    """Spherical area of one ring (Chamberlain & Duquette)."""
    total = 0.0
    for (x1, y1), (x2, y2) in zip(coords, coords[1:]):
        total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(total) * 6371.0088**2 / 2


def geodesic_part_km2(part: list) -> float:
    """Area of one polygon part: outer ring minus holes."""
    return geodesic_ring_km2(part[0]) - sum(geodesic_ring_km2(h) for h in part[1:])


def geodesic_area_km2(geometry: dict) -> float:
    """Spherical polygon area, outer rings minus holes."""
    return sum(geodesic_part_km2(p) for p in polygon_parts(geometry))


def topo_features(path: Path) -> list[tuple[dict, dict | None]]:
    """(properties, GeoJSON-like geometry) for every polygon geometry of a quantized, delta-encoded TopoJSON."""
    topo = json.loads(path.read_text(encoding="utf-8"))
    transform = topo.get("transform")
    arcs = []
    for arc in topo["arcs"]:
        if transform:
            (sx, sy), (tx, ty) = transform["scale"], transform["translate"]
            x = y = 0
            pts = []
            for dx, dy in arc:
                x += dx
                y += dy
                pts.append((x * sx + tx, y * sy + ty))
        else:
            pts = [(p[0], p[1]) for p in arc]
        arcs.append(pts)

    def ring(indexes: list[int]) -> list[tuple[float, float]]:
        out: list[tuple[float, float]] = []
        for i in indexes:
            pts = arcs[i] if i >= 0 else arcs[~i][::-1]
            out.extend(pts if not out else pts[1:])
        return out

    features = []
    for obj in topo["objects"].values():
        for g in obj.get("geometries", []):
            props = dict(g.get("properties") or {})
            if g.get("id") is not None:
                props.setdefault("id", g["id"])
            geometry = None
            if g["type"] == "Polygon":
                geometry = {"type": "Polygon", "coordinates": [ring(r) for r in g["arcs"]]}
            elif g["type"] == "MultiPolygon":
                geometry = {"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in g["arcs"]]}
            features.append((props, geometry))
    return features


def _in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def distance_to_polygon_km(lat: float, lon: float, geometry: dict | None) -> float:
    """0 inside the polygon, otherwise the distance to its nearest edge (local equirectangular approximation)."""
    parts = polygon_parts(geometry) if geometry else []
    if not parts:
        return math.inf
    for part in parts:
        if _in_ring(lon, lat, part[0]) and not any(_in_ring(lon, lat, h) for h in part[1:]):
            return 0.0
    kx, ky = 111.32 * math.cos(math.radians(lat)), 110.57
    best = math.inf
    for part in parts:
        for ring in part:
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                ax, bx = ((x1 - lon + 540) % 360 - 180) * kx, ((x2 - lon + 540) % 360 - 180) * kx
                ay, by = (y1 - lat) * ky, (y2 - lat) * ky
                dx, dy = bx - ax, by - ay
                seg = dx * dx + dy * dy
                t = 0.0 if seg == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg))
                best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


Extent = tuple[float, float, float, float, float, float]  # west, east, shifted west, shifted east, south, north


def ring_extent(ring: list) -> Extent:
    """Longitude range both as-is and shifted to 0..360 (for antimeridian crossings), plus latitude range."""
    lons = [x for x, _ in ring]
    lats = [y for _, y in ring]
    shifted = [x + 360 if x < 0 else x for x in lons]
    return (min(lons), max(lons), min(shifted), max(shifted), min(lats), max(lats))


def merge_all_extents(geometry: dict) -> Extent:
    rings = [part[0] for part in polygon_parts(geometry)]
    extent = ring_extent(rings[0])
    for ring in rings[1:]:
        extent = merge_extent(extent, ring_extent(ring))
    return extent


def merge_extent(a: Extent, b: Extent) -> Extent:
    return (min(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), max(a[3], b[3]), min(a[4], b[4]), max(a[5], b[5]))


def extent_bbox(e: Extent) -> list[float]:
    """[west, south, east, north]; takes the narrower of the plain and antimeridian-shifted longitude spans."""
    west, east = e[0], e[1]
    if e[3] - e[2] < east - west:  # crossing the antimeridian (Russia, Fiji, Kiribati…)
        west, east = e[2], e[3]
        if west > 180:
            west, east = west - 360, east - 360
    return [west, e[4], east, e[5]]


def bbox_area_deg2(bbox: list[float]) -> float:
    return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])


FOCUS_MIN_PART = 0.01  # parts smaller than 1% of the largest never widen the frame
FOCUS_MAJOR_PART = 0.30  # parts >= 30% of the largest are always framed (North Island, Hokkaido, Sumatra…)
FOCUS_MAX_GROWTH = 1.35  # other parts only if they grow the bbox area by <= 35%
FOCUS_ANCHOR_KM = 30.0  # the part holding the capital is always framed (Tarawa for Kiribati)


def focus_bbox(geometry: dict, anchor: tuple[float, float] | None = None) -> list[float]:
    """Bounding box used to frame a country: the main land mass plus the parts that fit without blowing it up.

    Greedy over parts sorted by geodesic area: start from the largest part, the major parts and the part
    closest to `anchor` (the capital); then add each further part only if the bbox grows by <= 35%.
    Keeps Sicily/Sardinia or Corsica, drops Alaska/Hawaii, Guyane, Svalbard.
    """
    parts = polygon_parts(geometry)
    if not parts:
        return [-180, -85, 180, 85]
    sized = sorted(((geodesic_part_km2(p), p[0]) for p in parts), key=lambda t: -t[0])
    largest = sized[0][0]
    framed = {0} | {i for i, (area, _) in enumerate(sized) if area >= largest * FOCUS_MAJOR_PART}
    if anchor:
        dist, idx = min(
            (min(haversine_km(anchor[0], anchor[1], y, x) for x, y in ring), i) for i, (_, ring) in enumerate(sized)
        )
        if dist <= FOCUS_ANCHOR_KM:
            framed.add(idx)
    extent = ring_extent(sized[0][1])
    for i in framed:
        extent = merge_extent(extent, ring_extent(sized[i][1]))
    for i, (area, ring) in enumerate(sized):
        if area < largest * FOCUS_MIN_PART:
            break
        if i in framed:
            continue
        grown = merge_extent(extent, ring_extent(ring))
        if bbox_area_deg2(extent_bbox(grown)) <= bbox_area_deg2(extent_bbox(extent)) * FOCUS_MAX_GROWTH:
            extent = grown
    return [round(v, 3) for v in extent_bbox(extent)]


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
        "-filter-fields", "ADM0_A3,ISO_A2_EH,ISO_A3_EH,NAME,NAME_IT,CONTINENT,SUBREGION,TYPE,WIKIDATAID,LABEL_X,LABEL_Y,MIN_LABEL",
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
        "-each", "area_km2 = this.area / 1e6",  # spherical area of the full-resolution shape
        "-simplify", "8%", "keep-shapes",
        "-filter-fields", "key,adm0_a3,area_km2",
        "-split", "adm0_a3",
        "-o", str(split_dir) + "/", "format=topojson", "quantization=1e5", "singles",
    )  # fmt: skip
    files = {p.stem: p for p in split_dir.glob("*.json")}
    return rows, files


# Region stats are checked against the region's own polygon (Natural Earth 1:10m, full resolution):
# a Wikidata item whose area or capital does not fit the shape is the wrong entity for it (Natural Earth links
# Latvian municipalities to the city of Valmiera, Vietnamese provinces to their 2025 merged successors, Togo's
# Centrale to Burkina Faso's Centre) or carries a unit slip (Côte d'Ivoire and Uganda areas 1000x too small).
REGION_CAPITAL_KM = 30.0  # a region capital farther than this from the polygon is not its capital
REGION_HOME_KM = 5.0  # simplified coasts and borders put real capitals of small regions up to a few km outside
REGION_AREA_BAND = (0.45, 2.2)  # accepted Wikidata area / polygon area (areas often include inland water)
REGION_AREA_BAND_SMALL = (0.25, 4.0)  # below REGION_SMALL_KM2 the 1:10m outline misses islets and coastline
REGION_SMALL_KM2 = 200.0
UNIT_SLIPS = (1e3, 1e6, 1e-3)  # a ratio fixed by one of these is a wrong unit (m², "thousand km²"), not a wrong entity
# Beyond these area ratios the item covers a different extent even when it shares the capital (Tyumen with its
# okrugs, Dublin county vs city): its population does not describe the polygon.
REGION_POP_EXTENT = (0.2, 5.0)
REGION_POP_EXTENT_NO_CAPITAL = (0.25, 4.0)  # without a capital to confirm the item (city-regions: Tbilisi, Incheon)
# Countries whose Wikidata items already describe a newer division than Natural Earth's: any area mismatch means
# the item is the reorganised unit, so its population is not used.
NEWER_DIVISIONS = {
    "VNM": "34 provinces since 2025-07-01 (Natural Earth still draws the 63 former ones)",
}
COMPUTED_AREA = "Natural Earth (calcolata)"


def judge_region(s: dict, geometry: dict | None, measured: float | None) -> dict:
    """How a Wikidata item fits a region polygon.

    cap: a capital within REGION_CAPITAL_KM (True/False, None without capitals); dist: nearest capital distance;
    area: Wikidata area within the band of the measured polygon area (None when unknown); slip: the area is off
    by a unit or decimal slip only; score: +1 per fitting and -1 per contradicting piece of evidence.
    """
    caps = [(distance_to_polygon_km(c["lat"], c["lon"], geometry), c) for c in s.get("capitals") or []]
    near = [c for d, c in caps if d <= REGION_CAPITAL_KM]
    cap_ok = bool(near) if caps else None
    ratio = s["area"] / measured if s.get("area") and measured else None
    area_ok, slip = None, False
    if ratio is not None:
        lo, hi = REGION_AREA_BAND if measured >= REGION_SMALL_KM2 else REGION_AREA_BAND_SMALL
        area_ok = lo <= ratio <= hi
        slip = not area_ok and any(lo <= ratio * f <= hi for f in UNIT_SLIPS)
        # A misplaced decimal point (Ghor: 3,657 for 36,479 km²) only counts when a capital confirms the item.
        slip = slip or (not area_ok and bool(cap_ok) and any(0.85 <= ratio * f <= 1.15 for f in (10, 0.1)))
    score = (cap_ok is True) - (cap_ok is False) + (area_ok is True or slip) - (area_ok is False and not slip)
    return {
        "ratio": ratio,
        "cap": cap_ok,
        "inside": any(d == 0 for d, _ in caps),
        "dist": min((d for d, _ in caps), default=None),
        "area": area_ok,
        "slip": slip,
        "score": score,
        "capital": max(near, key=lambda c: c["population"] or 0) if near else None,
    }


def build_admin1(
    rows: list[dict], files: dict[str, Path], countries: dict[str, dict], cities_by_iso2: dict[str, list[dict]]
) -> dict[str, dict]:
    """Attach stats to each admin-1 feature and write public/data/admin1/<ADM0>.json.

    Each Natural Earth feature has two candidate Wikidata items: its `wikidataid` and the item holding its ISO
    3166-2 code (P300). The one fitting the polygon wins (area, capital inside); an item linked to several
    features stays with the one it fits. Features whose attributes sit on a neighbour's polygon (Napo and
    Tungurahua in Ecuador, the regions of Guyana and Eritrea) take the item whose capital lies inside them.
    What still does not fit is dropped field by field; missing or rejected areas become the polygon's area.
    """
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        groups[admin1_key(r)].append(r)

    shapes: dict[str, tuple[dict | None, float | None]] = {}
    for path in files.values():
        for props, geometry in topo_features(path):
            shapes[props["key"]] = (geometry, props.get("area_km2"))

    dissolved_iso: dict[str, str] = {}
    for key, members in groups.items():
        if "|" not in key:
            continue
        code = DISSOLVED_ISO.get(key) or clean_str(members[0].get("region_cod"))
        if ISO_3166_2.match(code):
            dissolved_iso[key] = code
    singles = {key: members[0] for key, members in groups.items() if "|" not in key}
    iso_count: dict[str, int] = defaultdict(int)
    for r in singles.values():
        iso_count[clean_str(r.get("iso_3166_2"))] += 1
    single_iso = sorted(c for c, n in iso_count.items() if n == 1 and ISO_3166_2.match(c))
    iso_to_qid = wikidata_resolve("P300", sorted(set(dissolved_iso.values()) | set(single_iso)))

    qid_to_iso: dict[str, str] = {}
    for code, q in iso_to_qid.items():
        qid_to_iso[q] = code if q not in qid_to_iso else ""  # ambiguous when an item holds several codes
    member_qids = {clean_str(r["wikidataid"]) for r in rows if clean_str(r["wikidataid"])}
    stats = wikidata_stats(sorted(member_qids | set(iso_to_qid.values())), "admin1")

    # ---- pick one Wikidata item per single (non-dissolved) feature
    def candidates(r: dict) -> list[tuple[str, str]]:
        """(qid, iso) pairs: Natural Earth's link first, then the item owning the ISO code."""
        iso = clean_str(r.get("iso_3166_2"))
        out = [(q, iso) for q in [clean_str(r["wikidataid"])] if q]
        by_iso = iso_to_qid.get(iso) if iso_count[iso] == 1 else None
        if by_iso and by_iso not in [q for q, _ in out]:
            out.append((by_iso, iso))
        return out

    linked: dict[str, int] = defaultdict(int)
    for r in singles.values():
        if clean_str(r["wikidataid"]):
            linked[clean_str(r["wikidataid"])] += 1

    judged: dict[tuple[str, str], dict] = {}

    def judge(q: str, key: str) -> dict:
        if (q, key) not in judged:
            judged[q, key] = judge_region(stats.get(q, {}), *shapes.get(key, (None, None)))
        return judged[q, key]

    chosen: dict[str, tuple[str, str] | None] = {}
    for key, r in singles.items():
        ranked = sorted(candidates(r), key=lambda c: (judge(c[0], key)["score"], linked[c[0]] <= 1), reverse=True)
        chosen[key] = ranked[0] if ranked else None

    # An item chosen by several features stays with the one it fits best (only if it fits); the others fall
    # back to their other candidate when that one is not contradicted by the polygon.
    by_qid: dict[str, list[str]] = defaultdict(list)
    for key, c in chosen.items():
        if c:
            by_qid[c[0]].append(key)
    for q, keys in by_qid.items():
        if len(keys) < 2:
            continue
        best = max(keys, key=lambda k: judge(q, k)["score"])
        for key in keys:
            if key == best and judge(q, key)["score"] > 0:
                continue
            alt = [c for c in candidates(singles[key]) if c[0] != q and judge(c[0], key)["score"] >= 0]
            chosen[key] = alt[0] if alt else None

    # Attributes shifted onto a neighbour's polygon (Napo/Tungurahua in Ecuador, the regions of Guyana and
    # Eritrea): an item whose capital is not inside its own polygon moves to the polygon of the same country
    # that contains it, when that polygon's own item does not belong there either. A polygon left empty takes
    # an unused candidate item whose capital it contains.
    by_country: dict[str, list[str]] = defaultdict(list)
    for key, r in singles.items():
        by_country[r["adm0_a3"]].append(key)
    origin: dict[str, dict] = {}  # key -> NE row the chosen item came from (for name, type, ISO)
    boxes = {k: extent_bbox(merge_all_extents(g)) for k, (g, _) in shapes.items() if g}

    def fits_here(q: str, k: str) -> bool:
        """The item's capital is (about) inside the polygon, or (no capital) its area does not contradict it."""
        j = judge(q, k)
        return j["dist"] <= REGION_HOME_KM if j["cap"] is not None else (j["area"] is not False or j["slip"])

    def area_agrees(q: str, k: str) -> bool:
        """Stricter than judge(): a moved item must match the polygon's area within the main band, if known."""
        j = judge(q, k)
        return j["ratio"] is None or j["slip"] or REGION_AREA_BAND[0] <= j["ratio"] <= REGION_AREA_BAND[1]

    reassigned = 0
    for adm0, keys in by_country.items():
        def home(q: str) -> str | None:
            found = set()
            for c in stats.get(q, {}).get("capitals") or []:
                for k in keys:
                    w, so, e, n = boxes.get(k, (0, 0, 0, 0))
                    if so <= c["lat"] <= n and (w <= c["lon"] <= e if w <= e else c["lon"] >= w or c["lon"] <= e):
                        if distance_to_polygon_km(c["lat"], c["lon"], shapes[k][0]) == 0:
                            found.add(k)
            return found.pop() if len(found) == 1 else None

        current = {k: chosen[k] for k in keys}
        targets: dict[str, list[tuple[str, tuple[str, str]]]] = defaultdict(list)  # home -> [(from, item)]
        for k in keys:
            c = current[k]
            if not c or not stats.get(c[0], {}).get("capitals") or fits_here(c[0], k):
                continue
            h = home(c[0])
            if h and h != k and not (current[h] and fits_here(current[h][0], h)) and area_agrees(c[0], h):
                targets[h].append((k, c))
        moves = {h: v[0] for h, v in targets.items() if len(v) == 1}
        for h, (k, c) in moves.items():
            if k not in moves:
                chosen[k] = None
        for h, (k, c) in moves.items():
            chosen[h] = c
            origin[h] = singles[k]
            reassigned += 1
            log(f"admin-1 {adm0}: item of {singles[k]['name']} moved to the polygon of {singles[h]['name']} ({h})")
        if moves:
            assigned = {c[0] for k in keys if (c := chosen[k])}
            for k in keys:
                if chosen[k]:
                    continue
                spare = [
                    (c, src)
                    for src in keys
                    for c in candidates(singles[src])
                    if c[0] not in assigned and home(c[0]) == k and area_agrees(c[0], k)
                ]
                if len({c[0] for c, _ in spare}) == 1:
                    chosen[k], origin[k] = spare[0][0], singles[spare[0][1]]
                    assigned.add(spare[0][0][0])
                    reassigned += 1
                    log(f"admin-1 {adm0}: {spare[0][0][0]} (candidate of {spare[0][1]}) fills {singles[k]['name']} ({k})")
    if reassigned:
        log(f"admin-1: {reassigned} features take the Wikidata item of a neighbouring feature (capital inside)")

    # ---- per-field plausibility
    counts: dict[str, int] = defaultdict(int)
    summary: dict[str, dict] = {}
    for key, members in groups.items():
        adm0 = members[0]["adm0_a3"]
        country = countries.get(adm0) or {}
        geometry, measured = shapes.get(key, (None, None))
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
            s = {**s, "area": area}
            kind = "Region"
            iso = dissolved_iso.get(key)
            row = members[0]
            item_qids = [group_qid] if group_qid else []
            aliases = [key.split("|", 1)[1]]
        else:
            row = origin.get(key, members[0])
            c = chosen.get(key)
            s = stats.get(c[0], {}) if c else {}
            iso = (qid_to_iso.get(c[0]) or c[1] if c else "") or clean_str(row.get("iso_3166_2"))
            kind = clean_str(row.get("type_en"))
            name = None
            population, year = s.get("population"), s.get("populationYear")
            item_qids = [c[0]] if c else []
            aliases = [clean_str(row.get("name")), clean_str(row.get("name_it"))]
            if c and population is None and key not in origin:
                # The other candidate, when it fits the polygon too, may carry the population (the city of
                # Delhi for the National Capital Territory, which has the same area).
                for q, _ in candidates(members[0]):
                    ja, alt = judge(q, key), stats.get(q, {})
                    if q != c[0] and alt.get("population") is not None and ja["area"] and ja["cap"] is not False:
                        population, year = alt["population"], alt.get("populationYear")
                        counts["population from the other candidate"] += 1
                        break

        j = judge_region(s, geometry, measured)
        area = s.get("area")
        if j["area"] is False:
            counts["area rejected (unit slip)" if j["slip"] else "area rejected (other extent)"] += 1
            area = None
        off = j["area"] is False and not j["slip"]
        if off and j["cap"] is not True:
            # Neither the area nor a capital ties the item to this polygon.
            lo, hi = REGION_POP_EXTENT_NO_CAPITAL if j["cap"] is None else (math.inf, -math.inf)
        else:
            lo, hi = REGION_POP_EXTENT
        if off and j["cap"] is False:
            counts["item rejected (area and capital do not fit)"] += 1
            s, population, year = {}, None, None
        elif population and off and (not lo <= j["ratio"] <= hi or adm0 in NEWER_DIVISIONS):
            counts["population rejected (item covers another extent)"] += 1
            population, year = None, None
        if j["cap"] is False:
            counts["capital rejected (outside the region)"] += 1
        if area and country.get("area") and area > country["area"] * 1.05:
            area = None  # implausible Wikidata value (wrong unit or scope)
        if population and country.get("population") and population > country["population"]:
            counts["population rejected (above the country)"] += 1
            if len(by_country.get(adm0, [])) + sum(1 for k in groups if k.startswith(f"{adm0}|")) == 1:
                population, year = country["population"], country.get("populationYear")  # the region is the country
            else:
                population, year = None, None
        area_source = "Wikidata" if area else None
        if not area and measured:
            area, area_source = round(measured, 1), COMPUTED_AREA
        if name is None:
            name = s.get("label") or clean_str(row.get("name_it")) or clean_str(row["name"])
        cap = dict(j["capital"]) if j["capital"] else None
        if cap and cap["population"] is None:
            cap["population"] = geonames_population(cap["lat"], cap["lon"], cities_by_iso2.get(country.get("iso2"), []))
        summary[key] = {
            "adm0": adm0,
            "name": name,
            "type": kind,
            "iso": iso or None,
            "population": population,
            "populationYear": year,
            "area": area,
            "areaSource": area_source,
            "capName": cap["name"] if cap else None,
            "capLat": cap["lat"] if cap else None,
            "capLon": cap["lon"] if cap else None,
            "capPop": cap["population"] if cap else None,
            # Internal (not written): used to join the regional indicators below.
            "_qids": item_qids,
            "_names": [n for n in [name, *aliases] if n],
        }
    log(f"admin-1 checks: {dict(sorted(counts.items()))}")
    add_region_indicators(summary, countries)

    admin_dir = OUT / "admin1"
    # Overwrite in place and drop only stale files: deleting the folder makes a running Vite dev server stop
    # serving it (it answers index.html until restarted), which the app shows as "Regioni non disponibili".
    admin_dir.mkdir(parents=True, exist_ok=True)
    for stale in set(admin_dir.glob("*.json")) - {admin_dir / f"{adm0}.json" for adm0 in files}:
        stale.unlink()
    for adm0, path in files.items():
        topo = json.loads(path.read_text())
        for obj in topo["objects"].values():
            for geom in obj.get("geometries", []):
                key = geom["properties"]["key"]
                props = {k: v for k, v in summary[key].items() if k != "adm0" and k[0] != "_" and v is not None}
                geom["properties"] = {"id": key, **props}
        write_json(admin_dir / f"{adm0}.json", topo)
    return summary


# --------------------------------------------------------------------------- regional indicators
# GDP (DOSE) and life expectancy (OECD) come with their own region lists and names, not Natural Earth's: each
# source region is joined to an admin-1 feature by name (Natural Earth names, Wikidata labels in English and
# Italian, aliases and native names), within the same country, and only one-to-one. Source regions from another
# division (Kenya's 47 counties vs Natural Earth's 8 provinces, NUTS 3 groups of Portuguese districts) find no
# name and are skipped.

# Words that only say what kind of division it is ("Lombardy Region", "Oblast' di Mosca", "Voivodato di Opole").
REGION_NAME_NOISE = set(
    """province provincia provincie prov region regione regiao state estado etat staat oblast oblysy krai kray
    republic republik republica of the and de del della di du des la le el autonomous autonoma autonome prefecture
    ken department departement county governorate district municipality city capital territory special
    administrative metropolitan national federal voivodeship community comunidad foral principality union wojewodztwo
    kraj zupanija megye maakond okrug respublika provinsi wilaya departamento gewest lan fylke amt canton kanton
    land shi sheng zizhiqu uygur huizu zhuangzu""".split()
)
REGION_FUZZY_MIN = 0.88  # difflib ratio for spelling variants (Kanchanburi / Kanchanaburi, Moquequa / Moquegua)
REGION_FUZZY_GAP = 0.05  # ...and clearly better than the second-best feature
REGION_JOIN_POP = (0.5, 2.0)  # source population / feature population, when both are known


def _ascii_tokens(name: str) -> list[str]:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().replace("&", " and ")
    return [t for t in re.split(r"[^a-z0-9]+", s) if t]


def name_exact(name: str) -> str:
    return "".join(_ascii_tokens(name))


def name_core(name: str) -> str:
    """The distinctive part of a region name: "Oblast' di Mosca" and "Moscow Oblast" -> "mosca", "moscow"."""
    toks = ["st" if t in ("saint", "sankt", "san", "santa") else t for t in _ascii_tokens(name)]
    return "".join(t for t in toks if t not in REGION_NAME_NOISE)


def wikidata_names(qids: list[str]) -> dict[str, list[str]]:
    """English labels and aliases, multilingual and native (P1705) names of each item (cached per item)."""
    cache_file = CACHE / "wikidata_names.json"
    cached = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    todo = [q for q in qids if q not in cached]
    for i in range(0, len(todo), 250):
        chunk = todo[i : i + 250]
        values = " ".join(f"wd:{q}" for q in chunk)
        rows = sparql(
            f"""
            SELECT ?item ?name WHERE {{
              VALUES ?item {{ {values} }}
              {{ ?item rdfs:label ?name FILTER(LANG(?name) IN ("en", "mul")) }}
              UNION {{ ?item skos:altLabel ?name FILTER(LANG(?name) = "en") }}
              UNION {{ ?item wdt:P1705 ?name }}
            }}"""
        )
        for q in chunk:
            cached.setdefault(q, [])
        for r in rows:
            names = cached[qid(r["item"]["value"])]
            if r["name"]["value"] not in names:
                names.append(r["name"]["value"])
        time.sleep(1)
    if todo:
        log(f"wikidata names: {len(todo)} items queried")
        write_json(cache_file, cached)
    return {q: cached.get(q, []) for q in qids}


def match_region_names(features: list[dict], sources: list[tuple[str, str, float | None]]) -> dict[str, str]:
    """Join source regions [(id, name, population)] to features [{key, names, population}] of one country.

    Exact names first (whole name, then its distinctive part), then close spellings. Several candidates, or a
    population more than a factor 2 off, are settled by population or left unmatched.
    """
    pops = {f["key"]: f["population"] for f in features}
    exact: dict[str, set[str]] = defaultdict(set)
    core: dict[str, set[str]] = defaultdict(set)
    for f in features:
        for n in f["names"]:
            exact[name_exact(n)].add(f["key"])
            if name_core(n):
                core[name_core(n)].add(f["key"])

    def plausible(key: str, pop: float | None) -> bool:
        return not (pop and pops.get(key)) or REGION_JOIN_POP[0] <= pop / pops[key] <= REGION_JOIN_POP[1]

    out: dict[str, str] = {}
    rest = []
    for sid, name, pop in sources:
        hits: list[str] = []
        for index, key in ((exact, name_exact(name)), (core, name_core(name))):
            hits = [k for k in index.get(key, ()) if k not in out and plausible(k, pop)]
            if len(hits) == 1:
                break
        if len(hits) > 1 and pop:  # Moscow city and Moscow Oblast
            hits = sorted(hits, key=lambda k: abs(math.log(pop / pops[k])) if pops.get(k) else math.inf)[:1]
        if len(hits) == 1:
            out[hits[0]] = sid
        else:
            rest.append((sid, name, pop))
    for sid, name, pop in rest:
        n = name_core(name)
        if not n:
            continue
        scored = sorted(
            (
                (max((difflib.SequenceMatcher(None, n, c).ratio() for c in map(name_core, f["names"]) if c[:2] == n[:2]), default=0), f["key"])
                for f in features
                if f["key"] not in out
            ),
            reverse=True,
        )
        if not scored or scored[0][0] < REGION_FUZZY_MIN:
            continue
        if len(scored) > 1 and scored[0][0] - scored[1][0] < REGION_FUZZY_GAP:
            continue
        if plausible(scored[0][1], pop):
            out[scored[0][1]] = sid
    return {key: sid for key, sid in out.items()}


def load_dose() -> dict[str, list[dict]]:
    """Latest DOSE record with GDP per capita in current US$ per region, grouped by ISO3."""
    path = download(DOSE_CSV, "DOSE_V2.9.csv")
    latest: dict[str, dict] = {}
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if not r["grp_pc_usd"] or not r["GID_1"]:
                continue
            if r["GID_1"] not in latest or int(r["year"]) > int(latest[r["GID_1"]]["year"]):
                latest[r["GID_1"]] = r
    out: dict[str, list[dict]] = defaultdict(list)
    for r in latest.values():
        out[r["GID_0"]].append(r)
    log(f"DOSE: {len(latest)} regions in {len(out)} countries")
    return out


def load_oecd_life_expectancy() -> dict[tuple[str, str], list[tuple[str, str, float, int]]]:
    """Latest life expectancy at birth (both sexes) of OECD TL2/TL3 regions: (ISO3, level) -> [(code, name, years, year)]."""
    data = download(f"{OECD_SDMX}/data/{OECD_LIFE_EXP},/all?lastNObservations=1&format=csvfile", "oecd_life_exp.csv")
    names_file = CACHE / "oecd_region_names.json"
    if not names_file.exists():
        agency, flow = OECD_LIFE_EXP.split(",")
        raw = http_get(
            f"{OECD_SDMX}/dataflow/{agency}/{flow}/latest?references=codelist",
            headers={"Accept": "application/vnd.sdmx.structure+json;version=1.0"},
        )
        codelist = next(c for c in json.loads(raw)["data"]["codelists"] if c["id"] == "CL_REGIONAL")
        write_json(names_file, {c["id"]: c["name"] for c in codelist["codes"]})
    names = json.loads(names_file.read_text())
    out: dict[tuple[str, str], list[tuple[str, str, float, int]]] = defaultdict(list)
    with open(data, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["SEX"] == "_T" and r["AGE"] == "Y0" and r["TERRITORIAL_LEVEL"] in ("TL2", "TL3") and r["OBS_VALUE"]:
                code = r["REF_AREA"]
                out[r["COUNTRY"], r["TERRITORIAL_LEVEL"]].append(
                    (code, names.get(code, code), float(r["OBS_VALUE"]), int(r["TIME_PERIOD"]))
                )
    log(f"OECD life expectancy: {sum(map(len, out.values()))} regions")
    return out


def add_region_indicators(summary: dict[str, dict], countries: dict[str, dict]) -> None:
    """GDP, GDP per capita (DOSE) and life expectancy (OECD) of the admin-1 features, where a source region joins."""
    item_names = wikidata_names(sorted({q for s in summary.values() for q in s["_qids"]}))
    by_country: dict[str, list[dict]] = defaultdict(list)
    for key, s in summary.items():
        names = {*s["_names"], *(n for q in s["_qids"] for n in item_names.get(q, []))}
        by_country[s["adm0"]].append({"key": key, "names": sorted(names), "population": s["population"]})
    # Sources use ISO3; Natural Earth gives dependencies their sovereign's code (Ashmore and Cartier Is. is AUS).
    adm0_of = {c["iso3"]: cid for cid, c in sorted(countries.items(), key=lambda kv: kv[0] == kv[1]["iso3"]) if c["iso3"]}

    dose, gdp_joined = load_dose(), 0
    for iso3, rows in dose.items():
        adm0 = adm0_of.get(iso3, iso3)
        by_gid = {r["GID_1"]: r for r in rows}
        sources = [(r["GID_1"], r["region"], float(r["pop"]) if r["pop"] else None) for r in rows]
        for key, gid in match_region_names(by_country.get(adm0, []), sources).items():
            r = by_gid[gid]
            per_capita = float(r["grp_pc_usd"])
            summary[key]["gdpPerCapita"] = round(per_capita, 1)
            summary[key]["gdp"] = round(per_capita * float(r["pop"])) if r["pop"] else None
            summary[key]["gdpYear"] = int(r["year"])
            gdp_joined += 1
    log(f"DOSE: GDP joined to {gdp_joined} admin-1 features")

    life, life_joined = load_oecd_life_expectancy(), 0
    for iso3 in sorted({c for c, _ in life}):
        adm0 = adm0_of.get(iso3, iso3)
        # TL2 are admin-1 in most countries, TL3 in some (Japanese prefectures, Swedish counties): keep the better fit.
        joins = []
        for level in ("TL2", "TL3"):
            rows = {code: row for code, *row in life.get((iso3, level), [])}
            sources = [(code, name, None) for code, (name, _, _) in rows.items()]
            joins.append((match_region_names(by_country.get(adm0, []), sources), rows))
        joined, rows = max(joins, key=lambda j: len(j[0]))
        for key, code in joined.items():
            _, years, year = rows[code]
            summary[key]["lifeExpectancy"] = round(years, 1)
            summary[key]["lifeExpectancyYear"] = year
            life_joined += 1
    log(f"OECD: life expectancy joined to {life_joined} admin-1 features")


def load_cities() -> list[dict]:
    path = unzip(download(GEONAMES_CITIES, "cities5000.zip"), CACHE / "cities5000")
    cities = []
    with open(path / "cities5000.txt", encoding="utf-8") as fh:
        for row in csv.reader(fh, delimiter="\t", quoting=csv.QUOTE_NONE):
            # cities5000 also lists every admin seat, some with population 0 (Saratamata, Little Cayman).
            if row[7] in EXCLUDED_FEATURE_CODES or not row[14] or int(row[14]) <= 0:
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
                    "timezone": row[17],
                }
            )
    log(f"geonames: {len(cities)} cities")
    return cities


ADMIN_SEAT_CODES = {"PPLC", "PPLA", "PPLA2", "PPLA3", "PPLA4"}


def geonames_population(lat: float, lon: float, pool: list[dict]) -> int | None:
    """Population of the GeoNames place standing for a capital: within 10 km, PPLC first, then seats, then closest."""
    near = [(c, haversine_km(lat, lon, c["lat"], c["lon"])) for c in pool]
    near = [(c["code"] != "PPLC", c["code"] not in ADMIN_SEAT_CODES, d, c) for c, d in near if d <= CAPITAL_POP_KM]
    return min(near, key=lambda t: t[:3])[3]["population"] if near else None


def suppress_nearby(
    candidates: list[dict], anchors: list[dict], qids: dict[str, str], parents: dict[str, list[str]]
) -> list[dict]:
    """Greedy de-duplication of GeoNames candidates; returns the survivors sorted by population.

    Candidates are visited by population, admin-1 seats (PPLA) first. One is dropped when it lies within
    CITY_MERGE_KM of a kept city that is more populous or a seat (Guadalajara wins over the larger Zapopan), or
    when Wikidata puts it inside (P131) a kept city within CITY_PART_OF_KM, or maps it to the same item.
    Anchors (the capital and its GeoNames records) suppress but are not returned.
    """
    kept = list(anchors)
    out: list[dict] = []
    # Ties (GeoNames lists some places twice with the same population, e.g. Komárno with a wrong second point)
    # go to the record linked from Wikidata.
    order = sorted(candidates, key=lambda c: (c["code"] != "PPLA", -c["population"], c["geonameid"] not in qids))
    for c in order:
        q = qids.get(c.get("geonameid", ""))
        dup = False
        for k in kept:
            d = haversine_km(c["lat"], c["lon"], k["lat"], k["lon"])
            if c["name"] == k["name"] and c["population"] == k["population"]:
                dup = True  # the same GeoNames place recorded twice
            elif d <= CITY_MERGE_KM and (c["population"] <= (k["population"] or math.inf) or k.get("code") == "PPLA"):
                dup = True
            elif d <= CITY_PART_OF_KM and q:
                kq = qids.get(k.get("geonameid", ""))
                dup = bool(kq) and (kq == q or kq in parents.get(q, []))
            if dup:
                break
        if not dup:
            kept.append(c)
            out.append(c)
    return sorted(out, key=lambda c: -c["population"])


def italian_names(geoname_ids: set[str]) -> dict[str, str]:
    """Italian names from GeoNames alternate names, keyed by geonameid (exact, unlike Wikidata's P1566 links)."""
    path = download(GEONAMES_ALT_NAMES, "alternateNamesV2.zip")
    best: dict[str, tuple[int, str]] = {}
    with zipfile.ZipFile(path) as zf, zf.open("alternateNamesV2.txt") as raw:
        for line in io.TextIOWrapper(raw, encoding="utf-8"):
            cols = line.rstrip("\n").split("\t")
            if cols[2] != "it" or cols[1] not in geoname_ids:
                continue
            if cols[6] == "1" or cols[7] == "1":  # colloquial or historic
                continue
            name = cols[3]
            if not name[:1].isupper() or name.lower().startswith("distretto"):  # "poona", "Distretto di Bornova"
                continue
            score = 2 * (cols[4] == "1") + (cols[5] == "1")  # preferred, then short
            if cols[1] not in best or score > best[cols[1]][0]:
                best[cols[1]] = (score, name)
    log(f"geonames: {len(best)} Italian city names")
    return {k: v[1] for k, v in best.items()}


def iso_owners(entries: list[tuple[str, str, str]]) -> dict[str, str]:
    """Map each ISO code to the one feature that owns it, from (ADM0_A3, code, ISO_A3_EH) triples.

    Natural Earth gives dependencies their sovereign's code (Ashmore and Cartier Is. and Indian Ocean Ter. are
    AUS/AU): the owner is the feature whose ADM0_A3 equals its ISO_A3_EH, otherwise the only feature with that
    code (S. Sudan is SDS/SSD). Codes shared without a clear owner get none.
    """
    by_code: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for adm0, code, iso3 in entries:
        if code:
            by_code[code].append((adm0, iso3))
    owners: dict[str, str] = {}
    for code, members in by_code.items():
        primary = [adm0 for adm0, iso3 in members if adm0 == iso3]
        if len(primary) == 1:
            owners[code] = primary[0]
        elif len(members) == 1:
            owners[code] = members[0][0]
        else:
            log(f"ISO code {code} shared by {[m[0] for m in members]} without an owner")
    return owners


def build_countries(features: list[dict], admin1_files: dict[str, Path]) -> dict[str, dict]:
    population_wb = world_bank("SP.POP.TOTL")
    area_wb = world_bank("AG.SRF.TOTL.K2")
    gdp_wb = world_bank("NY.GDP.MKTP.CD")  # GDP, current US$
    gdp_pc_wb = world_bank("NY.GDP.PCAP.CD")  # GDP per capita, current US$
    life_wb = world_bank("SP.DYN.LE00.IN")  # life expectancy at birth, total (years)
    extra_wb = {field: (world_bank(code), decimals) for field, (code, decimals) in WB_INDICATORS.items()}
    wd = wikidata_stats(sorted({clean_str(f["properties"]["WIKIDATAID"]) for f in features} - {""}), "countries")
    iso3s = [(f["properties"]["ADM0_A3"], clean_str(f["properties"]["ISO_A3_EH"])) for f in features]
    iso3_owner = iso_owners([(adm0, iso3, iso3) for adm0, iso3 in iso3s])

    countries: dict[str, dict] = {}
    wb_codes: dict[str, str] = {}
    for feat in features:
        p = feat["properties"]
        cid = p["ADM0_A3"]
        iso2, iso3 = clean_str(p["ISO_A2_EH"]), clean_str(p["ISO_A3_EH"])
        w = wd.get(clean_str(p["WIKIDATAID"]), {})
        # World Bank rows are joined by ISO3: only the feature owning the code gets them (not its dependencies).
        wb_code = iso3 if iso3_owner.get(iso3) == cid else WORLD_BANK_ALIASES.get(cid, "")
        wb_codes[cid] = wb_code

        population, pop_year, pop_source = None, None, None
        if wb_code in population_wb:
            (population, pop_year), pop_source = population_wb[wb_code], "World Bank"
        elif w.get("population") is not None:  # 0 is real for uninhabited territories
            population, pop_year, pop_source = w["population"], w.get("populationYear"), "Wikidata"

        # World Bank first; Wikidata only when consistent with the boundary's own geodesic area.
        measured = geodesic_area_km2(feat["geometry"])
        wb_area = area_wb[wb_code][0] if wb_code in area_wb else None
        if wb_area and w.get("area") and not 1 / 3 < wb_area / w["area"] < 3:
            # The sources disagree wildly (World Bank: Monaco 74.9 km², Greenland ice-free only;
            # Wikidata: Macao with its waters). The boundary's own area picks the plausible one.
            def off(v: float) -> float:
                return abs(math.log(v / measured)) if measured > 1 else 0.0

            if off(w["area"]) <= off(wb_area):
                area, area_source = w["area"], "Wikidata"
            else:
                area, area_source = wb_area, "World Bank"
        elif wb_area:
            area, area_source = wb_area, "World Bank"
        elif w.get("area") and 0.6 < w["area"] / max(measured, 1e-9) < 1.6:
            area, area_source = w["area"], "Wikidata"
        else:
            area, area_source = measured, "Natural Earth (calcolata)"
        if area_source == "Wikidata" and wb_area:
            log(f"area {cid}: World Bank {wb_area} vs Wikidata {w['area']} → Wikidata")

        capitals = sorted(w.get("capitals") or [], key=lambda c: -(c["population"] or 0))
        anchor = (capitals[0]["lat"], capitals[0]["lon"]) if capitals else None
        countries[cid] = {
            "id": cid,
            "name": clean_str(p["NAME_IT"]) or p["NAME"],
            "nameEn": p["NAME"],
            "iso2": iso2 or None,
            "iso3": iso3 or None,
            "continent": p["CONTINENT"],
            "subregion": p["SUBREGION"],
            "type": p["TYPE"],
            "population": int(population) if population is not None else None,
            "populationYear": pop_year,
            "populationSource": pop_source,
            "gdp": round(gdp_wb[wb_code][0]) if wb_code in gdp_wb else None,
            "gdpYear": gdp_wb[wb_code][1] if wb_code in gdp_wb else None,
            "gdpPerCapita": round(gdp_pc_wb[wb_code][0], 1) if wb_code in gdp_pc_wb else None,
            "gdpPerCapitaYear": gdp_pc_wb[wb_code][1] if wb_code in gdp_pc_wb else None,
            "lifeExpectancy": round(life_wb[wb_code][0], 1) if wb_code in life_wb else None,
            "lifeExpectancyYear": life_wb[wb_code][1] if wb_code in life_wb else None,
            **{
                k: v
                for field, (values, decimals) in extra_wb.items()
                for k, v in (
                    (field, round(values[wb_code][0], decimals) if wb_code in values else None),
                    (f"{field}Year", values[wb_code][1] if wb_code in values else None),
                )
            },
            "area": round(area, 1) if area else None,
            "areaSource": area_source,
            "capitals": capitals,
            # Natural Earth's hand-placed label point and the zoom from which the name should show.
            "label": [round(p["LABEL_X"], 3), round(p["LABEL_Y"], 3)] if p.get("LABEL_X") is not None else None,
            "labelMinZoom": p.get("MIN_LABEL"),
            "bbox": focus_bbox(feat["geometry"], anchor),
            "admin1Count": 0,
        }
    write_history(countries, {cid: code for cid, code in wb_codes.items() if code})
    missing = sorted(set(admin1_files) - set(countries))
    if missing:
        log(f"admin-1 files without a matching country: {missing}")
    log(f"missing population: {[c for c, v in countries.items() if v['population'] is None]}")
    return countries


def build_cities(
    countries: dict[str, dict], admin1_summary: dict[str, dict], cities_by_iso2: dict[str, list[dict]]
) -> None:
    """Pick the major cities of each country, enrich them from Wikidata, write countries/cities JSON."""
    admin1_by_country: dict[str, list[dict]] = defaultdict(list)
    for s in admin1_summary.values():
        admin1_by_country[s["adm0"]].append(s)
    # GeoNames cities are keyed by ISO2, which dependencies share with their sovereign (AU for Ashmore and
    # Cartier Is.): only the feature owning the code gets them.
    iso2_owner = iso_owners([(c["id"], c["iso2"] or "", c["iso3"] or "") for c in countries.values()])
    zone_owner = zone_countries()

    anchors: dict[str, list[dict]] = {}
    candidates: dict[str, list[dict]] = {}
    for cid, country in countries.items():
        country["admin1Count"] = len(admin1_by_country.get(cid, []))
        iso2 = country["iso2"]
        own = cities_by_iso2.get(iso2, []) if iso2 and iso2_owner.get(iso2) == cid else []
        own = sorted(own, key=lambda c: -c["population"])
        if not country["capitals"]:
            country["capitals"] = [
                {"name": c["name"], "lat": c["lat"], "lon": c["lon"], "population": c["population"]}
                for c in own
                if c["code"] == "PPLC"
            ][:1]
        for cap in country["capitals"]:
            if cap["population"] is None:
                cap["population"] = geonames_population(cap["lat"], cap["lon"], cities_by_iso2.get(iso2, []))
        country["capitals"].sort(key=lambda c: -(c["population"] or 0))
        # Time zones: the capital's (nearest GeoNames place) and every zone the country's places use.
        for cap in country["capitals"]:
            near = min(
                ((haversine_km(cap["lat"], cap["lon"], c["lat"], c["lon"]), c) for c in cities_by_iso2.get(iso2, [])),
                key=lambda t: t[0],
                default=(math.inf, None),
            )
            cap["timezone"] = near[1]["timezone"] if near[0] <= CAPITAL_TZ_KM and near[1]["timezone"] else None
        own_zone = lambda z: bool(z) and zone_owner.get(z, iso2) == iso2  # noqa: E731
        zones = {c["timezone"] for c in own if own_zone(c["timezone"])}
        zones |= {c["timezone"] for c in country["capitals"] if c["timezone"]}
        country["timezones"] = sorted(zones)
        # National capitals live in countries.json; their GeoNames duplicates only suppress their neighbours.
        caps = country["capitals"]
        dupes = [
            c
            for c in own
            if c["code"] == "PPLC"
            or any(haversine_km(c["lat"], c["lon"], k["lat"], k["lon"]) <= CAPITAL_DEDUP_KM for k in caps)
        ]
        anchors[cid] = caps + dupes
        candidates[cid] = [c for c in own if c not in dupes][:CITY_CANDIDATES]

    # Wikidata "located in" (P131) tells boroughs and wards (Queens, the Bronx, Ōta) from neighbouring cities.
    groups = [*anchors.values(), *candidates.values()]
    ids = sorted({c["geonameid"] for group in groups for c in group if "geonameid" in c})
    gn_to_qid = wikidata_resolve("P1566", ids)
    parents = wikidata_parents(sorted(set(gn_to_qid.values())))
    selected: dict[str, list[dict]] = {}
    dropped = 0
    for cid, cands in candidates.items():
        survivors = suppress_nearby(cands, anchors[cid], gn_to_qid, parents)
        dropped += len(cands) - len(survivors)
        if survivors:
            selected[cid] = survivors[:CITIES_PER_COUNTRY]
    log(f"cities: {dropped} of {sum(map(len, candidates.values()))} GeoNames candidates merged into a nearby city")

    # GeoNames gives undated populations and English names: prefer Wikidata's dated figure and Italian label.
    ids = sorted({c["geonameid"] for major in selected.values() for c in major})
    wd = wikidata_stats(sorted({gn_to_qid[i] for i in ids if i in gn_to_qid}), "cities")
    it_names = italian_names(set(ids))
    enriched = 0
    cities_out: dict[str, list] = {}
    for cid, major in selected.items():
        rows = []
        for c in major:
            w = wd.get(gn_to_qid.get(c["geonameid"], ""), {})
            # GeoNames "it" names are exact per place (a few are old exonyms, e.g. "Iconio"); Wikidata's
            # P1566 link often points at the district, whose label is wrong for the city ("Chongqing Shi").
            name = it_names.get(c["geonameid"]) or w.get("label") or c["name"]
            population = c["population"]
            if (
                w.get("population")
                and (w.get("populationYear") or 0) >= 2010
                and w["population"] <= c["population"] * CITY_WIKIDATA_MAX_RATIO
            ):
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
                {"name": "World Bank WDI", "url": "https://data.worldbank.org", "license": "CC BY 4.0", "usedFor": "Indicatori degli Stati: popolazione, superficie, PIL, aspettativa di vita, età, fecondità, urbanizzazione, CO₂"},
                {"name": "Wikidata", "url": "https://www.wikidata.org", "license": "CC0", "usedFor": "Capitali, regioni (popolazione, superficie, capoluogo)"},
                {"name": "DOSE v2.9 (MCC-PIK, Wenz et al. 2023)", "url": "https://doi.org/10.5281/zenodo.13773040", "license": "CC BY 4.0", "usedFor": "PIL e PIL pro capite delle regioni"},
                {"name": "OECD Regional Statistics", "url": "https://data-explorer.oecd.org", "license": "CC BY 4.0", "usedFor": "Aspettativa di vita delle regioni"},
                {"name": "GeoNames (cities5000, alternateNames)", "url": "https://www.geonames.org", "license": "CC BY 4.0", "usedFor": "Città principali, popolazione e nomi italiani"},
                {"name": "NASA GIBS (Blue Marble)", "url": "https://earthdata.nasa.gov/gibs", "license": "Pubblico dominio", "usedFor": "Sfondo a rilievo (opzionale, caricato da internet)"},
                {"name": "flag-icons (Panayiotis Lipiridis)", "url": "https://github.com/lipis/flag-icons", "license": "MIT", "usedFor": "Bandiere"},
                {"name": "Natural Earth", "url": "https://www.naturalearthdata.com", "license": "Public domain", "usedFor": "Confini di Stati e regioni"},
                {"name": "Noto Sans (glifi OpenFreeMap)", "url": "https://openfreemap.org", "license": "SIL OFL 1.1", "usedFor": "Font delle etichette sulla mappa"},
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
    cities_by_iso2: dict[str, list[dict]] = defaultdict(list)
    for c in load_cities():
        cities_by_iso2[c["iso2"]].append(c)
    countries = build_countries(countries_features, files)
    summary = build_admin1(rows, files, countries, cities_by_iso2)
    build_cities(countries, summary, cities_by_iso2)
    download_fonts()
    write_meta()
    log("done")


if __name__ == "__main__":
    main()
