'use strict';

const fs = require('fs');
const path = require('path');
const { fetchArcGISLayer, fetchSoilLayer, LAYERS, normalizeApn } = require('./layers');

const root = path.resolve(__dirname, '..');
const raw = path.join(root, 'data', 'raw');
const generated = path.join(root, 'data', 'generated');
fs.mkdirSync(raw, { recursive: true });
fs.mkdirSync(generated, { recursive: true });

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

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(LAYERS);
  const manifestPath = path.join(generated, 'sources.json');
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { layers: {} };
  const manifest = { generatedAt: new Date().toISOString(), layers: requested.length ? { ...previous.layers } : {} };
  for (const name of names) {
    const config = LAYERS[name];
    if (!config) throw new Error(`Unknown layer: ${name}`);
    console.log(`Downloading ${config.name}…`);
    const sourceConfig = name === 'groundwater_wells' ? { ...config, fields: config.fields.filter(field => !field.startsWith('Nearby')) } : config;
    const data = sourceConfig.type === 'wfs-gml' ? await fetchSoilLayer(sourceConfig) : await fetchArcGISLayer(sourceConfig);
    if (name === 'groundwater_wells') addNearbyWellSummaries(data);
    fs.writeFileSync(path.join(raw, `${name}.geojson`), JSON.stringify(data));
    manifest.layers[name] = { source: config.url, featureCount: data.features.length, fields: config.fields };
    if (name === 'parcels') fs.writeFileSync(path.join(generated, 'apn-index.json'), JSON.stringify(parcelIndex(data.features)));
    console.log(`  ${data.features.length.toLocaleString()} features`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
