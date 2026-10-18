'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('assets/app.source.js', 'utf8');
const css = fs.readFileSync('assets/style.css', 'utf8');
const normalize = app.match(/function normalizeHeading\(heading\) \{[\s\S]*?\n\}/)?.[0];
const compass = app.match(/function deviceCompassHeading\(event\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(normalize && compass, 'heading conversion functions exist');
const context = { screen: { orientation: { angle: 0 } }, window: {} };
vm.createContext(context);
vm.runInContext(`${normalize}\n${compass}`, context);

// The alpha path points 90° counterclockwise from the unadjusted heading.
// Screen rotation still contributes its angle.
for (const [alpha, screenAngle, expected] of [
  [0, 0, 270], [270, 0, 0], [180, 0, 90],
  [0, 90, 0], [0, 270, 180]
]) {
  context.screen.orientation.angle = screenAngle;
  assert.equal(context.deviceCompassHeading({ alpha }), expected, `alpha=${alpha}, screen=${screenAngle}`);
}
assert.equal(context.deviceCompassHeading({ webkitCompassHeading: 0, alpha: 180 }), 0, 'iOS compass stays unchanged');
assert.equal(context.deviceCompassHeading({ alpha: null }), null, 'missing compass stays unavailable');
assert.match(css, /\.user-heading-cone::before\s*\{[^}]*bottom:\s*0;[^}]*clip-path:\s*polygon\(50% 0, 100% 100%, 0 100%\)/s, 'original cone geometry stays unchanged');
console.log('Heading cone conversion tests passed');
