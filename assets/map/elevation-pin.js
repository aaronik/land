'use strict';

const TERRAIN_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const TILE_ZOOM = 13;
const TILE_SIZE = 256;
const tileCache = new Map();

export function terrainTilePixel(point) {
  const tiles = 2 ** TILE_ZOOM;
  const x = (point.lng + 180) / 360 * tiles;
  const sinLat = Math.sin(Math.max(-85.051129, Math.min(85.051129, point.lat)) * Math.PI / 180);
  const y = (1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2 * tiles;
  const tileX = Math.floor(x), tileY = Math.floor(y);
  return { tileX, tileY, pixelX: Math.min(255, Math.floor((x - tileX) * TILE_SIZE)), pixelY: Math.min(255, Math.floor((y - tileY) * TILE_SIZE)) };
}

export async function lookupElevationFeet(point, { signal } = {}) {
  const { tileX, tileY, pixelX, pixelY } = terrainTilePixel(point);
  if (tileY < 0 || tileY >= 2 ** TILE_ZOOM) throw new Error('Terrain unavailable at this point');
  const key = `${TILE_ZOOM}/${((tileX % 2 ** TILE_ZOOM) + 2 ** TILE_ZOOM) % 2 ** TILE_ZOOM}/${tileY}`;
  let pixels = tileCache.get(key);
  if (!pixels) {
    const response = await fetch(`${TERRAIN_TILE_URL}/${key}.png`, { signal });
    if (!response.ok) throw new Error(`Terrain tiles returned ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob());
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TILE_SIZE;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Could not read terrain tile');
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    } finally { bitmap.close(); }
    if (signal?.aborted) throw new DOMException('Elevation lookup cancelled', 'AbortError');
    tileCache.set(key, pixels);
    if (tileCache.size > 12) tileCache.delete(tileCache.keys().next().value);
  }
  const offset = (pixelY * TILE_SIZE + pixelX) * 4;
  if (!pixels[offset + 3]) throw new Error('Terrain unavailable at this point');
  const meters = pixels[offset] * 256 + pixels[offset + 1] + pixels[offset + 2] / 256 - 32768;
  return meters * 3.28084;
}

export class ElevationPinControl {
  constructor(maplibregl, onActivate = () => {}, lookup = lookupElevationFeet) {
    this.maplibregl = maplibregl;
    this.onActivate = onActivate;
    this.lookup = lookup;
    this.active = false;
  }
  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl map-tool-control elevation-pin-control';
    this.container.innerHTML = '<button type="button" class="elevation-pin-toggle" aria-pressed="false" aria-label="Place an elevation pin" title="Place an elevation pin"><span aria-hidden="true">▲</span><b>Elevation</b></button><button type="button" class="elevation-pin-clear" aria-label="Clear elevation pin" title="Clear elevation pin" hidden>×</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.elevation-pin-toggle');
    this.clearButton = this.container.querySelector('.elevation-pin-clear');
    this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.clearButton.addEventListener('click', () => this.clear());
    this.onMapClick = event => this.handleClick(event);
    map.on('click', this.onMapClick);
    return this.container;
  }
  onRemove() {
    this.clear();
    this.map.off('click', this.onMapClick);
    this.container.remove();
    this.map = undefined;
  }
  isActive() { return this.active; }
  deactivate() {
    this.active = false;
    this.map.getCanvas().style.cursor = '';
    this.updateUi();
  }
  toggle() {
    this.active = !this.active;
    if (this.active) this.onActivate();
    this.map.getCanvas().style.cursor = this.active ? 'crosshair' : '';
    this.updateUi();
  }
  clear() {
    this.deactivate();
    this.request?.abort();
    this.request = null;
    this.marker?.remove();
    this.marker = null;
    this.popup?.remove();
    this.popup = null;
    this.updateUi();
  }
  async handleClick(event) {
    if (!this.active) return;
    this.request?.abort();
    this.popup?.remove();
    this.marker?.remove();
    const request = new AbortController();
    this.request = request;
    const point = event.lngLat;
    const pin = document.createElement('div');
    pin.className = 'elevation-pin-marker';
    pin.setAttribute('aria-label', 'Elevation pin');
    this.marker = new this.maplibregl.Marker({ element: pin }).setLngLat(point).addTo(this.map);
    const content = document.createElement('div');
    content.className = 'elevation-pin-popup';
    const heading = document.createElement('strong');
    heading.textContent = 'Elevation: loading…';
    const note = document.createElement('small');
    note.textContent = 'AWS Terrain Tiles / Mapzen · approximate ground elevation, not a survey';
    content.append(heading, note);
    this.popup = new this.maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 18 })
      .setLngLat(point).setDOMContent(content).addTo(this.map);
    this.clearButton.hidden = false;
    try {
      const feet = await this.lookup(point, { signal: request.signal });
      if (this.request !== request) return;
      heading.textContent = `Elevation: ${Math.round(feet).toLocaleString('en-US')} ft above sea level`;
    } catch (error) {
      if (this.request !== request || request.signal.aborted) return;
      heading.textContent = 'Elevation unavailable. Click another point to retry.';
    } finally {
      if (this.request === request) this.request = null;
    }
  }
  updateUi() {
    this.toggleButton.classList.toggle('active', this.active);
    this.toggleButton.setAttribute('aria-pressed', String(this.active));
    this.toggleButton.title = this.active ? 'Click the map to check elevation' : 'Place an elevation pin';
    this.toggleButton.setAttribute('aria-label', this.toggleButton.title);
    this.clearButton.hidden = !this.marker;
    this.output.hidden = !this.active;
    this.output.textContent = this.active ? 'Click the map to check ground elevation.' : '';
  }
}
