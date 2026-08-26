'use strict';

const STORAGE_KEY = 'shasta-land-atlas.parcel-alignment-experiments.v1';
const PARCEL_QUERY_URL = 'https://services3.arcgis.com/JmPiYilyU1x5zuxM/arcgis/rest/services/Siskiyou_Parcels_Public/FeatureServer/0/query';
const radians = value => value * Math.PI / 180;
const normalizeApn = value => String(value || '').replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3');

export class ParcelAdjustmentControl {
  constructor(map) { this.map = map; this.saved = this.load(); this.mode = null; this.attach(); }
  load() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } }
  persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved)); }
  attach() {
    const map = this.map;
    this.onDown = event => this.start(event);
    this.onMove = event => this.move(event);
    this.onUp = () => this.finish();
    map.on('mousedown', this.onDown); map.on('touchstart', this.onDown);
    map.on('mousemove', this.onMove); map.on('touchmove', this.onMove);
    map.on('mouseup', this.onUp); map.on('touchend', this.onUp); map.on('touchcancel', this.onUp);
  }
  isActive(apn) { return this.apn === normalizeApn(apn); }
  async toggle(apn) {
    if (this.apn === normalizeApn(apn)) { this.deactivate(); return false; }
    await this.activate(apn); return true;
  }
  async activate(apn) {
    apn = normalizeApn(apn); if (!apn) return;
    const url = new URL(PARCEL_QUERY_URL);
    url.search = new URLSearchParams({ f: 'geojson', where: `APN='${apn}'`, outFields: 'APN', returnGeometry: 'true', outSR: '4326' });
    const response = await fetch(url); const data = await response.json();
    if (!response.ok || data.error || !data.features?.[0]) throw new Error('County parcel geometry could not be loaded.');
    this.apn = apn; this.original = data.features[0]; this.transform = { dx: 0, dy: 0, rotation: 0, ...(this.saved[apn] || {}) };
    this.center = this.centerOf(this.original.geometry.coordinates[0]); this.render();
  }
  deactivate() { this.mode = null; this.apn = null; this.original = null; this.map.getSource('parcel-adjustment')?.setData({ type: 'FeatureCollection', features: [] }); }
  reset() { if (!this.apn) return; delete this.saved[this.apn]; this.persist(); this.transform = { dx: 0, dy: 0, rotation: 0 }; this.render(); }
  centerOf(ring) { const points = ring.slice(0, -1); return points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]); }
  pointTransform(point) {
    const [lng, lat] = this.center, scale = Math.cos(radians(lat));
    const x = (point[0] - lng) * scale, y = point[1] - lat, a = radians(this.transform.rotation);
    return [lng + (x * Math.cos(a) - y * Math.sin(a)) / scale + this.transform.dx, lat + x * Math.sin(a) + y * Math.cos(a) + this.transform.dy];
  }
  render() {
    if (!this.original) return;
    const coordinates = this.original.geometry.coordinates.map(ring => ring.map(point => this.pointTransform(point)));
    const transformedCenter = this.pointTransform(this.center);
    const handle = [transformedCenter[0], transformedCenter[1] + 0.00035];
    this.map.getSource('parcel-adjustment')?.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { kind: 'parcel' }, geometry: { type: this.original.geometry.type, coordinates } },
      { type: 'Feature', properties: { kind: 'rotate-handle' }, geometry: { type: 'Point', coordinates: handle } }
    ] });
  }
  start(event) {
    if (!this.apn || !event.point) return;
    const handle = this.map.queryRenderedFeatures(event.point, { layers: ['parcel-adjustment-handle'] })[0];
    const parcel = this.map.queryRenderedFeatures(event.point, { layers: ['parcel-adjustment-fill', 'parcel-adjustment-line'] })[0];
    if (!handle && !parcel) return;
    const lngLat = event.lngLat; this.mode = handle ? 'rotate' : 'move'; this.startPoint = [lngLat.lng, lngLat.lat]; this.startTransform = { ...this.transform };
    const center = this.pointTransform(this.center); this.startAngle = Math.atan2(lngLat.lat - center[1], (lngLat.lng - center[0]) * Math.cos(radians(center[1])));
    this.map.dragPan.disable(); this.map.getCanvas().style.cursor = 'grabbing'; event.preventDefault?.();
  }
  move(event) {
    if (!this.mode || !event.lngLat) return;
    const point = [event.lngLat.lng, event.lngLat.lat];
    if (this.mode === 'move') { this.transform.dx = this.startTransform.dx + point[0] - this.startPoint[0]; this.transform.dy = this.startTransform.dy + point[1] - this.startPoint[1]; }
    else { const center = this.pointTransform(this.center); const angle = Math.atan2(point[1] - center[1], (point[0] - center[0]) * Math.cos(radians(center[1]))); this.transform.rotation = this.startTransform.rotation + (angle - this.startAngle) * 180 / Math.PI; }
    this.render(); event.preventDefault?.();
  }
  finish() { if (!this.mode) return; this.mode = null; this.map.dragPan.enable(); this.map.getCanvas().style.cursor = ''; this.saved[this.apn] = this.transform; this.persist(); }
}
