'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtemp, readFile, writeFile, readdir, mkdir, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { normalizeCaltrans, normalizeAlertCalifornia, safeUrl, fetchJson, refresh, SOURCES, OUTPUT } = require('./refresh-webcams.js');

function caltrans(id = 'test1', overrides = {}) {
  return { cctv: {
    index: '1',
    location: { county: 'Siskiyou', locationName: `Road ${id}`, longitude: '-122.4', latitude: '41.5' },
    imageData: { static: { currentImageURL: `https://cwwp2.dot.ca.gov/data/d2/cctv/image/${id}/${id}.jpg`, currentImageUpdateFrequency: '5' } },
    inService: 'true',
    ...overrides,
  } };
}
function alert(id = 'lookout-cam01', overrides = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-122.4, 41.5, 2000] },
    properties: { county: 'siskiyou', id, name: `Lookout ${id.endsWith('02') ? 2 : 1}`, last_frame_ts: 1700000000, ...overrides },
  };
}
const ct = (...data) => ({ data });
const ac = (...features) => ({ type: 'FeatureCollection', features });
const cameras = feature => JSON.parse(feature.properties.cameras);
const fixtureFetch = async url => ({ ok: true, json: async () => url === SOURCES.caltrans.url ? ct(caltrans()) : ac(alert()) });

function validateInventory(inventory) {
  assert.equal(inventory.type, 'FeatureCollection');
  assert.equal(new Date(inventory.fetchedAt).toISOString(), inventory.fetchedAt);
  assert.deepEqual(inventory.sources, SOURCES);
  const sites = new Set();
  const ids = new Set();
  const cameraIds = new Set();
  const counts = { caltrans: 0, alertcalifornia: 0 };
  for (const feature of inventory.features) {
    const props = feature.properties;
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Point');
    assert.equal(feature.geometry.coordinates.length, 2);
    const [lon, lat] = feature.geometry.coordinates;
    assert.ok(Number.isFinite(lon) && lon >= -124 && lon <= -121);
    assert.ok(Number.isFinite(lat) && lat >= 41 && lat <= 42.1);
    assert.deepEqual(Object.keys(props).sort(), ['cameras', 'id', 'name', 'provider']);
    assert.ok(Object.hasOwn(counts, props.provider));
    assert.ok(props.id.startsWith(`${props.provider}-site-`));
    assert.ok(props.name.trim());
    assert.ok(!ids.has(props.id));
    ids.add(props.id);
    const site = `${props.provider}:${feature.geometry.coordinates.join(',')}`;
    assert.ok(!sites.has(site));
    sites.add(site);
    assert.equal(typeof props.cameras, 'string');
    const entries = cameras(feature);
    assert.ok(entries.length > 0);
    counts[props.provider] += entries.length;
    for (const entry of entries) {
      const expected = ['id', 'name', 'imageUrl', 'viewerUrl', 'refreshSeconds', 'inService'];
      if (Object.hasOwn(entry, 'lastFrameAt')) expected.push('lastFrameAt');
      assert.deepEqual(Object.keys(entry).sort(), expected.sort());
      assert.ok(entry.id && entry.name);
      const cameraKey = `${props.provider}:${entry.id}`;
      assert.ok(!cameraIds.has(cameraKey));
      cameraIds.add(cameraKey);
      assert.equal(safeUrl(entry.imageUrl, props.provider, 'image'), entry.imageUrl);
      assert.equal(safeUrl(entry.viewerUrl, props.provider, 'viewer'), entry.viewerUrl);
      assert.equal(typeof entry.inService, 'boolean');
      assert.ok(Number.isInteger(entry.refreshSeconds) && entry.refreshSeconds >= 30);
      if (entry.lastFrameAt) assert.equal(new Date(entry.lastFrameAt).toISOString(), entry.lastFrameAt);
      if (props.provider === 'alertcalifornia') assert.equal(entry.refreshSeconds, 30);
    }
  }
  assert.ok(counts.caltrans > 0 && counts.alertcalifornia > 0);
}

