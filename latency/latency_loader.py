#!/usr/bin/env python3
"""
Sentinel catalog publication latency per H3 cell.

For every scene in a STAC collection the loader compares the acquisition
timestamp (``properties.datetime``) with the time the item appeared in the
catalog (``properties.created``). Scene footprints are rasterised to fine
"sample" H3 cells; each sample cell keeps the first scene that made it
available on that acquisition date. Sample cells are then grouped into coarse
"output" H3 cells and the median latency is stored per output cell and
acquisition date. Dates without an acquisition are not stored.

Metadata only: no imagery is downloaded and no cloud masking is applied.

Default source: swisstopo swissEO S2-SR v200 (Sentinel-2, Switzerland)
https://data.geo.admin.ch/browser/index.html#/collections/ch.swisstopo.swisseo_s2-sr_v200

USAGE
    python latency/latency_loader.py                       # DEFAULT_START .. today
    python latency/latency_loader.py --date 2026-11-05
    python latency/latency_loader.py --start 2026-10-01 --end 2026-10-31
    python latency/latency_loader.py --export latency/data/latency.json
    python latency/latency_loader.py --export-only --export latency/data/latency.json

Author: David Oesch, 2026-11-06
"""

import argparse
import json
import os
import sqlite3
import statistics
import time
from datetime import date, datetime, timedelta, timezone

import h3
import requests

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# Configuration (all overridable via CLI or environment)
# ---------------------------------------------------------------------------

STAC_SEARCH_URL = os.environ.get(
    "STAC_SEARCH_URL", "https://data.geo.admin.ch/api/stac/v1/search"
)
STAC_COLLECTION = os.environ.get("STAC_COLLECTION", "ch.swisstopo.swisseo_s2-sr_v200")
MISSION = os.environ.get("MISSION", "sentinel-2")

# swissEO v200 went into near-real-time production around this date. Items
# acquired earlier were bulk-reprocessed in 2026 and say nothing about
# operational latency.
DEFAULT_START = os.environ.get("LATENCY_START", "2026-06-29")

# Scenes published later than this are treated as reprocessed / backfilled
# and excluded from the cell statistics (they are still listed as scenes).
MAX_LATENCY_HOURS = float(os.environ.get("MAX_LATENCY_HOURS", "240"))

# Switzerland is ~41'000 km2: res 5 (~253 km2) gives ~200 hexagons,
# res 7 (~5 km2) gives 49 sample cells per hexagon.
OUTPUT_RESOLUTION = int(os.environ.get("OUTPUT_RESOLUTION", "5"))
SAMPLE_RESOLUTION = int(os.environ.get("SAMPLE_RESOLUTION", "7"))

# Region the hexagons are clipped to. STAC footprints of the swissEO mosaics
# are rectangles, but data only exists over Switzerland (+ ~5 km buffer).
# Same AOI outline as get_acquisition_plans.py (lon, lat).
REGION = {
    "type": "Polygon",
    "coordinates": [[
        [5.96, 46.13], [6.03, 46.66], [6.91, 47.52], [8.56, 47.90], [9.78, 47.65],
        [9.91, 47.17], [10.70, 46.96], [10.60, 46.47], [10.08, 46.11], [9.06, 45.74],
        [7.13, 45.77], [5.96, 46.13],
    ]],
}

