'use strict';

// NHTSA FARS annual National CSV archives: one record per fatal motor-vehicle crash.
// Keep ZIPs out of the repository; the published GeoJSON contains only Siskiyou points.
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { unzipSync } = require('fflate');

const FIRST_YEAR = 2015;
const LAST_YEAR = 2024;
const CACHE = path.join(__dirname, '..', '.cache', 'fars');
const OUTPUT = path.join(__dirname, '..', 'data', 'fatal-traffic-crashes.geojson');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      row.push(field);
      if (row.some(value => value !== '')) rows.push(row);
      row = []; field = '';
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else field += char;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (row.length || field) { row.push(field); rows.push(row); }
  return rows;
}

function extractCounty(csv, year) {
  const [headers, ...rows] = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (!headers) throw new Error(`${year}: missing accident CSV header`);
  const required = ['STATE', 'COUNTY', 'ST_CASE', 'YEAR', 'MONTH', 'DAY', 'FATALS', 'LATITUDE', 'LONGITUD', 'TWAY_ID', 'TWAY_ID2', 'TYP_INTNAME'];
  const indices = Object.fromEntries(required.map(name => [name, headers.indexOf(name)]));
  if (Object.values(indices).some(index => index < 0)) throw new Error(`${year}: missing required accident CSV columns`);
  const features = [];
  let missingLocation = 0;
  for (const row of rows) {
    if (row[indices.STATE] !== '6' || row[indices.COUNTY] !== '93') continue;
    const get = name => row[indices[name]];
    if (Number(get('YEAR')) !== year || !Number.isInteger(Number(get('ST_CASE'))) || Number(get('FATALS')) < 1) {
      throw new Error(`${year}: unexpected Siskiyou case: ${get('ST_CASE')}`);
    }
    const lat = Number(get('LATITUDE')), lon = Number(get('LONGITUD'));
    // Missing/unknown FARS locations use out-of-range sentinel coordinates; never map them.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 40.9 || lat > 42.1 || lon < -123.7 || lon > -120.9) {
      missingLocation++;
      continue;
    }
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {
      year, case: Number(get('ST_CASE')), month: Number(get('MONTH')), day: Number(get('DAY')),
      fatalities: Number(get('FATALS')), road: get('TWAY_ID'), crossRoad: get('TWAY_ID2'),
      intersection: get('TYP_INTNAME'), release: year === 2024 ? 'initial' : 'final'
    } });
  }
  if (!features.length) throw new Error(`${year}: no mapped Siskiyou crashes; check archive and schema`);
  return { features, missingLocation };
}

async function archive(year) {
  const name = `FARS${year}NationalCSV.zip`;
  const cached = path.join(CACHE, name);
  try { return await readFile(cached); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const url = `https://static.nhtsa.gov/nhtsa/downloads/FARS/${year}/National/${name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`FARS ${year}: ${response.status} fetching ${url}`);
  const data = Buffer.from(await response.arrayBuffer());
  // Only cache verified downloads; an interrupted run leaves the published file unchanged.
  const entries = unzipSync(data, { filter: file => /(?:^|\/)accident\.csv$/i.test(file.name) });
  if (Object.keys(entries).length !== 1) throw new Error(`${year}: missing accident.csv`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(cached, data);
  return data;
}

async function main() {
  const features = [];
  for (let year = FIRST_YEAR; year <= LAST_YEAR; year++) {
    const zip = await archive(year);
    const entries = unzipSync(zip, { filter: file => /(?:^|\/)accident\.csv$/i.test(file.name) });
    const csv = Object.values(entries)[0];
    if (!csv) throw new Error(`${year}: missing accident.csv`);
    const result = extractCounty(Buffer.from(csv).toString('utf8'), year);
    console.log(`${year}: ${result.features.length} mapped fatal crashes; ${result.missingLocation} omitted (missing/invalid coordinates)`);
    features.push(...result.features);
  }
  const keys = features.map(f => `${f.properties.year}-${f.properties.case}`);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate FARS cases');
  features.sort((a, b) => a.properties.year - b.properties.year || a.properties.case - b.properties.case);
  await writeFile(OUTPUT, JSON.stringify({ type: 'FeatureCollection', features }) + '\n');
  console.log(`Wrote ${features.length} Siskiyou fatal crash points to ${OUTPUT}`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { parseCsv, extractCounty };
