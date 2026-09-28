'use strict';
// Public USGS/USFS LANDFIRE 2025 CONUS EVT image service and official legend.
export const VEGETATION_YEAR = 2025;
export const VEGETATION_SERVICE = 'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2025/LF2025_EVT_CONUS/ImageServer';
let legendPromise;

export function vegetationTileUrl() {
  const params = new URLSearchParams({ f: 'image', bbox: '{bbox-epsg-3857}', bboxSR: '3857', imageSR: '3857', size: '256,256', format: 'png32', transparent: 'true' });
  return `${VEGETATION_SERVICE}/exportImage?${params.toString().replace('%7Bbbox-epsg-3857%7D', '{bbox-epsg-3857}')}`;
}

export async function loadVegetationLegend() {
  legendPromise ||= fetch(new URL('data/generated/landfire-evt-2025.json', window.location.href)).then(response => {
    if (!response.ok) throw new Error('LANDFIRE legend unavailable');
    return response.json();
  }).catch(error => { legendPromise = null; throw error; });
  return legendPromise;
}

export async function identifyVegetation(lngLat, request = fetch, loadLegend = loadVegetationLegend) {
  const params = new URLSearchParams({
    f: 'json', geometry: JSON.stringify({ x: lngLat.lng, y: lngLat.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', returnCatalogItems: 'false', returnGeometry: 'false'
  });
  const response = await request(`${VEGETATION_SERVICE}/identify?${params}`);
  if (!response.ok) throw new Error(`LANDFIRE returned ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'LANDFIRE error');
  const code = String(data.value ?? '');
  const legend = await loadLegend();
  return { code, ...(legend[code] || { name: 'Unclassified / no mapped vegetation', lifeform: '', physiognomy: '' }) };
}
