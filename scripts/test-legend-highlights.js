'use strict';

import assert from 'node:assert/strict';
import { legendMatches, LEGEND_QUERY_LAYERS, queryLegendFeatures, queryParcelWaterFeatures, updateLegendHighlights } from '../assets/ui/legend-highlights.js';

const features = [
  { layer: { id: 'parcel-fill' }, properties: { APN: '123' } },
  { layer: { id: 'transmission-lines' }, properties: { Name: 'Test line' } },
  { layer: { id: 'dams' }, properties: { NAME: 'Test dam' } },
  { layer: { id: 'landslides' }, properties: { LS_Type: 'debris flow' } },
  { layer: { id: 'landslide-footprints-fill' }, properties: { USGS_ID: 'ply123' } },
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
assert(matches.has('transmission-lines'));
assert(matches.has('dams'));
assert(matches.has('landslides'));
assert(matches.has('listing:private-land'));
assert(matches.has('listing:public-land'));
assert(!matches.has('listing:private-home'));
assert(LEGEND_QUERY_LAYERS.includes('parcel-fill'));
assert(LEGEND_QUERY_LAYERS.includes('springs'));
assert(LEGEND_QUERY_LAYERS.includes('landslide-footprints-fill'));
assert(legendMatches([{ layer: { id: 'landslide-footprints-fill' }, properties: {} }]).has('landslides'));
const queries = [];
const waterMap = {
  project: () => ({ x: 100, y: 200 }),
  queryRenderedFeatures: (geometry, { layers }) => {
    queries.push({ geometry, layers });
    if (layers.length !== 1) return [];
    return layers[0] === 'waterways'
      ? [{ layer: { id: 'waterways' }, properties: { fcode: 46000 } }, { layer: { id: 'waterways' }, properties: { fcode: 46003 } }]
      : [{ layer: { id: 'springs' }, properties: {} }];
  }
};
const waterMatches = legendMatches(queryLegendFeatures(waterMap, [-122, 41], ['waterways', 'springs']));
assert.deepEqual([...waterMatches.get('waterways')], ['Perennial', 'Intermittent', 'Mapped spring']);
assert.deepEqual(queries.map(query => query.geometry), [
  { x: 100, y: 200 }, [[95, 195], [105, 205]], [[91, 191], [109, 209]]
]);
assert.equal(queries.length, 3);
queries.length = 0;
queryLegendFeatures(waterMap, [-122, 41], ['waterways']);
assert.equal(queries.length, 2); // Hidden springs must not be queried.
const square = coordinates => ({ geometry: { type: 'Polygon', coordinates: [coordinates] } });
const parcel = square([[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]);
const waterFeature = (id, coordinates) => ({ layer: { id }, geometry: { type: id === 'springs' ? 'Point' : 'LineString', coordinates }, properties: { fcode: 46006 } });
const crossing = waterFeature('waterways', [[-10, 40], [110, 40]]);
const neighbor = waterFeature('waterways', [[120, 20], [120, 90]]);
const insideSpring = waterFeature('springs', [40, 70]);
const outsideSpring = waterFeature('springs', [130, 70]);
const parcelMap = {
  project: coordinate => ({ x: coordinate[0], y: coordinate[1] }),
  getCanvas: () => ({ clientWidth: 200, clientHeight: 200 }),
  queryRenderedFeatures: (box, options) => {
    assert.deepEqual(box, [[0, 0], [109, 109]]);
    assert.deepEqual(options.layers, ['waterways', 'springs']);
    return [crossing, neighbor, insideSpring, outsideSpring];
  }
};
assert.deepEqual(queryParcelWaterFeatures(parcelMap, [parcel], ['waterways', 'springs']), [crossing, insideSpring]);
assert.deepEqual([...legendMatches(queryParcelWaterFeatures(parcelMap, [parcel], ['waterways', 'springs'])).get('waterways')], ['Perennial', 'Mapped spring']);
const hole = { geometry: { type: 'Polygon', coordinates: [parcel.geometry.coordinates[0], [[20, 20], [80, 20], [80, 80], [20, 80], [20, 20]]] } };
assert.deepEqual(queryParcelWaterFeatures({ ...parcelMap, queryRenderedFeatures: () => [waterFeature('waterways', [[30, 40], [70, 40]]), insideSpring] }, [hole], ['waterways', 'springs']), []);
assert.deepEqual(queryParcelWaterFeatures(parcelMap, [], ['waterways', 'springs']), []);
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
const perennial = makeNode('Perennial');
const intermittent = makeNode('Intermittent / ephemeral');
const spring = makeNode('Mapped spring');
const waterKey = makeNode('', { dataset: { layerKey: 'waterways' }, querySelectorAll: () => [perennial, intermittent, spring] });
waterKey.classes.add('visible');
updateLegendHighlights({ querySelectorAll: () => [waterKey] }, waterMatches);
assert([perennial, intermittent, spring].every(item => item.classes.has('legend-match')));
waterKey.classes.delete('visible');
updateLegendHighlights({ querySelectorAll: () => [waterKey] }, waterMatches);
assert([perennial, intermittent, spring].every(item => !item.classes.has('legend-match')));
console.log('Legend highlights passed');
