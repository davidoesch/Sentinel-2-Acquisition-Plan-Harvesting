#!/usr/bin/python3.10

"""
Script for harvesting .kml information for Sentinel-2 acquisition plans from sentinels.copernicus.eu.
Extracts user-defined Area of Interest (AOI) polygons from the acquisition plan, stores it as CSV.

Fixes vs. original:
  - HTML parser replaced: div[@class='sentinel-2x'] -> h4-based section detection
    (ESA migrated to sentinels.copernicus.eu; CSS class structure no longer present)
  - get_latest_kml(): date format now case-insensitive (.upper()); fallback to most
    recent KML when no file covers today (e.g. ESA publishes with slight delay)
  - parse_kml_elements(): href matching generalised; no longer requires href to end
    in '00' or contain '.kml' suffix (ESA uses bare document slugs)
  - All three satellites (S2A, S2B, S2C) handled symmetrically

Inspired by https://github.com/hevgyrt/harvest_sentinel_acquisition_plans/

USAGE:
    python get_acquisition_plans.py

Author: David Oesch
Date: 2024-09-26 / updated 2026-05-21
"""

import datetime
import os
import urllib.request as ul
from datetime import timedelta

import pandas as pd  # type: ignore
from lxml import html

from extract_acquisition_plans_s2 import extract_S2_entries  # in-house developed method


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

S2_URL = "https://sentinels.copernicus.eu/web/sentinel/copernicus/sentinel-2/acquisition-plans"
URL_KML_PREFIX = "https://sentinels.copernicus.eu"
STORAGE_PATH = os.getcwd() + "/"

# Polygon defining the Area of Interest (AOI) – default: Switzerland
POLYGON_WKT = (
    "POLYGON((5.96 46.13,6.03 46.66,6.91 47.52,8.56 47.90,9.78 47.65,"
    "9.91 47.17,10.70 46.96,10.60 46.47,10.08 46.11,9.06 45.74,7.13 45.77,5.96 46.13))"
)

# Date format used in ESA KML filenames (lowercase 't' separator)
DATE_FORMAT = "%Y%m%dt%H%M%S"


# ---------------------------------------------------------------------------
# HTML parsing
# ---------------------------------------------------------------------------

def parse_acquisition_page(url):
    """
    Fetch and parse the ESA Sentinel-2 acquisition plans page.
    Returns a dict: {'S2A': [li, ...], 'S2B': [li, ...], 'S2C': [li, ...]}

    Robust against ESA site redesigns: uses <h4> headings to identify sections
    instead of CSS class names (which changed after migration to copernicus.eu).
    """
    tree = html.parse(ul.urlopen(url))
    root = tree.getroot()

    satellites = {"S2A": [], "S2B": [], "S2C": []}
    current = None

    satellite_map = {
        "sentinel-2a": "S2A",
        "sentinel-2b": "S2B",
        "sentinel-2c": "S2C",
    }

    for el in root.iter():
        if el.tag in ("h3", "h4"):
            text = (el.text_content() or "").strip().lower()
            current = None
            for key, sat in satellite_map.items():
                if key in text:
                    current = sat
                    break
        elif el.tag == "li" and current:
            satellites[current].append(el)

    for sat, items in satellites.items():
        print(f"  {sat}: {len(items)} KML link(s) found on page")

    return satellites


# ---------------------------------------------------------------------------
# KML link extraction
# ---------------------------------------------------------------------------

def parse_kml_elements(li_elements, url_kml_prefix):
    """
    Parse KML URLs from a list of <li> elements.

    Returns a dict mapping KML filename slug -> full URL.
    Handles both:
      - href ending in bare slug  (e.g. /documents/d/sentinel/s2c_mp_acq__kml_...)
      - href containing .kml      (legacy format)
    """
    kml_dict = {}

    for li in li_elements:
        for el in li.iter():
            href = el.get("href", "")
            if not href.startswith("/documents"):
                continue

            slug = href.split("/")[-1]

            # Accept slugs that look like acquisition plan filenames
            if "_mp_acq_" in slug or slug.endswith(".kml"):
                # Normalise: strip .kml suffix for consistent key handling
                key = slug.replace(".kml", "")
                kml_dict[key] = url_kml_prefix + href

    return kml_dict


# ---------------------------------------------------------------------------
# KML selection
# ---------------------------------------------------------------------------

