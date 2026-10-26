'use strict';
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

(async () => {
  const { createParcelDetails } = await import('../assets/ui/parcel-details.js');
  const dom = new JSDOM('<div id="details"></div>', { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  const requests = [];
  let countyValue = 0;
  global.fetch = async url => {
    const request = new URL(url);
    requests.push(request);
    if (request.pathname.includes('Siskiyou_Parcels_Public')) return { ok: true, json: async () => ({ features: [{ attributes: { Acres: countyValue, Shape__Area: 117463.9501953125 } }] }) };
    if (request.pathname.includes('CDD_Zoning_Districts_Public')) return { ok: true, json: async () => ({ features: [{ attributes: { zoning: 'R-R-B-40' } }] }) };
    if (request.pathname.includes('AddressPoints')) return { ok: true, json: async () => ({ features: [] }) };
    return { ok: true, json: async () => ({ features: [] }) };
  };
  const detailsElement = document.querySelector('#details');
  const { showParcelDetails } = createParcelDetails({
    detailsElement, getSaleData: () => ({ features: [] }),
    getApnIndex: () => ({ '037-390-050': { bbox: [-122.289, 41.299, -122.287, 41.301], acres: null } }),
    featureCenter: () => null, directionsOrigin: 'Mt. Shasta', municipalZoningUrl: null,
    parcelsQueryUrl: 'https://example.test/Siskiyou_Parcels_Public/query',
    addressPointsQueryUrl: 'https://example.test/AddressPoints/query',
    wildfirePerimetersQueryUrl: 'https://example.test/fires/query',
    recentWildfirePerimetersQueryUrl: 'https://example.test/recent-fires/query',
    onClose: () => {}
  });
  showParcelDetails({ APN: '037-390-050', Acres: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(detailsElement.querySelector('[data-selected-acreage]').textContent, '≈2.70 acres');
  assert.equal(detailsElement.querySelector('[data-selected-zoning]').textContent, ' · RRB40');
  assert.equal(detailsElement.querySelector('[data-zoning-explainer]').getAttribute('aria-label'), 'Learn about R-R-B-40 zoning');
  assert.equal(detailsElement.querySelector('.meta').textContent, '≈2.70 acres · RRB40 · 037-390-050');
  assert.equal(detailsElement.querySelector('.meta span:last-child').textContent, ' · 037-390-050');
  assert(requests.some(request => request.searchParams.get('outFields') === 'APN,Acres,Shape__Area'));
  const parcelRequests = () => requests.filter(request => request.pathname.includes('Siskiyou_Parcels_Public') && request.searchParams.get('outFields') === 'APN,Acres,Shape__Area').length;
  countyValue = 2.47;
  showParcelDetails({ APN: '037-390-030', Acres: 2.47 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(detailsElement.querySelector('[data-selected-acreage]').textContent, '2.47 acres');
  assert.equal(parcelRequests(), 1, 'positive county acreage should not trigger a calculated-area query');
  showParcelDetails({ APN: '037-390-040', Acres: 0 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(detailsElement.querySelector('[data-selected-acreage]').textContent, '2.47 acres');
  countyValue = null;
  showParcelDetails({ APN: '037-390-060', Acres: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(detailsElement.querySelector('[data-selected-acreage]').textContent, '≈2.70 acres');
  console.log('Passed: county-first parcel acreage with calculated fallback.');
})().catch(error => { console.error(error); process.exit(1); });
