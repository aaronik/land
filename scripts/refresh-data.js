'use strict';

const fs = require('fs');
const path = require('path');
const { resolveUnmappedParcels } = require('./parcel-resolver');

let pdfjs;

const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'data', 'parcels.json');
const overridesFile = path.join(root, 'data', 'parcel-overrides.json');
const reviewFile = path.join(root, 'data', 'lot-review.json');
const resolverReportFile = path.join(root, 'data', 'parcel-resolution-report.json');
const externalListingsFile = path.join(root, 'data', 'external-listings.json');
const EXTERNAL_LISTINGS = fs.existsSync(externalListingsFile) ? JSON.parse(fs.readFileSync(externalListingsFile, 'utf8')) : [];
const PARCEL_OVERRIDES = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {};
const MLS_SOURCES = [
  // When the same property appears in both feeds, retain this listing's URL.
  { name: 'Mt. Shasta Realty', api: 'https://www.mountshastarealty.com/-/AjaxSearch/idx_search', site: 'https://www.mountshastarealty.com', priority: 0 },
  { name: 'Coldwell Banker Mountain Gate', api: 'https://www.realtymtshasta.com/-/AjaxSearch/idx_search', site: 'https://www.realtymtshasta.com', priority: 1 }
];
const TAX_PAGE = 'https://www.siskiyoucounty.gov/treasurer-taxcollector/page/tax-sale-auction';
const GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const ADDRESS_GIS = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/AddressPointNew/FeatureServer/9/query';
const UA = 'Mozilla/5.0 shasta-land-map/1.0';
const APN_RE = /\b(\d{3})[-\s]?(\d{3})[-\s]?(\d{3})[-\s]?(\d{3})\b/g;
const MONEY_RE = /\$\s*\d[\d,]*\.\d{2}/g;
const STATUS_RE = /\b(REDEEMED|REMOVED|SOLD|WITHDRAWN)\b/i;
const DATE_RANGE_RE = /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\s*(?:-|–|to)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{1,2},?\s+\d{4})\b/i;

