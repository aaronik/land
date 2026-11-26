#!/usr/bin/env node
// Publish only fields needed for screening; never request customer or address data.
const { rename, writeFile } = require('node:fs/promises');
const path = require('node:path');

const cec = 'https://services3.arcgis.com/bWPjFyq029ChCGur/arcgis/rest/services/ElectricLoadServingEntities_';
const envelope = { geometry: '-123.75,41.15,-121.4,42.02', geometryType: 'esriGeometryEnvelope', inSR: '4326' };
// Happy Camp's source polygon is meter-sized, not a defensible district boundary.
const districts = ['Lake Shastina Community Services District', 'McCloud Community Services District', 'Tennant Community Services District'];
const feeds = [
  { key: 'electric-iou', url: `${cec}IOU_POU/FeatureServer/0`, fields: ['Utility', 'Type'], shape: 'Polygon', area: true, offset: '.00015', properties: a => ({ name: a.Utility, designation: a.Type }) },
  { key: 'electric-other', url: `${cec}Other/FeatureServer/0`, where: "Type IN ('CO-OP','TRIBAL')", fields: ['Utility', 'Type'], shape: 'Polygon', area: true, offset: '.00015', properties: a => ({ name: a.Utility, designation: a.Type }) },
  { key: 'water-area', url: 'https://gispublic.waterboards.ca.gov/portalserver/rest/services/Drinking_Water/California_Drinking_Water_System_Area_Boundaries/FeatureServer/0', where: "BOUNDARY_TYPE = 'Water Service Area'", fields: ['WATER_SYSTEM_NAME', 'WATER_SYSTEM_NUMBER', 'ACTIVITY_STATUS_CD', 'VERIFIED_STATUS'], shape: 'Polygon', area: true, filter: a => a.ACTIVITY_STATUS_CD?.trim() === 'A', properties: a => ({ name: a.WATER_SYSTEM_NAME, system: a.WATER_SYSTEM_NUMBER, verification: a.VERIFIED_STATUS || 'Not reported' }) },
  { key: 'sewer-district', url: 'https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/CSDA_Special_District_Boundaries/FeatureServer/0', where: `COMPANY IN (${districts.map(name => `'${name}'`).join(',')})`, fields: ['COMPANY'], shape: 'Polygon', area: true, properties: a => ({ name: a.COMPANY }) },
  { key: 'sewer-lines', url: 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Fort_Jones_Sewer_System/FeatureServer/8', fields: [], shape: 'LineString', properties: () => ({ name: 'Fort Jones sewer system' }) },
  { key: 'water-meter', url: 'https://services5.arcgis.com/oe3k134aAvdSB7Iw/arcgis/rest/services/wMeter_Public_View/FeatureServer/0', where: "Retired IS NULL AND WaterType = 'Potable'", fields: [], shape: 'Point', properties: () => ({ name: 'City of Yreka' }) }
];

async function arcgis(url, params = {}) {
  const response = await fetch(`${url}?${new URLSearchParams({ f: 'json', ...params })}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  const data = await response.json();
  if (data.error) throw new Error(`${url}: ${data.error.message}`);
  return data;
}

async function download(feed) {
  const query = `${feed.url}/query`;
  const selection = { where: feed.where || '1=1', ...(feed.area ? envelope : {}) };
  const { objectIdFieldName, objectIds } = await arcgis(query, { ...selection, returnIdsOnly: 'true' });
  if (!objectIdFieldName || !objectIds?.length) throw new Error(`${feed.key}: no matching records`);
  objectIds.sort((a, b) => a - b);
  const features = [];
  const batchSize = 150;
  for (let i = 0; i < objectIds.length; i += batchSize) {
    const ids = objectIds.slice(i, i + batchSize);
    const collection = await arcgis(query, {
      f: 'geojson', objectIds: ids.join(','), outFields: [objectIdFieldName, ...feed.fields].join(','),
      outSR: '4326', geometryPrecision: '6', ...(feed.offset ? { maxAllowableOffset: feed.offset } : {})
    });
    if (collection.type !== 'FeatureCollection' || collection.exceededTransferLimit || collection.features.length !== ids.length) {
      throw new Error(`${feed.key}: incomplete feature batch (expected ${ids.length}, got ${collection.features?.length})`);
    }
    const seen = new Set();
    for (const feature of collection.features) {
      const id = Number(feature.properties[objectIdFieldName]);
      if (seen.has(id) || !ids.includes(id)) throw new Error(`${feed.key}: unexpected object ID ${id}`);
      seen.add(id);
      if (feed.filter && !feed.filter(feature.properties)) continue;
      const { geometry } = feature;
      if (!geometry || ![feed.shape, `Multi${feed.shape}`].includes(geometry.type)) throw new Error(`${feed.key}: missing or unexpected geometry for ${id}`);
      const properties = feed.properties(feature.properties);
      if (!properties.name) throw new Error(`${feed.key}: missing name for ${id}`);
      features.push({ type: 'Feature', id: `${feed.key}-${id}`, properties: { feed: feed.key, ...properties }, geometry });
    }
  }
  if (!features.length) throw new Error(`${feed.key}: no publishable features`);
  if (feed.key === 'sewer-district' && districts.some(name => !features.some(feature => feature.properties.name === name))) throw new Error('Missing a corroborated sewer district');
  console.log(`${feed.key}: ${features.length} features`);
  return features.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

async function main() {
  const features = (await Promise.all(feeds.map(download))).flat();
  const file = path.resolve(__dirname, '../data/utility-evidence.geojson');
  const data = { type: 'FeatureCollection', retrieved: new Date().toISOString().slice(0, 10), features };
  await writeFile(`${file}.tmp`, `${JSON.stringify(data)}\n`);
  await rename(`${file}.tmp`, file);
  console.log(`Wrote ${features.length} utility records to ${file}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
