'use strict';

function addSpringSymbol(map) {
  const size = 24;
  const data = new Uint8Array(size * size * 4);
  const setPixel = (x, y, color) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const index = (y * size + x) * 4;
    data.set(color, index);
  };
  const stroke = (x1, y1, x2, y2, width, color) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const projection = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
      const px = x1 + projection * dx;
      const py = y1 + projection * dy;
      if (Math.hypot(x - px, y - py) <= width / 2) setPixel(x, y, color);
    }
  };
  const centerX = 9;
  const centerY = 10;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot(x - centerX, y - centerY);
    if (distance <= 5.3) setPixel(x, y, distance >= 3.6 ? [7, 83, 107, 255] : [156, 244, 255, 255]);
  }
  // USGS-style spring/seep outlet, extending from the blue source circle.
  stroke(12, 13, 17, 18, 2.4, [7, 83, 107, 255]);
  stroke(12, 13, 17, 18, 1, [156, 244, 255, 255]);
  map.addImage('usgs-spring', { width: size, height: size, data });
}

function addWellSymbols(map) {
  const colors = { shallow: [112, 228, 239], medium: [74, 196, 230], deep: [67, 132, 222], veryDeep: [118, 81, 199] };
  for (const [name, color] of Object.entries(colors)) {
    const size = 16;
    const data = new Uint8Array(size * size * 4);
    for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
      const index = (y * size + x) * 4;
      data.set(x === 2 || x === 13 || y === 2 || y === 13 ? [243, 251, 255, 255] : [...color, 255], index);
    }
    map.addImage(`well-${name}`, { width: size, height: size, data });
  }
}

