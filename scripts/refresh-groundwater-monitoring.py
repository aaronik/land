#!/usr/bin/env python3
"""Build the small Siskiyou snapshot from public DWR station and measurement files."""
import argparse
import csv
import io
import json
import math
import re
import shutil
import tempfile
import urllib.request
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PERIODIC = ('https://data.cnra.ca.gov/dataset/dd9b15f5-6d08-4d8c-bace-37dc761a9c08/resource/'
            'c51e0af9-5980-4aa3-8965-e9ea494ad468/download/periodic_gwl_bulkdatadownload.zip')
CONTINUOUS = 'https://data.cnra.ca.gov/dataset/618c73fe-b28c-4399-a824-43d0278fe974/resource/'
FILES = {'gwl-stations.csv': '03967113-1556-4100-af2c-b16a4d41b9d0',
         'gwl-monthly.csv': '16f256f8-35a4-4cab-ae02-399a2914c282'}
SITE = re.compile(r'\d{6}N\d{7}W\d{3}')


def download(url, path):
    with urllib.request.urlopen(url, timeout=120) as source, path.open('wb') as target:
        shutil.copyfileobj(source, target)


def field(rows, names):
    if not set(names.split()).issubset(rows.fieldnames or []):
        raise ValueError(f'Unexpected DWR CSV columns: {rows.fieldnames}')
    return rows


def zip_rows(archive, file, names):
    with io.TextIOWrapper(archive.open(file), encoding='utf-8-sig', newline='') as stream:
        yield from field(csv.DictReader(stream), names)


def csv_rows(file, names):
    with file.open(encoding='utf-8-sig', newline='') as stream:
        yield from field(csv.DictReader(stream), names)


def number(text):
    try:
        value = float(text)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def report_id(text):
    text = text.strip().upper()
    return text if re.fullmatch(r'WCR\d{4}-\d+|[A-Z]?\d+', text) else ''


def station(code, lon, lat, **props):
    lon, lat = number(lon), number(lat)
    if not SITE.fullmatch(code) or lon is None or lat is None or not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return {'type': 'Feature', 'id': code, 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
            'properties': {'site': code, **props}}


def measurement(date, depth, quality):
    depth = number(depth)
    if depth is None:
        return None
    # Preserve local source time without implying UTC or a DST conversion.
    return [datetime.fromisoformat(date).isoformat(sep=' '), depth, quality]


