'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

function approximatelyEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual[0] - expected[0]) < 1e-10 && Math.abs(actual[1] - expected[1]) < 1e-10,
    message
  );
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets/map/polygon-draw.js'), 'utf8');
  const geometry = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const { azimuthFor, destination, reverseAzimuth, updatedEdgeVertices } = geometry;
  const quadrants = [
    { name: 'N 44 E', ns: 'N', ew: 'E', bearing: 44 },
    { name: 'S 44 E', ns: 'S', ew: 'E', bearing: 136 },
    { name: 'S 44 W', ns: 'S', ew: 'W', bearing: 224 },
    { name: 'N 44 W', ns: 'N', ew: 'W', bearing: 316 }
  ];
  const end = [-122.42, 41.31], distance = 1000;
  for (const quadrant of quadrants) {
    const call = { ns: quadrant.ns, ew: quadrant.ew, degrees: 44, minutes: 0, seconds: 0, distance };
    assert.equal(azimuthFor(call), quadrant.bearing, `${quadrant.name} azimuth`);
    assert.equal(reverseAzimuth(quadrant.bearing), (quadrant.bearing + 180) % 360, `${quadrant.name} inverse`);

    const fixedEnd = updatedEdgeVertices([-122, 41], end, call, 'end');
    assert.deepEqual(fixedEnd.end, end, `${quadrant.name}: fixed End is preserved`);
    approximatelyEqual(
      fixedEnd.start,
      destination(end, quadrant.bearing, distance),
      `${quadrant.name}: fixed End interprets entered call as End → Start`
    );

    const start = [-122, 41];
    const fixedStart = updatedEdgeVertices(start, end, call, 'start');
    assert.deepEqual(fixedStart.start, start, `${quadrant.name}: fixed Start is preserved`);
    approximatelyEqual(
      fixedStart.end,
      destination(start, quadrant.bearing, distance),
      `${quadrant.name}: fixed Start interprets entered call as Start → End`
    );
  }
  console.log('Passed: polygon draw start- and end-fixed geometry for all quadrant calls.');
}
main().catch(error => { console.error(error); process.exit(1); });
