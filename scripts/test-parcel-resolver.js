'use strict';

const assert = require('assert');
const { lotNumber, resolveGroup, resolveSingleton, resolveUnmappedParcels } = require('./parcel-resolver');

function lot(mlsNumber, number, acres, latLng = [41.413778, -122.372076]) {
  return { mlsNumber, title: `Lot ${number} Meadow Ln, Weed, CA 96094`, acres, latLng, category: 'private-land' };
}

function testLotParsing() {
  assert.equal(lotNumber(lot('1', 25, 14.19)), 25);
  assert.equal(lotNumber({ title: '25 Meadow Ln' }), null);
}

function testCorroboratedSequence() {
  const group = { records: [lot('20250318', 25, 14.19), lot('20250321', 26, 4.15)] };
  const parcels = [
    { apn: '021-750-250', acres: 14.19 },
    { apn: '021-750-260', acres: 4.15 },
    { apn: '999-999-250', acres: 3 }
  ];
  const result = resolveGroup(group, parcels);
  assert.deepEqual(result.resolved.map(match => match.parcel.apn), ['021-750-250', '021-750-260']);
}

function testSingleMatchDoesNotResolve() {
  const group = { records: [lot('1', 25, 14.19), lot('2', 26, 99)] };
  const result = resolveGroup(group, [{ apn: '021-750-250', acres: 14.19 }]);
  assert.equal(result.resolved.length, 0);
}

function testAmbiguousCandidateDoesNotResolve() {
  const group = { records: [lot('1', 25, 14.19), lot('2', 26, 4.15)] };
  const parcels = [
    { apn: '021-750-250', acres: 14.19 }, { apn: '999-999-250', acres: 14.19 },
    { apn: '021-750-260', acres: 4.15 }, { apn: '999-999-260', acres: 4.15 }
  ];
  assert.equal(resolveGroup(group, parcels).resolved.length, 0);
}

function testShiftedSequence() {
  const group = { records: [lot('a', 37, 2.53), lot('b', 38, 2.51), lot('c', 40, 10.06), lot('d', 46, 2.5)] };
  const parcels = [
    { apn: '021-760-020', acres: 2.53 }, { apn: '021-760-030', acres: 2.51 },
    { apn: '021-760-050', acres: 10.06 }, { apn: '021-760-110', acres: 2.5 }
  ];
  const result = resolveGroup(group, parcels);
  assert.equal(result.model.lotOffset, -35);
  assert.deepEqual(result.resolved.map(match => match.parcel.apn), ['021-760-020', '021-760-030', '021-760-050', '021-760-110']);
}

function testTwoListingShiftedSequenceDoesNotResolve() {
  const group = { records: [lot('a', 15, 2.65), lot('b', 16, 2.51)] };
  const parcels = [{ apn: '037-190-330', acres: 2.65 }, { apn: '037-190-340', acres: 2.5 }];
  assert.equal(resolveGroup(group, parcels).resolved.length, 0);
}

function testSingletonWithEstablishedPrefix() {
  const record = lot('20250322', 27, 4.83, [41.408765, -122.375345]);
  const result = resolveSingleton(record, [
    { apn: '021-750-270', acres: 4.83 },
    { apn: '999-999-270', acres: 4.83 }
  ], new Set(['021-750|0']));
  assert.equal(result.resolved[0].parcel.apn, '021-750-270');
  assert.equal(resolveSingleton(record, [{ apn: '999-999-270', acres: 4.83 }], new Set(['021-750|0'])).resolved.length, 0);
}

async function testResolutionOutput() {
  const records = [lot('20250318', 25, 14.19), lot('20250321', 26, 4.15), { ...lot('3', 8, 5), latLng: [40, -120] }];
  const result = await resolveUnmappedParcels(records, async latLng => latLng[0] > 41 ? [
    { apn: '021-750-250', acres: 14.19 }, { apn: '021-750-260', acres: 4.15 }
  ] : []);
  assert.equal(result.resolved.length, 2);
  assert.equal(result.unmapped.length, 1);
  assert.equal(result.report.mappedListings, 2);
  assert.equal(result.resolved[0].parcelMatchEvidence.resolver, 'subdivision-lot-sequence-v3');
}

(async () => {
  testLotParsing();
  testCorroboratedSequence();
  testSingleMatchDoesNotResolve();
  testAmbiguousCandidateDoesNotResolve();
  testShiftedSequence();
  testTwoListingShiftedSequenceDoesNotResolve();
  testSingletonWithEstablishedPrefix();
  await testResolutionOutput();
  console.log('Passed: conservative secondary parcel resolver tests.');
})().catch(error => { console.error(error); process.exit(1); });
