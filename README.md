[![Run acquisition](https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/actions/workflows/run_acquisition.yml/badge.svg)](https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/actions/workflows/run_acquisition.yml)[![GitHub commit](https://img.shields.io/github/last-commit/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting)](https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/commits/main)

# Sentinel-2 Acquisition Plan Harvesting and Extraction

This project is a toolset for harvesting and processing [ESA Sentinel-2 acquisition plans](https://sentinels.copernicus.eu/web/sentinel/copernicus/sentinel-2/acquisition-plans), extracting relevant metadata of upcoming satellite passes for a given Area of Interest (AOI), and exporting the data into CSV file. The scripts allow users to extract acquisition data from Sentinel-2 .kml files, define an AOI polygon, and filter acquisition dates. Goal: to use it in https://github.com/swisstopo/topo-satromo/ context to show end users when the next satellite product will be available see [Example of HISTORIC and FUTURE S2 data](https://davidoesch.github.io/Sentinel-2-Acquisition-Plan-Harvesting/calendar.html).

It also tracks how fast acquired scenes actually show up in the swisstopo STAC catalog: see the [Sentinel-2 catalog latency map](https://davidoesch.github.io/Sentinel-2-Acquisition-Plan-Harvesting/latency/).

## Acquisition Plan Sentinel-2 Switzerland
| Acquisition Date   | Publish Date   |   Orbit | Platform   | Coverage                    |
|:-------------------|:---------------|--------:|:-----------|:----------------------------|
| 2026-11-07         | 2026-11-10     |       8 | S2B        | ![Coverage](assets/8.png)   |
| 2026-11-08         | 2026-11-11     |      65 | S2A        | ![Coverage](assets/65.png)  |
| 2026-11-08         | 2026-11-11     |      22 | S2B        | ![Coverage](assets/22.png)  |
| 2026-11-09         | 2026-11-12     |     108 | S2C        | ![Coverage](assets/108.png) |
| 2026-11-11         | 2026-11-14     |     108 | S2A        | ![Coverage](assets/108.png) |
| 2026-11-12         | 2026-11-15     |       8 | S2C        | ![Coverage](assets/8.png)   |
| 2026-11-13         | 2026-11-16     |      22 | S2C        | ![Coverage](assets/22.png)  |
| 2026-11-14         | 2026-11-17     |       8 | S2A        | ![Coverage](assets/8.png)   |
| 2026-11-15         | 2026-11-18     |      22 | S2A        | ![Coverage](assets/22.png)  |
| 2026-11-16         | 2026-11-19     |      65 | S2C        | ![Coverage](assets/65.png)  |

## Features

- **Harvest Sentinel-2 Acquisition Plans**: Automatically download and process Sentinel-2 acquisition plan files from the Sentinel ESA website.
- **AOI-Based Extraction**: Extract metadata within a defined Area of Interest (AOI) from Sentinel-2 acquisition plans (.kml files). (default: Switzerland)
- **Robust harvesting**: Falls back to the next KML when the newest one is not yet public (HTTP 404), retries URLs with a trailing `:`, and never fails the daily run.
- **CSV Export**: Merge S2A, S2B and S2C acquisition plans into one CSV file, filter out dates older than today, and automatically calculate publish dates (assuming a 3 day delay of https://github.com/swisstopo/topo-satromo/).

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Python 3.10+ (CI uses 3.12)
- `lxml` library
- `pandas` library
- `shapely` library
- `h3`, `requests`, `flask` (only for the latency map)

Install the required dependencies using `pip`:

```
pip install -r requirements.txt
```
### Installation
1. Clone the repository to your local machine:

```
git clone https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting.git
cd Sentinel-2-Acquisition-Plan-Harvesting
```
2. Ensure the necessary environment setup by installing dependencies.

3. Keep the two scripts (`get_acquisition_plans.py` and `extract_acquisition_plans_s2.py`) in the same directory.

## Usage
### 1. Define the AOI
Define the AOI by changing the 'POLYGON_WKT' in 'get_acquisition_plans.py' to your needs (Default is Switzerland)

### 2. Running the Acquisition Harvesting Script
The 'get_acquisition_plans.py' script downloads the latest acquisition plan files from the Sentinel ESA website and processes the Area of Interest (AOI) defined in the script.
```
python get_acquisition_plans.py
```
This script will:

- Download the latest .kml files for Sentinel-2A, Sentinel-2B and Sentinel-2C.
- Extract data for the polygons for the defined AOI using  'extract_acquisition_plans_s2.py'
- Merge all the acquisition files into a single CSV (acquisitionplan.csv), removing acquisition dates older than two days ago, and delete the intermediate `*_plan.kml` / `*_AOI.csv` files.

By default, this script processes an example AOI polygon and saves the output in a CSV file. You can customize the AOI polygon by updating the 'polygon_wkt' variable in the script.

CSV files from different acquisition plans are automatically merged into one output CSV, filtered to remove dates older than today, and add a calculated publish date.

## Availability calendar

[`calendar.html`](https://davidoesch.github.io/Sentinel-2-Acquisition-Plan-Harvesting/calendar.html) shows per day, for the
swissEO S2-SR **v200** collection:

- available scenes (thumbnail, local acquisition time, catalog latency, links to map.geo.admin, the STAC Browser and the metadata) from the [STAC API](https://data.geo.admin.ch/api/stac/v1/collections/ch.swisstopo.swisseo_s2-sr_v200)
- days without imagery (cloudy / no candidate scene / tile upload incomplete) from [`dates_with_no_imagery.csv`](https://data.geo.admin.ch/ch.swisstopo.swisseo_s2-sr_v200/dates_with_no_imagery.csv)
- planned acquisitions with orbit coverage from `acquisitionplan.csv`, with the expected publication time (median latency of the last 30 days)

Options: `?lang=de` (default English), `?embed=1` (no header, stats or side panel, for iframes), `#2026-11` / `#2026-11-04` to open a month or day.
Everything is fetched by the browser, so the page works as a static GitHub Pages site and under Flask.

## Sentinel-2 catalog latency map

`latency/` holds a Flask and Leaflet app that shows how long Sentinel-2 scenes take to appear in the
[swisstopo STAC collection `ch.swisstopo.swisseo_s2-sr_v200`](https://data.geo.admin.ch/browser/index.html#/collections/ch.swisstopo.swisseo_s2-sr_v200),
per H3 hexagon.

How it works (`latency/latency_loader.py`):

- Queries the STAC `/search` endpoint for scene footprints, acquisition time (`properties.datetime`) and catalog creation time (`properties.created`). Latency = created − datetime.
- Splits each footprint into H3 resolution 7 sample cells (~5 km²), clipped to the Switzerland AOI. Each sample cell keeps the scene that published it first on that acquisition date.
- Stores the median latency of the sample cells per H3 resolution 5 hexagon (~250 km²), on the acquisition date only, in SQLite (`latency/latency.sqlite`, not committed).
- Scenes published more than 240 h after acquisition (reprocessing / backfill) are listed but left out of the map. The default start date is 2026-06-29, when near-real-time production of v200 began; older items were bulk-reprocessed.
- No imagery is downloaded and no cloud masking is applied.

```
python latency/latency_loader.py                                  # 2026-06-29 .. today
python latency/latency_loader.py --date 2026-11-05                # one date
python latency/latency_loader.py --start 2026-10-01 --end 2026-10-31
python latency/latency_loader.py --export latency/data/latency.json
python latency/app.py                                             # http://127.0.0.1:5000
```

The Flask app serves the whole site with the same URLs as GitHub Pages: `/calendar.html`, `/latency/`.

The daily GitHub Action rebuilds `latency/data/latency.json`, so the same page also runs as a static site on GitHub Pages
(`/latency/`). Under Flask the data file is built live from SQLite, and there is a JSON API:
`/api/calendar?start=&end=` (per-day status merging the local scene DB, the no-imagery CSV and the plan), `/api/dates`, `/api/latency?date=`,
`/api/summary?start=&end=`, `/api/timeseries?h3_cell=`, `/api/scenes?start=&end=`.
Options: `--region <geojson>` / `--no-region`, `--output-resolution`, `--sample-resolution`, `--stac-url`, `--collection`, `--mission`
(the loader works with any STAC collection that has `created` timestamps, e.g. a Sentinel-1 one).

## Acknowledgments
Inspired by [hevgyrt's Sentinel-2 harvesting tool](https://github.com/hevgyrt/harvest_sentinel_acquisition_plans/).
The latency map idea was inspired by [thoyo/sentinel-latency](https://github.com/thoyo/sentinel-latency); the code here is an independent implementation.



