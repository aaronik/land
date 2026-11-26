'use strict';

// Acquire tabular data directly from SDA. Geometry is already shipped by the
// soils layer; this refresh does not need to open or rebuild the soil archive.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const ENDPOINT = 'https://sdmdataaccess.nrcs.usda.gov/tabular/post.rest';
const RULE = 'ENG - Septic Tank Absorption Fields';
const BBOX = [-123.73, 40.98, -121.43, 42.02]; // Same envelope as the SSURGO soils layer.
const CLASSES = ['Very limited', 'Somewhat limited', 'Not limited']; // Tie: more limiting class first.
const KEY = /^\d+$/;
const run = promisify(execFile);

function keyQuery() {
  const [west, south, east, north] = BBOX;
  const wkt = `POLYGON((${west} ${south},${east} ${south},${east} ${north},${west} ${north},${west} ${south}))`;
  return `SELECT DISTINCT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wkt}') ORDER BY mukey`;
}

function ratingQuery(keys) {
  if (!keys.length || keys.some(key => !KEY.test(key))) throw new Error('Invalid mukey batch');
  return `SELECT c.mukey, c.cokey, c.comppct_r, i.ruledepth, i.interphrc, i.interphr
FROM component c JOIN cointerp i ON i.cokey = c.cokey
WHERE c.mukey IN (${keys.map(key => `'${key}'`).join(',')})
AND i.mrulename = '${RULE}' AND i.ruledepth IN (0, 1)
AND (i.ruledepth = 0 OR i.interphr > 0)
ORDER BY c.mukey, c.cokey, i.ruledepthseq`;
}

function aggregate(keys, rows) {
  const units = new Map(keys.map(key => [key, new Map()]));
  for (const [key, cokey, percentage, depth, label, score] of rows) {
    const components = units.get(String(key));
    if (!components || !KEY.test(cokey)) throw new Error(`Unexpected interpretation row: ${key}/${cokey}`);
    if (!components.has(cokey)) components.set(cokey, { rating: null, pct: Number(percentage), reasons: new Map() });
    const component = components.get(cokey);
    if (String(depth) === '0') {
      if (label && label !== 'Not rated' && !CLASSES.includes(label)) throw new Error(`Unknown USDA rating: ${label}`);
      if (CLASSES.includes(label)) component.rating = label;
    } else if (String(depth) === '1' && Number(score) > 0 && label && !/^not rated/i.test(label)) {
      component.reasons.set(label, Math.max(Number(score), component.reasons.get(label) || 0));
    }
  }

  return Object.fromEntries([...units].map(([key, components]) => {
    const totals = new Map(CLASSES.map(rating => [rating, 0]));
    for (const { rating, pct } of components.values()) {
      if (Number.isFinite(pct) && pct > 0 && rating) totals.set(rating, totals.get(rating) + pct);
    }
    const [rating, share] = [...totals].sort((a, b) => b[1] - a[1])[0];
    if (!share) return [key, null];
    const reasons = new Map();
    for (const component of components.values()) {
      if (component.rating !== rating || !(component.pct > 0)) continue;
      for (const [reason, severity] of component.reasons) {
        reasons.set(reason, Math.max(severity, reasons.get(reason) || 0));
      }
    }
    const labels = [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([reason]) => reason);
    return [key, [rating, share, labels]];
  }));
}

async function query(sql) {
  // curl honors the shell's proxy environment, which Node fetch often ignores.
  const { stdout } = await run('curl', ['-fsS', '--retry', '2', '--max-time', '90', '--data-urlencode', `query=${sql}`, '-d', 'format=JSON', ENDPOINT], { maxBuffer: 8 * 1024 * 1024 });
  let data;
  try { data = JSON.parse(stdout); } catch { throw new Error(`NRCS did not return JSON: ${stdout.slice(0, 600)}`); }
  if (!Array.isArray(data.Table)) throw new Error('NRCS did not return a tabular result');
  return data.Table;
}

async function main() {
  const keys = (await query(keyQuery())).map(([key]) => String(key));
  if (keys.length < 1000 || new Set(keys).size !== keys.length || keys.some(key => !KEY.test(key))) {
    throw new Error(`Unexpected SSURGO key inventory (${keys.length} keys)`);
  }
  const mapUnits = {};
  for (let i = 0; i < keys.length; i += 160) {
    const batch = keys.slice(i, i + 160);
    Object.assign(mapUnits, aggregate(batch, await query(ratingQuery(batch))));
  }
  const rated = Object.values(mapUnits).filter(Boolean).length;
  if (rated < keys.length / 2) throw new Error(`Unexpected SSURGO rating coverage (${rated}/${keys.length})`);
  const result = { source: ENDPOINT, interpretation: RULE, retrieved: new Date().toISOString().slice(0, 10), bbox: BBOX, mapUnits };
  const output = path.resolve(__dirname, '../assets/data/septic-screening.json');
  const entries = Object.entries(mapUnits).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const payload = JSON.stringify({ ...result, mapUnits: {} }, null, 2).replace('"mapUnits": {}', () => `"mapUnits": {\n${entries.join(',\n')}\n  }`);
  await fs.writeFile(`${output}.tmp`, `${payload}\n`);
  await fs.rename(`${output}.tmp`, output);
  console.log(`Saved ${rated} rated and ${keys.length - rated} not-rated SSURGO map units.`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { aggregate, keyQuery, ratingQuery };
