'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const required = ['index.html', 'assets/style.css', 'assets/app.source.js', 'assets/vendor/maplibre/maplibre-gl-worker.mjs', 'data/parcels.json', 'scripts/refresh-data.js'];
const failures = required.filter(file => !fs.existsSync(path.join(root, file)));
if (!failures.length) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/parcels.json')));
  if (data.type !== 'FeatureCollection') failures.push('data/parcels.json is not GeoJSON');
  if (!Array.isArray(data.features) || !data.features.length) failures.push('data/parcels.json has no parcel features');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'assets/app.source.js'), 'utf8');
  if (!html.includes('parcelquest-warning')) failures.push('ParcelQuest warning dialog is missing');
  if (!app.includes('Research in ParcelQuest Lite')) failures.push('ParcelQuest parcel action is missing');
  if (!app.includes('localStorage')) failures.push('browser-local research cache is missing');
  if (!app.includes('if (!map.getStyle()) {') || !app.includes('setTimeout(initializeMapLayers, 50);')) failures.push('official map layers need a style readiness retry');
  if (app.includes('Promise.all([')) failures.push('sales data must not wait for the parcel search index');
  if (!app.includes("fetch('data/parcels.json')") || !app.includes("fetch('data/generated/apn-index.json')")) failures.push('map data startup fetches are missing');
  const vite = fs.readFileSync(path.join(root, 'vite.config.mjs'), 'utf8');
  if (!vite.includes("fileName: 'assets/maplibre-gl-worker.mjs'") || !vite.includes("fileName: 'assets/maplibre-gl-shared.mjs'")) failures.push('production MapLibre worker assets are missing');
  if (app.includes('/api/parcelquest')) failures.push('ParcelQuest must not be proxied');
  for (const feature of data.features || []) {
    if (!/^\d{3}-\d{3}-\d{3}$/.test(feature.properties?.APN || '')) failures.push(`invalid APN ${feature.properties?.APN}`);
    if (!Array.isArray(feature.properties?.records) || !feature.properties.records.length) failures.push(`missing records for ${feature.properties?.APN}`);
  }
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join('\n')); process.exit(1); }
console.log('Passed: site files and parcel GeoJSON are valid.');
