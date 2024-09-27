# Sentinel-2 Acquisition Plan Harvesting and Extraction

This project is a toolset for harvesting and processing [ESA Sentinel-2 acquisition plans](https://sentinel.esa.int/web/sentinel/copernicus/sentinel-2/acquisition-plans), extracting relevant metadata of upcoming satellite passes for a given Area of Interest (AOI), and exporting the data into CSV file. The scripts allow users to extract acquisition data from Sentinel-2 .kml files, define an AOI polygon, and filter acquisition dates. Goal: to use it in https://github.com/swisstopo/topo-satromo/ context to show end users when the next satellite product will be available.

## Features

- **Harvest Sentinel-2 Acquisition Plans**: Automatically download and process Sentinel-2 acquisition plan files from the Sentinel ESA website.
- **AOI-Based Extraction**: Extract metdata within a defined Area of Interest (AOI) from Sentinel-2 acquisition plans (.kml files).
- **CSV Export**: Merge S2A and S2B  acquisition plans into one CSV file, filter out dates older than today, and automatically calculate publish dates (assuming a 3 day delay of https://github.com/swisstopo/topo-satromo/).

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Python 3.10+
- `lxml` library
- `pandas` library
- `shapely` library

Install the required dependencies using `pip`:

```
pip install lxml pandas shapely
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
Define the AOI by changing the 'POLYGON_WKT' in 'get_acquisition.py' to your needs

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


