export const APP_ORIGIN = 'https://land.aaronik.com';
const DEFAULT_VIEW = '8.25/41.45/-122.45';

// MapLibre hash: #zoom/latitude/longitude[/bearing[/pitch]]. Never accept
// arbitrary URLs: the screenshot browser may only visit our own atlas.
export function parseView(raw) {
  if (raw == null || raw === '') raw = DEFAULT_VIEW;
  if (raw.length > 100) return null;
  const parts = raw.replace(/^#/, '').split('/');
  if (parts.length < 3 || parts.length > 5 || parts.some(part => !/^-?\d+(?:\.\d+)?$/.test(part))) return null;
  const numbers = parts.map(Number);
  const [zoom, lat, lng, bearing = 0, pitch = 0] = numbers;
  if (!numbers.every(Number.isFinite) || zoom < 0 || zoom > 20 || lat < -85 || lat > 85 || lng < -180 || lng > 180 || bearing < -360 || bearing > 360 || pitch < 0 || pitch > 90) return null;
  return parts.join('/');
}

export function viewFromUrl(url) {
  const view = parseView(url.searchParams.get('view'));
  if (!view) return null;
  const terrainValue = url.searchParams.get('terrain');
  if (terrainValue !== null && terrainValue !== '0' && terrainValue !== '1') return null;
  const terrain = terrainValue === '1';
  const parcel = url.searchParams.get('parcel');
  // Parcel identifiers only; do not reflect untrusted HTML or arbitrary URLs.
  if (parcel && !/^[a-zA-Z0-9-]{1,40}$/.test(parcel)) return null;
  return { view, terrain, parcel: parcel || '' };
}

export function appUrl({ view, terrain, parcel }, preview = false) {
  const url = new URL(APP_ORIGIN + '/');
  if (terrain) url.searchParams.set('terrain', '1');
  if (parcel) url.searchParams.set('parcel', parcel);
  if (preview) url.searchParams.set('preview', '1');
  url.hash = view;
  return url.href;
}

export function imagePath({ view, terrain, parcel }) {
  const query = new URLSearchParams({ view });
  if (terrain) query.set('terrain', '1');
  if (parcel) query.set('parcel', parcel);
  return `/image?${query}`;
}
