import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { PolygonDrawControl } from '../assets/map/polygon-draw.js';
import { DRAWINGS_KEY } from '../assets/map/drawing-seeds.js';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test' });
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
const drawing = { id: 'custom', name: 'Polygon 1', visible: true, vertices: [[0, 0], [1, 0], [0, 1]] };
localStorage.setItem(DRAWINGS_KEY, JSON.stringify([drawing]));
let features;
const canvas = { style: {} };
const map = {
  on() {}, off() {}, getCanvas: () => canvas,
  getLayer: () => true,
  queryRenderedFeatures: (_, { layers }) => layers.includes('polygon-drawings-vertices') ? [{ properties: { drawingId: 'custom', vertexIndex: 0 } }] : [],
  getSource: () => ({ setData: value => { features = value.features; } }),
  dragPan: { enabled: true, isEnabled() { return this.enabled; }, disable() { this.enabled = false; }, enable() { this.enabled = true; } }
};
const control = new PolygonDrawControl({}); control.onAdd(map); control.refresh();
const event = { point: [0, 0], lngLat: { lng: 0, lat: 0 }, preventDefault() {} };
assert.equal(control.lockButton.hidden, false);
control.startVertexDrag(event);
assert.equal(control.isDraggingVertex(), true);
control.lockButton.click();
assert.equal(control.isDraggingVertex(), false, 'locking finishes an in-progress drag');
assert.equal(map.dragPan.enabled, true);
assert.equal(control.lockButton.getAttribute('aria-pressed'), 'true');
assert.equal(control.lockButton.getAttribute('aria-label'), 'Unlock saved polygons');
control.startVertexDrag(event);
assert.equal(control.isDraggingVertex(), false);
control.openEdgePopup({ properties: { drawingId: drawing.id, edgeIndex: 0 } });
assert.equal(control.popup, undefined);
control.deleteEdge(drawing.id, 0);
assert.deepEqual(control.drawings[0].vertices, drawing.vertices);
assert.equal(features.filter(f => f.properties.kind === 'vertex' && f.properties.drawingId === drawing.id).length, 3, 'locked polygons remain visible');
control.toggle(); control.addVertex(event);
assert.equal(control.draft.vertices.length, 1, 'new drawings still work while saved polygons are locked');
control.deactivate(); control.onRemove();
const restored = new PolygonDrawControl({}); restored.onAdd(map);
assert.equal(restored.locked, true, 'lock survives reload');
restored.lockButton.click();
assert.equal(restored.locked, false);
assert.equal(localStorage.getItem('shasta-land-atlas.polygon-lock.v1'), null);
restored.startVertexDrag(event);
assert.equal(restored.isDraggingVertex(), true, 'unlock restores corner editing');
restored.finishVertexDrag(); restored.onRemove();
console.log('Polygon drawing lock tests passed');
