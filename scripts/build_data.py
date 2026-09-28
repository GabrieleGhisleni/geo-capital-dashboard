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
import io
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
GEONAMES_ALT_NAMES = "https://download.geonames.org/export/dump/alternateNamesV2.zip"  # ~200 MB, cached
WORLD_BANK = "https://api.worldbank.org/v2/country/all/indicator/{indicator}?format=json&mrnev=1&per_page=1000"
WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"
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


Extent = tuple[float, float, float, float, float, float]  # west, east, shifted west, shifted east, south, north


def ring_extent(ring: list) -> Extent:
    """Longitude range both as-is and shifted to 0..360 (for antimeridian crossings), plus latitude range."""
    lons = [x for x, _ in ring]
    lats = [y for _, y in ring]
    shifted = [x + 360 if x < 0 else x for x in lons]
    return (min(lons), max(lons), min(shifted), max(shifted), min(lats), max(lats))


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
        "-simplify", "8%", "keep-shapes",
        "-filter-fields", "key,adm0_a3",
        "-split", "adm0_a3",
        "-o", str(split_dir) + "/", "format=topojson", "quantization=1e5", "singles",
    )  # fmt: skip
    files = {p.stem: p for p in split_dir.glob("*.json")}
    return rows, files


def build_admin1(
    rows: list[dict], files: dict[str, Path], countries: dict[str, dict], cities_by_iso2: dict[str, list[dict]]
) -> dict[str, dict]:
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
        country = countries.get(adm0) or {}
        if area and country.get("area") and area > country["area"] * 1.05:
            area = None  # implausible Wikidata value (wrong unit or scope)
        caps = s.get("capitals") or []
        cap = dict(max(caps, key=lambda c: c["population"] or 0)) if caps else None
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
    for c in sorted(candidates, key=lambda c: (c["code"] != "PPLA", -c["population"])):
        q = qids.get(c.get("geonameid", ""))
        dup = False
        for k in kept:
            d = haversine_km(c["lat"], c["lon"], k["lat"], k["lon"])
            if d <= CITY_MERGE_KM and (c["population"] < (k["population"] or math.inf) or k.get("code") == "PPLA"):
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
    wd = wikidata_stats(sorted({clean_str(f["properties"]["WIKIDATAID"]) for f in features} - {""}), "countries")
    iso3s = [(f["properties"]["ADM0_A3"], clean_str(f["properties"]["ISO_A3_EH"])) for f in features]
    iso3_owner = iso_owners([(adm0, iso3, iso3) for adm0, iso3 in iso3s])

    countries: dict[str, dict] = {}
    for feat in features:
        p = feat["properties"]
        cid = p["ADM0_A3"]
        iso2, iso3 = clean_str(p["ISO_A2_EH"]), clean_str(p["ISO_A3_EH"])
        w = wd.get(clean_str(p["WIKIDATAID"]), {})
        # World Bank rows are joined by ISO3: only the feature owning the code gets them (not its dependencies).
        wb_code = iso3 if iso3_owner.get(iso3) == cid else WORLD_BANK_ALIASES.get(cid, "")

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
            "area": round(area, 1) if area else None,
            "areaSource": area_source,
            "capitals": capitals,
            # Natural Earth's hand-placed label point and the zoom from which the name should show.
            "label": [round(p["LABEL_X"], 3), round(p["LABEL_Y"], 3)] if p.get("LABEL_X") is not None else None,
            "labelMinZoom": p.get("MIN_LABEL"),
            "bbox": focus_bbox(feat["geometry"], anchor),
            "admin1Count": 0,
        }
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
                {"name": "World Bank WDI (SP.POP.TOTL, AG.SRF.TOTL.K2, NY.GDP.MKTP.CD, NY.GDP.PCAP.CD)", "url": "https://data.worldbank.org", "license": "CC BY 4.0", "usedFor": "Popolazione, superficie, PIL e PIL pro capite degli Stati"},
                {"name": "Wikidata", "url": "https://www.wikidata.org", "license": "CC0", "usedFor": "Capitali, regioni (popolazione, superficie, capoluogo)"},
                {"name": "GeoNames (cities5000, alternateNames)", "url": "https://www.geonames.org", "license": "CC BY 4.0", "usedFor": "Città principali, popolazione e nomi italiani"},
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
