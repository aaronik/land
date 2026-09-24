'use strict';

const assert = require('node:assert/strict');

(async () => {
  const { LAND_COVER_SERVICE, LAND_COVER_MOSAIC_RULE, landCoverTileUrl, identifyLandCover } = await import('../assets/map/land-cover.js');
  const tile = landCoverTileUrl();
  assert.match(tile, /bbox=\{bbox-epsg-3857\}/);
  assert.equal(new URL(tile).searchParams.get('mosaicRule'), LAND_COVER_MOSAIC_RULE);
  assert.equal(JSON.parse(LAND_COVER_MOSAIC_RULE).where, 'Year = 2024');
  const request = async url => {
    assert.equal(new URL(url).origin, new URL(LAND_COVER_SERVICE).origin);
    const params = new URL(url).searchParams;
    assert.equal(JSON.parse(params.get('geometry')).spatialReference.wkid, 4326);
    assert.equal(params.get('mosaicRule'), LAND_COVER_MOSAIC_RULE);
    return { ok: true, json: async () => ({ value: '42' }) };
  };
  assert.equal(await identifyLandCover({ lng: -122.3, lat: 41.3 }, request), 'Evergreen forest');
  assert.equal(await identifyLandCover({ lng: -122.3, lat: 41.3 }, async () => ({ ok: true, json: async () => ({ value: 'NoData' }) })), null);
  console.log('Land-cover source tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
