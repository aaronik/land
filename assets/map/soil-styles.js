// Full set of surface texture labels returned by the NRCS SSURGO horizon join.
// Do not infer a finer texture from a map-unit name or invent within-unit boundaries.
export const SOIL_TEXTURE_COLORS = {
  'Sand': '#f5e39a', 'Fine sand': '#efda88', 'Coarse sand': '#e8ce72',
  'Loamy fine sand': '#e5c578', 'Loamy sand': '#ddbc66', 'Loamy coarse sand': '#d2af58',
  'Very fine sandy loam': '#e6b987', 'Fine sandy loam': '#dbaa71',
  'Sandy loam': '#cf995d', 'Coarse sandy loam': '#bc854c',
  'Loam': '#92683f', 'Silt': '#eee1ca', 'Silt loam': '#c6c0a7',
  'Clay loam': '#af7a70', 'Sandy clay loam': '#b5695f', 'Silty clay loam': '#9d777f',
  'Clay': '#784553', 'Silty clay': '#695273', 'Not rated': '#909090'
};
export function soilTextureExpression() {
  return ['match', ['get', 'texture_group'], ...Object.entries(SOIL_TEXTURE_COLORS).flat(), '#909090'];
}
