'use strict';
import { buildRoadGraph, snapToRoad, shortestRoadPath } from './road-distance-geometry.js';

export class RoadDistanceControl {
  constructor(onActivate = () => {}) { this.onActivate = onActivate; this.active = false; this.start = null; this.end = null; }
  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl road-distance-control';
    this.container.innerHTML = '<button type="button" class="road-distance-toggle" aria-pressed="false" title="Measure along mapped roads"><span aria-hidden="true">⌁</span><b>Road distance</b></button><button type="button" class="road-distance-clear" aria-label="Clear road distance" title="Clear road distance" hidden>×</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.road-distance-toggle');
    this.clearButton = this.container.querySelector('.road-distance-clear');
    this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.active ? this.clear() : this.activate());
    this.clearButton.addEventListener('click', () => this.clear());
    this.onClick = event => this.click(event);
    this.map.on('click', this.onClick);
    return this.container;
  }
  onRemove() { this.map.off('click', this.onClick); this.clear(); this.container.remove(); this.map = null; }
  isActive() { return this.active; }
  consumeMapClickSuppression() {
    if (!this.suppressMapClick) return false;
    this.suppressMapClick = false;
    return true;
  }
  activate() {
    this.onActivate(); this.active = true; this.start = null; this.end = null;
    this.render(); this.message('Click a road for the start, then click another road for the end.');
    this.map.getCanvas().style.cursor = 'crosshair';
  }
  deactivate() {
    this.active = false;
    this.map.getCanvas().style.cursor = '';
    this.toggleButton.classList.remove('active');
    this.toggleButton.setAttribute('aria-pressed', 'false');
    if (!this.end) this.message('');
  }
  clear() {
    this.deactivate(); this.start = null; this.end = null; this.graph = null;
    this.render(); this.message('');
  }
  message(text) { this.output.textContent = text; this.output.hidden = !text; }
  render(route = null) {
    this.toggleButton.classList.toggle('active', this.active);
    this.toggleButton.setAttribute('aria-pressed', String(this.active));
    this.clearButton.hidden = !this.start;
    const features = [];
    if (route) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } });
    for (const [index, snap] of [this.start, this.end].entries()) if (snap) {
      features.push({ type: 'Feature', properties: { index }, geometry: { type: 'Point', coordinates: snap.point } });
    }
    this.map.getSource('road-distance')?.setData({ type: 'FeatureCollection', features });
  }
  click(event) {
    if (!this.active) return;
    if (!this.start) {
      const features = [];
      for (const source of ['roads', 'forest_roads']) {
        try { features.push(...this.map.querySourceFeatures(source, { sourceLayer: source })); }
        catch { /* Vector source may not yet be loaded. */ }
      }
      this.graph = buildRoadGraph(features);
      if (this.graph.error) { this.message(this.graph.error); return; }
    }
    const snap = snapToRoad(this.graph, [event.lngLat.lng, event.lngLat.lat]);
    if (!snap) { this.message('No loaded road within 50 m. Zoom in and click closer to a mapped road.'); return; }
    if (!this.start) { this.start = snap; this.render(); this.message('Start set. Click a second point on a connected road.'); return; }
    const route = shortestRoadPath(this.graph, this.start, snap);
    if (!route) { this.message('No connected road path in loaded map data. Zoom out or choose another endpoint; roads that only cross on the map may not connect.'); return; }
    this.end = snap;
    this.render(route);
    const feet = Math.round(route.meters * 3.280839895).toLocaleString();
    const miles = route.meters / 1609.344;
    this.message(`Along mapped roads: ${feet} ft (${miles.toFixed(miles < 10 ? 3 : 2)} mi). Approximate; not a driving route. Click × to clear.`);
    this.suppressMapClick = true;
    setTimeout(() => { this.suppressMapClick = false; }, 0);
    this.deactivate();
  }
}
