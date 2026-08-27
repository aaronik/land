'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { fetchArcGISLayer, fetchSoilLayer, LAYERS, normalizeApn } = require('./layers');

const root = path.resolve(__dirname, '..');
const raw = path.join(root, 'data', 'raw');
const generated = path.join(root, 'data', 'generated');
fs.mkdirSync(raw, { recursive: true });
fs.mkdirSync(generated, { recursive: true });

function decodeXml(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function classifyGeology(label) {
  const value = String(label || '').toLowerCase().replace(/[^a-z]/g, '');
  if (/^(qv|tv|trpv|tob|tub|trb|qba)/.test(value) || /basalt|andesite|rhyolite|volcan|tuff/.test(value)) return 'Volcanic rock';
  if (/^(q|qal|qoa|qpc|qs|qrv|qhv)/.test(value) || /alluv|colluv|glacial|sand|gravel|sediment/.test(value)) return 'Unconsolidated deposits';
  if (/^(gr|gb|g[dr]|dior|gabb)/.test(value) || /granite|granodiorite|diorite|gabbro|pluton/.test(value)) return 'Intrusive igneous rock';
  if (/^(sch|m|mv|pz|trpz|um)/.test(value) || /schist|gneiss|marble|quartzite|metamorph/.test(value)) return 'Metamorphic rock';
  if (/^(jss|kjfs|ku|so|c|j|ts|tu|jm)/.test(value) || /shale|sandstone|limestone|conglomerate|sedimentary/.test(value)) return 'Sedimentary rock';
  return 'Other mapped geologic unit';
}

function parseUsgsGeologyGml(xml) {
  const features = [];
  for (const member of xml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)) {
    const body = member[1];
    const property = field => decodeXml(body.match(new RegExp(`<ms:${field}>([\\s\\S]*?)<\\/ms:${field}>`))?.[1]?.trim() || '');
    const polygons = [];
    for (const polygon of body.matchAll(/<gml:Polygon>[\s\S]*?<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>[\s\S]*?<\/gml:Polygon>/g)) {
      const values = polygon[1].trim().split(/\s+/).map(Number);
      const ring = [];
      for (let index = 0; index + 1 < values.length; index += 2) if (Number.isFinite(values[index]) && Number.isFinite(values[index + 1])) ring.push([values[index + 1], values[index]]);
      if (ring.length >= 4) polygons.push([ring]);
    }
    if (!polygons.length) continue;
    const sgmcLabel = property('sgmc_label');
    features.push({ type: 'Feature', geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons }, properties: { state: property('state'), orig_label: property('orig_label'), sgmc_label: sgmcLabel, unit_link: property('unit_link'), material_class: classifyGeology(sgmcLabel) } });
  }
  return { type: 'FeatureCollection', features };
}

async function fetchUsgsGeology(config) {
  const [west, south, east, north] = config.bbox.split(',').map(Number);
  const params = new URLSearchParams({ service: 'WFS', version: '1.1.0', request: 'GetFeature', typeName: 'Lithology', bbox: `${south},${west},${north},${east},EPSG:4326`, CQL_FILTER: "state='CA'" });
  const response = await fetch(`${config.url}?${params}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${config.name}`);
  const data = parseUsgsGeologyGml(await response.text());
  const tablesDirectory = path.join(os.tmpdir(), 'shasta-land-sgmc-tables');
  const unitsPath = path.join(tablesDirectory, 'SGMC_Units.csv');
  const lithologyPath = path.join(tablesDirectory, 'SGMC_Lithology.csv');
  if (!fs.existsSync(unitsPath) || !fs.existsSync(lithologyPath)) {
    const archive = path.join(os.tmpdir(), 'shasta-land-sgmc-tables.zip');
    const tablesResponse = await fetch('https://www.sciencebase.gov/catalog/file/get/5888bf4fe4b05ccb964bab9d?name=USGS_SGMC_Tables_CSV.zip');
    if (!tablesResponse.ok) throw new Error('Unable to download USGS SGMC companion tables');
    fs.writeFileSync(archive, Buffer.from(await tablesResponse.arrayBuffer()));
    fs.mkdirSync(tablesDirectory, { recursive: true });
    execFileSync('unzip', ['-jo', archive, 'USGS_SGMC_Tables_CSV/SGMC_Units.csv', 'USGS_SGMC_Tables_CSV/SGMC_Lithology.csv', '-d', tablesDirectory]);
  }
  const parseCsv = file => {
    const [header, ...rows] = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const fields = header.split(',');
    return rows.map(row => {
      const values = []; let value = '', quoted = false;
      for (let index = 0; index < row.length; index++) { const char = row[index]; if (char === '"') { if (quoted && row[index + 1] === '"') { value += char; index++; } else quoted = !quoted; } else if (char === ',' && !quoted) { values.push(value); value = ''; } else value += char; }
      values.push(value); return Object.fromEntries(fields.map((field, index) => [field, values[index] || '']));
    });
  };
  const units = new Map(parseCsv(unitsPath).map(unit => [unit.UNIT_LINK, unit]));
  const lithology = new Map();
  for (const record of parseCsv(lithologyPath)) if (record.LITH_RANK === 'Major' && !lithology.has(record.UNIT_LINK)) lithology.set(record.UNIT_LINK, record.LOW_LITH || record.TOTAL_LITH);
  for (const feature of data.features) {
    const unit = units.get(feature.properties.unit_link) || {};
    Object.assign(feature.properties, { unit_name: unit.UNIT_NAME || '', unit_age: unit.UNIT_AGE || '', unit_description: unit.UNITDESC || '', lithology: lithology.get(feature.properties.unit_link) || '' });
  }
  return data;
}

