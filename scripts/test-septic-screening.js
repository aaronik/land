'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { keyQuery, ratingQuery, aggregate } = require('./refresh-septic-screening');

(async () => {
  assert.match(keyQuery(), /SDA_Get_Mukey_from_intersection_with_WktWgs84/);
  assert.match(ratingQuery(['10']), /i\.interphrc, i\.interphr/);
  assert.throws(() => ratingQuery(["10'"]));
  const sample = aggregate(['10', '11', '12'], [
    ['10', '1', '38', '0', 'Not limited', '0'],
    ['10', '2', '22', '0', 'Very limited', '1'],
    ['10', '2', '22', '1', 'Slope', '0.8'],
    ['10', '2', '22', '1', 'Depth to bedrock', '1'],
    ['10', '3', '21', '0', 'Very limited', '1'],
    ['10', '3', '21', '1', 'Slope', '0.3'],
    ['10', '3', '21', '1', 'Not rated; water', '1'],
    ['10', '3', '21', '1', 'Zero score', '0'],
    ['10', '4', '19', '0', 'Not rated', null],
    ['11', '5', '40', '0', 'Somewhat limited', '0.2'],
    ['11', '6', '40', '0', 'Very limited', '1']
  ]);
  assert.deepEqual(sample, { 10: ['Very limited', 43, ['Depth to bedrock', 'Slope']], 11: ['Very limited', 40, []], 12: null });

  const { septicColorExpression, septicRating, septicPopupHtml, SEPTIC_LAYER_ID } = await import('../assets/map/septic-screening.js');
  const { createExpression } = await import('@maplibre/maplibre-gl-style-spec');
  const snapshot = require('../assets/data/septic-screening.json');
  const expression = septicColorExpression();
  const parsed = createExpression(expression, 'layers[0].paint.fill-color');
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  assert.equal(parsed.value.evaluate({}, { properties: { mukey: 459010 } }), '#d49a31');
  assert.equal(parsed.value.evaluate({}, { properties: { mukey: '459054' } }), '#92949c');
  const styleByKey = new Map();
  for (let i = 2; i < expression.length - 1; i += 2) {
    for (const key of expression[i]) {
      assert.ok(!styleByKey.has(key));
      styleByKey.set(key, expression[i + 1]);
    }
  }
  for (const [key, row] of Object.entries(snapshot.mapUnits)) {
    if (!row) assert.ok(!styleByKey.has(key));
    else {
      assert.ok(styleByKey.has(key));
      assert.ok(row[1] > 0 && row[1] <= 100);
      assert.equal(row[2].length, new Set(row[2]).size);
    }
  }
  assert.deepEqual(septicRating(459010), { label: 'Somewhat limited', share: 85, reasons: ['Slow water movement', 'Slope'] });
  assert.equal(septicRating('459054').label, 'Not rated');
  assert.equal(septicRating('not-an-id').label, 'No matching SSURGO rating');
  assert.match(septicPopupHtml({ mukey: 459010, muname: '<script>' }), /&lt;script&gt;.*85%.*Slow water movement/);

  const page = new JSDOM(fs.readFileSync('index.html', 'utf8'));
  const doc = page.window.document;
  assert.equal(doc.querySelector(`[data-map-layer="${SEPTIC_LAYER_ID}"]`).defaultChecked, false);
  const colors = [...doc.querySelectorAll(`[data-layer-key="${SEPTIC_LAYER_ID}"] span i`)].map(item => item.style.getPropertyValue('--key-color'));
  assert.deepEqual(new Set(colors), new Set([...styleByKey.values(), expression.at(-1)]));

  const dom = new JSDOM('<div id="details"></div>', { url: 'http://localhost/' });
  global.document = dom.window.document;
  global.localStorage = dom.window.localStorage;
  const { createParcelDetails } = await import('../assets/ui/parcel-details.js');
  const detailsElement = document.querySelector('#details');
  const lookup = 'https://example.test/query';
  global.fetch = async () => ({ ok: true, json: async () => ({ features: [] }) });
  const { showParcelDetails } = createParcelDetails({
    detailsElement, getSaleData: () => ({ features: [] }), getApnIndex: () => ({}), featureCenter: () => null, onClose: () => {},
    parcelsQueryUrl: lookup, addressPointsQueryUrl: lookup, wildfirePerimetersQueryUrl: lookup, recentWildfirePerimetersQueryUrl: lookup
  });
  showParcelDetails({ APN: '123-456-789' }, null);
  const section = detailsElement.querySelector('.research + section');
  assert.match(section.textContent, /Septic permit history.*does not mean.*123-456-789/);
  assert.match(section.querySelector('a').href, /^https:\/\/www\.siskiyoucounty\.gov\/.*property_information_inquiry_form\.pdf$/);
  console.log('Septic screening snapshot, legend, popup and county APN guidance checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
