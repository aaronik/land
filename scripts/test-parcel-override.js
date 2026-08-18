'use strict';

const assert = require('assert');
const { patchMapData } = require('./parcel-override');

function countyFeature(apn) {
  return {
    type: 'Feature',
    properties: { APN: apn, Acres: 2, LandUse1: '100', Zoning1: 'R-R' },
    geometry: { type: 'Polygon', coordinates: [] }
  };
}

const listing = {
  kind: 'private', mlsNumber: 'MC26015313', title: 'Lot 1 Example Road',
  propertyType: 'land', parcelMatchSource: 'unresolved', latLng: [41, -122]
};
const other = { kind: 'public', mlsNumber: '', title: 'Auction' };
const input = {
  type: 'FeatureCollection',
  counts: { privateMapped: 0, privateUnmapped: 1, publicRecords: 1, mappedParcels: 1 },
  unmappedListings: [listing],
  features: [{ ...countyFeature('001-002-003'), properties: { ...countyFeature('001-002-003').properties, records: [other] } }]
};
const override = { apns: ['021-520-380', '021-520-390'], source: 'manual override', confidence: 'verified' };
const output = patchMapData(input, 'MC26015313', override, override.apns.map(countyFeature));

assert.equal(output.unmappedListings.length, 0);
assert.equal(output.features.length, 3);
assert.equal(output.counts.privateMapped, 2);
assert.equal(output.counts.privateUnmapped, 0);
for (const apn of override.apns) {
  const record = output.features.find(feature => feature.properties.APN === apn).properties.records[0];
  assert.equal(record.APN, apn);
  assert.equal(record.parcelMatchSource, override.source);
  assert.equal(record.category, 'private-land');
  assert.ok(!('latLng' in record));
}

const moved = patchMapData(output, 'MC26015313', { ...override, apns: ['021-520-400'] }, [countyFeature('021-520-400')]);
assert.equal(moved.features.length, 2);
assert.ok(!moved.features.some(feature => ['021-520-380', '021-520-390'].includes(feature.properties.APN)));
assert.ok(moved.features.some(feature => feature.properties.APN === '021-520-400'));

assert.throws(() => patchMapData(input, 'MISSING', override, []), /not in current map data/);
console.log('Passed: incremental parcel override map patching.');
