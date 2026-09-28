'use strict';

// Join existing SSURGO map-unit polygons to dominant components and their
// shallowest representative, classified mineral horizon. Do not replace a
// missing texture with a guessed value from the map-unit name.
const fs = require('fs');
const path = require('path');
const ENDPOINT = 'https://sdmdataaccess.nrcs.usda.gov/tabular/post.rest';

function queryFor(keys) {
  if (!keys.length || keys.some(key => !/^\d+$/.test(key))) throw new Error('Invalid SSURGO mukey');
  return `SELECT mu.mukey, c.compname, c.comppct_r, c.taxclname, ch.hzdept_r, ch.hzdepb_r, tx.texcl, ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r
FROM mapunit mu
INNER JOIN component c ON c.cokey = (SELECT TOP 1 c2.cokey FROM component c2 WHERE c2.mukey = mu.mukey ORDER BY c2.comppct_r DESC, c2.cokey)
LEFT JOIN chorizon ch ON ch.chkey = (SELECT TOP 1 h.chkey FROM chorizon h INNER JOIN chtexturegrp g ON g.chkey=h.chkey AND g.rvindicator='Yes' INNER JOIN chtexture t ON t.chtgkey=g.chtgkey AND t.texcl IS NOT NULL WHERE h.cokey=c.cokey AND h.hzdepb_r > 0 ORDER BY h.hzdept_r, h.chkey)
LEFT JOIN chtexturegrp tg ON tg.chkey=ch.chkey AND tg.rvindicator='Yes'
LEFT JOIN chtexture tx ON tx.chtgkey=tg.chtgkey
WHERE mu.mukey IN (${keys.map(key => `'${key}'`).join(',')})`;
}

function textureGroup(value) {
  return String(value || '').trim() || 'Not rated';
}

async function fetchComponents(keys, request = fetch) {
  const response = await request(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ query: queryFor(keys), format: 'JSON' }) });
  if (!response.ok) throw new Error(`NRCS Soil Data Access returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  if (!Array.isArray(data.Table)) throw new Error('NRCS response missing Table');
  const result = new Map();
  for (const [mukey, series, percentage, taxonomy, top, bottom, texture, sand, silt, clay] of data.Table) {
    // A few components have multiple representative texture rows: retain the first.
    if (!result.has(String(mukey))) result.set(String(mukey), {
      dominant_series: series || '', dominant_percent: percentage || '', soil_taxonomy: taxonomy || '',
      surface_texture: texture || '', texture_top_cm: top ?? '', texture_bottom_cm: bottom ?? '', texture_group: textureGroup(texture),
      sand_pct: sand === null || sand === '' ? null : Number(sand),
      silt_pct: silt === null || silt === '' ? null : Number(silt),
      clay_pct: clay === null || clay === '' ? null : Number(clay)
    });
  }
  return result;
}

async function main() {
  const file = path.join(__dirname, '../data/raw/soils.geojson');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.argv.includes('--regroup')) {
    for (const feature of data.features) feature.properties.texture_group = textureGroup(feature.properties.surface_texture);
    fs.writeFileSync(file, JSON.stringify(data));
    console.log(`Regrouped ${data.features.length} soil polygons from their saved horizon textures.`);
    return;
  }
  const keys = [...new Set(data.features.map(feature => String(feature.properties.mukey)).filter(key => /^\d+$/.test(key)))];
  const components = new Map();
  for (let i = 0; i < keys.length; i += 60) {
    const batch = await fetchComponents(keys.slice(i, i + 60));
    for (const [key, value] of batch) components.set(key, value);
    console.log(`SSURGO: ${Math.min(i + 60, keys.length)}/${keys.length} keys`);
  }
  if (components.size !== keys.length) throw new Error(`Incomplete SSURGO join: ${components.size}/${keys.length}`);
  for (const feature of data.features) Object.assign(feature.properties, components.get(String(feature.properties.mukey)) || {
    dominant_series: '', dominant_percent: '', soil_taxonomy: '', surface_texture: '', texture_top_cm: '', texture_bottom_cm: '', texture_group: 'Not rated', sand_pct: null, silt_pct: null, clay_pct: null
  });
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`Enriched ${data.features.length} polygons with ${components.size} dominant soil components.`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { queryFor, textureGroup, fetchComponents };
