'use strict';
import { buildRoadGraph, snapToRoad, shortestRoadPath } from './road-distance-geometry.js';

export class RoadDistanceControl {
  constructor(onActivate = () => {}) { this.onActivate = onActivate; this.active = false; this.start = null; this.end = null; }
  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl map-tool-control road-distance-control';
    this.container.innerHTML = '<button type="button" class="road-distance-toggle" aria-pressed="false" title="Measure along mapped roads"><span aria-hidden="true">⌁</span><b>Road distance</b></button><button type="button" class="road-distance-clear" aria-label="Clear road distance" title="Clear road distance" hidden>×</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.road-distance-toggle');
    this.clearButton = this.container.querySelector('.road-distance-clear');
    this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.active ? this.clear() : this.activate());
    this.clearButton.addEventListener('click', () => this.clear());
    this.onClick = event => this.click(event);
    this.onPointerDown = event => this.startEndpointDrag(event);
    this.onPointerMove = event => this.moveEndpointDrag(event);
    this.onPointerUp = () => this.finishEndpointDrag();
    this.onHover = event => this.updateCursor(event);
    this.onDocumentPointerUp = () => this.finishEndpointDrag();
    this.map.on('click', this.onClick);
    this.map.on('mousedown', this.onPointerDown);
    this.map.on('touchstart', this.onPointerDown);
    this.map.on('mousemove', this.onPointerMove);
    this.map.on('touchmove', this.onPointerMove);
    this.map.on('mousemove', this.onHover);
    this.map.on('mouseup', this.onPointerUp);
    this.map.on('touchend', this.onPointerUp);
    this.map.on('touchcancel', this.onPointerUp);
    document.addEventListener('mouseup', this.onDocumentPointerUp, true);
    document.addEventListener('touchend', this.onDocumentPointerUp, true);
    document.addEventListener('touchcancel', this.onDocumentPointerUp, true);
    return this.container;
  }
  onRemove() {
    this.finishEndpointDrag();
    for (const type of ['mousedown', 'touchstart']) this.map.off(type, this.onPointerDown);
    for (const type of ['mousemove', 'touchmove']) this.map.off(type, this.onPointerMove);
    this.map.off('mousemove', this.onHover);
    for (const type of ['mouseup', 'touchend', 'touchcancel']) this.map.off(type, this.onPointerUp);
    for (const type of ['mouseup', 'touchend', 'touchcancel']) document.removeEventListener(type, this.onDocumentPointerUp, true);
    this.map.off('click', this.onClick);
    this.clear(); this.container.remove(); this.map = null;
  }
  isActive() { return this.active; }
  consumeMapClickSuppression() {
    if (!this.suppressMapClick) return false;
    this.suppressMapClick = false;
    return true;
  }
  activate() {
    this.finishEndpointDrag();
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
    this.finishEndpointDrag();
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
  endpointAt(point) {
    if (!point || !this.map.getLayer('road-distance-points')) return null;
    return this.map.queryRenderedFeatures(point, { layers: ['road-distance-points'] })[0] || null;
  }
  eventLngLat(event) { return event.lngLat || event.lngLats?.[0] || (event.point && this.map.unproject(event.point)); }
  startEndpointDrag(event) {
    if (this.active || !this.start || !this.end || !this.graph || this.endpointDrag || !event.point) return;
    const endpoint = this.endpointAt(event.point);
    if (!endpoint) return;
    const index = Number(endpoint.properties?.index);
    if (index !== 0 && index !== 1) return;
    this.endpointDrag = { index, dragPanWasEnabled: this.map.dragPan?.isEnabled?.() };
    this.map.dragPan?.disable();
    event.preventDefault?.();
    this.map.getCanvas().style.cursor = 'grabbing';
  }
  moveEndpointDrag(event) {
    if (!this.endpointDrag) return;
    const lngLat = this.eventLngLat(event);
    if (!lngLat) return;
    const snap = snapToRoad(this.graph, [lngLat.lng, lngLat.lat]);
    if (!snap) { this.message('No loaded road within 50 m. Drag closer to a mapped road.'); return; }
    const route = this.endpointDrag.index === 0
      ? shortestRoadPath(this.graph, snap, this.end)
      : shortestRoadPath(this.graph, this.start, snap);
    if (!route) { this.message('No connected road path here. Drag toward a connected mapped road.'); return; }
    if (this.endpointDrag.index === 0) this.start = snap;
    else this.end = snap;
    this.showRoute(route);
    event.preventDefault?.();
  }
  finishEndpointDrag() {
    if (!this.endpointDrag) return;
    const drag = this.endpointDrag;
    this.endpointDrag = null;
    if (drag.dragPanWasEnabled) this.map?.dragPan?.enable();
    this.suppressMapClick = true;
    setTimeout(() => { this.suppressMapClick = false; }, 0);
    if (this.map) this.map.getCanvas().style.cursor = 'grab';
  }
  updateCursor(event) {
    if (!this.active && !this.endpointDrag && this.start && this.end) {
      this.map.getCanvas().style.cursor = this.endpointAt(event.point) ? 'grab' : '';
    }
  }
  showRoute(route) {
    this.render(route);
    const feet = Math.round(route.meters * 3.280839895).toLocaleString();
    const miles = route.meters / 1609.344;
    this.message(`Along mapped roads: ${feet} ft (${miles.toFixed(miles < 10 ? 3 : 2)} mi). Approximate; not a driving route. Drag the ends to adjust or click × to clear.`);
  }
  click(event) {
    if (this.suppressMapClick) { this.suppressMapClick = false; return; }
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
    this.showRoute(route);
    this.suppressMapClick = true;
    setTimeout(() => { this.suppressMapClick = false; }, 0);
    this.deactivate();
  }
}
