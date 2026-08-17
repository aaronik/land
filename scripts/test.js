'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const required = ['index.html', 'assets/style.css', 'assets/app.source.js', 'data/parcels.json', 'data/generated/flood.pmtiles', 'data/generated/soils.pmtiles', 'data/generated/huc12.pmtiles', 'data/generated/railroads.pmtiles', 'scripts/refresh-data.js'];
const failures = required.filter(file => !fs.existsSync(path.join(root, file)));
if (!failures.length) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/parcels.json')));
  if (data.type !== 'FeatureCollection') failures.push('data/parcels.json is not GeoJSON');
  if (!Array.isArray(data.features) || !data.features.length) failures.push('data/parcels.json has no parcel features');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'assets/app.source.js'), 'utf8');
  if (!app.includes('function separatedUnmappedListings()') || !app.includes('function separatedCoordinate(latLng, index, count)') || !app.includes('const radiusFeet = 100')) failures.push('Coincident unmapped MLS dots are not separated by a fixed geographic distance');
  if (!html.includes('Find an APN, address, or listing') || !app.includes('function recordMatchesSearch(') || !app.includes('function filteredMappedListings()') || !app.includes('function filteredUnmappedListings()') || !app.includes("addEventListener('search', findListings)")) failures.push('Expanded address and listing search is missing');
  if (!html.includes('parcelquest-warning')) failures.push('ParcelQuest warning dialog is missing');
  if (!app.includes('Research in ParcelQuest Lite')) failures.push('ParcelQuest parcel action is missing');
  if (!app.includes('localStorage')) failures.push('browser-local research cache is missing');
  if (!app.includes("id: 'road-labels'") || !app.includes("['get', 'ROADNAME']")) failures.push('County road name labels are missing');
  if (!app.includes("roads: ['roads', 'road-labels']")) failures.push('Road toggle does not control road labels');
  if (!html.includes('data-map-layer="railroads"')) failures.push('Railroad toggle is missing');
  if (!app.includes("railroads: ['railroad-casing', 'railroads', 'railroad-ties', 'railroad-labels']")) failures.push('Railroad toggle does not control all railroad layers');
  if (!html.includes('data-map-layer="huc12"')) failures.push('HUC-12 watershed toggle is missing');
  if (!app.includes("huc12: ['huc12-fill', 'huc12-lines', 'huc12-labels']") || !app.includes("'source-layer': 'huc12'")) failures.push('HUC-12 watershed layers are missing');
  if (!app.includes("'line-color': '#e53935'") || !app.includes("['get', 'SUBDIV']")) failures.push('Railroad styling or labels are missing');
  if (!app.includes("const TERRAIN_URL_PARAM = 'terrain'") || !app.includes("url.searchParams.set(TERRAIN_URL_PARAM, '1')") || !app.includes("applyTerrain(true, { updateUrl: false, animate: false })")) failures.push('3D terrain mode is not persisted in the URL');
  if (!app.includes("const PARCEL_URL_PARAM = 'parcel'") || !app.includes('url.searchParams.set(PARCEL_URL_PARAM, apn)') || !app.includes('restoreInitialSelectedParcel()')) failures.push('Selected parcel is not persisted in the URL');
  if (!app.includes("url.searchParams.set('v', new URL(import.meta.url).pathname.split('/').pop())")) failures.push('PMTiles URLs are not versioned by the application bundle');
  if (!app.includes('class MilesScaleControl') || !app.includes("this.container.textContent = `${Number(niceMiles.toPrecision(3))} mi`")) failures.push('Miles-only map distance scale is missing');
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