function milesBetween([lon1, lat1], [lon2, lat2]) {
  const radians = Math.PI / 180;
  const latDistance = (lat2 - lat1) * radians;
  const lonDistance = (lon2 - lon1) * radians;
  const a = Math.sin(latDistance / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(lonDistance / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function numberRange(features, field) {
  const values = features.map(feature => Number(feature.properties?.[field])).filter(Number.isFinite);
  return values.length ? [Math.min(...values), Math.max(...values)] : [null, null];
}

function addNearbyWellSummaries(data) {
  const cellSize = 0.025;
  const located = data.features.filter(feature => feature.geometry?.type === 'Point' && feature.geometry.coordinates.every(Number.isFinite));
  const cells = new Map();
  for (const feature of located) {
    const [lon, lat] = feature.geometry.coordinates;
    const key = `${Math.floor(lon / cellSize)},${Math.floor(lat / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(feature);
  }
  for (const feature of located) {
    const [lon, lat] = feature.geometry.coordinates;
    const x = Math.floor(lon / cellSize), y = Math.floor(lat / cellSize);
    const nearby = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const candidate of cells.get(`${x + dx},${y + dy}`) || []) {
        if (milesBetween(feature.geometry.coordinates, candidate.geometry.coordinates) <= 1) nearby.push(candidate);
      }
    }
    const depths = nearby.map(candidate => Number(candidate.properties.TotalCompletedDepth || candidate.properties.TotalDrillDepth)).filter(Number.isFinite);
    const [staticMin, staticMax] = numberRange(nearby, 'StaticWaterLevel');
    const gpm = nearby.filter(candidate => candidate.properties.WellYieldUnitofMeasure === 'GPM');
    const [yieldMin, yieldMax] = numberRange(gpm, 'WellYield');
    const newest = nearby.map(candidate => Number(candidate.properties.DateWorkEnded)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    Object.assign(feature.properties, {
      NearbyReportCount: nearby.length,
      NearbyMedianDepthFt: median(depths),
      NearbyStaticLevelMinFt: staticMin,
      NearbyStaticLevelMaxFt: staticMax,
      NearbyYieldMinGpm: yieldMin,
      NearbyYieldMaxGpm: yieldMax,
      NearbyNewestDate: newest ? new Date(newest).toISOString().slice(0, 10) : ''
    });
  }
  return data;
}

function coordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

function parcelIndex(features) {
  const index = {};
  for (const feature of features) {
    const apn = normalizeApn(feature.properties?.APN);
    const points = coordinates(feature.geometry);
    if (!apn || !points.length) continue;
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    index[apn] = {
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      acres: Number(feature.properties?.Acres) || null
    };
  }
  return index;
}

function placeIndex(features, nameField, type) {
  const places = [];
  for (const feature of features) {
    const name = String(feature.properties?.[nameField] || '').trim();
    const geometry = feature.geometry;
    if (!name || !geometry) continue;
    const points = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'MultiPoint' ? geometry.coordinates : coordinates(geometry);
    const valid = points.filter(point => point?.length >= 2 && point.every(Number.isFinite));
    if (!valid.length) continue;
    const xs = valid.map(point => point[0]), ys = valid.map(point => point[1]);
    places.push({ name, type, center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  return places;
}

function mergePlaceIndexes(...indexes) {
  return indexes.flat().sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
}

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(LAYERS);
  const manifestPath = path.join(generated, 'sources.json');
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { layers: {} };
  const manifest = { generatedAt: new Date().toISOString(), layers: requested.length ? { ...previous.layers } : {} };
  const placeIndexes = [];
  for (const name of names) {
    const config = LAYERS[name];
    if (!config) throw new Error(`Unknown layer: ${name}`);
    console.log(`Downloading ${config.name}…`);
    const sourceConfig = name === 'groundwater_wells' ? { ...config, fields: config.fields.filter(field => !field.startsWith('Nearby')) } : config;
    const data = sourceConfig.type === 'wfs-gml' ? await fetchSoilLayer(sourceConfig) : sourceConfig.type === 'usgs-geology-wfs' ? await fetchUsgsGeology(sourceConfig) : await fetchArcGISLayer(sourceConfig);
    if (name === 'groundwater_wells') addNearbyWellSummaries(data);
    if (name === 'waterbodies') placeIndexes.push(placeIndex(data.features, 'GNIS_NAME', 'lake or reservoir'));
    if (name === 'summits') placeIndexes.push(placeIndex(data.features, 'gaz_name', 'summit'));
    if (name === 'towns') placeIndexes.push(placeIndex(data.features, 'gaz_name', 'town'));
    fs.writeFileSync(path.join(raw, `${name}.geojson`), JSON.stringify(data));
    manifest.layers[name] = { source: config.url, featureCount: data.features.length, fields: config.fields };
    if (name === 'parcels') fs.writeFileSync(path.join(generated, 'apn-index.json'), JSON.stringify(parcelIndex(data.features)));
    console.log(`  ${data.features.length.toLocaleString()} features`);
  }
  if (placeIndexes.length) {
    const indexPath = path.join(generated, 'place-index.json');
    const replacedTypes = new Set(placeIndexes.flat().map(place => place.type));
    const existing = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
    fs.writeFileSync(indexPath, JSON.stringify(mergePlaceIndexes(existing.filter(place => !replacedTypes.has(place.type)), ...placeIndexes)));
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
