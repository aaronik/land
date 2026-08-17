'use strict';

const assert = require('assert');
const { fetchArcGISLayer, parseSoilGml, normalizeApn, listingConfidence, LAYERS } = require('./layers');

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

function testSoilGmlParsing() {
  const xml = '<gml:featureMember><ms:mapunitpolyextended fid="soil.1"><ms:multiPolygon><gml:MultiPolygon><gml:polygonMember><gml:Polygon><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates>41,-122 41,-121 42,-121 41,-122</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs></gml:Polygon></gml:polygonMember></gml:MultiPolygon></ms:multiPolygon><ms:mukey>123</ms:mukey><ms:muname>Test &amp; soil</ms:muname><ms:drclassdcd>Well drained</ms:drclassdcd></ms:mapunitpolyextended></gml:featureMember>';
  const features = parseSoilGml(xml, ['mukey', 'muname', 'drclassdcd']);
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].geometry.coordinates[0][0], [-122, 41]);
  assert.equal(features[0].properties.muname, 'Test & soil');
}

function testMatchingConfidence() {
  assert.equal(normalizeApn('001002003'), '001-002-003');
  assert.equal(listingConfidence({ source: 'listing APN', listedAcres: 40, gisAcres: 40 }), 'provided');
  assert.equal(listingConfidence({ source: 'county address point', listedAcres: 40, gisAcres: 39 }), 'probable');
  assert.equal(listingConfidence({ source: 'county address point', listedAcres: 100, gisAcres: 40 }), 'possible_multi_parcel');
  assert.equal(listingConfidence({ source: 'county address point', listedAcres: 20, gisAcres: 100 }), 'ambiguous');
  assert.equal(listingConfidence({ source: '', listedAcres: 20, gisAcres: null }), 'unmatched');
}

function testActiveRailroadSource() {
  const railroads = LAYERS.railroads;
  assert.match(railroads.url, /NTAD_North_American_Rail_Network_Lines/);
  assert.equal(railroads.where, "NET IN ('M','I','O','S','Y','Z') OR (NET = 'X' AND RROWNER1 = 'MCR')");
  assert(railroads.fields.includes('NET'));
  assert(railroads.fields.includes('RROWNER1'));
}

function testWaterwaysSource() {
  const waterways = LAYERS.waterways;
  assert.match(waterways.url, /hydro\.nationalmap\.gov.*\/nhd\/MapServer\/6/);
  assert.equal(waterways.where, 'ftype = 460');
  assert(waterways.fields.includes('gnis_name'));
  assert(waterways.fields.includes('fcode'));
}

(async () => {
  await testPaginationCompleteness();
  await testIncompleteDownloadFails();
  testSoilGmlParsing();
  testMatchingConfidence();
  testActiveRailroadSource();
  testWaterwaysSource();
  console.log('Passed: ArcGIS pagination, transportation, waterways, and listing confidence tests.');
})().catch(error => { console.error(error); process.exit(1); });
