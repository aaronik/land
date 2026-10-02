'use strict';

const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

(async () => {
  const { lookupElevationFeet, terrainTilePixel, ElevationPinControl } = await import('../assets/map/elevation-pin.js');
  assert.deepEqual(terrainTilePixel({ lng: -180, lat: 0 }), { tileX: 0, tileY: 4096, pixelX: 0, pixelY: 0 });
  const originalFetch = global.fetch;
  const originalBitmap = global.createImageBitmap;
  let requests = 0;
  const point = { lng: -122.31, lat: 41.31 };
  const { tileX, tileY, pixelX, pixelY } = terrainTilePixel(point);
  global.fetch = async (url, { signal } = {}) => {
    requests++;
    assert.equal(url, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/${tileX}/${tileY}.png`);
    assert.ok(signal);
    return { ok: true, blob: async () => ({}) };
  };
  global.createImageBitmap = async () => ({ close() {} });
  const pixels = new Uint8ClampedArray(256 * 256 * 4);
  const offset = (pixelY * 256 + pixelX) * 4;
  // Terrarium: 32768 m is RGB(128, 0, 0). Encode 1000 m above sea level.
  pixels.set([132, 0, 0, 255], offset);
  global.document = { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: pixels }) }) }) };
  try {
    const feet = await lookupElevationFeet(point, { signal: new AbortController().signal });
    assert.ok(Math.abs(feet - 1024 * 3.28084) < 0.001);
    assert.equal(await lookupElevationFeet(point), feet);
    assert.equal(requests, 1);
  } finally { global.fetch = originalFetch; global.createImageBitmap = originalBitmap; }

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  let resolveLookup;
  const pendingLookup = () => new Promise(resolve => { resolveLookup = resolve; });
  const map = {
    listeners: {},
    on(name, callback) { this.listeners[name] = callback; },
    off(name) { delete this.listeners[name]; },
    getCanvas() { return { style: this.canvasStyle }; },
    canvasStyle: {}
  };
  class Marker {
    constructor() { this.removed = false; }
    setLngLat(point) { this.point = point; return this; }
    addTo() { return this; }
    remove() { this.removed = true; }
  }
  class Popup {
    setLngLat(point) { this.point = point; return this; }
    setDOMContent(content) { this.content = content; return this; }
    addTo() { return this; }
    remove() { this.removed = true; }
  }
  let activations = 0;
  const control = new ElevationPinControl({ Marker, Popup }, () => { activations++; }, pendingLookup);
  control.onAdd(map);
  control.toggleButton.click();
  assert.equal(activations, 1);
  assert.equal(control.isActive(), true);
  const first = map.listeners.click({ lngLat: { lng: -122.31, lat: 41.31 } });
  assert.equal(control.popup.content.querySelector('strong').textContent, 'Elevation: loading…');
  resolveLookup(3591.489);
  await first;
  assert.match(control.popup.content.textContent, /3,591 ft above sea level/);
  assert.equal(control.isActive(), true);
  const second = map.listeners.click({ lngLat: { lng: -122.4, lat: 41.4 } });
  const staleResolve = resolveLookup;
  const third = map.listeners.click({ lngLat: { lng: -122.5, lat: 41.5 } });
  staleResolve(9999);
  await second;
  assert.equal(control.popup.content.querySelector('strong').textContent, 'Elevation: loading…');
  control.clearButton.click();
  assert.equal(control.isActive(), false);
  assert.equal(control.marker, null);
  resolveLookup(1234);
  await third;
  assert.equal(control.popup, null);
  control.onRemove();
  assert.equal(map.listeners.click, undefined);
  console.log('Passed: elevation lookup and pin lifecycle.');
})().catch(error => { console.error(error); process.exitCode = 1; });
