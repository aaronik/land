'use strict';

const fs = require('fs');
const path = require('path');

let pdfjs;

const root = path.resolve(__dirname, '..');
const outFile = path.join(root, 'data', 'parcels.json');
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
  // Require a strong street match and a decisive lead over the runner-up.
  if (!candidates.length || candidates[0].score < 0.82) return null;
  if (candidates[1] && candidates[0].score - candidates[1].score < 0.08) return null;
  return candidates[0].point;
}

async function apnAtPoint(latLng) {
  if (!Array.isArray(latLng) || latLng.length < 2) return null;
  const [lat, lon] = latLng.map(Number);
  const params = new URLSearchParams({ f: 'json', where: '1=1', outFields: 'APN,LandUse1', returnGeometry: 'false', geometry: `${lon},${lat}`, geometryType: 'esriGeometryPoint', inSR: 4326, spatialRel: 'esriSpatialRelIntersects', resultRecordCount: 1 });
  const attrs = (await (await fetchOk(`${GIS}?${params}`)).json()).features?.[0]?.attributes;
  if (!attrs) return null;
  return { apn: normalizeApn(attrs.APN), landUse: String(attrs.LandUse1 || '') };
}

// County right-of-way features can contain an MLS road-centerline pin.  They
// are not sale parcels, so retain these listings as unverified point markers.
function usableParcel(match) {
  return match?.apn && !['004', '005', '008'].includes(match.landUse);
}

async function privateRecords(items) {
  const records = [], unmapped = [];
  for (let i = 0; i < items.length; i += 12) {
    const batch = items.slice(i, i + 12);
    const addressPoints = await Promise.all(batch.map(item => countyAddressPoint(item).catch(() => null)));
    const matches = await Promise.all(batch.map((item, index) => apnAtPoint(addressPoints[index] || item.latLng).catch(() => null)));
    batch.forEach((item, index) => {
      const match = matches[index];
      const listedApn = explicitApn(item);
      const verifiedAddress = Boolean(addressPoints[index]);
      const apn = listedApn || (verifiedAddress && usableParcel(match) ? match.apn : '');
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
        parcelMatchSource: listedApn ? 'listing APN' : 'county address point',
        mlsNumber: item.mlsNo
      };
      if (apn) records.push(record);
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
  const privateData = await privateRecords(mls);
  const privateRows = privateData.records;
  const records = [...privateRows, ...auctions];
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
    generatedAt: new Date().toISOString(), sources: { mls: MLS_SOURCES.map(source => ({ name: source.name, api: source.api })), auctions: TAX_PAGE, parcels: GIS },
    counts: { mlsLandListings: mls.length, privateMapped: privateRows.length, privateUnmapped: privateData.unmapped.length, publicRecords: auctions.length, mappedParcels: features.length },
    unmappedListings: privateData.unmapped,
    type: 'FeatureCollection', features
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(output));
  console.log(`Wrote ${features.length} mapped parcels (${privateRows.length} private, ${auctions.length} public records) to data/parcels.json`);
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
