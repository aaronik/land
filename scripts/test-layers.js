'use strict';

const assert = require('assert');
const { fetchArcGISLayer, normalizeApn, listingConfidence } = require('./layers');

async function testPaginationCompleteness() {
  const calls = [];
  const request = async params => {
    calls.push(params);
    if (params.returnCountOnly === 'true') return { count: 3 };
    const all = [
      { type: 'Feature', properties: { OBJECTID: 1, APN: '001-002-003' }, geometry: null },
      { type: 'Feature', properties: { OBJECTID: 2, APN: '001-002-004' }, geometry: null },
      { type: 'Feature', properties: { OBJECTID: 3, APN: '001-002-005' }, geometry: null }
    ];
    return { type: 'FeatureCollection', features: all.slice(Number(params.resultOffset), Number(params.resultOffset) + 2) };
  };
  const result = await fetchArcGISLayer({ url: 'https://example.test/0', fields: ['APN'], pageSize: 2 }, request);
  assert.equal(result.features.length, 3);
  assert.deepEqual(calls.filter(call => call.resultOffset !== undefined).map(call => call.resultOffset), [0, 2]);
  assert(calls.every(call => call.outSR === undefined || call.outSR === '4326'));
}

async function testIncompleteDownloadFails() {
  const request = async params => params.returnCountOnly === 'true' ? { count: 2 } : { features: [] };
  await assert.rejects(() => fetchArcGISLayer({ url: 'https://example.test/0', fields: ['APN'] }, request), /collected 0 of 2/);
}

function testMatchingConfidence() {
  assert.equal(normalizeApn('001002003'), '001-002-003');
  assert.equal(listingConfidence({ source: 'listing APN', listedAcres: 40, gisAcres: 40 }), 'provided');
  assert.equal(listingConfidence({ source: 'county address point', listedAcres: 40, gisAcres: 39 }), 'probable');
  assert.equal(listingConfidence({ source: 'county address point', listedAcres: 100, gisAcres: 40 }), 'possible_multi_parcel');
  assert.equal(listingConfidence({ source: 'county address point', listedAcres: 20, gisAcres: 100 }), 'ambiguous');
  assert.equal(listingConfidence({ source: '', listedAcres: 20, gisAcres: null }), 'unmatched');
}

(async () => {
  await testPaginationCompleteness();
  await testIncompleteDownloadFails();
  testMatchingConfidence();
  console.log('Passed: ArcGIS pagination and listing confidence tests.');
})().catch(error => { console.error(error); process.exit(1); });
