'use strict';

const assert = require('node:assert/strict');
const { restoreArchivedResearchListings } = require('./refresh-data');

const generatedAt = '2026-09-15T16:01:24.940Z';
const item = {
  active: false,
  listing: { title: '4 acres Bartel - McCloud River', price: 250000, acres: 4, propertyType: 'land', listingUrl: 'https://example.com/listing/20261116' },
  createdAt: '2026-09-12T22:13:28.077Z',
  updatedAt: '2026-09-12T22:13:28.077Z'
};
const research = { items: { '20261116': item } };
const override = { apns: ['027-070-170'], source: 'manual override', confidence: 'manually verified' };
const overrides = { '20261116': override };
const links = { '20261116': { apns: ['001-002-003'], source: 'persisted match', confidence: 'verified' } };
const emptyArchive = () => ({ schemaVersion: 1, listings: {} });
const restore = (overrides, links, queue = research) => restoreArchivedResearchListings(emptyArchive(), generatedAt, queue, overrides, links);

const recovered = restore(overrides, {});
const record = recovered.listings['20261116:027-070-170'];
assert.ok(record, 'recover an override-only listing without a persisted MLS link');
assert.equal(record.parcelMatchSource, override.source);
assert.equal(record.parcelMatchConfidence, override.confidence);
assert.equal(record.title, item.listing.title);
assert.equal(record.price, 250000);
assert.equal(record.url, item.listing.listingUrl);
assert.equal(record.firstSeenAt, item.createdAt);
assert.equal(record.disappearedAt, item.updatedAt);
assert.equal(record.disappearanceDateSource, 'retained research record');
assert.equal(record.kind, 'private');
assert.ok(!record.soldDate && !record.soldPrice && record.status !== 'Sold', 'disappearance is not a confirmed sale');
assert.deepEqual(restore(overrides, links), recovered, 'manual override wins over a conflicting persisted link');
assert.ok(restore({}, links).listings['20261116:001-002-003'], 'persisted links still work');
for (const apns of [[], ['invalid']]) {
  assert.deepEqual(restore({ '20261116': { apns } }, links), restore({}, links), 'unusable overrides fall back to persisted links');
}
assert.deepEqual(restore({}, {}).listings, {}, 'unmatched listings stay unmapped');
for (const excluded of [{ ...item, active: true }, { ...item, active: undefined }, { ...item, listing: null }]) {
  assert.deepEqual(restore(overrides, {}, { items: { '20261116': excluded } }).listings, {});
}
const multi = restore({ '20261116': { ...override, apns: ['027070170', '027-070-180', 'invalid'] } }, {});
assert.deepEqual(Object.keys(multi.listings), ['20261116:027-070-170', '20261116:027-070-180']);
record.lastSeenAt = '2026-09-14T00:00:00Z';
const before = structuredClone(recovered);
restoreArchivedResearchListings(recovered, generatedAt, research, overrides, {});
assert.deepEqual(recovered, before, 'repeated recovery preserves existing archive records');
console.log('Passed: archived listing recovery honors manual overrides.');
