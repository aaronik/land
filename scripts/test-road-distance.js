'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  console.log('Passed: road-distance graph, snapping, bends, disconnected roads and tile seams.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
