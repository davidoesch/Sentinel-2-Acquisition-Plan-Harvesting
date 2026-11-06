#!/usr/bin/env python3
"""
Flask app serving the swissEO Sentinel-2 site locally:

    /calendar.html     availability calendar (scenes, no-imagery days, plan)
    /latency/          Leaflet map of catalog publication latency per H3 cell

URLs mirror the GitHub Pages site, so the very same HTML/JS runs in both
places. Under Flask ``/latency/data/latency.json`` is built live from the
SQLite database filled by ``latency_loader.py``, and a JSON API is offered.

USAGE
    python latency/latency_loader.py          # fill latency/latency.sqlite
    python latency/app.py                     # http://127.0.0.1:5000

Environment: LATENCY_DB, MISSION, HOST (127.0.0.1), PORT (5000)

API
    GET /api/calendar?start=YYYY-MM-DD&end=...      per-day status (scenes from the
                                                    local DB, no-imagery CSV, plan)
    GET /api/dates                                  acquisition dates
    GET /api/latency?date=YYYY-MM-DD                GeoJSON, one date
    GET /api/summary?start=YYYY-MM-DD&end=...       GeoJSON, median per cell
    GET /api/timeseries?h3_cell=<id>                latency per date for a cell
    GET /api/scenes?start=...&end=...               scene-level latencies
"""

import csv
import io
import os
import statistics
import sys
import time
from datetime import date, timedelta

import requests
from flask import Flask, abort, jsonify, redirect, request, send_from_directory

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import latency_loader as ll  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STATIC_FILES = {"index.html", "app.js", "style.css"}
PLAN_CSV = os.path.join(ROOT, "acquisitionplan.csv")
NO_IMAGERY_URL = (
    "https://data.geo.admin.ch/ch.swisstopo.swisseo_s2-sr_v200/dates_with_no_imagery.csv"
)
NO_IMAGERY_TTL = 3600  # seconds
_no_imagery_cache = {"at": 0.0, "data": {}}
DB_PATH = ll.DEFAULT_DB
MISSION = ll.MISSION

app = Flask(__name__, static_folder=None)


def db():
    return ll.connect(DB_PATH)


def _iso_date(name):
    value = request.args.get(name)
    if not value:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        abort(400, f"{name} must be YYYY-MM-DD")


def _range_sql():
    start, end = _iso_date("start"), _iso_date("end")
    if start and end and start > end:
        abort(400, "start must be on or before end")
    sql, params = "", []
    if start:
        sql += " AND acq_date >= ?"
        params.append(start)
    if end:
        sql += " AND acq_date <= ?"
        params.append(end)
    return sql, params, start, end


def _feature(cell, props):
    ring = [[lng, lat] for lat, lng in ll.cell_boundary(cell)]
    ring.append(ring[0])
    return {"type": "Feature", "id": cell, "properties": {"h3_cell": cell, **props},
            "geometry": {"type": "Polygon", "coordinates": [ring]}}


# ---------------------------------------------------------------------------
# Page and data file
# ---------------------------------------------------------------------------

@app.get("/")
def home():
    return redirect("/calendar.html")


@app.get("/calendar.html")
def calendar_page():
    return send_from_directory(ROOT, "calendar.html")


@app.get("/acquisitionplan.csv")
def plan_csv():
    return send_from_directory(ROOT, "acquisitionplan.csv", max_age=0)


@app.get("/assets/<path:name>")
def assets(name):
    return send_from_directory(os.path.join(ROOT, "assets"), name)


@app.get("/latency")
def latency_redirect():
    return redirect("/latency/")


@app.get("/latency/")
def latency_page():
    return send_from_directory(HERE, "index.html")


@app.get("/latency/<name>")
def latency_static(name):
    if name not in STATIC_FILES:
        abort(404)
    return send_from_directory(HERE, name)


