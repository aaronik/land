'use strict';
const assert = require('assert/strict');

(async () => {
  const { listingUrl } = await import('../assets/data/listing-url.js');
  const { createParcelDetails } = await import('../assets/ui/parcel-details.js');
  const path = '/idx/listing/CA-SISKIYOU/20260971/17025-Patricia-Ave-Montague-CA-96097';
  const oldUrl = `https://www.mountshastarealty.com${path}`;
  const repaired = `https://www.realtymtshasta.com${path}`;
  assert.equal(listingUrl({ url: oldUrl }), repaired);
  assert.equal(listingUrl({ url: `${oldUrl}?view=photos#details` }), `${repaired}?view=photos#details`);
  assert.equal(listingUrl({ url: oldUrl.replace('www.', '') }), repaired);
  for (const url of [repaired, oldUrl.replace('CA-SISKIYOU', 'CA-MRMLS'), 'https://example.com/property', 'https://www.mountshastarealty.com/contact-me', '', undefined]) {
    assert.equal(listingUrl({ url }), url || '');
  }
  const { recordCard } = createParcelDetails({});
  for (const category of ['private-home', 'private-land']) {
    const html = recordCard({ kind: 'private', category, url: oldUrl, primaryPhoto: 'https://example.com/photo.jpg' });
    assert.equal(html.split(`href="${repaired}"`).length - 1, 2, 'photo and Open listing use the repaired destination');
    assert.ok(!html.includes(oldUrl));
  }
  console.log('Passed: listing URL routing and card link tests.');
})().catch(error => { console.error(error); process.exit(1); });
