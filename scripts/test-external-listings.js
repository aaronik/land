'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dealerStatus, refreshExternalListings } = require('./external-listings');

const url = 'https://www.californiaoutdoorproperties.com/listing/40-acres-siskiyou-420';
const item = { url, listingSource: 'California Outdoor Properties', status: 'For Sale' };
assert.equal(dealerStatus('<a href="/property_type/sold">Sold</a>'), null);
assert.equal(dealerStatus('<img src="https://www.californiaoutdoorproperties.com/wp-content/themes/rumor_skel_co/images/icon_sold.png">'), 'Sold');
assert.equal(dealerStatus('<img src="/images/photo.jpg">'), null);

(async () => {
  const logger = { warn: () => {} };
  assert.equal((await refreshExternalListings([item], async () => '<img src="/images/icon_sold.png">', logger))[0].status, 'Sold');
  assert.equal((await refreshExternalListings([item], async () => '<a href="/property_type/sold">Sold</a>', logger))[0].status, 'For Sale');
  assert.equal((await refreshExternalListings([{ ...item, status: 'Sold' }], async () => { throw Error('403'); }, logger))[0].status, 'Sold');
  assert.equal((await refreshExternalListings([{ ...item, referenceListing: true, status: 'Coming Soon' }], async () => '<img src="/images/icon_sold.png">', logger))[0].status, 'Coming Soon');
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/parcels.json'), 'utf8'));
  const parcel = data.features.find(feature => feature.properties.APN === '036-250-420');
  assert.ok(parcel.properties.soldExternalListings.some(record => record.status === 'Sold' && record.url === url));
  assert.ok(!parcel.properties.records.some(record => record.url === url));
  const upcoming = data.features.find(feature => feature.properties.APN === '036-250-440');
  assert.equal(upcoming.properties.Acres, 30.45);
  assert.ok(upcoming.properties.records.some(record => record.status === 'Coming Soon' && record.referenceListing && record.url === url && !record.price));
  assert.deepEqual(upcoming.properties.soldExternalListings, []);
  console.log('Passed: dealer sold badge, reference-link isolation, blocked fetch fallback, and mapped statuses.');
})().catch(error => { console.error(error); process.exitCode = 1; });