@app.get("/latency/data/latency.json")
def export():
    with db() as conn:
        return jsonify(ll.build_export(conn, MISSION))


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/api/dates")
def api_dates():
    with db() as conn:
        rows = conn.execute(
            "SELECT acq_date, scene_count, excluded_count, cell_count, loaded_at "
            "FROM runs WHERE mission = ? ORDER BY acq_date DESC", (MISSION,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/latency")
def api_latency():
    with db() as conn:
        day = _iso_date("date") or conn.execute(
            "SELECT max(acq_date) FROM runs WHERE mission = ?", (MISSION,)
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM cell_latency WHERE mission = ? AND acq_date = ? ORDER BY h3_cell",
            (MISSION, day),
        ).fetchall()
    feats = [
        _feature(r["h3_cell"], {
            "acq_date": r["acq_date"],
            "latency_hours": r["latency_hours"],
            "observed_samples": r["observed_samples"],
            "total_samples": r["total_samples"],
            "first_acquired_at": r["first_acquired_at"],
            "first_created_at": r["first_created_at"],
            "scene_ids": r["scene_ids"].split(","),
        })
        for r in rows
    ]
    return jsonify({"type": "FeatureCollection", "features": feats,
                    "properties": {"mission": MISSION, "date": day, "count": len(feats)}})


@app.get("/api/summary")
def api_summary():
    sql, params, start, end = _range_sql()
    with db() as conn:
        rows = conn.execute(
            "SELECT h3_cell, acq_date, latency_hours FROM cell_latency "
            f"WHERE mission = ?{sql} ORDER BY h3_cell, acq_date", [MISSION, *params]
        ).fetchall()
    per_cell = {}
    for r in rows:
        per_cell.setdefault(r["h3_cell"], []).append(r)
    feats = []
    for cell, items in per_cell.items():
        lat = [i["latency_hours"] for i in items]
        feats.append(_feature(cell, {
            "median_latency_hours": statistics.median(lat),
            "mean_latency_hours": statistics.fmean(lat),
            "max_latency_hours": max(lat),
            "acquisition_count": len(items),
            "first_date": items[0]["acq_date"],
            "last_date": items[-1]["acq_date"],
        }))
    return jsonify({"type": "FeatureCollection", "features": feats,
                    "properties": {"mission": MISSION, "start": start, "end": end,
                                   "count": len(feats)}})


@app.get("/api/timeseries")
def api_timeseries():
    cell = request.args.get("h3_cell", "").strip()
    if not cell:
        abort(400, "h3_cell is required")
    sql, params, start, end = _range_sql()
    with db() as conn:
        rows = conn.execute(
            "SELECT acq_date, latency_hours, observed_samples, total_samples, "
            "first_acquired_at, first_created_at, scene_ids FROM cell_latency "
            f"WHERE mission = ? AND h3_cell = ?{sql} ORDER BY acq_date",
            [MISSION, cell, *params],
        ).fetchall()
    return jsonify({"mission": MISSION, "h3_cell": cell, "start": start, "end": end,
                    "points": [dict(r) for r in rows]})


@app.get("/api/scenes")
def api_scenes():
    sql, params, _, _ = _range_sql()
    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM scenes WHERE mission = ?{sql} ORDER BY acquired_at",
            [MISSION, *params],
        ).fetchall()
    return jsonify([{**dict(r), "excluded": bool(r["excluded"])} for r in rows])


def _no_imagery():
    """date -> remark from swisstopo's dates_with_no_imagery.csv (cached)."""
    if time.time() - _no_imagery_cache["at"] > NO_IMAGERY_TTL:
        try:
            resp = requests.get(NO_IMAGERY_URL, timeout=30)
            resp.raise_for_status()
            rows = csv.DictReader(io.StringIO(resp.text))
            _no_imagery_cache["data"] = {r["date"]: r["remark"] for r in rows if r.get("date")}
            _no_imagery_cache["at"] = time.time()
        except (requests.RequestException, KeyError) as exc:
            app.logger.warning("no-imagery CSV unavailable: %s", exc)
    return _no_imagery_cache["data"]


def _plan():
    out = {}
    if os.path.exists(PLAN_CSV):
        with open(PLAN_CSV, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                out.setdefault(r["Acquisition Date"], []).append(
                    {"platform": r["Platform"], "orbit": int(r["Orbit"])}
                )
    return out


@app.get("/api/calendar")
def api_calendar():
    """Per-day availability; scenes come from the local DB (run the loader first)."""
    today = date.today()
    start = _iso_date("start") or (today - timedelta(days=30)).isoformat()
    end = _iso_date("end") or (today + timedelta(days=14)).isoformat()
    if start > end:
        abort(400, "start must be on or before end")
    with db() as conn:
        rows = conn.execute(
            "SELECT * FROM scenes WHERE mission = ? AND acq_date BETWEEN ? AND ? "
            "ORDER BY acquired_at", (MISSION, start, end),
        ).fetchall()
    scenes = {}
    for r in rows:
        scenes.setdefault(r["acq_date"], []).append({
            "id": r["item_id"], "acquired": r["acquired_at"], "created": r["created_at"],
            "latency_hours": r["latency_hours"], "reprocessed": bool(r["excluded"]),
        })
    no_img, plan = _no_imagery(), _plan()
    days = []
    d, last = date.fromisoformat(start), date.fromisoformat(end)
    while d <= last:
        key = d.isoformat()
        entry = {"date": key, "scenes": scenes.get(key, []), "remark": no_img.get(key),
                 "planned": plan.get(key, [])}
        if entry["scenes"]:
            entry["status"] = "scene"
        elif entry["remark"] and not (
            # written before the overpass: premature for today/future planned days
            entry["planned"] and d >= today and "no candidate" in entry["remark"].lower()
        ):
            r = entry["remark"].lower()
            entry["status"] = "cloudy" if "cloud" in r else "incomplete" if "incomplete" in r else "no_scene"
        elif entry["planned"]:
            entry["status"] = "planned" if d >= today else "pending"
        else:
            entry["status"] = None
        days.append(entry)
        d += timedelta(days=1)
    return jsonify({"start": start, "end": end, "days": days})


@app.errorhandler(400)
def bad_request(err):
    return jsonify({"error": err.description}), 400


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")))