async function fetchOk(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'User-Agent': UA, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

function normalizeApn(value) {
  const match = String(value || '').match(/(\d{3})\D?(\d{3})\D?(\d{3})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

async function fetchMlsPage(source, page, perPage = 100) {
  const body = new URLSearchParams({ listingType: 'homes-for-sale', page, itemsPerPage: perPage, sort: 'new', locationType: 'county', location: 'Siskiyou County, CA', lotSizeMin: 0 });
  const response = await fetchOk(source.api, {
    method: 'POST', body,
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', Origin: source.site, Referer: `${source.site}/` }
  });
  return response.json();
}

async function fetchMlsSource(source) {
  const items = [];
  let page = 1, total = null;
  while (total === null || items.length < total) {
    const data = await fetchMlsPage(source, page++);
    if (!data.success) throw new Error(`${source.name}: ${data.message || 'MLS API failed'}`);
    total = Number(data.total || 0);
    items.push(...(data.listings || []).map(item => ({ ...item, source })));
    if (!(data.listings || []).length) break;
  }
  if (items.length !== total) throw new Error(`${source.name}: incomplete MLS data: ${items.length}/${total}`);
  return items.filter(item => ['land', 'farm', 'house', 'multi', 'condo', 'mobile'].includes(item.propertyType));
}

function listingKey(item) {
  return [item.streetAddress, item.city, item.state, item.zip]
    .map(value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .join('|');
}

async function fetchMls() {
  const feeds = await Promise.all(MLS_SOURCES.map(fetchMlsSource));
  const unique = new Map();
  for (const item of feeds.flat().sort((a, b) => a.source.priority - b.source.priority)) {
    const key = listingKey(item);
    // Mt. Shasta Realty has priority for an address match, so its listing URL wins.
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function explicitApn(item) {
  const values = [];
  const visit = value => {
    if (typeof value === 'string') values.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(item);
  for (const value of values) {
    // Siskiyou sometimes publishes a trailing assessment suffix; parcel GIS
    // uses the first three numeric groups (for example 031-020-260-000).
    const match = value.match(/(?:\bAPN\s*(?:#|NO\.?|ONLY)?\s*[:#-]?\s*)?\b(\d{3})[-\s](\d{3})[-\s](\d{3})(?:[-\s]\d{3})?\b/i);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return '';
}

function normalizeStreet(value) {
  return String(value || '').toUpperCase()
    .replace(/^\d+[A-Z-]*\s+/, '')
    .replace(/(?:\s+|^)#\s*\w+.*$/, '')
    .replace(/\s+(?:APT|UNIT|STE|SUITE|SP|SPACE)\s+[A-Z0-9-]+.*$/, '')
    .replace(/\bMOUNT\b/g, 'MT')
    .replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S')
    .replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W')
    .replace(/\bSTATE ROUTE\b/g, 'HWY').replace(/\bSTATE HIGHWAY\b/g, 'HWY')
    .replace(/\bCOURT\b/g, 'CT').replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bSTREET\b/g, 'ST').replace(/\bROAD\b/g, 'RD')
    .replace(/\bDRIVE\b/g, 'DR').replace(/\bLANE\b/g, 'LN')
    .replace(/\bHIGHWAY\b/g, 'HWY').replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bCIRCLE\b/g, 'CIR').replace(/\bPLACE\b/g, 'PL')
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[b.length];
}

function streetSimilarity(a, b) {
  const left = normalizeStreet(a), right = normalizeStreet(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length);
}

function addressParts(item) {
  const address = String(item.streetAddress || '').trim();
  const match = address.match(/^(\d+)\s+(.+?)\s*$/);
  if (!match) return null; // Lot-only listings do not have a situs address.
  const number = match[1];
  const words = match[2].toUpperCase().replace(/\b(COURT|CT)\b/g, 'CT').replace(/\b(AVENUE|AVE)\b/g, 'AVE').replace(/\b(STREET|ST)\b/g, 'ST').split(/\s+/);
  // The county stores the base street name separately from its suffix.
  const suffixes = new Set(['CT', 'AVE', 'ST', 'RD', 'DR', 'LN', 'WAY', 'HWY', 'PL', 'BLVD', 'CIR']);
  if (suffixes.has(words.at(-1))) words.pop();
  return words.length ? { number, street: words.join(' '), zip: String(item.zip || '') } : null;
}

async function countyAddressPoint(item) {
  const address = addressParts(item);
  if (!address) return null;
  const clauses = [`AddNumber = '${address.number.replace(/'/g, "''")}'`];
  if (/^\d{5}$/.test(address.zip)) clauses.push(`Post_Code = '${address.zip}'`);
  const params = new URLSearchParams({ f: 'json', where: clauses.join(' AND '), outFields: 'FullSt_Add,MSAGComm,Post_Code', returnGeometry: 'true', outSR: 4326, resultRecordCount: 50 });
  const data = await (await fetchOk(`${ADDRESS_GIS}?${params}`)).json();
  const candidates = (data.features || []).map(feature => ({
    score: streetSimilarity(item.streetAddress, feature.attributes?.FullSt_Add),
    point: feature.geometry?.x != null && feature.geometry?.y != null ? [feature.geometry.y, feature.geometry.x] : null
  })).filter(candidate => candidate.point).sort((a, b) => b.score - a.score);
  // Duplicate county points for the same situs are not ambiguity. Collapse
  // coordinates within roughly one metre before comparing the runner-up.
  const unique = [];
  for (const candidate of candidates) {
    if (!unique.some(old => Math.abs(old.point[0] - candidate.point[0]) < 0.00001 && Math.abs(old.point[1] - candidate.point[1]) < 0.00001)) unique.push(candidate);
  }
  // Require a strong street match and a decisive lead over the runner-up.
  if (!unique.length || unique[0].score < 0.82) return null;
  if (unique[1] && unique[0].score - unique[1].score < 0.08) return null;
  return unique[0].point;
}

async function parcelsNearPoint(latLng, distance = 0) {
  if (!Array.isArray(latLng) || latLng.length < 2) return [];
  const [lat, lon] = latLng.map(Number);
  const values = { f: 'json', where: '1=1', outFields: 'APN,LandUse1,Acres', returnGeometry: distance ? 'true' : 'false', outSR: 4326, geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', resultRecordCount: distance ? 20 : 1 };
  if (distance) Object.assign(values, { distance: String(distance), units: 'esriSRUnit_Meter' });
  const data = await (await fetchOk(`${GIS}?${new URLSearchParams(values)}`)).json();
  const pointSegmentDistance = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.hypot((px - x) * 111000 * Math.cos(py * Math.PI / 180), (py - y) * 111000);
  };
  const geometryDistance = geometry => {
    const rings = geometry?.rings || [];
    let best = Infinity;
    for (const ring of rings) for (let i = 1; i < ring.length; i++) best = Math.min(best, pointSegmentDistance(lon, lat, ...ring[i - 1], ...ring[i]));
    return best;
  };
  return (data.features || []).map(feature => ({
    apn: normalizeApn(feature.attributes?.APN),
    landUse: String(feature.attributes?.LandUse1 || ''),
    acres: Number(feature.attributes?.Acres) || null,
    distance: distance ? geometryDistance(feature.geometry) : 0
  }));
}

async function resolverParcelCandidates(latLng, distance = 750) {
  if (!Array.isArray(latLng) || latLng.length !== 2) return [];
  const [lat, lon] = latLng.map(Number);
  const params = new URLSearchParams({
    f: 'json', where: '1=1', outFields: 'APN,Acres', returnGeometry: 'false', outSR: 4326,
    geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects', distance: String(distance), units: 'esriSRUnit_Meter', resultRecordCount: 2000
  });
  const data = await (await fetchOk(`${GIS}?${params}`)).json();
  return (data.features || []).map(feature => ({
    apn: normalizeApn(feature.attributes?.APN),
    acres: Number(feature.attributes?.Acres) || null
  })).filter(parcel => parcel.apn && parcel.acres);
}

async function apnAtPoint(latLng) {
  return (await parcelsNearPoint(latLng))[0] || null;
}

// County right-of-way features can contain an MLS road-centerline pin.  They
// are not sale parcels, so retain these listings as unverified point markers.
function usableParcel(match) {
  return match?.apn && !['004', '005', '008'].includes(match.landUse);
}

function acreageCompatible(item, match) {
  const listed = Number(item.lotSize), gis = Number(match?.acres);
  if (!(listed > 0) || !(gis > 0)) return true;
  // Small residential lots often differ by rounding; larger land listings
  // should agree much more closely before a boundary is inferred.
  const tolerance = listed < 1 ? Math.max(0.2, listed * 0.45) : Math.max(0.35, listed * 0.25);
  return Math.abs(listed - gis) <= tolerance;
}

function uniqueNearbyParcel(item, candidates) {
  const usable = candidates.filter(match => usableParcel(match) && acreageCompatible(item, match)).sort((a, b) => a.distance - b.distance);
  if (!usable.length || usable[0].distance > 15) return null;
  // Require at least a five-metre lead unless there is only one candidate.
  if (usable[1] && usable[1].distance - usable[0].distance < 5) return null;
  return usable[0];
}

async function privateRecords(items) {
  const records = [], unmapped = [];
  for (let i = 0; i < items.length; i += 12) {
    const batch = items.slice(i, i + 12);
    const addressPoints = await Promise.all(batch.map(item => countyAddressPoint(item).catch(() => null)));
    const containing = await Promise.all(batch.map((item, index) => apnAtPoint(addressPoints[index] || item.latLng).catch(() => null)));
    const nearby = await Promise.all(batch.map((item, index) => addressPoints[index] && !usableParcel(containing[index])
      ? parcelsNearPoint(addressPoints[index], 15).catch(() => []) : []));
    batch.forEach((item, index) => {
      const directMatch = containing[index];
      const nearbyMatch = uniqueNearbyParcel(item, nearby[index]);
      const match = usableParcel(directMatch) ? directMatch : nearbyMatch;
      const override = PARCEL_OVERRIDES[String(item.mlsNo || '')];
      const overrideApns = (override?.apns || []).map(normalizeApn).filter(Boolean);
      const listedApn = explicitApn(item);
      const verifiedAddress = Boolean(addressPoints[index]);
      const apn = overrideApns[0] || listedApn || (verifiedAddress && usableParcel(match) ? match.apn : '');
      const title = [item.streetAddress, item.city, item.state, item.zip].filter(Boolean).join(', ').replace(', CA,', ', CA');
      const slug = title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const record = {
        APN: apn, kind: 'private', title, price: Number(item.price) || null, acres: Number(item.lotSize) || null,
        status: item.displayStatus || '', listingDate: item.listingDate || '',
        propertyType: item.propertyType || '', propertySubType: item.propertySubType || '',
        beds: Number(item.beds) || 0, baths: Number(item.bathsTotal) || 0,
        sqft: Number(item.sqft) || 0, yearBuilt: Number(item.yearBuilt) || 0,
        url: `${item.source.site}/idx/listing/${item.mlsId}/${item.mlsNo}/${slug}`,
        listingSource: item.source.name,
        parcelMatchSource: overrideApns.length ? override.source : (listedApn ? 'listing APN' : (nearbyMatch ? 'county address point + nearest parcel (15m)' : 'county address point')),
        parcelMatchConfidence: override?.confidence || '',
        mlsNumber: item.mlsNo
      };
      if (apn) {
        const apns = overrideApns.length ? overrideApns : [apn];
        apns.forEach(value => records.push({ ...record, APN: value }));
      }
      else if (Array.isArray(addressPoints[index] || item.latLng) && (addressPoints[index] || item.latLng).length === 2 && (addressPoints[index] || item.latLng).every(Number.isFinite)) {
        record.latLng = addressPoints[index] || item.latLng;
        record.locationSource = verifiedAddress ? 'county address point (parcel rejected)' : 'MLS location only';
        record.category = ['land', 'farm'].includes(record.propertyType) ? 'private-land' : 'private-home';
        unmapped.push(record);
      }
    });
  }
  return { records, unmapped };
}

function externalRecords() {
  return EXTERNAL_LISTINGS.flatMap(item => (item.apns || []).map(value => ({
    APN: normalizeApn(value), kind: 'private', title: item.title || `Land listing ${value}`,
    price: Number(item.price) || null, acres: Number(item.acres) || null,
    status: item.status || 'For Sale', listingDate: item.listingDate || '',
    propertyType: item.propertyType || 'land', propertySubType: item.propertySubType || 'Bare Land',
    beds: 0, baths: 0, sqft: 0, yearBuilt: 0,
    url: item.url, listingSource: item.listingSource || 'External listing',
    parcelMatchSource: item.parcelMatchSource || 'listing APN',
    parcelMatchConfidence: item.parcelMatchConfidence || 'provided',
    mlsNumber: item.id || value, notes: item.notes || ''
  }))).filter(record => record.APN && record.url);
}

async function pdfText(url) {
  const bytes = new Uint8Array(await (await fetchOk(url)).arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map(item => item.str).join(' '));
  }
  return pages.join('\n');
}

function auctionEnd(text) {
  const match = text.slice(0, 5000).replace(/\s+/g, ' ').match(DATE_RANGE_RE);
  if (!match) return '';
  let end = match[1].split(/\s*(?:-|–|to)\s*/).pop();
  if (!/^[A-Za-z]+/.test(end)) end = `${match[1].split(/\s+/)[0]} ${end}`;
  return end;
}

function parseSaleRecords(text, label, sourceUrl) {
  const matches = [...text.matchAll(APN_RE)];
  const endDate = auctionEnd(text);
  const records = [];
  matches.forEach((match, index) => {
    const apn = `${match[1]}-${match[2]}-${match[3]}`;
    const next = matches[index + 1]?.index ?? Math.min(text.length, match.index + 500);
    const chunk = text.slice(match.index, next).replace(/\s+/g, ' ');
    const monies = chunk.match(MONEY_RE) || [];
    const statusMatch = chunk.match(STATUS_RE);
    const sourceStatus = statusMatch ? statusMatch[1].toUpperCase() : (monies.length ? 'ACTIVE' : 'UNKNOWN');
    let status = sourceStatus;
    if (status === 'ACTIVE' && endDate && Date.parse(endDate) < Date.now()) status = 'EXPIRED';
    const before = text.slice(Math.max(0, match.index - 160), match.index);
    const itemMatches = [...before.matchAll(/(?:^|\s)(\d{1,4})\s+\d{3}-\d{3}/g)];
    records.push({ APN: apn, kind: 'public', title: `Tax-sale parcel ${apn}`, minimumBid: monies.at(-1)?.replace(/\s/g, '') || '', status, sourceStatus, auctionEnd: endDate, item: itemMatches.at(-1)?.[1] || '', source: label, sourceUrl });
  });
  return records;
}

async function fetchAuctions() {
  const html = await (await fetchOk(TAX_PAGE)).text();
  const links = [...html.matchAll(/<a\s+[^>]*href=["']([^"']+\.pdf)["'][^>]*>(.*?)<\/a>/gis)]
    .map(match => ({ url: new URL(match[1], TAX_PAGE).href, label: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }))
    .filter(link => /sale list/i.test(link.label) && /(internet|re-offer)/i.test(link.label));
  const byApn = new Map();
  for (const link of links) {
    const records = parseSaleRecords(await pdfText(link.url), link.label, link.url);
    for (const record of records) {
      const old = byApn.get(record.APN);
      const score = value => (value.minimumBid ? 10 : 0) + (value.status === 'ACTIVE' ? 5 : 0) + (/re-offer/i.test(value.source) ? 20 : 0);
      if (!old || score(record) > score(old)) byApn.set(record.APN, record);
    }
  }
  // The map is an inventory tool: retain only listings still advertised as live.
  // Historical PDF rows (expired, redeemed, removed, sold, etc.) should not
  // create orange parcels with no current auction destination.
  return [...byApn.values()].filter(record => record.status === 'ACTIVE');
}

async function parcelFeatures(apns) {
  const features = [];
  for (let i = 0; i < apns.length; i += 50) {
    const chunk = apns.slice(i, i + 50);
    const where = `APN IN (${chunk.map(apn => `'${apn}'`).join(',')})`;
    const params = new URLSearchParams({ f: 'geojson', where, outFields: 'APN,Acres,Zoning1,LandUse1,Section,Township,Range', returnGeometry: 'true', outSR: 4326, resultRecordCount: 2000 });
    const data = await (await fetchOk(`${GIS}?${params}`)).json();
    features.push(...(data.features || []));
  }
  return features;
}

async function main() {
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  console.log('Fetching MLS and county auction sources…');
  const [mls, auctions] = await Promise.all([fetchMls(), fetchAuctions()]);
  const firstPass = await privateRecords(mls);
  const resolverEnabled = process.env.SECONDARY_PARCEL_RESOLVER !== '0';
  if (resolverEnabled) console.log('Running conservative secondary parcel resolver…');
  const secondary = resolverEnabled
    ? await resolveUnmappedParcels(firstPass.unmapped, resolverParcelCandidates)
    : { resolved: [], unmapped: firstPass.unmapped, report: { resolver: 'subdivision-lot-sequence-v3', disabled: true, evaluatedGroups: 0, mappedListings: 0, groups: [] } };
  const privateData = { records: [...firstPass.records, ...secondary.resolved], unmapped: secondary.unmapped };
  const privateRows = privateData.records;
  const externalRows = externalRecords();
  const records = [...privateRows, ...externalRows, ...auctions];
  const features = await parcelFeatures([...new Set(records.map(row => row.APN))]);
  const recordsByApn = new Map();
  for (const record of records) {
    if (!recordsByApn.has(record.APN)) recordsByApn.set(record.APN, []);
    recordsByApn.get(record.APN).push(record);
  }
  for (const feature of features) {
    const recordsForParcel = recordsByApn.get(normalizeApn(feature.properties.APN)) || [];
    const hasHomeLandUse = /^1\d{2}/.test(String(feature.properties.LandUse1 || ''));
    for (const record of recordsForParcel) {
      record.category = record.kind === 'private'
        ? (['land', 'farm'].includes(record.propertyType) ? 'private-land' : 'private-home')
        : (hasHomeLandUse ? 'public-home' : 'public-land');
    }
    feature.properties.records = recordsForParcel;
  }
  const output = {
    generatedAt: new Date().toISOString(), sources: { mls: MLS_SOURCES.map(source => ({ name: source.name, api: source.api })), externalListings: EXTERNAL_LISTINGS.map(item => item.url), auctions: TAX_PAGE, parcels: GIS },
    counts: { mlsLandListings: mls.length, privateMapped: privateRows.length + externalRows.length, externalListings: externalRows.length, privateUnmapped: privateData.unmapped.length, publicRecords: auctions.length, mappedParcels: features.length },
    unmappedListings: privateData.unmapped,
    type: 'FeatureCollection', features
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output));
  const lotReview = privateData.unmapped.filter(record => /\b(?:LOT|BLOCK)\s*[#-]?\s*\d+/i.test(record.title)).map(record => ({
    mlsNumber: record.mlsNumber, title: record.title, acres: record.acres, latLng: record.latLng,
    listingUrl: record.url,
    assessorSearch: 'https://assr.parcelquest.com/impl/SISASSR',
    status: 'needs assessor-map confirmation'
  }));
  fs.writeFileSync(reviewFile, JSON.stringify({ generatedAt: output.generatedAt, count: lotReview.length, listings: lotReview }, null, 2));
  fs.writeFileSync(resolverReportFile, JSON.stringify({ generatedAt: output.generatedAt, ...secondary.report }, null, 2));
  console.log(`Wrote ${features.length} mapped parcels (${privateRows.length} MLS private, ${externalRows.length} external, ${auctions.length} public records), ${lotReview.length} lot-review items, and ${secondary.resolved.length} secondary mappings`);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
