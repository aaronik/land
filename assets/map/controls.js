'use strict';

class CardinalCompassControl {
  onAdd(controlMap) {
    this.map = controlMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl cardinal-compass';
    this.container.innerHTML = '<button type="button" aria-label="Reset map to north" title="Reset map to north"><span class="compass-dial"><b class="north">N</b><b class="east">E</b><b class="south">S</b><b class="west">W</b><i></i></span></button>';
    this.dial = this.container.querySelector('.compass-dial');
    this.update = () => { this.dial.style.transform = `rotate(${-this.map.getBearing()}deg)`; };
    this.container.querySelector('button').addEventListener('click', () => this.map.easeTo({ bearing: 0, duration: 500 }));
    this.map.on('rotate', this.update);
    this.update();
    return this.container;
  }
  onRemove() {
    this.map.off('rotate', this.update);
    this.container.remove();
  }
}
class GoogleStreetViewControl {
  onAdd(controlMap) {
    this.map = controlMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl google-maps-control';
    this.container.innerHTML = '<button class="google-maps-button street-view-drag-handle" type="button" aria-label="Drag Street View to a road, or open it at the map center" title="Drag Street View to a road"><span class="street-view-pegman" aria-hidden="true"></span><span>Street View</span></button>';
    this.button = this.container.querySelector('button');
    this.button.addEventListener('click', () => {
      if (!this.ignoreClick) this.openAt(this.map.getCenter());
      this.ignoreClick = false;
    });
    this.button.addEventListener('pointerdown', event => this.startDrag(event));
    return this.container;
  }
  startDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragStart = { x: event.clientX, y: event.clientY };
    this.dragged = false;
    this.button.setPointerCapture(event.pointerId);
    this.map.dragPan.disable();
    this.proxy = document.createElement('span');
    this.proxy.className = 'street-view-drag-proxy';
    document.body.appendChild(this.proxy);
    this.moveDrag(event);
    const move = moveEvent => this.moveDrag(moveEvent);
    const finish = finishEvent => {
      this.button.removeEventListener('pointermove', move);
      this.button.removeEventListener('pointerup', finish);
      this.button.removeEventListener('pointercancel', finish);
      this.proxy.remove();
      this.proxy = null;
      this.map.dragPan.enable();
      if (finishEvent.type === 'pointerup') {
        const fallback = this.dragged ? this.map.unproject(this.mapPoint(finishEvent)) : this.map.getCenter();
        this.openAt(this.nearestRoadPoint(fallback, ...this.mapPoint(finishEvent)) || fallback);
        // A pointer release also emits click; do not open a second tab for it.
        this.ignoreClick = true;
        setTimeout(() => { this.ignoreClick = false; }, 0);
      }
    };
    this.button.addEventListener('pointermove', move);
    this.button.addEventListener('pointerup', finish);
    this.button.addEventListener('pointercancel', finish);
  }
  mapPoint(event) {
    const rect = this.map.getCanvas().getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
  moveDrag(event) {
    if (!this.proxy) return;
    this.dragged ||= Math.hypot(event.clientX - this.dragStart.x, event.clientY - this.dragStart.y) > 4;
    this.proxy.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    const [x, y] = this.mapPoint(event);
    const point = this.nearestRoadPoint(this.map.unproject([x, y]), x, y);
    this.proxy.classList.toggle('over-road', Boolean(point));
  }
  nearestRoadPoint(fallback, x, y) {
    if (!this.map.getLayer('roads')) return null;
    const radius = 40;
    let features = [];
    try { features = this.map.queryRenderedFeatures([[x - radius, y - radius], [x + radius, y + radius]], { layers: ['roads'] }); } catch { /* The road layer may still be loading. */ }
    let best = null;
    for (const feature of features) {
      const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [];
      for (const line of lines) for (let i = 1; i < line.length; i++) {
        const a = this.map.project(line[i - 1]), b = this.map.project(line[i]);
        const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy;
        if (!lengthSquared) continue;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
        const px = a.x + t * dx, py = a.y + t * dy, distance = Math.hypot(x - px, y - py);
        if (!best || distance < best.distance) best = { distance, point: this.map.unproject([px, py]), heading: Math.atan2(dx, -dy) * 180 / Math.PI };
      }
    }
    return best?.distance <= radius ? best : fallback;
  }
  openAt(location) {
    const point = location.point || location;
    const url = new URL('https://www.google.com/maps/@');
    url.searchParams.set('api', '1');
    url.searchParams.set('map_action', 'pano');
    url.searchParams.set('viewpoint', `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`);
    url.searchParams.set('heading', String((location.heading ?? this.map.getBearing() + 360) % 360));
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
  onRemove() {
    this.container.remove();
    this.map = undefined;
  }
}
class MilesScaleControl {
  constructor({ maxWidth = 120 } = {}) {
    this.maxWidth = maxWidth;
  }
  onAdd(controlMap) {
    this.map = controlMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-scale miles-scale-control';
    this.container.setAttribute('role', 'img');
    this.container.setAttribute('aria-label', 'Map distance scale in miles');
    this.update = () => {
      const canvas = this.map.getCanvas();
      const y = canvas.clientHeight / 2;
      const x = canvas.clientWidth / 2;
      let left;
      let right;
      try {
        left = this.map.unproject([x - this.maxWidth / 2, y]);
        right = this.map.unproject([x + this.maxWidth / 2, y]);
      } catch {
        return;
      }
      if (!left || !right) return;
      const maxMiles = left.distanceTo(right) / 1609.344;
      if (!Number.isFinite(maxMiles) || maxMiles <= 0) return;
      const magnitude = 10 ** Math.floor(Math.log10(maxMiles));
      const normalized = maxMiles / magnitude;
      const niceMiles = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
      this.container.style.width = `${this.maxWidth * niceMiles / maxMiles}px`;
      this.container.textContent = `${Number(niceMiles.toPrecision(3))} mi`;
      this.container.title = `${niceMiles} miles`;
    };
    this.map.on('move', this.update);
    this.map.on('resize', this.update);
    this.update();
    return this.container;
  }
  onRemove() {
    this.map.off('move', this.update);
    this.map.off('resize', this.update);
    this.container.remove();
    this.map = undefined;
  }
}
class DistanceMeasureControl {
  constructor() {
    this.start = null;
    this.end = null;
    this.active = false;
    this.preview = null;
  }
  onAdd(controlMap) {
    this.map = controlMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl distance-measure-control';
    this.container.innerHTML = '<button type="button" class="distance-measure-toggle" aria-pressed="false" aria-label="Measure a distance" title="Measure a distance"><span aria-hidden="true">↔</span><b>Measure</b></button><button type="button" class="distance-measure-clear" aria-label="Clear measurement" title="Clear measurement" hidden>×</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.distance-measure-toggle');
    this.clearButton = this.container.querySelector('.distance-measure-clear');
    this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.clearButton.addEventListener('click', () => this.clear());
    this.onMapClick = event => this.handleClick(event);
    this.onMouseMove = event => this.handleMove(event);
    this.map.on('click', this.onMapClick);
    this.map.on('mousemove', this.onMouseMove);
    return this.container;
  }
  onRemove() {
    this.map.off('click', this.onMapClick);
    this.map.off('mousemove', this.onMouseMove);
    this.container.remove();
    this.map = undefined;
  }
  isActive() { return this.active; }
  toggle() {
    if (this.active) this.clear();
    else {
      this.active = true;
      this.map.doubleClickZoom.disable();
      this.updateUi('Click the map to place the first point.');
      this.map.getCanvas().style.cursor = 'crosshair';
    }
  }
  clear() {
    this.start = null;
    this.end = null;
    this.preview = null;
    this.active = false;
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = '';
    this.updateData();
    this.updateUi();
  }
  handleClick(event) {
    if (!this.active) return;
    if (!this.start || this.end) {
      this.start = event.lngLat;
      this.end = null;
      this.preview = null;
      this.updateData();
      this.updateUi('Move the pointer and click to place the second point.');
      return;
    }
    this.end = event.lngLat;
    this.preview = null;
    this.updateData();
    this.updateUi(this.formatDistance(this.start.distanceTo(this.end)));
  }
  handleMove(event) {
    if (!this.active || !this.start || this.end) return;
    this.preview = event.lngLat;
    this.updateData();
    this.updateUi(this.formatDistance(this.start.distanceTo(this.preview)));
  }
  formatDistance(meters) {
    const feet = meters * 3.280839895;
    const miles = meters / 1609.344;
    return `${Math.round(feet).toLocaleString()} ft (${miles.toFixed(miles < 10 ? 3 : 2)} mi)`;
  }
  updateUi(message = '') {
    const measuring = this.active;
    this.toggleButton.classList.toggle('active', measuring);
    this.toggleButton.setAttribute('aria-pressed', String(measuring));
    this.toggleButton.title = measuring ? 'Stop measuring' : 'Measure a distance';
    this.toggleButton.setAttribute('aria-label', this.toggleButton.title);
    this.clearButton.hidden = !this.start;
    this.output.hidden = !message;
    this.output.textContent = message;
  }
  updateData() {
    const end = this.end || this.preview;
    const features = this.start && end ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[this.start.lng, this.start.lat], [end.lng, end.lat]] }, properties: {} }] : [];
    const points = [this.start, end].filter(Boolean).map(point => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [point.lng, point.lat] }, properties: {} }));
    this.map.getSource('distance-measurement')?.setData({ type: 'FeatureCollection', features: [...features, ...points] });
  }
}
export function installMapControls(map, maplibregl) {
  map.addControl(new GoogleStreetViewControl(), 'top-left');
  map.addControl(new CardinalCompassControl(), 'top-right');
  map.addControl(new MilesScaleControl(), 'bottom-left');
  const distanceMeasureControl = new DistanceMeasureControl();
  map.addControl(distanceMeasureControl, 'top-left');
  return distanceMeasureControl;
}