test('Caltrans filters county, groups cameras, uses static URLs and converts minutes', () => {
  const other = caltrans('other');
  other.cctv.location.county = 'Shasta';
  const off = caltrans('test2', { inService: 'false' });
  const features = normalizeCaltrans(ct(other, off, caltrans()));
  assert.equal(features.length, 1);
  assert.deepEqual(features[0].geometry.coordinates, [-122.4, 41.5]);
  const entries = cameras(features[0]);
  assert.equal(entries.length, 2);
  assert.ok(entries.some(camera => camera.inService === false));
  for (const camera of entries) {
    assert.equal(camera.refreshSeconds, 300);
    assert.equal(camera.viewerUrl, camera.imageUrl);
    assert.ok(!Object.hasOwn(camera, 'lastFrameAt')); // recordTimestamp is NOT a frame timestamp.
  }
  const minutes = caltrans();
  minutes.cctv.imageData.static.currentImageUpdateFrequency = '2.5';
  assert.equal(cameras(normalizeCaltrans(ct(minutes))[0])[0].refreshSeconds, 150);
  for (const invalid of [null, '', 'bad', 0, -1, Infinity, 99999, true]) {
    minutes.cctv.imageData.static.currentImageUpdateFrequency = invalid;
    assert.equal(cameras(normalizeCaltrans(ct(minutes))[0])[0].refreshSeconds, 300);
  }
});

test('ALERTCalifornia pairs become one site, preserve camera IDs and frame timestamps', () => {
  const first = alert();
  const second = alert('lookout-cam02', { county: ' SISKIYOU ' });
  const result = normalizeAlertCalifornia(ac(second, alert('outside', { county: 'Shasta' }), first));
  assert.equal(result.length, 1);
  assert.equal(result[0].properties.name, 'Lookout');
  assert.deepEqual(cameras(result[0]).map(camera => camera.id), ['lookout-cam01', 'lookout-cam02']);
  const camera = cameras(result[0])[0];
  assert.equal(camera.imageUrl, 'https://cameras.alertcalifornia.org/public-camera-data/lookout-cam01/latest-frame.jpg');
  assert.equal(camera.viewerUrl, 'https://cameras.alertcalifornia.org/?id=lookout-cam01');
  assert.equal(camera.lastFrameAt, '2023-11-14T22:13:20.000Z');
  assert.equal(camera.inService, true);
  for (const invalid of [null, undefined, '', 'invalid', -1, 0, Infinity, 1e30]) {
    const missing = cameras(normalizeAlertCalifornia(ac(alert('missing', { last_frame_ts: invalid })))[0])[0];
    assert.equal(missing.inService, false);
    assert.ok(!Object.hasOwn(missing, 'lastFrameAt'));
  }
});

test('grouping is deterministic, provider-specific, and independent of membership/index', () => {
  const one = caltrans();
  const two = caltrans('test2');
  assert.deepEqual(normalizeCaltrans(ct(one, two)), normalizeCaltrans(ct(two, one)));
  assert.equal(normalizeCaltrans(ct(one))[0].properties.id, normalizeCaltrans(ct(one, two))[0].properties.id);
  const original = normalizeCaltrans(ct(one));
  one.cctv.index = '999';
  assert.deepEqual(normalizeCaltrans(ct(one)), original);
  const a = alert();
  const b = alert('lookout-cam02');
  assert.deepEqual(normalizeAlertCalifornia(ac(a, b)), normalizeAlertCalifornia(ac(b, a)));
  assert.equal(normalizeAlertCalifornia(ac(a))[0].properties.id, normalizeAlertCalifornia(ac(a, b))[0].properties.id);
  assert.notEqual(original[0].properties.id, normalizeAlertCalifornia(ac(a))[0].properties.id);
  b.geometry.coordinates = [-122.4001, 41.5];
  assert.equal(normalizeAlertCalifornia(ac(a, b)).length, 2); // Nearby is not co-located.
  assert.equal(normalizeAlertCalifornia(ac(a, a)).length, 1);
  assert.equal(cameras(normalizeCaltrans(ct(one, one))[0]).length, 1);
  assert.throws(() => normalizeAlertCalifornia(ac(a, alert('lookout-cam01', { name: 'Conflicting' }))), /Conflicting/);
});

test('reject empty providers and malformed feed schemas', () => {
  for (const input of [null, {}, [], { data: {} }, ct(), ct(caltrans('other', { location: { county: 'Shasta' } }))]) {
    assert.throws(() => normalizeCaltrans(input), /Invalid|Empty/);
  }
  for (const input of [null, {}, [], { type: 'Feature', features: [] }, ac(), ac(alert('other', { county: 'Shasta' }))]) {
    assert.throws(() => normalizeAlertCalifornia(input), /Invalid|Empty/);
  }
});

