'use strict';
const assert = require('assert/strict');
const { addressStreetKey, addressStreetsEquivalent, preferredUnmappedLocation, selectCountyAddressCandidate, streetCandidatesForCity, streetSimilarity } = require('./refresh-data');

assert.equal(addressStreetKey('565 Main'), addressStreetKey('565 Main Street'));
assert.equal(addressStreetKey('161 S 13th'), addressStreetKey('161 South 13th Street'));
assert.notEqual(addressStreetKey('219 S California'), addressStreetKey('219 North California Street'));
assert.equal(addressStreetsEquivalent('565 Main', '565 Main Street'), true);
assert.equal(addressStreetsEquivalent('537 N Adams Dr', '537 Adams Drive'), true);
assert.equal(addressStreetsEquivalent('219 S California', '219 North California Street'), false);
assert.equal(addressStreetsEquivalent('311 Perry Street', '311 Perry Avenue'), false);
assert.equal(addressStreetKey('931 E Oberlin Rd E'), addressStreetKey('931 East Oberlin Road'));
assert.equal(addressStreetsEquivalent('422 N Main N', '422 North Main Street'), true);
assert.equal(addressStreetsEquivalent('1085 N Foothill Dr. North', '1085 North Foothill Drive'), true);
assert.equal(addressStreetsEquivalent('931 E Oberlin Rd W', '931 East Oberlin Road'), false);
assert.equal(addressStreetsEquivalent('931 E Oberlin Rd E', '931 West Oberlin Road'), false);
assert.equal(addressStreetsEquivalent('931 E Oberlin Rd E', '931 East Oberlin Avenue'), false);
assert.notEqual(streetSimilarity('931 Oberlin Rd E', '931 Oberlin Rd'), 1, 'a lone postdirection is not redundant');
assert.equal(streetSimilarity('931 E Oberlin Rd E', '931 East Oberlin Road'), 1);
const corrected = preferredUnmappedLocation({ streetAddress: 'Lot 52 Spearpoint Rd' }, [41.31519, -122.289195], { point: [41.5265, -122.38], source: 'county street' });
assert.deepEqual(corrected.point, [41.5265, -122.38]);
assert.match(corrected.source, /MLS pin rejected/);
assert.deepEqual(preferredUnmappedLocation({ streetAddress: '537 N Adams Dr' }, [41.3, -122.3], { point: [42, -123], source: 'county street' }).point, [41.3, -122.3]);
assert.deepEqual(streetCandidatesForCity([{ cityMatch: false }, { cityMatch: false }], 'HORNBROOK'), []);
assert.equal(streetCandidatesForCity([{ cityMatch: false }, { cityMatch: true }], 'HORNBROOK').length, 1);
assert.equal(streetCandidatesForCity([{ cityMatch: false }], '').length, 1);

const north = { score: streetSimilarity('612 N Mt. Shasta Blvd', '612 North Mount Shasta Boulevard'), point: [41.31658, -122.31634] };
const south = { score: streetSimilarity('612 N Mt. Shasta Blvd', '612 South Mount Shasta Boulevard'), point: [41.30835, -122.31077] };
assert.equal(north.score, 1);
assert.deepEqual(selectCountyAddressCandidate([south, north]), north.point, 'unique exact normalized address must win');
assert.deepEqual(selectCountyAddressCandidate([{ score: 1, exactStreet: true, point: [41, -122] }, { score: 0.7, exactStreet: false, point: [42, -123] }]), [41, -122]);
assert.equal(selectCountyAddressCandidate([{ score: 1, exactStreet: true, point: [41, -122] }, { score: 1, exactStreet: true, point: [42, -123] }]), null);
assert.equal(selectCountyAddressCandidate([
  { score: 1, point: [41, -122] }, { score: 1, point: [42, -123] }
]), null, 'two exact addresses remain ambiguous');
assert.equal(selectCountyAddressCandidate([
  { score: 0.9, point: [41, -122] }, { score: 0.85, point: [42, -123] }
]), null, 'close fuzzy matches remain ambiguous');
console.log('Passed: exact county address matching and ambiguity safeguards.');
