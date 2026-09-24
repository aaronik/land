'use strict';
const assert = require('assert/strict');

(async () => {
  const { createParcelDetails } = await import('../assets/ui/parcel-details.js');
  global.localStorage = { getItem: () => null };
  const detailsElement = { innerHTML: '', querySelector: () => null };
  const tax = { kind: 'tax-delinquent', category: 'tax-delinquent', redemptionAmount: 1250, paymentPlan: 'None', source: 'County treasurer', sourceUrl: 'https://example.test/tax', checkedAt: '2026-01-01' };
  const saleData = { features: [
    { properties: { APN: '123-456-789', records: [{ kind: 'private', category: 'private-land', title: 'For sale' }] } },
    { properties: { APN: '123-456-789', records: [tax] } }
  ] };
  const { showParcelDetails } = createParcelDetails({
    detailsElement, getSaleData: () => saleData, getApnIndex: () => ({}),
    featureCenter: () => null, directionsOrigin: 'Mt. Shasta', onClose: () => {}
  });
  // Simulates clicking the parcel boundary with the tax layer hidden.
  showParcelDetails({ APN: '123-456-789' }, null);
  assert.equal(detailsElement.innerHTML.match(/current defaulted-tax balance/g)?.length, 1);
  assert.ok(detailsElement.innerHTML.indexOf('tax-delinquency') < detailsElement.innerHTML.indexOf('Sales history'));
  assert.ok(detailsElement.innerHTML.includes('Official current tax record'));
  assert.ok(!detailsElement.innerHTML.includes('class="record public tax-delinquent"'));
  // A visible listing for the same APN must remain above the tax section.
  showParcelDetails({ APN: '123-456-789' });
  assert.ok(detailsElement.innerHTML.includes('For sale'));
  assert.ok(detailsElement.innerHTML.indexOf('tax-delinquency') > detailsElement.innerHTML.indexOf('For sale'));
  assert.equal(detailsElement.innerHTML.match(/current defaulted-tax balance/g)?.length, 1);
  // Clicking the tax marker when visible must not duplicate its card at the top.
  showParcelDetails({ APN: '123-456-789', records: [tax] }, { properties: { APN: '123-456-789', records: [tax] } });
  assert.equal(detailsElement.innerHTML.match(/current defaulted-tax balance/g)?.length, 1);
  showParcelDetails({ APN: '000-000-000' }, null);
  assert.ok(!detailsElement.innerHTML.includes('tax-delinquency'));
  console.log('Passed: tax delinquency parcel card tests.');
})().catch(error => { console.error(error); process.exit(1); });