export function installMapSourcesAndLayers({ map, addPmtilesSource, COLORS, ZONING_FILL_COLOR, contourDemSource, saleGeoJson, salePointGeoJson, unmappedGeoJson }) {
    addPmtilesSource('public_land');
  addPmtilesSource('fire_hazard');
  addPmtilesSource('flood');
  addPmtilesSource('soils');
  addPmtilesSource('farmland');
  addPmtilesSource('rcra_sites');
  addPmtilesSource('huc12');
  addPmtilesSource('cell_att');
  addPmtilesSource('cell_tmobile');
  addPmtilesSource('cell_verizon');
  addPmtilesSource('pct');
  addPmtilesSource('pct_markers');
  addPmtilesSource('groundwater_basins');
  addPmtilesSource('groundwater_wells');
  addPmtilesSource('geology');
  addPmtilesSource('zoning');
  addPmtilesSource('parcels');
  addPmtilesSource('roads');
  addPmtilesSource('forest_roads');
  addPmtilesSource('railroads');
  addPmtilesSource('waterways');
  addPmtilesSource('waterbodies');
  addPmtilesSource('summits');
  addPmtilesSource('towns');
  addPmtilesSource('springs');
  map.addSource('sales', { type: 'geojson', data: saleGeoJson() });
  map.addSource('sale-points', { type: 'geojson', data: salePointGeoJson() });
  map.addSource('unmapped', { type: 'geojson', data: unmappedGeoJson() });
  map.addSource('distance-measurement', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('coordinate-pin', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('road-tracks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('polygon-drawings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('parcel-adjustment', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('topographic-contours', {
    type: 'vector',
    tiles: [contourDemSource.contourProtocolUrl({
      multiplier: 3.28084,
      thresholds: { 8: [1000, 5000], 10: [500, 2500], 12: [200, 1000], 14: [100, 500], 15: [50, 250] },
      contourLayer: 'contours',
      elevationKey: 'ele',
      levelKey: 'level'
    })],
    maxzoom: 15
  });

  map.addLayer({
    id: 'topographic-contours',
    type: 'line',
    source: 'topographic-contours',
    'source-layer': 'contours',
    minzoom: 8,
    paint: {
      'line-color': '#d9c79c',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.18, 12, 0.28, 16, 0.34],
      'line-width': ['match', ['get', 'level'], 1, 0.85, 0.45]
    }
  });
  map.addLayer({
    id: 'topographic-contour-labels',
    type: 'symbol',
    source: 'topographic-contours',
    'source-layer': 'contours',
    minzoom: 10,
    filter: ['>=', ['get', 'level'], 0],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-field': ['concat', ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }], ' ft'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-letter-spacing': 0.04,
      'text-padding': 5,
      'text-keep-upright': true,
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#fff4d2',
      'text-halo-color': 'rgba(32, 35, 28, 0.92)',
      'text-halo-width': 2,
      'text-halo-blur': 0.4
    }
  });
  map.addLayer({ id: 'public-land', type: 'fill', source: 'public_land', 'source-layer': 'public_land', paint: { 'fill-color': '#4e9f54', 'fill-opacity': 0.38 } });
  map.addLayer({ id: 'huc12-fill', type: 'fill', source: 'huc12', 'source-layer': 'huc12', minzoom: 7, layout: { visibility: 'none' }, paint: { 'fill-color': '#27b8ca', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'huc12-lines', type: 'line', source: 'huc12', 'source-layer': 'huc12', minzoom: 7, layout: { visibility: 'none' }, paint: { 'line-color': '#44d7e8', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 2.2] } });
  map.addLayer({
    id: 'huc12-labels', type: 'symbol', source: 'huc12', 'source-layer': 'huc12', minzoom: 9,
    layout: { visibility: 'none', 'text-field': ['concat', ['coalesce', ['get', 'name'], 'Unnamed subwatershed'], '\nHUC ', ['get', 'huc12']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12], 'text-max-width': 16, 'text-padding': 8 },
    paint: { 'text-color': '#d9fbff', 'text-halo-color': 'rgba(15, 37, 39, 0.92)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({ id: 'cell-att', type: 'fill', source: 'cell_att', 'source-layer': 'cell_att', minzoom: 7, layout: { visibility: 'none' }, paint: { 'fill-color': '#00c5ff', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'cell-tmobile', type: 'fill', source: 'cell_tmobile', 'source-layer': 'cell_tmobile', minzoom: 7, layout: { visibility: 'none' }, paint: { 'fill-color': '#ff00c5', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'cell-verizon', type: 'fill', source: 'cell_verizon', 'source-layer': 'cell_verizon', minzoom: 7, layout: { visibility: 'none' }, paint: { 'fill-color': '#ef3030', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'pct-casing', type: 'line', source: 'pct', 'source-layer': 'pct', minzoom: 7, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': 'rgba(37, 25, 8, 0.92)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3.2, 14, 7] } });
  map.addLayer({ id: 'pct', type: 'line', source: 'pct', 'source-layer': 'pct', minzoom: 7, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#e69800', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.7, 14, 4], 'line-opacity': 0.98 } });
  map.addLayer({ id: 'pct-markers', type: 'circle', source: 'pct_markers', 'source-layer': 'pct_markers', minzoom: 10, layout: { visibility: 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4], 'circle-color': '#1d1609', 'circle-stroke-color': '#e69800', 'circle-stroke-width': 1.5 } });
  map.addLayer({
    id: 'groundwater-basins-fill', type: 'fill', source: 'groundwater_basins', 'source-layer': 'groundwater_basins', minzoom: 7,
    layout: { visibility: 'none' }, paint: { 'fill-color': '#9e6eea', 'fill-opacity': 0.12 }
  });
  map.addLayer({
    id: 'groundwater-basins-lines', type: 'line', source: 'groundwater_basins', 'source-layer': 'groundwater_basins', minzoom: 7,
    layout: { visibility: 'none' }, paint: { 'line-color': '#b98cff', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 13, 2.5], 'line-dasharray': [2, 1.5], 'line-opacity': 0.9 }
  });
  map.addLayer({
    id: 'groundwater-basins-labels', type: 'symbol', source: 'groundwater_basins', 'source-layer': 'groundwater_basins', minzoom: 9,
    layout: { visibility: 'none', 'text-field': ['coalesce', ['get', 'Basin_Subbasin_Name'], ['get', 'Basin_Name']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 13], 'text-max-width': 14, 'text-padding': 8 },
    paint: { 'text-color': '#dfc6ff', 'text-halo-color': 'rgba(35, 19, 58, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  addWellSymbols(map);
  map.addLayer({
    id: 'groundwater-wells', type: 'symbol', source: 'groundwater_wells', 'source-layer': 'groundwater_wells', minzoom: 7,
    layout: {
      visibility: 'none',
      'icon-image': ['step', ['coalesce', ['get', 'TotalCompletedDepth'], ['get', 'TotalDrillDepth'], 0], 'well-shallow', 100, 'well-medium', 250, 'well-deep', 500, 'well-veryDeep'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.45, 12, 0.75],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true
    }
  });
  map.addLayer({
    id: 'geology', type: 'fill', source: 'geology', 'source-layer': 'geology', minzoom: 7,
    layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'material_class'], 'Unconsolidated deposits', '#e7d28a', 'Volcanic rock', '#bd7c61', 'Intrusive igneous rock', '#ad8bd0', 'Metamorphic rock', '#729f83', 'Sedimentary rock', '#be9d62', '#9a9a9a'], 'fill-opacity': 0.38, 'fill-outline-color': 'rgba(45, 38, 30, 0.68)' }
  });
  map.addLayer({
    id: 'rcra-sites', type: 'circle', source: 'rcra_sites', 'source-layer': 'rcra_sites', minzoom: 7, layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 12, 6],
      'circle-color': ['match', ['get', 'FEDERAL_GENERATOR_STATUS'], 'LQG', '#d73027', 'SQG', '#fc8d59', 'VSG', '#fee08b', '#9b59b6'],
      'circle-stroke-color': '#3b1515',
      'circle-stroke-width': 1.2,
      'circle-opacity': 0.92
    }
  });
  map.addLayer({ id: 'farmland', type: 'fill', source: 'farmland', 'source-layer': 'farmland', minzoom: 7, layout: { visibility: 'none' },
    paint: {
      'fill-color': ['match', ['get', 'polygon_ty'], 'P', '#8db359', 'S', '#bed984', 'U', '#e2f7b0', 'L', '#f9fcde', 'G', '#e3dbc5', 'I', '#acc7a5', 'N', '#f0f0c2', 'Cl', '#b37b59', '#b9b9b9'],
      'fill-opacity': 0.48,
      'fill-outline-color': 'rgba(69, 89, 39, 0.72)'
    }
  });
  map.addLayer({ id: 'soils', type: 'fill', source: 'soils', 'source-layer': 'soils', minzoom: 9, layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'drclassdcd'], 'Very poorly drained', '#4f78a8', 'Poorly drained', '#6b94b7', 'Somewhat poorly drained', '#87adbf', 'Moderately well drained', '#b9a46b', 'Well drained', '#a97a45', 'Somewhat excessively drained', '#c48d54', 'Excessively drained', '#d5a767', '#9b8064'], 'fill-opacity': 0.34, 'fill-outline-color': 'rgba(69, 45, 25, 0.7)' } });
  map.addLayer({ id: 'flood', type: 'fill', source: 'flood', 'source-layer': 'flood', layout: { visibility: 'none' }, paint: { 'fill-color': ['case', ['==', ['get', 'SFHA_TF'], 'T'], '#00c5ff', ['all', ['==', ['get', 'FLD_ZONE'], 'X'], ['match', ['get', 'ZONE_SUBTY'], '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', true, '0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD', true, false]], '#75d5ec', ['==', ['get', 'FLD_ZONE'], 'D'], '#e8d15c', '#3db7de'], 'fill-opacity': 0.38, 'fill-outline-color': 'rgba(0, 104, 160, 0.8)' } });
  map.addLayer({ id: 'fire-hazard', type: 'fill', source: 'fire_hazard', 'source-layer': 'fire_hazard', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'HAZ_CLASS'], 'Very High', '#d73027', 'High', '#fc8d59', 'Moderate', '#fee08b', '#f5a623'], 'fill-opacity': 0.3 } });
  map.addLayer({ id: 'zoning-fill', type: 'fill', source: 'zoning', 'source-layer': 'zoning', minzoom: 10.5, layout: { visibility: 'none' }, paint: { 'fill-color': ZONING_FILL_COLOR, 'fill-opacity': 0.65 } });
  map.addLayer({ id: 'zoning-lines', type: 'line', source: 'zoning', 'source-layer': 'zoning', minzoom: 10.5, layout: { visibility: 'none' }, paint: { 'line-color': '#6e6e6e', 'line-width': ['interpolate', ['linear'], ['zoom'], 10.5, 0.5, 15, 1.2], 'line-opacity': 0.8 } });
  map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcels', 'source-layer': 'parcels', minzoom: 8, paint: { 'fill-color': '#fff', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.01, 13, 0.045] } });
  map.addLayer({ id: 'parcel-lines', type: 'line', source: 'parcels', 'source-layer': 'parcels', minzoom: 8, paint: { 'line-color': '#aeb4b7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 13, 0.85], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 15, 1.8] } });
  map.addLayer({
    id: 'waterways-casing', type: 'line', source: 'waterways', 'source-layer': 'waterways', minzoom: 7,
    paint: { 'line-color': 'rgba(6, 31, 58, 0.78)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.3, 14, 5.2], 'line-opacity': ['match', ['get', 'fcode'], 46000, 0.9, 46006, 0.9, 0.5] }
  });
  map.addLayer({
    id: 'waterways', type: 'line', source: 'waterways', 'source-layer': 'waterways', minzoom: 7,
    paint: {
      'line-color': ['match', ['get', 'fcode'], 46000, '#38a8ff', 46006, '#38a8ff', '#6ca8cf'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'fcode'], 46006, 1.4, 46000, 1.4, 0.7], 14, ['match', ['get', 'fcode'], 46006, 3.2, 46000, 3.2, 1.35]],
      'line-opacity': ['match', ['get', 'fcode'], 46000, 0.95, 46006, 0.95, 0.7],
      'line-dasharray': ['match', ['get', 'fcode'], 46003, ['literal', [2.5, 2]], 46007, ['literal', [1, 2]], ['literal', [1, 0]]]
    }
  });
  map.addLayer({
    id: 'waterbodies', type: 'fill', source: 'waterbodies', 'source-layer': 'waterbodies', minzoom: 7,
    paint: { 'fill-color': '#4aafff', 'fill-opacity': 0.58, 'fill-outline-color': '#167cc2' }
  });
  map.addLayer({
    id: 'waterbody-labels', type: 'symbol', source: 'waterbodies', 'source-layer': 'waterbodies', minzoom: 9,
    filter: ['all', ['has', 'GNIS_NAME'], ['!=', ['get', 'GNIS_NAME'], '']],
    layout: {
      'text-field': ['get', 'GNIS_NAME'], 'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13], 'text-max-width': 12,
      'text-padding': 5
    },
    paint: { 'text-color': '#b9e4ff', 'text-halo-color': 'rgba(6, 24, 43, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({
    id: 'summits', type: 'symbol', source: 'summits', 'source-layer': 'summits', minzoom: 8,
    layout: {
      'text-field': ['concat', '▲ ', ['get', 'gaz_name']], 'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 13],
      'symbol-sort-key': ['case', ['==', ['get', 'gaz_name'], 'Mount Shasta'], 0, 1],
      'text-offset': [0, 0.2], 'text-anchor': 'bottom', 'text-padding': 5
    },
    paint: { 'text-color': '#f4dc9d', 'text-halo-color': 'rgba(39, 31, 19, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({
    id: 'towns', type: 'symbol', source: 'towns', 'source-layer': 'towns', minzoom: 6,
    filter: ['all', ['has', 'gaz_name'], ['!=', ['get', 'gaz_name'], '']],
    layout: {
      'text-field': ['get', 'gaz_name'], 'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 8, 13, 14, 14],
      'text-transform': 'uppercase', 'text-letter-spacing': 0.08,
      'text-offset': [0, 0.7], 'text-anchor': 'top', 'text-padding': 6,
      'text-allow-overlap': true, 'text-ignore-placement': true
    },
    paint: { 'text-color': '#fffdf0', 'text-halo-color': 'rgba(20, 28, 24, 0.98)', 'text-halo-width': 2.5, 'text-halo-blur': 0.4 }
  });
  addSpringSymbol(map);
  map.addLayer({
    id: 'springs', type: 'symbol', source: 'springs', 'source-layer': 'springs', minzoom: 9,
    layout: { visibility: 'visible', 'icon-image': 'usgs-spring', 'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1.15], 'icon-allow-overlap': true, 'icon-ignore-placement': true }
  });
  map.addLayer({
    id: 'waterway-labels', type: 'symbol', source: 'waterways', 'source-layer': 'waterways', minzoom: 10,
    filter: ['all', ['has', 'gnis_name'], ['!=', ['get', 'gnis_name'], '']],
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'gnis_name'],
      'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-letter-spacing': 0.03, 'text-offset': [0, 1], 'text-padding': 4, 'text-keep-upright': true
    },
    paint: { 'text-color': '#78c6ff', 'text-halo-color': 'rgba(6, 24, 43, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({ id: 'forest-roads', type: 'line', source: 'forest_roads', 'source-layer': 'forest_roads', minzoom: 9, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#c7a85b', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.55, 15, 2.2], 'line-opacity': 0.72 } });
  map.addLayer({
    id: 'forest-road-labels', type: 'symbol', source: 'forest_roads', 'source-layer': 'forest_roads', minzoom: 11,
    filter: ['all', ['has', 'field_id'], ['!=', ['get', 'field_id'], '']],
    layout: { 'symbol-placement': 'line', 'symbol-spacing': 450, 'text-field': ['get', 'field_id'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 15, 12], 'text-letter-spacing': 0.02, 'text-max-angle': 35, 'text-padding': 4, 'text-keep-upright': true },
    paint: { 'text-color': '#e7d08b', 'text-halo-color': 'rgba(35, 31, 21, 0.92)', 'text-halo-width': 1.8, 'text-halo-blur': 0.35 }
  });
  map.addLayer({ id: 'roads', type: 'line', source: 'roads', 'source-layer': 'roads', minzoom: 9, paint: { 'line-color': '#f8d37c', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 15, 3], 'line-opacity': 0.9 } });
  map.addLayer({
    id: 'road-labels',
    type: 'symbol',
    source: 'roads',
    'source-layer': 'roads',
    minzoom: 11,
    filter: ['all', ['has', 'ROADNAME'], ['!=', ['get', 'ROADNAME'], '']],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 300,
      'text-field': ['get', 'ROADNAME'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
      'text-letter-spacing': 0.02,
      'text-max-angle': 35,
      'text-padding': 3,
      'text-keep-upright': true
    },
    paint: {
      'text-color': '#fff7dc',
      'text-halo-color': 'rgba(35, 31, 21, 0.92)',
      'text-halo-width': 2,
      'text-halo-blur': 0.4
    }
  });
  map.addLayer({
    id: 'railroad-casing', type: 'line', source: 'railroads', 'source-layer': 'railroads', minzoom: 7,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': 'rgba(255, 255, 255, 0.9)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.8, 14, 6.5] }
  });
  map.addLayer({
    id: 'railroads', type: 'line', source: 'railroads', 'source-layer': 'railroads', minzoom: 7,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#e53935', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 14, 3.5] }
  });
  map.addLayer({
    id: 'railroad-ties', type: 'line', source: 'railroads', 'source-layer': 'railroads', minzoom: 10,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': '#681616', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 14, 2.2], 'line-dasharray': [0.5, 2.5] }
  });
  map.addLayer({
    id: 'railroad-labels', type: 'symbol', source: 'railroads', 'source-layer': 'railroads', minzoom: 10,
    filter: ['any', ['has', 'SUBDIV'], ['has', 'BRANCH'], ['has', 'RROWNER1']],
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 500,
      'text-field': ['coalesce', ['get', 'SUBDIV'], ['get', 'BRANCH'], ['get', 'RROWNER1']],
      'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-letter-spacing': 0.04, 'text-offset': [0, 1.1], 'text-padding': 4, 'text-keep-upright': true
    },
    paint: { 'text-color': '#ff6b67', 'text-halo-color': 'rgba(25, 16, 16, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({ id: 'sale-fill', type: 'fill', source: 'sales', paint: { 'fill-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'fill-opacity': 0.42 } });
  map.addLayer({ id: 'sale-lines', type: 'line', source: 'sales', paint: { 'line-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'line-width': 3 } });
  map.addLayer({ id: 'sale-markers', type: 'circle', source: 'sale-points', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.95, 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'sale-marker-labels', type: 'symbol', source: 'sale-points', filter: ['!=', ['get', 'markerLabel'], ''], layout: { 'text-field': ['get', 'markerLabel'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-padding': 3, 'text-pitch-alignment': 'viewport' }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(20, 25, 22, 0.9)', 'text-halo-width': 2, 'text-halo-blur': 0.4 } });
  map.addLayer({ id: 'coordinate-pin-halo', type: 'circle', source: 'coordinate-pin', paint: { 'circle-radius': 11, 'circle-color': 'rgba(255,255,255,.9)', 'circle-stroke-color': '#b52c2c', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'coordinate-pin', type: 'circle', source: 'coordinate-pin', paint: { 'circle-radius': 5, 'circle-color': '#d93636', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'road-tracks-outline', type: 'line', source: 'road-tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': 'rgba(20, 28, 24, .95)', 'line-width': 7 } });
  map.addLayer({ id: 'road-tracks', type: 'line', source: 'road-tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'recording'], '#ff7a30', '#49dca6'], 'line-width': 4 } });
  map.addLayer({ id: 'distance-measurement-line-outline', type: 'line', source: 'distance-measurement', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': 'rgba(255,255,255,.95)', 'line-width': 6, 'line-opacity': .95 } });
  map.addLayer({ id: 'distance-measurement-line', type: 'line', source: 'distance-measurement', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': '#126246', 'line-width': 3, 'line-dasharray': [1.5, 1.2] } });
  map.addLayer({ id: 'distance-measurement-points', type: 'circle', source: 'distance-measurement', filter: ['==', ['get', 'kind'], 'point'], paint: { 'circle-radius': 7, 'circle-color': '#126246', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'distance-measurement-label', type: 'symbol', source: 'distance-measurement', filter: ['==', ['get', 'kind'], 'label'], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.2], 'text-anchor': 'bottom', 'text-padding': 4, 'text-allow-overlap': true }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(18, 98, 70, .96)', 'text-halo-width': 2.5, 'text-halo-blur': .4 } });
  map.addLayer({ id: 'parcel-adjustment-fill', type: 'fill', source: 'parcel-adjustment', paint: { 'fill-color': '#ffdc57', 'fill-opacity': 0.18 } });
  map.addLayer({ id: 'parcel-adjustment-line', type: 'line', source: 'parcel-adjustment', paint: { 'line-color': '#ffdc57', 'line-width': 3, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'parcel-adjustment-handle', type: 'circle', source: 'parcel-adjustment', filter: ['==', ['get', 'kind'], 'rotate-handle'], paint: { 'circle-radius': 8, 'circle-color': '#ffdc57', 'circle-stroke-color': '#16231d', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'polygon-drawings-fill', type: 'fill', source: 'polygon-drawings', filter: ['==', ['get', 'kind'], 'area'], paint: { 'fill-color': '#5fc4e8', 'fill-opacity': ['case', ['get', 'draft'], 0.1, 0.16] } });
  map.addLayer({ id: 'polygon-drawings-edges-outline', type: 'line', source: 'polygon-drawings', filter: ['==', ['get', 'kind'], 'edge'], paint: { 'line-color': '#16231d', 'line-width': 5 } });
  map.addLayer({ id: 'polygon-drawings-edges', type: 'line', source: 'polygon-drawings', filter: ['==', ['get', 'kind'], 'edge'], paint: { 'line-color': '#5fc4e8', 'line-width': 3 } });
  map.addLayer({ id: 'polygon-drawings-selected-edge', type: 'line', source: 'polygon-drawings', filter: ['all', ['==', ['get', 'kind'], 'edge'], ['==', ['get', 'selected'], true]], paint: { 'line-color': '#ffe166', 'line-width': 6 } });
  map.addLayer({ id: 'polygon-drawings-vertices', type: 'circle', source: 'polygon-drawings', filter: ['==', ['get', 'kind'], 'vertex'], paint: { 'circle-radius': ['match', ['get', 'selectedRole'], 'Start', 8, 'End', 8, 5], 'circle-color': ['match', ['get', 'selectedRole'], 'Start', '#39d98a', 'End', '#ff7b72', '#5fc4e8'], 'circle-stroke-color': '#16231d', 'circle-stroke-width': 1.5 } });
  map.addLayer({ id: 'polygon-drawings-selected-corner-labels', type: 'symbol', source: 'polygon-drawings', filter: ['==', ['get', 'kind'], 'selected-corner-label'], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-offset': [0, -1.2], 'text-anchor': 'bottom', 'text-allow-overlap': true }, paint: { 'text-color': '#fff', 'text-halo-color': '#16231d', 'text-halo-width': 2 } });
  map.addLayer({ id: 'polygon-drawings-labels', type: 'symbol', source: 'polygon-drawings', filter: ['==', ['get', 'kind'], 'label'], layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 10, 'text-offset': [0, -1], 'text-anchor': 'bottom', 'text-max-width': 24, 'text-allow-overlap': true }, paint: { 'text-color': '#e7fbff', 'text-halo-color': '#16231d', 'text-halo-width': 2 } });
  map.addLayer({ id: 'parcel-selected', type: 'line', source: 'parcels', 'source-layer': 'parcels', paint: { 'line-color': '#fff', 'line-width': 5, 'line-blur': 0.3, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] } });
  map.addLayer({ id: 'unmapped-markers', type: 'circle', source: 'unmapped', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'category'], 'private-home', COLORS['private-home'], COLORS['private-land']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.9, 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'unmapped-marker-labels', type: 'symbol', source: 'unmapped', filter: ['!=', ['get', 'markerLabel'], ''], layout: { 'text-field': ['get', 'markerLabel'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-padding': 3, 'text-pitch-alignment': 'viewport' }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(20, 25, 22, 0.9)', 'text-halo-width': 2, 'text-halo-blur': 0.4 } });

}