test('reject unsafe/malformed coordinates, identifiers, labels, and service flags', () => {
  for (const xy of [[null, 41.5], ['', 41.5], [false, 41.5], [-122.4, null], [Infinity, 41.5], [-122.4, NaN], [41.5, -122.4], [0, 0], [-90, 41.5], [-122.4, 90]]) {
    const a = alert(); a.geometry.coordinates = xy;
    assert.throws(() => normalizeAlertCalifornia(ac(a)), /coordinates/);
    const c = caltrans(); [c.cctv.location.longitude, c.cctv.location.latitude] = xy;
    assert.throws(() => normalizeCaltrans(ct(c)), /coordinates/);
  }
  for (const id of ['../evil', 'id?x=1', 'id#fragment', 'id/path', 'id%2fpath', 'id space', '<script>', '']) {
    assert.throws(() => normalizeAlertCalifornia(ac(alert(id))), /Invalid/);
  }
  for (const name of ['<img src=x>', 'bad\nname', '', null]) {
    assert.throws(() => normalizeAlertCalifornia(ac(alert('test', { name }))), /Invalid/);
  }
  assert.throws(() => normalizeCaltrans(ct(caltrans('test', { inService: 'yes' }))), /inService/);
  const line = alert(); line.geometry.type = 'LineString';
  assert.throws(() => normalizeAlertCalifornia(ac(line)), /Point/);
});

test('URL allowlists reject scripts, external hosts, credentials, ports, traversal and query injection', () => {
  const good = caltrans().cctv.imageData.static.currentImageURL;
  for (const url of ['javascript:alert(1)', 'data:image/jpeg;base64,AAAA', '//evil.test/x.jpg', good.replace('https:', 'http:'), good.replace('cwwp2.dot.ca.gov', 'cwwp2.dot.ca.gov.evil.test'), good.replace('cwwp2.dot.ca.gov', 'user@cwwp2.dot.ca.gov'), good.replace('cwwp2.dot.ca.gov', 'cwwp2.dot.ca.gov:8443'), good + '?redirect=https://evil.test', good + '#fragment', good.replace('test1/test1', 'test1/../test1/test1'), good.replace('test1/test1', 'test1/%2e%2e/test1'), good.replace('/image/', '/other/'), ' ' + good, good.replace('/image/', '/image\\')]) {
    const c = caltrans(); c.cctv.imageData.static.currentImageURL = url;
    assert.throws(() => normalizeCaltrans(ct(c)), /URL/);
  }
  assert.throws(() => safeUrl('https://cameras.alertcalifornia.org/?id=x&redirect=evil', 'alertcalifornia', 'viewer'), /URL/);
  assert.throws(() => safeUrl('https://evil.test/public-camera-data/x/latest-frame.jpg', 'alertcalifornia', 'image'), /URL/);
});

test('fetch checks HTTP errors, JSON errors, timeout signal, and forbids redirects', async () => {
  await assert.rejects(fetchJson('https://example.test', { fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  await assert.rejects(fetchJson('https://example.test', { fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }) }), /bad JSON/);
  await fetchJson('https://example.test', { fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({}) };
  } });
  // Keep one timer referenced because AbortSignal.timeout itself is unref'ed.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(fetchJson('https://example.test', { timeoutMs: 10, fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) }), { name: 'TimeoutError' });
  } finally { clearTimeout(keepAlive); }
});

test('refresh writes compact inventory atomically; failures preserve old output and clean temp files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'land-webcams-test-'));
  const output = path.join(dir, 'webcams.geojson');
  try {
    const result = await refresh({ output, fetchImpl: fixtureFetch });
    validateInventory(result);
    const saved = await readFile(output, 'utf8');
    assert.equal(saved, JSON.stringify(result) + '\n');
    assert.deepEqual(await readdir(dir), ['webcams.geojson']);
    for (const fetchImpl of [
      async () => { throw new Error('network failure'); },
      async url => url === SOURCES.caltrans.url ? { ok: true, json: async () => ct() } : fixtureFetch(url),
      async url => url === SOURCES.alertcalifornia.url ? { ok: true, json: async () => ac() } : fixtureFetch(url),
      async url => url === SOURCES.alertcalifornia.url ? { ok: true, json: async () => ac(alert('../unsafe')) } : fixtureFetch(url),
    ]) {
      await assert.rejects(refresh({ output, fetchImpl }));
      assert.equal(await readFile(output, 'utf8'), saved);
      assert.deepEqual(await readdir(dir), ['webcams.geojson']);
    }
    const blocked = path.join(dir, 'blocked');
    await mkdir(blocked);
    await writeFile(path.join(blocked, 'keep'), 'untouched');
    await assert.rejects(refresh({ output: blocked, fetchImpl: fixtureFetch }));
    assert.deepEqual((await readdir(dir)).sort(), ['blocked', 'webcams.geojson']);
    assert.equal(await readFile(path.join(blocked, 'keep'), 'utf8'), 'untouched');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('generated inventory metadata and feature schema (when present)', async t => {
  let contents;
  try { contents = await readFile(OUTPUT, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') { t.skip('Run node scripts/refresh-webcams.js to generate the inventory'); return; }
    throw error;
  }
  validateInventory(JSON.parse(contents));
});