def get_latest_kml(kml_dict):
    """
    Find the best available KML file from the given dict.

    Priority:
      1. A file whose time window contains today (start < today < end).
      2. Fallback: the file with the most recent end_date (handles ESA
         publishing delay where the new KML is not yet listed on the page).

    Date format in filenames is case-insensitive (handles both 't' and 'T').
    """
    today = datetime.datetime.now()
    best_active = None
    best_active_end = None
    best_fallback = None
    best_fallback_end = None

    for key in kml_dict:
        parts = key.split("_")
        if len(parts) < 2:
            continue
        try:
            start_str = parts[-2].upper().replace("T", "t")
            end_str = parts[-1].split(".")[0].upper().replace("T", "t")
            start_date = datetime.datetime.strptime(start_str, DATE_FORMAT)
            end_date = datetime.datetime.strptime(end_str, DATE_FORMAT)
        except (ValueError, IndexError):
            print(f"  WARNING: could not parse dates from key '{key}', skipping")
            continue

        if start_date < today < end_date:
            if best_active_end is None or end_date > best_active_end:
                best_active = key
                best_active_end = end_date
        else:
            if best_fallback_end is None or end_date > best_fallback_end:
                best_fallback = key
                best_fallback_end = end_date

    if best_active:
        print(f"  -> Active KML selected: {best_active}")
        return best_active

    if best_fallback:
        print(f"  -> No active KML found; using most recent available: {best_fallback}")
        return best_fallback

    return None


# ---------------------------------------------------------------------------
# Download and extraction
# ---------------------------------------------------------------------------

def download_and_extract_kml(satellite, file_url, output_filename, output_path, extract_area=False):
    """
    Download a .kml file and optionally extract AOI entries.

    Returns True on success, False on failure.
    """
    kml_file_path = os.path.join(output_path, output_filename + ".kml")

    try:
        ul.urlretrieve(file_url, filename=kml_file_path)
        print(f"  Downloaded: {file_url}")
    except Exception as exc:
        print(f"  ERROR downloading {file_url}: {exc}")
        return False

    if extract_area and satellite == "Sentinel-2":
        # Derive platform tag from output filename (S2A / S2B / S2C)
        platform_tag = output_filename[:3].upper()
        entries = extract_S2_entries(
            platform_tag,
            kml_file_path,
            output_filename + "_AOI.csv",
            output_path,
            POLYGON_WKT,
        )
        if not entries:
            print(f"  WARNING: No AOI entries extracted from {output_filename}")
            return False
        print(f"  AOI extraction successful: {output_filename}")

    return True


# ---------------------------------------------------------------------------
# CSV merge
# ---------------------------------------------------------------------------

def merge_aoi_files(directory, output_file):
    """
    Merge all *_AOI.csv files, remove entries older than today-2 days,
    add Publish Date (+3 days), sort by Acquisition Date.

    Returns True if output was written, False otherwise.
    """
    merged_data = []
    today = datetime.datetime.now().date()

    for filename in sorted(os.listdir(directory)):
        if not filename.endswith("_AOI.csv"):
            continue
        filepath = os.path.join(directory, filename)
        print(f"  Merging {filename} ...")
        try:
            df = pd.read_csv(filepath)
        except Exception as exc:
            print(f"  WARNING: could not read {filepath}: {exc}")
            continue

        df["Acquisition Date"] = pd.to_datetime(df["ObservationTimeStart"]).dt.date
        df = df[df["Acquisition Date"] >= today - timedelta(days=2)]

        if df.empty:
            continue

        df["Publish Date"] = df["Acquisition Date"] + timedelta(days=3)
        df = df[["Acquisition Date", "Publish Date", "OrbitRelative", "Platform"]]
        df.rename(columns={"OrbitRelative": "Orbit"}, inplace=True)
        merged_data.append(df)

    if merged_data:
        result_df = pd.concat(merged_data)
        result_df.sort_values(by="Acquisition Date", inplace=True)
        result_df.drop_duplicates(inplace=True)
        result_df.to_csv(output_file, index=False)
        print(f"  Merged output saved: {output_file}")
        return True

    print("  No valid AOI data found for merge.")
    return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("Fetching Sentinel-2 acquisition plan page ...")
    satellite_li = parse_acquisition_page(S2_URL)

    satellites = {
        "S2A": ("S2A_acquisition_plan", satellite_li["S2A"]),
        "S2B": ("S2B_acquisition_plan", satellite_li["S2B"]),
        "S2C": ("S2C_acquisition_plan", satellite_li["S2C"]),
    }

    results = {}

    for sat, (output_name, li_elements) in satellites.items():
        print(f"\nProcessing {sat} ...")
        kml_dict = parse_kml_elements(li_elements, URL_KML_PREFIX)
        print(f"  KML entries parsed: {list(kml_dict.keys())}")

        key = get_latest_kml(kml_dict)
        if not key:
            print(f"  No KML available for {sat}")
            results[sat] = False
            continue

        results[sat] = download_and_extract_kml(
            "Sentinel-2",
            kml_dict[key],
            output_name,
            STORAGE_PATH,
            extract_area=True,
        )

    print("\nMerging AOI CSV files ...")
    merge_ok = merge_aoi_files(STORAGE_PATH, "acquisitionplan.csv")

    print("\n**********************")
    for sat, ok in results.items():
        print(f"  {sat}: {'Success' if ok else 'no planned acquisitions or error'}")
    print(f"  Merge: {'Success' if merge_ok else 'Failed'}")

    if all(results.values()) and merge_ok:
        print("\nAll Sentinel-2 downloads and operations completed successfully.")
    else:
        print("\nCompleted with warnings (see above).")


if __name__ == "__main__":
    main()
