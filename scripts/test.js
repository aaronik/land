'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const required = ['index.html', 'assets/style.css', 'assets/app.source.js', 'data/parcels.json', 'data/generated/flood.pmtiles', 'data/generated/soils.pmtiles', 'data/generated/railroads.pmtiles', 'scripts/refresh-data.js'];
const failures = required.filter(file => !fs.existsSync(path.join(root, file)));
if (!failures.length) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/parcels.json')));
  if (data.type !== 'FeatureCollection') failures.push('data/parcels.json is not GeoJSON');
  if (!Array.isArray(data.features) || !data.features.length) failures.push('data/parcels.json has no parcel features');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'assets/app.source.js'), 'utf8');
  if (!app.includes('function separatedUnmappedListings()') || !app.includes('function separatedCoordinate(latLng, index, count)') || !app.includes('const radiusFeet = 100')) failures.push('Coincident unmapped MLS dots are not separated by a fixed geographic distance');
  if (!html.includes('parcelquest-warning')) failures.push('ParcelQuest warning dialog is missing');
  if (!app.includes('Research in ParcelQuest Lite')) failures.push('ParcelQuest parcel action is missing');
  if (!app.includes('localStorage')) failures.push('browser-local research cache is missing');
  if (!app.includes("id: 'road-labels'") || !app.includes("['get', 'ROADNAME']")) failures.push('County road name labels are missing');
  if (!app.includes("roads: ['roads', 'road-labels']")) failures.push('Road toggle does not control road labels');
  if (!html.includes('data-map-layer="railroads"')) failures.push('Railroad toggle is missing');
  if (!app.includes("railroads: ['railroad-casing', 'railroads', 'railroad-ties', 'railroad-labels']")) failures.push('Railroad toggle does not control all railroad layers');
  if (!app.includes("'line-color': '#e53935'") || !app.includes("'text-field': ['get', 'NAME']")) failures.push('Railroad styling or labels are missing');
  if (!app.includes("url.searchParams.set('v', new URL(import.meta.url).pathname.split('/').pop())")) failures.push('PMTiles URLs are not versioned by the application bundle');
  const vite = fs.readFileSync(path.join(root, 'vite.config.mjs'), 'utf8');
  for (const worker of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) if (!vite.includes(worker)) failures.push(`production worker asset is missing: ${worker}`);
  if (!app.includes("...(id === 'parcels' ? { promoteId: 'APN' } : {})")) failures.push('Parcel APNs are not promoted to feature IDs');
  if (!app.includes("['feature-state', 'selected']") || !app.includes("map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: selectedApn }")) failures.push('Parcel selection does not use feature state');
  if (app.includes("map.setFilter('parcel-selected'")) failures.push('Parcel selection still rebuilds the selected-layer filter');
  if (app.includes('/api/parcelquest')) failures.push('ParcelQuest must not be proxied');
  for (const feature of data.features || []) {
    if (!/^\d{3}-\d{3}-\d{3}$/.test(feature.properties?.APN || '')) failures.push(`invalid APN ${feature.properties?.APN}`);
    if (!Array.isArray(feature.properties?.records) || !feature.properties.records.length) failures.push(`missing records for ${feature.properties?.APN}`);
  }
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join('\n')); process.exit(1); }
console.log('Passed: site files and parcel GeoJSON are valid.');
