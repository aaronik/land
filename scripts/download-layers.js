'use strict';

const fs = require('fs');
const path = require('path');
const { fetchArcGISLayer, LAYERS, normalizeApn } = require('./layers');

const root = path.resolve(__dirname, '..');
const raw = path.join(root, 'data', 'raw');
const generated = path.join(root, 'data', 'generated');
fs.mkdirSync(raw, { recursive: true });
fs.mkdirSync(generated, { recursive: true });

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
  const manifest = { generatedAt: new Date().toISOString(), layers: {} };
  for (const name of names) {
    const config = LAYERS[name];
    if (!config) throw new Error(`Unknown layer: ${name}`);
    console.log(`Downloading ${config.name}…`);
    const data = await fetchArcGISLayer(config);
    fs.writeFileSync(path.join(raw, `${name}.geojson`), JSON.stringify(data));
    manifest.layers[name] = { source: config.url, featureCount: data.features.length, fields: config.fields };
    if (name === 'parcels') fs.writeFileSync(path.join(generated, 'apn-index.json'), JSON.stringify(parcelIndex(data.features)));
    console.log(`  ${data.features.length.toLocaleString()} features`);
  }
  fs.writeFileSync(path.join(generated, 'sources.json'), JSON.stringify(manifest, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
