'use strict';

export function installMapSourcesAndLayers({ map, addPmtilesSource, COLORS, ZONING_FILL_COLOR, contourDemSource, saleGeoJson, salePointGeoJson, unmappedGeoJson }) {
    addPmtilesSource('public_land');
  addPmtilesSource('fire_hazard');
  addPmtilesSource('flood');
  addPmtilesSource('soils');
  addPmtilesSource('huc12');
  addPmtilesSource('groundwater_basins');
  addPmtilesSource('groundwater_wells');
  addPmtilesSource('geology');
  addPmtilesSource('zoning');
  addPmtilesSource('parcels');
  addPmtilesSource('roads');
  addPmtilesSource('railroads');
  addPmtilesSource('waterways');
  addPmtilesSource('waterbodies');
  addPmtilesSource('summits');
  addPmtilesSource('springs');
  map.addSource('sales', { type: 'geojson', data: saleGeoJson() });
  map.addSource('sale-points', { type: 'geojson', data: salePointGeoJson() });
  map.addSource('unmapped', { type: 'geojson', data: unmappedGeoJson() });
  map.addSource('distance-measurement', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
  map.addLayer({
    id: 'groundwater-wells', type: 'circle', source: 'groundwater_wells', 'source-layer': 'groundwater_wells', minzoom: 7,
    layout: { visibility: 'none' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2.5, 12, 5], 'circle-color': ['step', ['coalesce', ['get', 'TotalCompletedDepth'], ['get', 'TotalDrillDepth'], 0], '#70e4ef', 100, '#4ac4e6', 250, '#4384de', 500, '#7651c7'], 'circle-stroke-color': '#f3fbff', 'circle-stroke-width': 0.8, 'circle-opacity': 0.78 }
  });
  map.addLayer({
    id: 'geology', type: 'fill', source: 'geology', 'source-layer': 'geology', minzoom: 7,
    layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'material_class'], 'Unconsolidated deposits', '#e7d28a', 'Volcanic rock', '#bd7c61', 'Intrusive igneous rock', '#ad8bd0', 'Metamorphic rock', '#729f83', 'Sedimentary rock', '#be9d62', '#9a9a9a'], 'fill-opacity': 0.38, 'fill-outline-color': 'rgba(45, 38, 30, 0.68)' }
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
    id: 'springs', type: 'circle', source: 'springs', 'source-layer': 'springs', minzoom: 9,
    layout: { visibility: 'visible' }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 5], 'circle-color': '#9cf4ff', 'circle-stroke-color': '#07536b', 'circle-stroke-width': 1.1, 'circle-opacity': 0.9 }
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
  map.addLayer({ id: 'distance-measurement-line-outline', type: 'line', source: 'distance-measurement', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': 'rgba(255,255,255,.95)', 'line-width': 6, 'line-opacity': .95 } });
  map.addLayer({ id: 'distance-measurement-line', type: 'line', source: 'distance-measurement', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#126246', 'line-width': 3, 'line-dasharray': [1.5, 1.2] } });
  map.addLayer({ id: 'distance-measurement-points', type: 'circle', source: 'distance-measurement', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#126246', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
  map.addLayer({ id: 'parcel-selected', type: 'line', source: 'parcels', 'source-layer': 'parcels', paint: { 'line-color': '#fff', 'line-width': 5, 'line-blur': 0.3, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] } });
  map.addLayer({ id: 'unmapped-markers', type: 'circle', source: 'unmapped', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'category'], 'private-home', COLORS['private-home'], COLORS['private-land']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.9, 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'unmapped-marker-labels', type: 'symbol', source: 'unmapped', filter: ['!=', ['get', 'markerLabel'], ''], layout: { 'text-field': ['get', 'markerLabel'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-padding': 3, 'text-pitch-alignment': 'viewport' }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(20, 25, 22, 0.9)', 'text-halo-width': 2, 'text-halo-blur': 0.4 } });

}
