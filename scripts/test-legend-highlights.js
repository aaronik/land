'use strict';

import assert from 'node:assert/strict';
import { legendMatches, LEGEND_QUERY_LAYERS, updateLegendHighlights } from '../assets/ui/legend-highlights.js';

const features = [
  { layer: { id: 'parcel-fill' }, properties: { APN: '123' } },
  { layer: { id: 'zoning-fill' }, properties: { zoning: 'RES-2' } },
  { layer: { id: 'fire-hazard' }, properties: { HAZ_CLASS: 'Very High' } },
  { layer: { id: 'cell-att' }, properties: {} },
  { layer: { id: 'cell-verizon' }, properties: {} },
  { layer: { id: 'recent-wildfire-perimeters-fill' }, properties: {} }
];
const matches = legendMatches(features, ['private-land', 'public-land']);
assert.deepEqual([...matches.get('zoning')], ['RES-2']);
assert.deepEqual([...matches.get('cell-coverage')], ['AT&T', 'Verizon']);
assert.deepEqual([...matches.get('wildfire-perimeters')], ['Recent']);
assert(matches.has('parcel-lines'));
assert(matches.has('listing:private-land'));
assert(matches.has('listing:public-land'));
assert(!matches.has('listing:private-home'));
assert(LEGEND_QUERY_LAYERS.includes('parcel-fill'));
assert.deepEqual([...legendMatches([], [])], []);

// Minimal DOM-shaped nodes let us exercise the visual-state contract in Node.
const node = (text, options = {}) => ({ textContent: text, ...options, classes: new Set(), classList: {
  toggle(name, on) { this.owner.classes[on ? 'add' : 'delete'](name); },
  contains(name) { return this.owner.classes.has(name); }
} });
const makeNode = (text, options) => {
  const item = node(text, options);
  item.classList.owner = item;
  return item;
};
const label = makeNode('Zoning districts');
const res1 = makeNode('RES-1');
const res2 = makeNode('RES-2');
const key = makeNode('', { dataset: { layerKey: 'zoning' }, querySelectorAll: () => [res1, res2] });
key.classes.add('visible');
const root = { querySelectorAll: selector => selector === '.layer-key' ? [key] : [label] };
updateLegendHighlights(root, matches);
assert(!label.classes.has('legend-match'));
assert(!res1.classes.has('legend-match'));
assert(res2.classes.has('legend-match'));
key.classes.delete('visible');
updateLegendHighlights(root, matches);
assert(!label.classes.has('legend-match'));
assert(!res2.classes.has('legend-match'));
console.log('Legend highlights passed');
