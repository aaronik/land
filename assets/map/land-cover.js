// Annual NLCD Collection 1.1, 2024 land cover (30 m). Land cover is a
// landscape proxy for habitat, not a species inventory or a wetland delineation.
export const LAND_COVER_SERVICE = 'https://di-nlcd.img.arcgis.com/arcgis/rest/services/USA_NLCD_Annual_LandCover/ImageServer';
export const LAND_COVER_YEAR = 2024;
export const LAND_COVER_MOSAIC_RULE = JSON.stringify({ mosaicMethod: 'esriMosaicAttribute', sortField: 'Year', sortValue: String(LAND_COVER_YEAR), where: `Year = ${LAND_COVER_YEAR}` });

export const LAND_COVER_CLASSES = {
  11: 'Open water', 12: 'Perennial snow/ice',
  21: 'Developed open space', 22: 'Developed, low intensity', 23: 'Developed, medium intensity', 24: 'Developed, high intensity',
  31: 'Barren land', 41: 'Deciduous forest', 42: 'Evergreen forest', 43: 'Mixed forest',
  51: 'Dwarf scrub', 52: 'Shrub/scrub', 71: 'Grassland/herbaceous', 72: 'Sedge/herbaceous',
  73: 'Lichens', 74: 'Moss', 81: 'Pasture/hay', 82: 'Cultivated crops',
  90: 'Woody wetlands', 95: 'Emergent herbaceous wetlands'
};

// Legend swatches group several of the source's 30 m classes together.
export function landCoverLegendClass(value) {
  if (!value) return null;
  if (value.includes('forest')) return 'Forest';
  if (value.includes('wetland')) return 'Woody / herbaceous wetland';
  if (value === 'Open water') return 'Open water';
  if (value.includes('scrub')) return 'Shrub / scrub';
  if (['Grassland/herbaceous', 'Sedge/herbaceous', 'Lichens', 'Moss'].includes(value)) return 'Grassland / herbaceous';
  if (['Pasture/hay', 'Cultivated crops'].includes(value)) return 'Pasture / cropland';
  if (value.startsWith('Developed') || value === 'Barren land') return 'Developed / barren';
  return null; // No matching swatch (e.g. perennial snow/ice).
}

export function landCoverTileUrl() {
  const params = new URLSearchParams({
    f: 'image', bbox: '{bbox-epsg-3857}', bboxSR: '3857', imageSR: '3857',
    size: '256,256', format: 'png32', transparent: 'true', mosaicRule: LAND_COVER_MOSAIC_RULE
  });
  // Preserve MapLibre's tile bounding-box placeholder (not URL-encoded).
  return `${LAND_COVER_SERVICE}/exportImage?${params.toString().replace('%7Bbbox-epsg-3857%7D', '{bbox-epsg-3857}')}`;
}

export async function identifyLandCover(lngLat, request = fetch) {
  const params = new URLSearchParams({
    f: 'json', geometry: JSON.stringify({ x: lngLat.lng, y: lngLat.lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint', returnCatalogItems: 'false', returnGeometry: 'false', mosaicRule: LAND_COVER_MOSAIC_RULE
  });
  const response = await request(`${LAND_COVER_SERVICE}/identify?${params}`);
  if (!response.ok) throw new Error(`Land-cover service returned ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error(result.error.message || 'Land-cover service error');
  return LAND_COVER_CLASSES[Number(result.value)] || null;
}
