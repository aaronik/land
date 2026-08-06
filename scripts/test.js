'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const required = ['index.html', 'assets/style.css', 'assets/app.js', 'data/parcels.json', 'scripts/refresh-data.js'];
const failures = required.filter(file => !fs.existsSync(path.join(root, file)));
if (!failures.length) {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/parcels.json')));
  if (data.type !== 'FeatureCollection') failures.push('data/parcels.json is not GeoJSON');
  if (!Array.isArray(data.features) || !data.features.length) failures.push('data/parcels.json has no parcel features');
  for (const feature of data.features || []) {
    if (!/^\d{3}-\d{3}-\d{3}$/.test(feature.properties?.APN || '')) failures.push(`invalid APN ${feature.properties?.APN}`);
    if (!Array.isArray(feature.properties?.records) || !feature.properties.records.length) failures.push(`missing records for ${feature.properties?.APN}`);
  }
}
if (failures.length) { console.error(failures.map(item => `- ${item}`).join('\n')); process.exit(1); }
console.log('Passed: site files and parcel GeoJSON are valid.');
