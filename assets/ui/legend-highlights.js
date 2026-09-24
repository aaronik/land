'use strict';

// Match only features actually rendered at the selected point. Raster layers
// cannot be identified reliably with queryRenderedFeatures, so they are not
// marked as parcel matches merely because their checkbox is on.
const LAYERS = {
  'public-land': 'public-land',
  'parcel-lines': 'parcel-fill',
  roads: 'roads',
  waterways: 'waterways',
  railroads: 'railroads',
  pct: 'pct',
  huc12: 'huc12-fill',
  'incorporated-places': 'incorporated-places-red',
  zoning: 'zoning-fill',
  'municipal-zoning': 'municipal-zoning-fill',
  'groundwater-basins': 'groundwater-basins-fill',
  geology: 'geology',
  'fire-hazard': 'fire-hazard',
  'wildfire-perimeters': 'wildfire-perimeters-fill',
  'recent-wildfire-perimeters': 'recent-wildfire-perimeters-fill',
  flood: 'flood',
  soils: 'soils',
  farmland: 'farmland',
  'critical-habitat': 'critical-habitat-final',
  'critical-habitat-proposed': 'critical-habitat-proposed',
  'cell-coverage-att': 'cell-att',
  'cell-coverage-tmobile': 'cell-tmobile',
  'cell-coverage-verizon': 'cell-verizon'
};
export const LEGEND_QUERY_LAYERS = [...new Set(Object.values(LAYERS))];

export function legendMatches(features, listingCategories = []) {
  const matches = new Map();
  const add = (id, key) => {
    if (!matches.has(id)) matches.set(id, new Set());
    if (key !== undefined && key !== null && key !== '') matches.get(id).add(String(key));
  };
  for (const category of listingCategories) add(`listing:${category}`);
  for (const feature of features) {
    const layer = feature.layer?.id;
    const p = feature.properties || {};
    if (layer === 'parcel-fill') { add('parcel-lines'); continue; }
    if (layer === 'municipal-zoning-fill') { add('zoning', p.zoning); continue; }
    if (layer === 'recent-wildfire-perimeters-fill') { add('wildfire-perimeters', 'Recent'); continue; }
    if (layer === 'critical-habitat-proposed') { add('critical-habitat', 'Proposed'); continue; }
    if (layer === 'cell-att' || layer === 'cell-tmobile' || layer === 'cell-verizon') {
      add('cell-coverage', { 'cell-att': 'AT&T', 'cell-tmobile': 'T-Mobile', 'cell-verizon': 'Verizon' }[layer]);
      continue;
    }
    const id = Object.keys(LAYERS).find(key => LAYERS[key] === layer);
    if (!id) continue;
    if (id === 'zoning') add(id, p.zoning);
    else if (id === 'geology') add(id, p.material_class);
    else if (id === 'fire-hazard') add(id, p.HAZ_CLASS);
    else if (id === 'wildfire-perimeters') add(id, 'Historic');
    else if (id === 'critical-habitat') add(id, 'Final');
    else if (id === 'farmland') add(id, { P: 'Prime', S: 'Statewide', U: 'Unique', L: 'Local', G: 'Grazing', I: 'Irrigated', N: 'Nonirrigated' }[p.polygon_ty]);
    else if (id === 'soils') add(id, p.drclassdcd);
    else if (id === 'flood') add(id, p.SFHA_TF === 'T' ? 'Special Flood' : p.FLD_ZONE === 'D' ? 'Undetermined' : p.FLD_ZONE === 'X' && /0\.2 PCT|0\.2 PERCENT/.test(p.ZONE_SUBTY || '') ? '0.2%' : 'Other mapped');
    else if (id === 'waterways') add(id, p.fcode === 46000 || p.fcode === 46006 ? 'Perennial' : 'Intermittent');
    else add(id);
  }
  return matches;
}

function zoningKeyMatches(text, value) {
  if (text === value) return true;
  // A district code must be a complete entry, not a prefix (PD vs PD (MH),
  // RES-1 vs RES-2, etc.). Family rows explicitly cover their buffers.
  if (text.split(/, | and /).includes(value)) return true;
  if (text === 'PD (RES-1 variants)') return value === 'PD (RES-1)' || value === 'PD (RES-1-B-5)';
  const family = text.match(/^([A-Z]+(?:-[A-Z0-9]+)?) and (?:most )?buffer variants$/);
  if (family) return (value === family[1] || value.startsWith(`${family[1]}-B-`)) && !(family[1] === 'R-R' && value === 'R-R-B-5');
  const group = text.match(/^([A-Z]+(?:-[A-Z0-9]+)?) and buffer variants$/);
  if (group) return value === group[1] || value.startsWith(`${group[1]}-B-`);
  return false;
}

export function updateLegendHighlights(root, matches) {
  for (const key of root.querySelectorAll('.layer-key')) {
    const values = matches.get(key.dataset.layerKey);
    for (const span of key.querySelectorAll('span')) {
      const text = span.textContent.trim();
      const match = values && [...values].some(value => {
        if (key.dataset.layerKey === 'zoning') return zoningKeyMatches(text, value);
        return text === value || text.startsWith(`${value} `) || text.startsWith(`${value} (`);
      });
      span.classList.toggle('legend-match', !!match && key.classList.contains('visible'));
    }
  }
}