def build(archive, directory):
    stations, series, continuous_ids = {}, {}, {}
    metadata = archive.read('metadata.txt').decode('utf-8-sig')
    extract = re.search(r'^data_extract_date: (\d{4}-\d{2}-\d{2})', metadata, re.M).group(1)
    for row in zip_rows(archive, 'stations.csv', 'county_name site_code longitude latitude well_name swn basin_name basin_code well_depth well_use well_type wcr_no monitoring_program'):
        if row['county_name'].lower() != 'siskiyou':
            continue
        code = row['site_code']
        feature = station(code, row['longitude'], row['latitude'], name=row['well_name'], swn=row['swn'],
                          basin=row['basin_name'], basinCode=row['basin_code'], depth=number(row['well_depth']),
                          use=row['well_use'], wellType=row['well_type'], report=report_id(row['wcr_no']),
                          program=row['monitoring_program'])
        if feature:
            if code in stations:
                raise ValueError(f'Duplicate periodic station: {code}')
            stations[code] = feature
            series[code] = {'periodic': [], 'automated': [], 'monthly': [], 'screens': []}
    if not stations:
        raise ValueError('No Siskiyou periodic monitoring stations found')
    for row in csv_rows(directory / 'gwl-stations.csv', 'COUNTY_NAME STATION SITE_CODE LONGITUDE LATITUDE WELL_NAME STNAME BASIN_NAME BASIN_CODE WELL_DEPTH WELL_USE WELL_TYPE WCR_NO'):
        if row['COUNTY_NAME'].lower() != 'siskiyou':
            continue
        code = row['SITE_CODE']
        if code not in stations:
            feature = station(code, row['LONGITUDE'], row['LATITUDE'], name=row['WELL_NAME'] or row['STNAME'],
                              swn=row['STATION'], basin=row['BASIN_NAME'], basinCode=row['BASIN_CODE'],
                              depth=number(row['WELL_DEPTH']), use=row['WELL_USE'],
                              wellType=row['WELL_TYPE'], report=report_id(row['WCR_NO']), program='')
            if not feature:
                continue
            stations[code] = feature
            series[code] = {'periodic': [], 'automated': [], 'monthly': [], 'screens': []}
        props = stations[code]['properties']
        props['swn'] = props['swn'] or row['STATION']
        props['report'] = props['report'] or report_id(row['WCR_NO'])
        continuous_ids[row['STATION']] = code
    for row in zip_rows(archive, 'perforations.csv', 'site_code top_prf_int bot_prf_int'):
        if row['site_code'] not in series:
            continue
        top, bottom = number(row['top_prf_int']), number(row['bot_prf_int'])
        if top is not None or bottom is not None:
            series[row['site_code']]['screens'].append([top, bottom])
    for row in zip_rows(archive, 'measurements.csv', 'site_code msmt_date gse_gwe wlm_qa_desc source'):
        code, source = row['site_code'], row['source']
        if code not in series or row['wlm_qa_desc'] == 'Missing':
            continue
        kind = {'DWR_DISCRETE': 'periodic', 'DWR_CONTINUOUS': 'automated'}.get(source)
        if kind is None:
            raise ValueError(f'Unrecognized DWR measurement source: {source}')
        entry = measurement(row['msmt_date'], row['gse_gwe'], row['wlm_qa_desc'])
        if entry:
            series[code][kind].append(entry)
    for row in csv_rows(directory / 'gwl-monthly.csv', 'STATION MSMT_DATE GSE_WSE GSE_WSE_QC'):
        code, quality = continuous_ids.get(row['STATION']), row['GSE_WSE_QC']
        if code is not None and quality not in {'151', '175', '201', '255'}:
            entry = measurement(row['MSMT_DATE'], row['GSE_WSE'], quality)
            if entry:
                series[code]['monthly'].append(entry)
    kinds = ('periodic', 'automated', 'monthly')
    totals = dict.fromkeys(kinds, 0)
    for code, feature in stations.items():
        data = series[code]
        props = feature['properties']
        for kind in kinds:
            data[kind].sort(key=lambda entry: entry[0])
            totals[kind] += len(data[kind])
        props['readingCount'] = sum(len(data[kind]) for kind in kinds)
    if not totals['periodic'] or not totals['monthly']:
        raise ValueError(f'Incomplete measurement downloads: {totals}')
    features = [stations[code] for code in sorted(stations)]
    # Metadata and histories share a key; WCR references come only from DWR.
    histories = {code: {**stations[code]['properties'], **series[code]} for code in sorted(stations)}
    print(f'{len(stations)} stations, {sum(bool(f["properties"]["readingCount"]) for f in features)} with usable depths; {totals}; periodic extract {extract}')
    return {'type': 'FeatureCollection', 'features': features}, {'extract': extract, 'stations': histories}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, help='Use already downloaded periodic.zip, gwl-stations.csv, and gwl-monthly.csv')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as temp:
        directory = args.input_dir or Path(temp)
        if not args.input_dir:
            print('Downloading public DWR periodic and continuous/monthly archives…', flush=True)
            download(PERIODIC, directory / 'periodic.zip')
            for file, resource in FILES.items():
                download(f'{CONTINUOUS}{resource}/download/{file}', directory / file)
        with zipfile.ZipFile(directory / 'periodic.zip') as archive:
            points, histories = build(archive, directory)
        for name, data in [('groundwater-monitoring.geojson', points), ('groundwater-monitoring-history.json', histories)]:
            target = ROOT / 'data' / name
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n', encoding='utf-8')
            temporary.replace(target)


if __name__ == '__main__':
    main()
