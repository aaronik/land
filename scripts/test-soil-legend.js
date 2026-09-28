import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildSoilLegend, updateSoilLegendValues, soilParticleText } from '../assets/ui/soil-legend.js';
import { updateLegendHighlights } from '../assets/ui/legend-highlights.js';

const dom = new JSDOM('<div class="layer-key soil-texture-key visible" data-layer-key="soils"><strong>Soil texture</strong><span><i></i>Loam</span><span><i></i>Clay loam</span><span><i></i>Not rated / other</span><span>Note</span></div>');
const doc = dom.window.document;
buildSoilLegend(doc);
const key = doc.querySelector('.soil-texture-key');
assert.equal(key.querySelectorAll('.soil-particle-row').length, 9);
assert.deepEqual([...key.querySelectorAll('.soil-particle-row')].slice(0, 3).map(row => row.dataset.soilParticle), ['sand', 'silt', 'clay']);
updateSoilLegendValues(doc, { texture_group: 'Loam', sand_pct: 0, silt_pct: 37.5, clay_pct: null });
assert.deepEqual([...key.querySelectorAll('.soil-particle-row')].slice(0, 3).map(row => row.querySelector('output').textContent), ['0%', '37.5%', 'Not reported']);
assert.equal(soilParticleText({}, 'sand'), 'Not reported');
updateLegendHighlights(doc, new Map([['soils', new Set(['Loam'])]]));
assert.equal(key.querySelectorAll('.legend-match').length, 4); // Heading + three rows, not Clay loam.
assert(![...key.querySelectorAll('.legend-match')].some(row => row.textContent.includes('Clay loam')));
updateSoilLegendValues(doc, null);
assert.equal(key.querySelectorAll('.soil-particle-row output')[0].textContent, '—');
updateLegendHighlights(doc, new Map());
assert.equal(key.querySelectorAll('.legend-match').length, 0);
console.log('Soil texture triplets and exact legend highlighting passed');
