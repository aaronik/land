'use strict';

// Local-only, resumable crawl of Siskiyou's public tax lookup. It deliberately
// uses one request at a time; do not add this to a scheduled workflow.
const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('node:timers/promises');
const { fetchOk } = require('./refresh-fetch');
const { defaultedTaxFields, parcelFeatures } = require('./refresh-siskiyou-tax-delinquent');

const GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const TAX_BASE = 'https://common1.mptsweb.com/MBC';
const root = path.join(__dirname, '..');
const checkpointFile = path.join(root, '.cache', 'siskiyou-tax-crawl.json');
const outFile = path.join(root, 'data', 'siskiyou-tax-delinquent-crawl.json');
const finalFile = path.join(root, 'data', 'siskiyou-tax-delinquent.json');
const delayMs = Math.max(0, Number(process.env.TAX_CRAWL_DELAY_MS || 250));
const limit = Math.max(0, Number(process.env.TAX_CRAWL_PREFIX_LIMIT || 0));

const apnFromAssessment = asmt => `${asmt.slice(0, 3)}-${asmt.slice(3, 6)}-${asmt.slice(6, 9)}`;
const save = state => { fs.mkdirSync(path.dirname(checkpointFile), { recursive: true }); fs.writeFileSync(checkpointFile, `${JSON.stringify(state)}\n`); };
const load = () => {
  try { return JSON.parse(fs.readFileSync(checkpointFile, 'utf8')); } catch { return null; }
};
async function prefixes() {
  const values = [], seen = new Set();
  for (let offset = 0;; offset += 2000) {
    const params = new URLSearchParams({ f: 'json', where: '1=1', outFields: 'APN', returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000' });
    const data = await (await fetchOk(`${GIS}?${params}`)).json();
    const rows = data.features || [];
    for (const row of rows) {
      const prefix = String(row.attributes?.APN || '').replace(/\D/g, '').slice(0, 6);
      if (prefix.length === 6 && !seen.has(prefix)) { seen.add(prefix); values.push(prefix); }
    }
    if (rows.length < 2000) return values.sort();
  }
}
async function prefixAssessments(prefix) {
  const raw = await (await fetchOk(`${TAX_BASE}/api/search/siskiyou/0000-CURR/asmt/${prefix}`)).json();
  const rows = JSON.parse(raw)?.Table?.Row || [];
  return (Array.isArray(rows) ? rows : [rows]).filter(row => row?.Asmt && row.Taxyear && row.RollYear !== undefined);
}
async function defaultedRecord(row) {
  const url = `${TAX_BASE}/siskiyou/tax/main/${row.Asmt}/${row.Taxyear}/${row.RollYear}`;
  const html = await (await fetchOk(url)).text();
  if (!/Defaulted Tax Balance Through End of Month/i.test(html)) return null;
  const { balance, paymentPlan } = defaultedTaxFields(html);
  if (!(balance > 0)) return null;
  const APN = apnFromAssessment(row.Asmt);
  return { APN, kind: 'tax-delinquent', category: 'tax-delinquent', county: 'Siskiyou', title: `Siskiyou County tax-defaulted parcel ${APN}`, redemptionAmount: balance, paymentPlan, status: 'TAX-DEFAULTED', source: 'Siskiyou County tax system (current per-parcel lookup)', sourceUrl: url };
}
async function publish(records, state) {
  const unique = [...new Map(records.map(record => [record.APN, record])).values()];
  const features = await parcelFeatures(unique);
  const output = { generatedAt: new Date().toISOString(), source: 'Siskiyou County tax system (countywide current-roll crawl)', notice: 'Current status was checked by a local, resumable countywide crawl. Balances can change; verify with Siskiyou County.', counts: { scannedPrefixes: state.completed.length, totalPrefixes: state.prefixes.length, scannedAssessments: state.scannedAssessments, currentlyDefaulted: unique.length, mappedParcels: features.length, complete: state.completed.length === state.prefixes.length }, type: 'FeatureCollection', features };
  fs.writeFileSync(outFile, `${JSON.stringify(output)}\n`);
  if (output.counts.complete) fs.writeFileSync(finalFile, `${JSON.stringify(output)}\n`);
  console.log(`${output.counts.complete ? 'Published' : 'Saved partial'} ${features.length} mapped defaulted parcels (${state.completed.length}/${state.prefixes.length} prefixes).`);
}
async function main() {
  let state = load();
  if (!state || !Array.isArray(state.prefixes) || !Array.isArray(state.completed) || !Array.isArray(state.defaulted)) state = { prefixes: await prefixes(), completed: [], defaulted: [], scannedAssessments: 0, startedAt: new Date().toISOString() };
  const complete = new Set(state.completed);
  const todo = state.prefixes.filter(prefix => !complete.has(prefix));
  const run = limit ? todo.slice(0, limit) : todo;
  console.log(`Crawling ${run.length} prefixes; ${state.completed.length}/${state.prefixes.length} are already checkpointed. Delay: ${delayMs}ms.`);
  for (const [index, prefix] of run.entries()) {
    const rows = await prefixAssessments(prefix);
    const seenAssessments = new Set();
    for (const row of rows) {
      if (seenAssessments.has(row.Asmt)) continue;
      seenAssessments.add(row.Asmt); state.scannedAssessments += 1;
      const record = await defaultedRecord(row);
      if (record) state.defaulted.push(record);
      if (delayMs) await sleep(delayMs);
    }
    state.completed.push(prefix); complete.add(prefix); state.updatedAt = new Date().toISOString(); save(state);
    console.log(`${state.completed.length}/${state.prefixes.length}: ${prefix} (${rows.length} assessments; ${state.defaulted.length} defaulted total)`);
    if (delayMs && index < run.length - 1) await sleep(delayMs);
  }
  await publish(state.defaulted, state);
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exit(1); });
module.exports = { apnFromAssessment, prefixAssessments, prefixes };
