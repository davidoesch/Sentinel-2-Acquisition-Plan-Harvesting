[![Run acquisition](https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/actions/workflows/run_acquisition.yml/badge.svg)](https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/actions/workflows/run_acquisition.yml)[![GitHub commit](https://img.shields.io/github/last-commit/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting)](https://github.com/davidoesch/Sentinel-2-Acquisition-Plan-Harvesting/commits/main)

# Sentinel-2 Acquisition Plan Harvesting and Extraction

This project is a toolset for harvesting and processing [ESA Sentinel-2 acquisition plans](https://sentinel.esa.int/web/sentinel/copernicus/sentinel-2/acquisition-plans), extracting relevant metadata of upcoming satellite passes for a given Area of Interest (AOI), and exporting the data into CSV file. The scripts allow users to extract acquisition data from Sentinel-2 .kml files, define an AOI polygon, and filter acquisition dates. Goal: to use it in https://github.com/swisstopo/topo-satromo/ context to show end users when the next satellite product will be available see [Example of HISTORIC and FUTURE S2 data](https://davidoesch.github.io/Sentinel-2-Acquisition-Plan-Harvesting/calendar.html).

## Acquisition Plan Sentinel-2 Switzerland
| Acquisition Date   | Publish Date   |   Orbit | Platform   | Coverage                    |
|:-------------------|:---------------|--------:|:-----------|:----------------------------|
| 2025-11-03         | 2025-11-06     |      65 | S2A        | ![Coverage](assets/65.png)  |
| 2025-11-04         | 2025-11-07     |     108 | S2C        | ![Coverage](assets/108.png) |
| 2025-11-06         | 2025-11-09     |     108 | S2A        | ![Coverage](assets/108.png) |
| 2025-11-07         | 2025-11-10     |       8 | S2C        | ![Coverage](assets/8.png)   |
| 2025-11-08         | 2025-11-11     |      22 | S2C        | ![Coverage](assets/22.png)  |
| 2025-11-09         | 2025-11-12     |       8 | S2A        | ![Coverage](assets/8.png)   |
| 2025-11-10         | 2025-11-13     |      22 | S2A        | ![Coverage](assets/22.png)  |
| 2025-11-11         | 2025-11-14     |      65 | S2C        | ![Coverage](assets/65.png)  |
| 2025-11-13         | 2025-11-16     |      65 | S2A        | ![Coverage](assets/65.png)  |
| 2025-11-14         | 2025-11-17     |     108 | S2C        | ![Coverage](assets/108.png) |
| 2025-11-16         | 2025-11-19     |     108 | S2A        | ![Coverage](assets/108.png) |
| 2025-11-17         | 2025-11-20     |       8 | S2C        | ![Coverage](assets/8.png)   |

## Features

- **Harvest Sentinel-2 Acquisition Plans**: Automatically download and process Sentinel-2 acquisition plan files from the Sentinel ESA website.
- **AOI-Based Extraction**: Extract metadata within a defined Area of Interest (AOI) from Sentinel-2 acquisition plans (.kml files). (default: Switzerland)
- **CSV Export**: Merge S2A and S2B  acquisition plans into one CSV file, filter out dates older than today, and automatically calculate publish dates (assuming a 3 day delay of https://github.com/swisstopo/topo-satromo/).

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Python 3.9+
- `lxml` library
- `pandas` library
- `shapely` library

Install the required dependencies using `pip`:

```
pip install -r requirements.txt
```
### Installation
1. Clone the repository to your local machine:

```
git clone https://github.com/yourusername/sentinel2-acquisition-harvester.git
cd sentinel2-acquisition-harvester
```
2. Ensure the necessary environment setup by installing dependencies.

3. Place the two scripts (`get_acquisition.py` and `extract_acquisition_plans_s2.py`) in the same directory.

## Usage
### 1. Define the AOI
Define the AOI by changing the 'POLYGON_WKT' in 'get_acquisition.py' to your needs (Default is Switzerland)

### 2. Running the Acquisition Harvesting Script
The 'get_acquisition.py' script downloads the latest acquisition plan files from the Sentinel ESA website and processes the Area of Interest (AOI) defined in the script.
```
python get_acquisition.py
```
This script will:

- Download the latest .kml files for Sentinel-2A and Sentinel-2B.
- Extract data for the polygons for the defined AOI using  'extract_acquisition_plans_s2.py'
- Merge all the acquisition files into a single CSV (acquisitionplan.csv), removing acquisition dates older than today.

By default, this script processes an example AOI polygon and saves the output in a CSV file. You can customize the AOI polygon by updating the 'polygon_wkt' variable in the script.

CSV files from different acquisition plans are automatically merged into one output CSV, filtered to remove dates older than today, and add a calculated publish date.

## Acknowledgments
Inspired by [hevgyrt's Sentinel-2 harvesting tool](https://github.com/hevgyrt/harvest_sentinel_acquisition_plans/).



