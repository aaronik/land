'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../assets/map/road-distance-geometry.js'), 'utf8');
  const { buildRoadGraph, snapToRoad, shortestRoadPath, metersBetween } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const line = coordinates => ({ geometry: { type: 'LineString', coordinates } });
  const roads = [
    line([[0, 0], [0.001, 0], [0.001, 0.001], [0.002, 0.001]]),
    line([[0.001, 0], [0.002, 0]]),
    line([[0.002, 0.001], [0.003, 0.001]]),
    line([[0.003, 0.001], [0.003, 0.002]]),
    line([[0.01, 0.01], [0.011, 0.01]])
  ];
  const graph = buildRoadGraph(roads);
  const start = snapToRoad(graph, [0.0005, 0]);
  const end = snapToRoad(graph, [0.0025, 0.001]);
  const route = shortestRoadPath(graph, start, end);
  const expected = [[0.0005, 0], [0.001, 0], [0.001, 0.001], [0.002, 0.001], [0.0025, 0.001]];
  assert.equal(route.coordinates.length, expected.length);
  route.coordinates.forEach((point, i) => point.forEach((value, j) => assert.ok(Math.abs(value - expected[i][j]) < 1e-10)));
  assert.ok(Math.abs(route.meters - (metersBetween([0.0005, 0], [0.001, 0]) + metersBetween([0.001, 0], [0.001, 0.001]) + metersBetween([0.001, 0.001], [0.002, 0.001]) + metersBetween([0.002, 0.001], [0.0025, 0.001]))) < 0.01);
  assert.equal(shortestRoadPath(graph, start, snapToRoad(graph, [0.0105, 0.01])), null);
  assert.equal(snapToRoad(graph, [0.05, 0.05]), null);
  const same = shortestRoadPath(graph, snapToRoad(graph, [0.0008, 0]), snapToRoad(graph, [0.0002, 0]));
  assert.equal(same.coordinates.length, 2);
  assert.ok(Math.abs(same.meters - metersBetween([0.0008, 0], [0.0002, 0])) < 0.01);
  const seam = buildRoadGraph([line([[0, 0], [0.001, 0]]), line([[0.001000005, 0], [0.002, 0]])]);
  assert.ok(shortestRoadPath(seam, snapToRoad(seam, [0.0005, 0]), snapToRoad(seam, [0.0015, 0])));
  assert.ok(buildRoadGraph(roads, 1).error);
  const gap = buildRoadGraph([line([[0, 0], [0.001, 0]]), line([[0.00104, 0], [0.002, 0]])]);
  assert.ok(shortestRoadPath(gap, snapToRoad(gap, [0.0005, 0]), snapToRoad(gap, [0.0015, 0])), 'short independent road endpoint gaps connect');
  const parallel = buildRoadGraph([line([[0, 0], [0.003, 0]]), line([[0.001, 0.00004], [0.002, 0.00004]])]);
  assert.equal(shortestRoadPath(parallel, snapToRoad(parallel, [0.0015, 0]), snapToRoad(parallel, [0.0015, 0.00004])), null, 'parallel road interiors must not connect');

  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  global.document = dom.window.document;
  const controlSource = fs.readFileSync(path.join(__dirname, '../assets/map/road-distance.js'), 'utf8')
    .replace("import { buildRoadGraph, snapToRoad, shortestRoadPath } from './road-distance-geometry.js';", '')
    .replace("import { loadRoadFeatures } from './road-distance-tiles.js';", '');
  const { RoadDistanceControl } = await import(`data:text/javascript;base64,${Buffer.from(source + '\n' + controlSource).toString('base64')}`);
  const listeners = new Map(), data = { features: [] };
  let panEnabled = true;
  const map = {
    on(type, fn) { listeners.set(type, fn); }, off(type) { listeners.delete(type); },
    getCanvas() { return { style: map.style }; }, style: {},
    getLayer() { return true; },
    getSource() { return { setData(value) { data.features = value.features; } }; },
    queryRenderedFeatures() { return [{ properties: { index: map.endpointIndex } }]; }, endpointIndex: 0,
    dragPan: { isEnabled: () => panEnabled, disable: () => { panEnabled = false; }, enable: () => { panEnabled = true; } }
  };
  const control = new RoadDistanceControl();
  control.onAdd(map);
  control.graph = graph; control.start = start; control.end = end;
  control.render(route); control.showRoute(route);
  control.startEndpointDrag({ point: { x: 1, y: 1 }, preventDefault() {} });
  assert.equal(panEnabled, false);
  const newStart = [0.0002, 0];
  control.moveEndpointDrag({ lngLat: { lng: newStart[0], lat: newStart[1] }, preventDefault() {} });
  assert.ok(Math.abs(control.start.point[0] - newStart[0]) < 1e-10);
  assert.ok(data.features[0].geometry.coordinates.length > 2);
  const previous = control.start;
  control.moveEndpointDrag({ lngLat: { lng: 0.05, lat: 0.05 } });
  assert.equal(control.start, previous, 'off-road drag retains last valid route');
  control.moveEndpointDrag({ lngLat: { lng: 0.0105, lat: 0.01 } });
  assert.equal(control.start, previous, 'disconnected drag retains last valid route');
  control.finishEndpointDrag();
  assert.equal(panEnabled, true);
  assert.equal(control.consumeMapClickSuppression(), true);
  map.endpointIndex = 1;
  control.startEndpointDrag({ point: { x: 1, y: 1 }, preventDefault() {} });
  control.moveEndpointDrag({ lngLat: { lng: 0.0028, lat: 0.001 }, preventDefault() {} });
  assert.ok(Math.abs(control.end.point[0] - 0.0028) < 1e-10);
  control.clear();
  assert.equal(panEnabled, true);
  assert.equal(data.features.length, 0);
  control.onRemove();
  console.log('Passed: road-distance graph, snapping, bends, disconnected roads, tile seams and endpoint dragging.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
