'use strict';
const assert = require('assert/strict');
const { assess, candidateParcels, mergeQueue, validate } = require('./apn-research');

const listing = { mlsNumber: 'TEST100', title: 'Lot 4 Sample Rd, Weed, CA', acres: 5, price: 10000, url: 'https://example.com/listing', latLng: [41, -122], locationSource: 'MLS', propertyType: 'land' };
const old = { schemaVersion: 1, items: { TEST100: { listingId: 'TEST100', status: 'needs_evidence', evidence: [{ id: 'e001', type: 'listing', signals: ['road'], url: 'https://example.com', apns: [] }], candidates: [], ruledOutApns: [], createdAt: 'old' } } };
const merged = mergeQueue(old, [listing], 'now');
assert.equal(merged.items.TEST100.evidence.length, 1);
assert.equal(merged.items.TEST100.createdAt, 'old');
assert.equal(Object.keys(mergeQueue(merged, [listing], 'later').items).length, 1);

const item = { listingId: 'TEST100', status: 'needs_evidence', candidates: [
  { apn: '001-002-003', selected: true }, { apn: '001-002-004', selected: false }
], ruledOutApns: [], evidence: [
  { id: 'e001', type: 'county_gis', signals: ['acreage'], source: 'county', apns: ['001-002-003'] },
  { id: 'e002', type: 'listing', signals: ['location', 'road'], url: 'https://example.com/listing', apns: ['001-002-003'] }
] };
assert.equal(assess(item).ready, false, 'competitor must block resolution');
item.ruledOutApns.push('001-002-004');
assert.equal(assess(item).ready, true, 'GIS + 3 signals + 2 sources can pass');
item.evidence = item.evidence.slice(1);
assert.equal(assess(item).ready, false, 'GIS verification is mandatory');
item.evidence.push({ id: 'e003', type: 'photo', signals: ['boundary_image'], source: 'photo', apns: ['001-002-003'] });
assert.equal(assess(item).ready, false, 'boundary evidence does not replace GIS verification');
assert.deepEqual(validate({ schemaVersion: 1, items: { TEST100: item } }), []);
item.status = 'ready';
assert.match(validate({ schemaVersion: 1, items: { TEST100: item } }).join(' '), /confidence gates fail/);
item.status = 'inconclusive';
assert.deepEqual(validate({ schemaVersion: 1, items: { TEST100: item } }), [], 'reviewed inconclusive state is valid');
console.log('Passed: evidence-backed APN research queue and confidence gates.');
