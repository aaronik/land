'use strict';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

// Read the road archives directly instead of querySourceFeatures: MapLibre only
// returns viewport tiles, and returns none when the Roads display layer is hidden.
const archives = ['roads', 'forest_roads'].map(name => ({
  name, tiles: new PMTiles(new URL(`data/generated/${name}.pmtiles`, document.baseURI).href)
}));
const ZOOM = 13;
const tileAt = ([lng, lat]) => {
  const n = 2 ** ZOOM;
  return [Math.max(0, Math.min(n - 1, Math.floor((lng + 180) / 360 * n))),
    Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)))];
};
const cache = new Map();
async function tileFeatures(archive, x, y) {
  const key = `${archive.name}/${x}/${y}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const result = await archive.tiles.getZxy(ZOOM, x, y);
    if (!result) return [];
    const layer = new VectorTile(new PbfReader(new Uint8Array(result.data))).layers[archive.name];
    if (!layer) return [];
    const features = [];
    for (let i = 0; i < layer.length; i++) features.push(layer.feature(i).toGeoJSON(x, y, ZOOM));
    return features;
  })().catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
}

export async function loadRoadFeatures(start, end = start) {
  const [ax, ay] = tileAt(start), [bx, by] = tileAt(end);
  // Include adjacent tiles for snapping near seams and graph connections.
  const minX = Math.min(ax, bx) - 1, maxX = Math.max(ax, bx) + 1;
  const minY = Math.min(ay, by) - 1, maxY = Math.max(ay, by) + 1;
  const count = (maxX - minX + 1) * (maxY - minY + 1);
  if (count > 120) throw new Error('Points are too far apart. Zoom in or measure a shorter road segment.');
  const requests = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
    for (const archive of archives) requests.push(tileFeatures(archive, x, y));
  }
  return (await Promise.all(requests)).flat();
}
