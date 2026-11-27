const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { matchParcelUtilities, renderParcelUtilityEvidence, UTILITY_LAYER_GROUPS } = await import('../assets/map/utilities.js');
  const ring = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
  const parcel = [ring(0, 0, 10), ring(3, 3, 4), ring(15, 15, 2)];
  const f = (type, coordinates, id, feed = 'water-meter') => ({ id, geometry: { type, coordinates }, properties: { feed, name: '<img onerror=x>' } });
  const features = [
    f('Point', [2, 2], 'inside'), f('Point', [4, 4], 'hole'), f('Point', [3, 4], 'on hole boundary'),
    f('Point', [12, 12], 'bbox gap'), f('Point', [16, 16], 'second component'),
    f('LineString', [[-1, 4], [20, 4]], 'crosses with endpoints outside', 'sewer-lines'),
    f('LineString', [[4, 4], [5, 5]], 'line in hole'), f('LineString', [[12, 1], [15, 1]], 'nearby line without intersection'),
    f('Polygon', [ring(4, 4, 1)], 'polygon in hole'), f('Polygon', [ring(-1, -1, 12)], 'contains parcel', 'electric-iou'),
    f('MultiPolygon', [[ring(4, 4, 1)], [ring(16, 16, 2)]], 'multipart overlap', 'sewer-district')
  ];
  const matches = matchParcelUtilities([parcel], features);
  assert.deepEqual(matches.map(feature => feature.id), ['inside', 'on hole boundary', 'second component', 'crosses with endpoints outside', 'contains parcel', 'multipart overlap']);
  const html = renderParcelUtilityEvidence(matches, '2026-11-26');
  const result = markup => new (require('jsdom').JSDOM)(markup).window.document;
  const view = result(html);
  const findings = [...view.querySelectorAll('.utility-findings p')].map(node => node.textContent);
  assert.match(findings[0], /3 mapped water meters/);
  assert.match(findings[1], /mapped sewer line/);
  assert.match(findings[2], /Sewer district:/);
  assert.match(findings[3], /Electric territory:/);
  assert.equal(view.querySelector('details').open, false);
  assert.equal(view.querySelector('summary').textContent, 'Coverage and limits');
  assert.match(view.querySelector('details').textContent, /No mapped public drinking-water area matched/);
  assert.doesNotMatch(html, /<img/);
  const rural = result(renderParcelUtilityEvidence(matches.filter(m => m.properties.feed === 'electric-iou'), ''));
  assert.match(rural.querySelector('.utility-findings').textContent, /^Electric territory:/);
  assert.doesNotMatch(rural.querySelector('.utility-findings').textContent, /unknown|No .*matched/i);
  const none = result(renderParcelUtilityEvidence([], ''));
  assert.equal(none.querySelector('.utility-findings').textContent, 'No mapped utility records matched this parcel.');
  assert.match(none.querySelector('details').textContent, /No match does not mean service is unavailable/);

  const root = path.resolve(__dirname, '..');
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'data/utility-evidence.geojson')));
  assert.match(snapshot.retrieved, /^\d{4}-\d{2}-\d{2}$/);
  const counts = {}, ids = new Set();
  for (const { id, geometry, properties } of snapshot.features) {
    assert.ok(!ids.has(id));
    ids.add(id);
    for (const coords of geometry.coordinates.flat(Infinity)) assert.ok(Number.isFinite(coords));
    if (properties.feed === 'water-meter') assert.deepEqual(Object.keys(properties).sort(), ['feed', 'name']);
    if (properties.feed === 'electric-other') assert.ok(['CO-OP', 'TRIBAL'].includes(properties.designation));
    counts[properties.feed] = (counts[properties.feed] || 0) + 1;
  }
  for (const feed of ['electric-iou', 'electric-other', 'water-area', 'sewer-district', 'sewer-lines', 'water-meter']) assert.ok(counts[feed] > 0, feed);
  const markup = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const id of Object.keys(UTILITY_LAYER_GROUPS)) {
    const input = markup.match(new RegExp(`<input[^>]+data-map-layer="${id}"[^>]*>`));
    assert.ok(input, id);
    assert.doesNotMatch(input[0], /checked/);
  }
  console.log('Utility evidence geometry, snapshot and control tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