DEFAULT_DB = os.environ.get("LATENCY_DB", os.path.join(HERE, "latency.sqlite"))
PAGE_LIMIT = 100
RETRIES = 5
USER_AGENT = "sentinel-latency-loader/1.0 (+https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting)"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    mission          TEXT NOT NULL,
    acq_date         TEXT NOT NULL,
    stac_url         TEXT NOT NULL,
    collection       TEXT NOT NULL,
    scene_count      INTEGER NOT NULL,
    excluded_count   INTEGER NOT NULL,
    cell_count       INTEGER NOT NULL,
    output_res       INTEGER NOT NULL,
    sample_res       INTEGER NOT NULL,
    loaded_at        TEXT NOT NULL,
    PRIMARY KEY (mission, acq_date)
);
CREATE TABLE IF NOT EXISTS scenes (
    mission          TEXT NOT NULL,
    item_id          TEXT NOT NULL,
    acq_date         TEXT NOT NULL,
    acquired_at      TEXT NOT NULL,
    created_at       TEXT NOT NULL,
    latency_hours    REAL NOT NULL,
    excluded         INTEGER NOT NULL,
    PRIMARY KEY (mission, item_id)
);
CREATE TABLE IF NOT EXISTS cell_latency (
    mission            TEXT NOT NULL,
    acq_date           TEXT NOT NULL,
    h3_cell            TEXT NOT NULL,
    latency_hours      REAL NOT NULL,
    observed_samples   INTEGER NOT NULL,
    total_samples      INTEGER NOT NULL,
    first_acquired_at  TEXT NOT NULL,
    first_created_at   TEXT NOT NULL,
    scene_ids          TEXT NOT NULL,
    PRIMARY KEY (mission, acq_date, h3_cell)
);
CREATE INDEX IF NOT EXISTS cell_latency_cell ON cell_latency (mission, h3_cell);
CREATE INDEX IF NOT EXISTS scenes_date ON scenes (mission, acq_date);
"""


def connect(db_path=DEFAULT_DB):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# ---------------------------------------------------------------------------
# STAC
# ---------------------------------------------------------------------------

def parse_ts(value):
    """ISO 8601 -> aware UTC datetime (handles trailing 'Z')."""
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso_z(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_json(session, url, params=None):
    for attempt in range(1, RETRIES + 1):
        try:
            resp = session.get(url, params=params, timeout=(15, 120))
            if resp.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {resp.status_code}", response=resp)
            resp.raise_for_status()
            return resp.json()
        except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as exc:
            if attempt == RETRIES:
                raise
            wait = 2 ** attempt
            print(f"  STAC request failed ({exc}); retry {attempt}/{RETRIES} in {wait}s")
            time.sleep(wait)


def fetch_items(start_day, end_day, stac_url=STAC_SEARCH_URL, collection=STAC_COLLECTION):
    """Yield STAC items acquired in [start_day 00:00, end_day+1 00:00) UTC."""
    t0 = datetime(start_day.year, start_day.month, start_day.day, tzinfo=timezone.utc)
    t1 = datetime(end_day.year, end_day.month, end_day.day, tzinfo=timezone.utc) + timedelta(days=1)
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT
    url = stac_url
    params = {
        "collections": collection,
        "datetime": f"{iso_z(t0)}/{iso_z(t1 - timedelta(seconds=1))}",
        "limit": PAGE_LIMIT,
    }
    page = 0
    while url:
        page += 1
        data = _get_json(session, url, params)
        features = data.get("features", [])
        print(f"  STAC page {page}: {len(features)} items")
        yield from features
        # The 'next' link already carries all query parameters (cursor paging)
        url = next((l["href"] for l in data.get("links", []) if l.get("rel") == "next"), None)
        params = None


def scene_record(item):
    """Return a normalised scene dict, or None if the item is not a usable scene."""
    props = item.get("properties", {})
    if not props.get("datetime") or not props.get("created") or not item.get("geometry"):
        return None
    acquired = parse_ts(props["datetime"])
    created = parse_ts(props["created"])
    latency_h = (created - acquired).total_seconds() / 3600.0
    if latency_h < 0:
        # e.g. collection-level summary items created before their nominal datetime
        return None
    return {
        "id": item["id"],
        "acquired": acquired,
        "created": created,
        "latency_h": latency_h,
        "geometry": item["geometry"],
        "excluded": latency_h > MAX_LATENCY_HOURS,
    }


# ---------------------------------------------------------------------------
# H3 aggregation
# ---------------------------------------------------------------------------

def footprint_cells(geometry, resolution):
    """H3 cells whose centre lies inside a GeoJSON (Multi)Polygon."""
    try:
        return set(h3.geo_to_cells(geometry, resolution))
    except Exception as exc:  # malformed / unsupported geometry
        print(f"  WARNING: cannot index geometry: {exc}")
        return set()


def region_cells(region, sample_res):
    """Sample cells inside the region (None = no clipping)."""
    return footprint_cells(region, sample_res) if region else None


def aggregate_day(scenes, output_res=OUTPUT_RESOLUTION, sample_res=SAMPLE_RESOLUTION,
                  allowed=None):
    """
    Aggregate the scenes of ONE acquisition date into output H3 cells.

    Each sample cell keeps the scene that published it first (earliest
    'created'), i.e. the moment data for that spot first became available.
    """
    first = {}  # sample cell -> scene
    for scene in scenes:
        if scene["excluded"]:
            continue
        cells = footprint_cells(scene["geometry"], sample_res)
        if allowed is not None:
            cells &= allowed
        for cell in cells:
            prev = first.get(cell)
            if prev is None or scene["created"] < prev["created"]:
                first[cell] = scene

    groups = {}
    for cell, scene in first.items():
        groups.setdefault(h3.cell_to_parent(cell, output_res), []).append(scene)

    total = 7 ** (sample_res - output_res)
    rows = []
    for parent, members in groups.items():
        rows.append({
            "h3_cell": parent,
            "latency_hours": float(statistics.median(m["latency_h"] for m in members)),
            "observed_samples": len(members),
            "total_samples": total,
            "first_acquired_at": iso_z(min(m["acquired"] for m in members)),
            "first_created_at": iso_z(min(m["created"] for m in members)),
            "scene_ids": ",".join(sorted({m["id"] for m in members})),
        })
    return rows


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

def load_range(conn, start_day, end_day, mission=MISSION, stac_url=STAC_SEARCH_URL,
               collection=STAC_COLLECTION, output_res=OUTPUT_RESOLUTION,
               sample_res=SAMPLE_RESOLUTION, region=REGION):
    """Query STAC once for the range and (re)write every acquisition date in it."""
    print(f"Querying {collection} {start_day} .. {end_day}")
    by_day = {}
    for item in fetch_items(start_day, end_day, stac_url, collection):
        scene = scene_record(item)
        if scene is None:
            print(f"  skipping non-scene item: {item.get('id')}")
            continue
        by_day.setdefault(scene["acquired"].date().isoformat(), []).append(scene)

    allowed = region_cells(region, sample_res)
    loaded_at = iso_z(datetime.now(timezone.utc))
    with conn:
        # Replace the whole range so scenes removed from the catalog disappear
        for table in ("cell_latency", "scenes", "runs"):
            conn.execute(
                f"DELETE FROM {table} WHERE mission = ? AND acq_date BETWEEN ? AND ?",
                (mission, start_day.isoformat(), end_day.isoformat()),
            )
        for day in sorted(by_day):
            scenes = by_day[day]
            rows = aggregate_day(scenes, output_res, sample_res, allowed)
            conn.executemany(
                "INSERT INTO scenes VALUES (?,?,?,?,?,?,?)",
                [(mission, s["id"], day, iso_z(s["acquired"]), iso_z(s["created"]),
                  round(s["latency_h"], 3), int(s["excluded"])) for s in scenes],
            )
            conn.executemany(
                "INSERT INTO cell_latency VALUES (?,?,?,?,?,?,?,?,?)",
                [(mission, day, r["h3_cell"], round(r["latency_hours"], 3),
                  r["observed_samples"], r["total_samples"], r["first_acquired_at"],
                  r["first_created_at"], r["scene_ids"]) for r in rows],
            )
            excluded = sum(s["excluded"] for s in scenes)
            conn.execute(
                "INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?)",
                (mission, day, stac_url, collection, len(scenes), excluded,
                 len(rows), output_res, sample_res, loaded_at),
            )
            note = f", {excluded} excluded as reprocessed" if excluded else ""
            print(f"  {day}: {len(scenes)} scene(s){note} -> {len(rows)} H3 cells")
    print(f"Loaded {len(by_day)} acquisition date(s)")
    return len(by_day)


# ---------------------------------------------------------------------------
# Static export (consumed by latency/index.html, both on GitHub Pages and Flask)
# ---------------------------------------------------------------------------

def cell_boundary(cell):
    """H3 cell boundary as [[lat, lng], ...] rounded for compact JSON."""
    return [[round(lat, 5), round(lng, 5)] for lat, lng in h3.cell_to_boundary(cell)]


def build_export(conn, mission=MISSION):
    runs = conn.execute(
        "SELECT * FROM runs WHERE mission = ? ORDER BY acq_date", (mission,)
    ).fetchall()
    scenes = conn.execute(
        "SELECT * FROM scenes WHERE mission = ? ORDER BY acquired_at", (mission,)
    ).fetchall()
    cells = conn.execute(
        "SELECT * FROM cell_latency WHERE mission = ? ORDER BY acq_date, h3_cell", (mission,)
    ).fetchall()

    # Cells are listed once with their boundary; values reference them by index
    cell_ids = sorted({r["h3_cell"] for r in cells})
    index = {c: i for i, c in enumerate(cell_ids)}
    values = {}
    for r in cells:
        values.setdefault(r["acq_date"], []).append(
            [index[r["h3_cell"]], round(r["latency_hours"], 2), r["observed_samples"]]
        )
    run0 = runs[-1] if runs else None
    return {
        "meta": {
            "mission": mission,
            "stac_url": run0["stac_url"] if run0 else STAC_SEARCH_URL,
            "collection": run0["collection"] if run0 else STAC_COLLECTION,
            "output_resolution": run0["output_res"] if run0 else OUTPUT_RESOLUTION,
            "sample_resolution": run0["sample_res"] if run0 else SAMPLE_RESOLUTION,
            "samples_per_cell": 7 ** ((run0["sample_res"] - run0["output_res"]) if run0
                                      else (SAMPLE_RESOLUTION - OUTPUT_RESOLUTION)),
            "max_latency_hours": MAX_LATENCY_HOURS,
            "generated_at": iso_z(datetime.now(timezone.utc)),
        },
        "dates": [
            {"date": r["acq_date"], "scenes": r["scene_count"],
             "excluded": r["excluded_count"], "cells": r["cell_count"]}
            for r in runs
        ],
        "scenes": [
            {"id": s["item_id"], "date": s["acq_date"], "acquired": s["acquired_at"],
             "created": s["created_at"], "latency_hours": s["latency_hours"],
             "excluded": bool(s["excluded"])}
            for s in scenes
        ],
        # [[h3_id, [[lat, lng], ...]], ...]
        "cells": [[c, cell_boundary(c)] for c in cell_ids],
        # {date: [[cell_index, median_latency_hours, observed_samples], ...]}
        "values": values,
    }


def write_export(conn, path, mission=MISSION):
    data = build_export(conn, mission)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
        fh.write("\n")
    print(f"Exported {len(data['dates'])} dates / {len(data['cells'])} cells to {path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--date", help="single acquisition date YYYY-MM-DD")
    ap.add_argument("--start", default=DEFAULT_START, help=f"first date (default {DEFAULT_START})")
    ap.add_argument("--end", help="last date, inclusive (default: today UTC)")
    ap.add_argument("--db", default=DEFAULT_DB, help="SQLite file")
    ap.add_argument("--export", help="write the static JSON used by the web map")
    ap.add_argument("--export-only", action="store_true", help="skip STAC, only export")
    ap.add_argument("--mission", default=MISSION, help="label stored with the data")
    ap.add_argument("--stac-url", default=STAC_SEARCH_URL, help="STAC /search endpoint")
    ap.add_argument("--collection", default=STAC_COLLECTION, help="STAC collection id")
    ap.add_argument("--output-resolution", type=int, default=OUTPUT_RESOLUTION)
    ap.add_argument("--sample-resolution", type=int, default=SAMPLE_RESOLUTION)
    ap.add_argument("--region", help="GeoJSON file (Polygon/MultiPolygon geometry or "
                    "Feature) to clip hexagons to; default: built-in Switzerland outline")
    ap.add_argument("--no-region", action="store_true", help="do not clip to a region")
    args = ap.parse_args()

    if args.sample_resolution < args.output_resolution:
        ap.error("--sample-resolution must be >= --output-resolution")

    region = REGION
    if args.no_region:
        region = None
    elif args.region:
        with open(args.region, encoding="utf-8") as fh:
            gj = json.load(fh)
        region = gj.get("geometry", gj)

    conn = connect(args.db)
    if not args.export_only:
        if args.date:
            start = end = date.fromisoformat(args.date)
        else:
            start = date.fromisoformat(args.start)
            end = date.fromisoformat(args.end) if args.end else datetime.now(timezone.utc).date()
        if start > end:
            ap.error("--start must be on or before --end")
        load_range(conn, start, end, args.mission, args.stac_url, args.collection,
                   args.output_resolution, args.sample_resolution, region)
    if args.export:
        write_export(conn, args.export, args.mission)
    conn.close()


if __name__ == "__main__":
    main()
