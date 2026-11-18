'use strict';
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

(async () => {
  const { webcamCameras, createWebcamViewer } = await import('../assets/map/webcams.js');
  const camera = id => ({ id, name: `Camera ${id}`, imageUrl: `https://cameras.alertcalifornia.org/public-camera-data/${id}/latest-frame.jpg`, viewerUrl: `https://cameras.alertcalifornia.org/?id=${id}`, refreshSeconds: 30, inService: true });
  const properties = { provider: 'alertcalifornia', name: '<b>Lookout</b>', cameras: JSON.stringify([camera('one'), camera('two')]) };
  assert.equal(webcamCameras(properties).length, 2);
  assert.deepEqual(webcamCameras({ ...properties, cameras: 'bad json' }), []);
  for (const imageUrl of ['javascript:alert(1)', 'https://evil.test/image.jpg', 'https://cameras.alertcalifornia.org.evil.test/public-camera-data/one/latest-frame.jpg']) {
    assert.deepEqual(webcamCameras({ ...properties, cameras: JSON.stringify([{ ...camera('one'), imageUrl }]) }), []);
  }
  const inventory = JSON.parse(fs.readFileSync('data/webcams.geojson', 'utf8'));
  for (const site of inventory.features) assert.equal(webcamCameras(site.properties).length, JSON.parse(site.properties.cameras).length);
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const document = dom.window.document;
  const popups = [];
  class Popup {
    constructor() { this.listeners = {}; popups.push(this); }
    setLngLat(value) { this.coordinates = value; return this; }
    setDOMContent(root) { this.root = root; return this; }
    addTo() { document.body.append(this.root); return this; }
    on(name, handler) { this.listeners[name] = handler; return this; }
    remove() { this.listeners.close?.(); this.root.remove(); }
  }
  const viewer = createWebcamViewer({ map: {}, Popup, document });
  const feature = { geometry: { coordinates: [-122.4, 41.5] }, properties };
  viewer.open(feature);
  const root = popups[0].root;
  assert.equal(root.querySelector('h3').textContent, '<b>Lookout</b>');
  assert.equal(root.querySelector('b'), null, 'Provider text is never injected as markup');
  const image = root.querySelector('img');
  assert.match(image.src, /\/one\/latest-frame.jpg\?rqts=/);
  image.onload();
  assert.match(root.querySelector('[role=status]').textContent, /Image received/);
  root.querySelector('select').value = '1';
  root.querySelector('select').dispatchEvent(new dom.window.Event('change'));
  assert.match(image.src, /\/two\//);
  assert.match(root.querySelector('.webcam-source').href, /id=two/);
  image.onerror();
  assert.equal(image.hidden, true);
  assert.match(root.querySelector('[role=status]').textContent, /unavailable/);
  root.querySelector('button').click();
  assert.equal(image.hidden, false);
  assert.match(root.querySelector('[role=status]').textContent, /Loading/);
  viewer.open({ ...feature, properties: { ...properties, cameras: JSON.stringify([{ ...camera('offline'), inService: false }]) } });
  assert.equal(image.getAttribute('src'), null);
  assert.match(popups[1].root.querySelector('[role=status]').textContent, /out of service/);
  assert.equal(popups[1].root.querySelector('select').hidden, true);
  assert.equal(popups[1].root.querySelector('img').getAttribute('src'), null);
  viewer.close();
  viewer.close();
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.equal(document.querySelector('.webcam-viewer'), null);
  assert.equal(image.getAttribute('src'), null, 'Closed viewer cannot resume requests');
  dom.window.close();
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /data-map-layer="webcams"/);
  assert.doesNotMatch(html.match(/<input[^>]*data-map-layer="webcams"[^>]*>/)[0], /checked/);
  console.log('Webcam viewer: safe URLs, complete inventory, paired cameras, refresh, offline/error states and cleanup passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
