'use strict';

// Resumable Siskiyou current-roll crawl. This can run locally or in bounded
// GitHub Actions batches. Progress is deliberately tracked in data/.
const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('node:timers/promises');
const { fetchOk } = require('./refresh-fetch');
const { defaultedTaxFields, parcelFeatures } = require('./refresh-siskiyou-tax-delinquent');

const GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const TAX_BASE = 'https://common1.mptsweb.com/MBC';
const root = path.join(__dirname, '..');
const checkpointFile = path.join(root, 'data', 'siskiyou-tax-crawl-progress.json');
const partialFile = path.join(root, 'data', 'siskiyou-tax-delinquent-crawl.json');
const finalFile = path.join(root, 'data', 'siskiyou-tax-delinquent.json');
const delayMs = Math.max(0, Number(process.env.TAX_CRAWL_DELAY_MS || 250));
const limit = Math.max(0, Number(process.env.TAX_CRAWL_PREFIX_LIMIT || 0));
const maxMinutes = Math.max(0, Number(process.env.TAX_CRAWL_MAX_MINUTES || 0));
const deadline = maxMinutes ? Date.now() + maxMinutes * 60_000 : Infinity;

const apnFromAssessment = asmt => `${asmt.slice(0, 3)}-${asmt.slice(3, 6)}-${asmt.slice(6, 9)}`;
const save = state => { fs.mkdirSync(path.dirname(checkpointFile), { recursive: true }); fs.writeFileSync(checkpointFile, `${JSON.stringify(state)}\n`); };
const load = () => { try { return JSON.parse(fs.readFileSync(checkpointFile, 'utf8')); } catch { return null; } };
const outOfTime = () => Date.now() >= deadline;

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
async function publish(state) {
  const unique = [...new Map(state.defaulted.map(record => [record.APN, record])).values()];
  const features = await parcelFeatures(unique);
  const complete = state.completed.length === state.prefixes.length;
  const output = { generatedAt: new Date().toISOString(), source: 'Siskiyou County tax system (countywide current-roll crawl)', notice: 'Current status was checked by a resumable countywide crawl. Balances can change; verify with Siskiyou County.', counts: { scannedPrefixes: state.completed.length, totalPrefixes: state.prefixes.length, scannedAssessments: state.scannedAssessments, currentlyDefaulted: unique.length, mappedParcels: features.length, complete }, type: 'FeatureCollection', features };
  fs.writeFileSync(partialFile, `${JSON.stringify(output)}\n`);
  if (complete) fs.writeFileSync(finalFile, `${JSON.stringify(output)}\n`);
  return output;
}
async function main() {
  if (process.env.TAX_CRAWL_RESTART) {
    fs.rmSync(checkpointFile, { force: true });
    fs.rmSync(partialFile, { force: true });
    console.log('Starting a new countywide crawl; prior checkpoint cleared.');
  }
  try {
    const prior = JSON.parse(fs.readFileSync(partialFile, 'utf8'));
    if (prior?.counts?.complete && !process.env.TAX_CRAWL_RESTART) {
      console.log(JSON.stringify({ complete: true, scannedPrefixes: prior.counts.scannedPrefixes, totalPrefixes: prior.counts.totalPrefixes, message: 'Existing crawl is complete; set TAX_CRAWL_RESTART=1 to start a new crawl.' }));
      return;
    }
  } catch { /* No prior crawl output. */ }
  let state = load();
  if (!state || !Array.isArray(state.prefixes) || !Array.isArray(state.completed) || !Array.isArray(state.defaulted)) {
    state = { prefixes: await prefixes(), completed: [], defaulted: [], scannedAssessments: 0, startedAt: new Date().toISOString(), active: null };
  }
  state.active ||= null;
  const complete = new Set(state.completed);
  let prefixesRun = 0;
  console.log(`Resuming ${state.completed.length}/${state.prefixes.length} prefixes; deadline: ${Number.isFinite(deadline) ? new Date(deadline).toISOString() : 'none'}.`);
  while (!outOfTime() && (!limit || prefixesRun < limit)) {
    if (!state.active) {
      const prefix = state.prefixes.find(value => !complete.has(value));
      if (!prefix) break;
      state.active = { prefix, rows: await prefixAssessments(prefix), next: 0 };
      save(state);
    }
    const active = state.active;
    while (active.next < active.rows.length && !outOfTime()) {
      const row = active.rows[active.next++];
      state.scannedAssessments += 1;
      const record = await defaultedRecord(row);
      if (record) state.defaulted.push(record);
      state.updatedAt = new Date().toISOString(); save(state);
      if (delayMs && !outOfTime()) await sleep(delayMs);
    }
    if (active.next < active.rows.length) break;
    state.completed.push(active.prefix); complete.add(active.prefix); state.active = null; prefixesRun += 1;
    state.updatedAt = new Date().toISOString(); save(state);
    console.log(`${state.completed.length}/${state.prefixes.length}: ${active.prefix} (${active.rows.length} assessments; ${state.defaulted.length} defaulted total)`);
    if (delayMs && !outOfTime()) await sleep(delayMs);
  }
  const output = await publish(state);
  console.log(JSON.stringify({ complete: output.counts.complete, scannedPrefixes: output.counts.scannedPrefixes, totalPrefixes: output.counts.totalPrefixes }));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exit(1); });
module.exports = { apnFromAssessment, prefixAssessments, prefixes };
