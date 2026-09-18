'use strict';

const fs = require('fs');
const path = require('path');
const { fetchOk } = require('./refresh-fetch');

const SOURCE_URL = 'https://www.siskiyou.news/2025/08/29/siskiyou-county-tax-collector-property-tax-default-delinquent-list/';
const TAX_BASE = 'https://common1.mptsweb.com/MBC';
const GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const outFile = path.join(__dirname, '..', 'data', 'siskiyou-tax-delinquent.json');
const APN_RE = /(\d{3})-(\d{3})-(\d{3})-(\d{3})\s+\$([\d,]+\.\d{2})/g;

function parseNotice(html) {
  const records = [], seen = new Set();
  for (const match of html.matchAll(APN_RE)) {
    const APN = `${match[1]}-${match[2]}-${match[3]}`;
    if (seen.has(APN)) continue;
    seen.add(APN);
    records.push({ APN, noticeRedemptionAmount: Number(match[5].replace(/,/g, '')) });
  }
  return records;
}
function defaultedTaxFields(html) {
  const section = /Defaulted Tax Balance Through End of Month([\s\S]*?)(?:<\/div>\s*<div class="tab-pane|<\/body>)/i.exec(html)?.[1] || '';
  const value = label => new RegExp(`<strong>${label}<\\/strong><\\/div>\\s*<div>\\s*\\$?([\\d,]+\\.\\d{2}|YES|NO)`, 'i').exec(section)?.[1] || '';
  const balance = Number(value('Balance').replace(/,/g, ''));
  return { balance: Number.isFinite(balance) ? balance : null, paymentPlan: value('Pay Plan in Effect') || 'Not reported' };
}
async function currentTaxStatus(record) {
  const asmt = record.APN.replace(/-/g, '') + '000';
  const search = await (await fetchOk(`${TAX_BASE}/api/search/siskiyou/0000-CURR/asmt/${asmt}`)).json();
  const result = JSON.parse(search);
  const row = result?.Table?.Row;
  if (!row?.Asmt) return null;
  const url = `${TAX_BASE}/siskiyou/tax/main/${row.Asmt}/${row.Taxyear}/${row.RollYear}`;
  const html = await (await fetchOk(url)).text();
  if (!/Defaulted Tax Balance Through End of Month/i.test(html)) return null;
  const { balance, paymentPlan } = defaultedTaxFields(html);
  if (!(balance > 0)) return null;
  return { ...record, kind: 'tax-delinquent', category: 'tax-delinquent', county: 'Siskiyou', title: `Siskiyou County tax-defaulted parcel ${record.APN}`, redemptionAmount: balance, paymentPlan, status: 'TAX-DEFAULTED', source: 'Siskiyou County tax system (current per-parcel lookup)', sourceUrl: url, noticeSourceUrl: SOURCE_URL };
}
async function parcelFeatures(records) {
  const byApn = new Map(records.map(record => [record.APN, record])), features = [];
  for (let i = 0; i < records.length; i += 50) {
    const apns = records.slice(i, i + 50).map(record => record.APN);
    const params = new URLSearchParams({ f: 'geojson', where: `APN IN (${apns.map(apn => `'${apn}'`).join(',')})`, outFields: 'APN,Acres', returnGeometry: 'true', outSR: '4326' });
    const data = await (await fetchOk(`${GIS}?${params}`)).json();
    for (const feature of data.features || []) {
      const record = byApn.get(feature.properties.APN);
      if (record) features.push({ ...feature, properties: { ...feature.properties, county: 'Siskiyou', records: [record] } });
    }
  }
  return features;
}
async function refreshSiskiyouTaxDelinquent() {
  const notice = await (await fetchOk(SOURCE_URL)).text();
  const candidates = parseNotice(notice);
  if (!candidates.length) throw new Error('No candidate APNs parsed from the published Siskiyou notice.');
  const current = [];
  for (const candidate of candidates) {
    try { const record = await currentTaxStatus(candidate); if (record) current.push(record); } catch (error) { console.warn(`Tax lookup failed for ${candidate.APN}: ${error.message}`); }
  }
  const features = await parcelFeatures(current);
  const output = { generatedAt: new Date().toISOString(), source: SOURCE_URL, notice: 'Current status is checked monthly against Siskiyou County’s per-parcel tax system. Balances can change; verify with the County.', counts: { noticeCandidates: candidates.length, currentlyDefaulted: current.length, mappedParcels: features.length }, type: 'FeatureCollection', features };
  fs.writeFileSync(outFile, `${JSON.stringify(output)}\n`);
  return output;
}
if (require.main === module) refreshSiskiyouTaxDelinquent().then(output => console.log(`Wrote ${output.counts.mappedParcels} currently tax-defaulted Siskiyou parcels.`)).catch(error => { console.error(error.stack || error); process.exit(1); });
module.exports = { parseNotice, currentTaxStatus, refreshSiskiyouTaxDelinquent };
