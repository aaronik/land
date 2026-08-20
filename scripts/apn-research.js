'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeApn, normalizeListingNumber } = require('./parcel-override');

const root = path.resolve(__dirname, '..');
const DEFAULT_QUEUE = path.join(root, 'data', 'apn-research.json');
const DEFAULT_PARCELS = path.join(root, 'data', 'parcels.json');
const GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const SIGNALS = new Set(['explicit_apn', 'boundary_image', 'location', 'road', 'landmark', 'acreage', 'lot', 'subdivision', 'parcel_count']);
const STATUSES = new Set(['open', 'candidate', 'needs_evidence', 'ready', 'resolved', 'inconclusive', 'rejected']);

function emptyQueue() { return { schemaVersion: 1, updatedAt: new Date().toISOString(), items: {} }; }
function loadJson(file, fallback) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}
function listingSnapshot(record) {
  return { title: record.title, acres: Number(record.acres) || null, price: Number(record.price) || null,
    listingUrl: record.url, latLng: record.latLng, locationSource: record.locationSource, propertyType: record.propertyType };
}
function priority(item) {
  const title = item.listing?.title || '';
  return (item.status === 'ready' ? 1000 : item.status === 'candidate' ? 500 : 0)
    + (/\b(?:LOTS?|BLOCKS?)\s*[#-]?\s*\d+/i.test(title) ? 100 : 0)
    + (item.listing?.acres >= 1 ? 10 : 0);
}
function mergeQueue(queue, records, now = new Date().toISOString()) {
  const next = { schemaVersion: 1, updatedAt: now, items: { ...(queue.items || {}) } };
  const live = new Set();
  for (const record of records.filter(item => ['land', 'farm'].includes(item.propertyType))) {
    const id = normalizeListingNumber(record.mlsNumber);
    if (!id) continue;
    live.add(id);
    const old = next.items[id] || {};
    next.items[id] = { listingId: id, status: old.status || 'open', active: true,
      listing: listingSnapshot(record), candidates: old.candidates || [], evidence: old.evidence || [],
      ruledOutApns: old.ruledOutApns || [], notes: old.notes || '', createdAt: old.createdAt || now, updatedAt: now,
      ...(old.resolution ? { resolution: old.resolution } : {}) };
  }
  for (const [id, item] of Object.entries(next.items)) if (!live.has(id)) next.items[id] = { ...item, active: false };
  next.items = Object.fromEntries(Object.entries(next.items).sort(([, a], [, b]) => priority(b) - priority(a) || a.listingId.localeCompare(b.listingId, undefined, { numeric: true })));
  return next;
}
function evidenceId(item) { return `e${String((item.evidence || []).length + 1).padStart(3, '0')}`; }
function assess(item) {
  const selected = [...new Set((item.candidates || []).filter(x => x.selected).map(x => normalizeApn(x.apn)).filter(Boolean))];
  const evidence = item.evidence || [];
  const applicable = evidence.filter(x => !x.apns?.length || x.apns.some(apn => selected.includes(normalizeApn(apn))));
  const signals = new Set(applicable.flatMap(x => x.signals || []).filter(x => SIGNALS.has(x)));
  const sources = new Set(applicable.map(x => x.url || x.source).filter(Boolean));
  const hasGis = selected.length > 0 && selected.every(apn => applicable.some(x => x.type === 'county_gis' && (x.apns || []).map(normalizeApn).includes(apn)));
  const strong = signals.has('explicit_apn') || signals.has('boundary_image');
  const corroborated = signals.size >= 3 && sources.size >= 2 && (signals.has('location') || signals.has('road') || signals.has('landmark')) && (signals.has('acreage') || signals.has('lot') || signals.has('subdivision'));
  const ruledOut = new Set((item.ruledOutApns || []).map(value => normalizeApn(typeof value === 'string' ? value : value.apn)));
  const competitors = (item.candidates || []).filter(x => !x.selected && !ruledOut.has(normalizeApn(x.apn)));
  const reasons = [];
  if (!selected.length) reasons.push('select at least one candidate APN');
  if (!hasGis) reasons.push('verify every selected APN in county GIS evidence');
  if (!(strong || corroborated)) reasons.push('add explicit/boundary evidence or 3 corroborating signals from 2 sources');
  if (competitors.length) reasons.push(`rule out ${competitors.length} competing candidate(s)`);
  return { ready: !reasons.length, selectedApns: selected, signals: [...signals].sort(), sourceCount: sources.size, reasons };
}
function validate(queue) {
  const errors = [];
  if (queue.schemaVersion !== 1 || !queue.items || Array.isArray(queue.items)) errors.push('queue must have schemaVersion 1 and an items object');
  for (const [id, item] of Object.entries(queue.items || {})) {
    if (id !== normalizeListingNumber(item.listingId)) errors.push(`${id}: listingId mismatch`);
    if (!STATUSES.has(item.status)) errors.push(`${id}: invalid status ${item.status}`);
    const evidenceIds = new Set();
    for (const evidence of item.evidence || []) {
      if (!evidence.id || evidenceIds.has(evidence.id)) errors.push(`${id}: duplicate/missing evidence id`);
      evidenceIds.add(evidence.id);
      if (!Array.isArray(evidence.signals) || evidence.signals.some(signal => !SIGNALS.has(signal))) errors.push(`${id}/${evidence.id}: invalid signals`);
      if (evidence.url) try { new URL(evidence.url); } catch { errors.push(`${id}/${evidence.id}: invalid URL`); }
    }
    if (item.status === 'ready' && !assess(item).ready) errors.push(`${id}: marked ready but confidence gates fail`);
  }
  return errors;
}
function centroid(geometry) {
  const points = (geometry?.rings || []).flat();
  return points.length ? [points.reduce((sum, point) => sum + point[1], 0) / points.length, points.reduce((sum, point) => sum + point[0], 0) / points.length] : null;
}
function pointInRing(point, ring) {
  const [x, y] = [point[1], point[0]];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function containsPoint(geometry, point) { return (geometry?.rings || []).some(ring => pointInRing(point, ring)); }
function distanceMeters(a, b) {
  const radians = Math.PI / 180, dLat = (b[0] - a[0]) * radians, dLon = (b[1] - a[1]) * radians;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(value));
}
async function candidateParcels(item, radius = 3000) {
  const point = item.listing?.latLng;
  if (!Array.isArray(point) || point.length !== 2) throw new Error('Listing has no usable location');
  const [lat, lon] = point.map(Number), listed = Number(item.listing.acres);
  const params = new URLSearchParams({ f: 'json', where: '1=1', outFields: 'APN,Acres,LandUse1,Section,Township,Range', returnGeometry: 'true', outSR: '4326',
    geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', distance: String(radius), units: 'esriSRUnit_Meter', resultRecordCount: '2000' });
  const response = await fetch(`${GIS}?${params}`);
  if (!response.ok) throw new Error(`County GIS returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'County GIS query failed');
  const tolerance = listed > 0 ? Math.max(listed < 1 ? 0.15 : 0.5, listed * 0.05) : Infinity;
  return (data.features || []).map(feature => {
    const center = centroid(feature.geometry), attributes = feature.attributes || {}, pointMatch = containsPoint(feature.geometry, point);
    return { apn: normalizeApn(attributes.APN), gisAcres: Number(attributes.Acres) || null,
      acreDelta: listed > 0 ? Math.round(Math.abs(Number(attributes.Acres) - listed) * 1000) / 1000 : null,
      distanceMeters: center ? Math.round(distanceMeters(point, center)) : null,
      section: attributes.Section || '', township: attributes.Township || '', range: attributes.Range || '', pointMatch, selected: false };
  }).filter(parcel => parcel.apn && (parcel.pointMatch || parcel.acreDelta === null || parcel.acreDelta <= tolerance))
    .sort((a, b) => Number(b.pointMatch) - Number(a.pointMatch) || (a.acreDelta ?? Infinity) - (b.acreDelta ?? Infinity) || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
}
async function namedParcels(apns) {
  const normalized = [...new Set(String(apns || '').split(',').map(normalizeApn).filter(Boolean))];
  if (!normalized.length) return [];
  const where = normalized.map(apn => `APN = '${apn}'`).join(' OR ');
  const params = new URLSearchParams({ f: 'json', where, outFields: 'APN,Acres,LandUse1,Section,Township,Range', returnGeometry: 'false' });
  const response = await fetch(`${GIS}?${params}`);
  if (!response.ok) throw new Error(`County GIS returned ${response.status}`);
  const data = await response.json(); if (data.error) throw new Error(data.error.message || 'County GIS query failed');
  const found = (data.features || []).map(feature => {
    const a = feature.attributes || {}; return { apn: normalizeApn(a.APN), gisAcres: Number(a.Acres) || null, acreDelta: null, distanceMeters: null,
      section: a.Section || '', township: a.Township || '', range: a.Range || '', pointMatch: false, selected: false };
  }).filter(x => x.apn);
  if (found.length !== normalized.length) throw new Error(`County GIS did not return: ${normalized.filter(apn => !found.some(x => x.apn === apn)).join(', ')}`);
  return found;
}
function option(args, name, fallback = '') { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : fallback; }
function usage() { console.log(`APN evidence research

  npm run research -- sync
  npm run research -- list [--status open]
  npm run research -- show <MLS>
  npm run research -- candidates <MLS> [--radius 3000]
  npm run research -- add-candidate <MLS> <APN[,APN]>
  npm run research -- select <MLS> <APN[,APN]>
  npm run research -- rule-out <MLS> <APN[,APN]> --evidence <id>
  npm run research -- evidence <MLS> --type listing|county_gis|photo|assessor --signals acreage,location --url URL --apns APN --note TEXT
  npm run research -- assess <MLS>
  npm run research -- inconclusive <MLS> --note TEXT
  npm run research -- resolve <MLS>
  npm run research -- validate`); }
async function main(args = process.argv.slice(2)) {
  const file = path.resolve(option(args, 'file', DEFAULT_QUEUE));
  const parcelsFile = path.resolve(option(args, 'parcels-file', DEFAULT_PARCELS));
  const command = args[0] || 'list';
  let queue = loadJson(file, emptyQueue());
  if (command === 'sync') {
    const data = loadJson(parcelsFile, null); if (!data) throw new Error(`Missing ${parcelsFile}`);
    queue = mergeQueue(queue, data.unmappedListings || []); saveJson(file, queue);
    console.log(`Synced ${Object.values(queue.items).filter(x => x.active).length} active land listings to ${path.relative(root, file)}`); return;
  }
  if (command === 'validate') { const errors = validate(queue); if (errors.length) throw new Error(errors.join('\n')); console.log(`Valid: ${Object.keys(queue.items).length} research items`); return; }
  if (command === 'list') { const status = option(args, 'status'); for (const item of Object.values(queue.items)) if (item.active && (!status || item.status === status)) console.log(`${item.listingId}\t${item.status}\t${item.listing.acres || '—'} ac\t${item.listing.title}`); return; }
  if (command === 'help') return usage();
  const id = normalizeListingNumber(args[1]), item = queue.items[id];
  if (!item) throw new Error(`No research item for ${id || '(missing)'}; run sync`);
  if (command === 'show') { console.log(JSON.stringify({ ...item, assessment: assess(item) }, null, 2)); return; }
  if (command === 'candidates') {
    item.candidates = await candidateParcels(item, Number(option(args, 'radius', 3000)) || 3000);
    item.status = item.candidates.length ? 'candidate' : 'needs_evidence'; item.updatedAt = new Date().toISOString(); saveJson(file, queue);
    console.log(JSON.stringify(item.candidates, null, 2)); return;
  }
  if (command === 'add-candidate') {
    const added = await namedParcels(args[2]);
    const existing = new Map((item.candidates || []).map(candidate => [normalizeApn(candidate.apn), candidate]));
    for (const candidate of added) if (!existing.has(candidate.apn)) existing.set(candidate.apn, candidate);
    item.candidates = [...existing.values()]; item.status = 'candidate'; item.updatedAt = new Date().toISOString(); saveJson(file, queue);
    console.log(JSON.stringify(added, null, 2)); return;
  }
  if (command === 'select' || command === 'rule-out') {
    const apns = String(args[2] || '').split(',').map(normalizeApn).filter(Boolean); if (!apns.length) throw new Error('Provide APN(s)');
    if (command === 'select') item.candidates = (item.candidates || []).map(x => ({ ...x, selected: apns.includes(normalizeApn(x.apn)) }));
    else {
      const evidence = option(args, 'evidence');
      if (!evidence || !(item.evidence || []).some(entry => entry.id === evidence)) throw new Error('rule-out requires a valid --evidence <id>');
      const old = new Map((item.ruledOutApns || []).map(value => [normalizeApn(typeof value === 'string' ? value : value.apn), typeof value === 'string' ? { apn: normalizeApn(value), evidenceIds: [] } : value]));
      for (const apn of apns) old.set(apn, { apn, evidenceIds: [...new Set([...(old.get(apn)?.evidenceIds || []), evidence])] });
      item.ruledOutApns = [...old.values()];
    }
    const result = assess(item); item.status = result.ready ? 'ready' : 'needs_evidence'; item.updatedAt = new Date().toISOString(); saveJson(file, queue); console.log(JSON.stringify(result, null, 2)); return;
  }
  if (command === 'evidence') {
    const signals = option(args, 'signals').split(',').filter(Boolean); if (!signals.length || signals.some(x => !SIGNALS.has(x))) throw new Error(`Signals must be from: ${[...SIGNALS].join(', ')}`);
    const evidence = { id: evidenceId(item), type: option(args, 'type', 'listing'), signals, source: option(args, 'source'), url: option(args, 'url'), apns: option(args, 'apns').split(',').map(normalizeApn).filter(Boolean), note: option(args, 'note'), retrievedAt: new Date().toISOString() };
    if (!evidence.url && !evidence.source) throw new Error('Evidence requires --url or --source');
    item.evidence.push(evidence); const result = assess(item); item.status = result.ready ? 'ready' : 'needs_evidence'; item.updatedAt = evidence.retrievedAt; saveJson(file, queue); console.log(JSON.stringify(result, null, 2)); return;
  }
  if (command === 'assess') { const result = assess(item); item.status = result.ready ? 'ready' : 'needs_evidence'; saveJson(file, queue); console.log(JSON.stringify(result, null, 2)); return; }
  if (command === 'inconclusive') {
    const note = String(option(args, 'note')).trim(); if (!note) throw new Error('inconclusive requires --note TEXT');
    item.status = 'inconclusive'; item.notes = [item.notes, `Inconclusive: ${note}`].filter(Boolean).join('\n');
    item.reviewedAt = new Date().toISOString(); item.updatedAt = item.reviewedAt; saveJson(file, queue); console.log(`Marked MLS ${id} inconclusive`); return;
  }
  if (command === 'resolve') {
    const result = assess(item); if (!result.ready) throw new Error(`Confidence gates failed: ${result.reasons.join('; ')}`);
    const evidenceIds = item.evidence.map(x => x.id).join(', '), source = `evidence-backed APN research (${evidenceIds})`;
    const child = spawnSync(process.execPath, [path.join(__dirname, 'parcel-override.js'), 'add', id, result.selectedApns.join(','), '--source', source, '--confidence', 'high; evidence reviewed', '--notes', item.notes || `Research evidence: ${evidenceIds}`, '--force'], { stdio: 'inherit' });
    if (child.status !== 0) throw new Error('Parcel override failed');
    item.status = 'resolved'; item.resolution = { apns: result.selectedApns, evidenceIds: item.evidence.map(x => x.id), resolvedAt: new Date().toISOString() }; saveJson(file, queue); return;
  }
  usage(); throw new Error(`Unknown command: ${command}`);
}
if (require.main === module) main().catch(error => { console.error(`Error: ${error.message}`); process.exitCode = 1; });
module.exports = { SIGNALS, assess, candidateParcels, emptyQueue, loadJson, mergeQueue, priority, saveJson, validate };
