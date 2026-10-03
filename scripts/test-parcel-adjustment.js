import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ParcelAdjustmentControl, ParcelAdjustmentMapControl } from '../assets/map/parcel-adjustment.js';

const dom = new JSDOM('', { url: 'https://example.test' });
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
const apn = '123-456-789';
const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [{ geometry }] }) });
const canvas = { style: {} };
const map = {
  on() {},
  getSource: () => ({ setData() {} }),
  queryRenderedFeatures: (_, { layers }) => layers.includes('parcel-adjustment-handle') ? [] : [{}],
  getCanvas: () => canvas,
  dragPan: { enabled: true, disable() { this.enabled = false; }, enable() { this.enabled = true; } }
};
const alignment = new ParcelAdjustmentControl(map);
const control = new ParcelAdjustmentMapControl(alignment, () => apn);
control.onAdd();
await alignment.activate(apn);
control.update();
assert.equal(control.lockButton.hidden, false);
const event = { point: [0, 0], lngLat: { lng: 0, lat: 0 }, preventDefault() {} };
alignment.start(event);
assert.equal(alignment.mode, 'move');
alignment.move({ ...event, lngLat: { lng: 0.1, lat: 0.1 } });
alignment.finish();
const position = { ...alignment.transform };
control.lockButton.click();
assert.equal(control.lockButton.getAttribute('aria-pressed'), 'true');
assert.equal(alignment.isLocked(), true);
alignment.start(event);
assert.equal(alignment.mode, null);
assert.equal(map.dragPan.enabled, true);
alignment.move({ ...event, lngLat: { lng: 0.2, lat: 0.2 } });
assert.deepEqual(alignment.transform, position);
alignment.deactivate();
await alignment.activate(apn);
assert.equal(alignment.isLocked(), true);
assert.deepEqual(alignment.transform, position);
control.update();
control.lockButton.click();
assert.equal(alignment.isLocked(), false);
alignment.start(event);
assert.equal(alignment.mode, 'move');
alignment.finish();
alignment.reset();
assert.equal(alignment.isLocked(), false);
assert.equal(alignment.saved[apn], undefined);
console.log('Parcel alignment lock tests passed');
