'use strict';

const STORAGE_KEY = 'shasta-land-atlas.polygon-drawings.v1';
const EARTH_RADIUS_METERS = 6371008.8;
const radians = value => value * Math.PI / 180;
const degrees = value => value * 180 / Math.PI;
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function distanceFeet(a, b) {
  const lat1 = radians(a[1]), lat2 = radians(b[1]);
  const dLat = lat2 - lat1, dLng = radians(b[0] - a[0]);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)) / .3048;
}
function azimuth(a, b) {
  const lat1 = radians(a[1]), lat2 = radians(b[1]), dLng = radians(b[0] - a[0]);
  return (degrees(Math.atan2(Math.sin(dLng) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng))) + 360) % 360;
}
function callFor(a, b) {
  const bearing = azimuth(a, b);
  const angle = bearing <= 90 ? bearing : bearing <= 180 ? 180 - bearing : bearing <= 270 ? bearing - 180 : 360 - bearing;
  const totalSeconds = Math.round(angle * 3600);
  return { ns: bearing <= 90 || bearing >= 270 ? 'N' : 'S', degrees: Math.floor(totalSeconds / 3600), minutes: Math.floor(totalSeconds % 3600 / 60), seconds: totalSeconds % 60, ew: bearing <= 180 ? 'E' : 'W', distance: distanceFeet(a, b) };
}
function formatCall(call) { return `${call.ns} ${call.degrees}° ${String(call.minutes).padStart(2, '0')}′ ${String(call.seconds).padStart(2, '0')}″ ${call.ew} · ${call.distance.toFixed(1)} ft`; }
export function azimuthFor(call) {
  const angle = call.degrees + call.minutes / 60 + call.seconds / 3600;
  if (call.ns === 'N' && call.ew === 'E') return angle;
  if (call.ns === 'S' && call.ew === 'E') return 180 - angle;
  if (call.ns === 'S' && call.ew === 'W') return 180 + angle;
  return 360 - angle;
}
export function destination([longitude, latitude], bearingDegrees, feet) {
  const distance = feet * .3048 / EARTH_RADIUS_METERS, bearing = radians(bearingDegrees), lat1 = radians(latitude), lng1 = radians(longitude);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
  return [((degrees(lng2) + 540) % 360) - 180, degrees(lat2)];
}
export function reverseAzimuth(bearingDegrees) { return (bearingDegrees + 180) % 360; }
function formatQuadrantBearing(call) {
  const parts = [`${call.ns} ${call.degrees}°`];
  if (call.minutes || call.seconds) parts.push(`${String(call.minutes).padStart(2, '0')}′`);
  if (call.seconds) parts.push(`${String(call.seconds).padStart(2, '0')}″`);
  return `${parts.join(' ')} ${call.ew}`;
}
export function updatedEdgeVertices(start, end, call, fixed = 'start') {
  const bearing = azimuthFor(call);
  return fixed === 'end'
    ? { start: destination(end, bearing, call.distance), end }
    : { start, end: destination(start, bearing, call.distance) };
}
function validCall(call) { return ['N', 'S'].includes(call.ns) && ['E', 'W'].includes(call.ew) && call.degrees >= 0 && call.degrees <= 90 && call.minutes >= 0 && call.minutes < 60 && call.seconds >= 0 && call.seconds < 60 && (call.degrees < 90 || (!call.minutes && !call.seconds)) && call.distance > 0; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }

export class PolygonDrawControl {
  constructor(maplibregl, onActivate = () => {}) {
    this.maplibregl = maplibregl;
    this.onActivate = onActivate;
    this.drawings = this.load();
    this.draft = null;
    this.selectedEdge = null;
    this.active = false;
    this.vertexDrag = null;
    this.suppressMapClick = false;
  }
  load() { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY)); return Array.isArray(value) ? value.filter(item => Array.isArray(item.vertices) && item.vertices.length >= 3).map(item => ({ ...item, visible: item.visible !== false })) : []; } catch { return []; } }
  persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.drawings)); } catch { /* Storage may be unavailable. */ } }
  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl polygon-draw-control';
    this.container.innerHTML = '<button type="button" class="polygon-draw-toggle" aria-pressed="false" aria-label="Draw a polygon" title="Draw a polygon"><span aria-hidden="true">⬠</span><b>Draw</b></button><button type="button" class="polygon-draw-undo" aria-label="Undo last vertex" title="Undo last vertex" hidden>↶</button><button type="button" class="polygon-draw-finish" aria-label="Finish polygon" title="Finish polygon" hidden>Finish</button><button type="button" class="polygon-draw-open" aria-label="Manage saved polygons" title="Manage saved polygons" hidden>☰</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.polygon-draw-toggle'); this.undoButton = this.container.querySelector('.polygon-draw-undo'); this.finishButton = this.container.querySelector('.polygon-draw-finish'); this.openButton = this.container.querySelector('.polygon-draw-open'); this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.toggle()); this.undoButton.addEventListener('click', () => this.undo()); this.finishButton.addEventListener('click', () => this.finish()); this.openButton.addEventListener('click', () => this.openManager());
    this.onMapClick = event => this.addVertex(event);
    this.onLabelClick = event => {
      if (this.suppressMapClick) return;
      const label = this.labelAt(event.point);
      if (label) this.openEdgePopup(label);
    };
    this.onVertexPointerDown = event => this.startVertexDrag(event);
    this.onVertexPointerMove = event => this.moveVertexDrag(event);
    this.onVertexPointerUp = () => this.finishVertexDrag();
    map.on('click', this.onMapClick);
    map.on('click', this.onLabelClick);
    // Generic map events work whether the polygon layers were available when
    // this control was added or were installed later.
    map.on('mousedown', this.onVertexPointerDown);
    map.on('touchstart', this.onVertexPointerDown);
    map.on('mousemove', this.onVertexPointerMove);
    map.on('touchmove', this.onVertexPointerMove);
    map.on('mouseup', this.onVertexPointerUp);
    map.on('touchend', this.onVertexPointerUp);
    map.on('touchcancel', this.onVertexPointerUp);
    this.onDocumentPointerUp = () => this.finishVertexDrag();
    document.addEventListener('mouseup', this.onDocumentPointerUp, true);
    document.addEventListener('touchend', this.onDocumentPointerUp, true);
    document.addEventListener('touchcancel', this.onDocumentPointerUp, true);
    this.createManager(); this.updateUi(); return this.container;
  }
  onRemove() {
    this.finishVertexDrag();
    this.map.off('click', this.onMapClick); this.map.off('click', this.onLabelClick);
    this.map.off('mousedown', this.onVertexPointerDown); this.map.off('touchstart', this.onVertexPointerDown);
    this.map.off('mousemove', this.onVertexPointerMove); this.map.off('touchmove', this.onVertexPointerMove);
    this.map.off('mouseup', this.onVertexPointerUp); this.map.off('touchend', this.onVertexPointerUp); this.map.off('touchcancel', this.onVertexPointerUp);
    document.removeEventListener('mouseup', this.onDocumentPointerUp, true);
    document.removeEventListener('touchend', this.onDocumentPointerUp, true);
    document.removeEventListener('touchcancel', this.onDocumentPointerUp, true);
    this.popup?.remove(); this.manager?.remove(); this.container.remove(); this.map = undefined;
  }
  isActive() { return this.active; }
  labelAt(point) {
    if (!this.map.getLayer('polygon-drawings-labels')) return null;
    return this.map.queryRenderedFeatures(point, { layers: ['polygon-drawings-labels'] })[0] || null;
  }
  vertexAt(point) {
    if (!this.map.getLayer('polygon-drawings-vertices')) return null;
    return this.map.queryRenderedFeatures(point, { layers: ['polygon-drawings-vertices'] })[0] || null;
  }
  eventLngLat(event) { return event.lngLat || event.lngLats?.[0] || (event.point && this.map.unproject(event.point)); }
  startVertexDrag(event) {
    const lngLat = this.eventLngLat(event);
    if (this.active || !event.point || !lngLat || this.labelAt(event.point)) return;
    const feature = this.vertexAt(event.point), id = feature?.properties?.drawingId, vertex = Number(feature?.properties?.vertexIndex);
    const drawing = this.drawings.find(item => item.id === id);
    if (!drawing || !Number.isInteger(vertex) || vertex < 0 || vertex >= drawing.vertices.length) return;
    // A selected Start/End marker may be dragged; close its edge editor first.
    if (this.popup) {
      if (!feature.properties?.selectedRole) return;
      this.popup.remove();
    }
    const dragPan = this.map.dragPan;
    this.vertexDrag = { drawing, vertex, dragPanWasEnabled: dragPan?.isEnabled?.() };
    dragPan?.disable();
    event.preventDefault?.();
    this.map.getCanvas().style.cursor = 'grabbing';
  }
  moveVertexDrag(event) {
    if (!this.vertexDrag) {
      if (this.active || this.popup || !event.point) return;
      this.map.getCanvas().style.cursor = this.labelAt(event.point) ? 'pointer' : this.vertexAt(event.point) ? 'grab' : '';
      return;
    }
    const lngLat = this.eventLngLat(event);
    if (!lngLat) return;
    this.vertexDrag.drawing.vertices[this.vertexDrag.vertex] = [lngLat.lng, lngLat.lat];
    this.updateData();
    event.preventDefault?.();
  }
  finishVertexDrag() {
    if (!this.vertexDrag) return;
    const drag = this.vertexDrag;
    this.vertexDrag = null;
    if (drag.dragPanWasEnabled) this.map?.dragPan?.enable();
    this.persist();
    this.updateData();
    this.suppressMapClick = true;
    setTimeout(() => { this.suppressMapClick = false; }, 0);
    if (this.map) this.map.getCanvas().style.cursor = 'grab';
  }
  isDraggingVertex() { return Boolean(this.vertexDrag); }
  consumeMapClickSuppression() {
    if (!this.suppressMapClick) return false;
    this.suppressMapClick = false;
    return true;
  }
  deactivate() { this.active = false; this.map.getCanvas().style.cursor = ''; this.updateUi(); }
  toggle() {
    if (this.active) return this.deactivate();
    this.onActivate(); this.active = true; this.draft = { id: makeId(), vertices: [], createdAt: new Date().toISOString() };
    this.map.getCanvas().style.cursor = 'crosshair'; this.updateData(); this.updateUi();
  }
  addVertex(event) { if (!this.active) return; this.draft.vertices.push([event.lngLat.lng, event.lngLat.lat]); this.updateData(); this.updateUi(); }
  undo() { if (!this.active || !this.draft.vertices.length) return; this.draft.vertices.pop(); this.updateData(); this.updateUi(); }
  defaultName() {
    const used = new Set(this.drawings.map(item => item.name)); let number = 1;
    while (used.has(`Polygon ${number}`)) number++;
    return `Polygon ${number}`;
  }
  finish() {
    if (!this.active || this.draft.vertices.length < 3) return;
    const saved = { ...this.draft, name: this.draft.name || this.defaultName() };
    this.drawings.push(saved); this.persist(); this.draft = null; this.deactivate(); this.updateData(); this.updateUi();
  }
  createManager() {
    this.manager = document.createElement('dialog'); this.manager.className = 'polygon-manager-dialog';
    document.body.appendChild(this.manager);
    this.manager.addEventListener('click', event => {
      const button = event.target.closest('[data-action]'); if (!button) return;
      if (button.dataset.action === 'close') this.manager.close();
      if (button.dataset.action === 'visibility') { const drawing = this.drawings.find(item => item.id === button.dataset.id); if (drawing) { drawing.visible = !drawing.visible; if (!drawing.visible && this.selectedEdge?.drawingId === drawing.id) this.clearSelectedEdge(); this.persist(); this.updateData(); this.renderManager(); } }
      if (button.dataset.action === 'visibility-all') { const visible = button.dataset.visible === 'true'; this.drawings.forEach(drawing => { drawing.visible = visible; }); if (!visible) this.clearSelectedEdge(); this.persist(); this.updateData(); this.renderManager(); }
      if (button.dataset.action === 'delete' && window.confirm(`Delete “${button.dataset.name}”?`)) { this.drawings = this.drawings.filter(item => item.id !== button.dataset.id); if (this.selectedEdge?.drawingId === button.dataset.id) this.clearSelectedEdge(); this.persist(); this.updateData(); this.updateUi(); this.renderManager(); }
    });
    this.manager.addEventListener('submit', event => {
      event.preventDefault(); const form = event.target;
      if (!form.matches('[data-rename]')) return;
      const drawing = this.drawings.find(item => item.id === form.dataset.rename); const name = new FormData(form).get('name').trim();
      if (drawing && name) { drawing.name = name; this.persist(); this.updateData(); this.renderManager(); }
    });
  }
  openManager() { this.renderManager(); this.manager.showModal(); }
  renderManager() {
    const hiddenCount = this.drawings.filter(item => !item.visible).length;
    const items = this.drawings.map(item => `<li><form data-rename="${escapeHtml(item.id)}"><label>Polygon name<input name="name" value="${escapeHtml(item.name)}" aria-label="Polygon name"></label><small>${item.vertices.length} edges · ${item.visible ? 'Shown' : 'Hidden'}</small><button type="submit">Rename</button></form><button type="button" data-action="visibility" data-id="${escapeHtml(item.id)}" aria-pressed="${item.visible}" title="${item.visible ? 'Hide polygon' : 'Show polygon'}">${item.visible ? 'Hide' : 'Show'}</button><button type="button" data-action="delete" data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(item.name)}">Delete</button></li>`).join('');
    const visibilityControls = this.drawings.length ? `<div class="polygon-visibility-actions"><button type="button" data-action="visibility-all" data-visible="true" ${hiddenCount ? '' : 'disabled'}>Show all</button><button type="button" data-action="visibility-all" data-visible="false" ${hiddenCount < this.drawings.length ? '' : 'disabled'}>Hide all</button></div>` : '';
    this.manager.innerHTML = `<button class="dialog-close" type="button" data-action="close" aria-label="Close saved polygons">×</button><h2>Saved polygons</h2><p>Click a map call to edit that edge. Drag a corner to reposition it.</p>${visibilityControls}${items ? `<ul class="saved-polygon-drawings">${items}</ul>` : '<p class="meta">No saved polygons yet.</p>'}`;
  }
  clearSelectedEdge() {
    if (!this.selectedEdge) return;
    this.selectedEdge = null;
    this.updateData();
  }
  openEdgePopup(feature) {
    if (this.active || !feature) return;
    const drawing = this.drawings.find(item => item.id === feature.properties.drawingId);
    const edge = Number(feature.properties.edgeIndex);
    if (!drawing || !Number.isInteger(edge) || edge < 0 || edge >= drawing.vertices.length) return;
    this.popup?.remove();
    this.selectedEdge = { drawingId: drawing.id, edge };
    this.updateData();
    const call = callFor(drawing.vertices[edge], drawing.vertices[(edge + 1) % drawing.vertices.length]);
    const content = document.createElement('form'); content.className = 'polygon-edge-popup';
    content.innerHTML = `<strong>Edge ${edge + 1}</strong><p>The highlighted corners mark this edge's start and end.</p><fieldset><legend>Keep fixed</legend><label><input type="radio" name="fixed" value="start" checked> Start corner</label><label><input type="radio" name="fixed" value="end"> End corner</label></fieldset><p class="polygon-popup-call" aria-live="polite"></p><div class="polygon-popup-bearing"><label>From<select name="ns"><option ${call.ns === 'N' ? 'selected' : ''}>N</option><option ${call.ns === 'S' ? 'selected' : ''}>S</option></select></label><label>°<input name="degrees" type="number" min="0" max="90" value="${call.degrees}" required></label><label>′<input name="minutes" type="number" min="0" max="59" value="${call.minutes}" required></label><label>″<input name="seconds" type="number" min="0" max="59" value="${call.seconds}" required></label><label>Toward<select name="ew"><option ${call.ew === 'E' ? 'selected' : ''}>E</option><option ${call.ew === 'W' ? 'selected' : ''}>W</option></select></label></div><label class="polygon-popup-distance">Feet<input name="distance" type="number" min="0.01" step="0.01" value="${call.distance.toFixed(2)}" required></label><output class="polygon-popup-error" aria-live="polite"></output><div><button type="submit">Update edge</button><button type="button" data-delete ${drawing.vertices.length <= 3 ? 'disabled title="A triangle must keep three edges."' : ''}>Delete edge</button><button type="button" data-close>Close</button></div>${drawing.vertices.length <= 3 ? '<small>A triangle must keep three edges.</small>' : ''}`;
    const reverseEnteredCall = () => {
      const ns = content.elements.ns, ew = content.elements.ew;
      ns.value = ns.value === 'N' ? 'S' : 'N';
      ew.value = ew.value === 'E' ? 'W' : 'E';
    };
    const updateCallCopy = () => {
      const data = new FormData(content);
      const entered = { ns: data.get('ns'), degrees: Number(data.get('degrees')), minutes: Number(data.get('minutes')), seconds: Number(data.get('seconds')), ew: data.get('ew') };
      content.querySelector('.polygon-popup-call').textContent = data.get('fixed') === 'end'
        ? `Keeping End: this call is End → Start (${formatQuadrantBearing(entered)}); the map label will recompute Start → End.`
        : `Keeping Start: this call is Start → End (${formatQuadrantBearing(entered)}).`;
    };
    updateCallCopy();
    content.addEventListener('input', updateCallCopy);
    content.addEventListener('change', event => {
      if (event.target.matches('[name="fixed"]')) reverseEnteredCall();
      updateCallCopy();
    });
    content.addEventListener('submit', event => { event.preventDefault(); this.updateEdge(drawing.id, edge, new FormData(content), content); });
    content.addEventListener('click', event => { if (event.target.matches('[data-close]')) this.popup?.remove(); if (event.target.matches('[data-delete]')) this.deleteEdge(drawing.id, edge); });
    this.popup = new this.maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 }).setLngLat(feature.geometry.coordinates).setDOMContent(content).addTo(this.map);
    this.popup.on('close', () => { this.popup = null; this.clearSelectedEdge(); });
  }
  updateEdge(id, edge, data, content) {
    const call = { ns: data.get('ns'), degrees: Number(data.get('degrees')), minutes: Number(data.get('minutes')), seconds: Number(data.get('seconds')), ew: data.get('ew'), distance: Number(data.get('distance')) };
    if (!validCall(call)) { content.querySelector('.polygon-popup-error').textContent = 'Enter a valid quadrant bearing and distance.'; return; }
    const drawing = this.drawings.find(item => item.id === id); if (!drawing) return;
    const end = (edge + 1) % drawing.vertices.length;
    const updated = updatedEdgeVertices(drawing.vertices[edge], drawing.vertices[end], call, data.get('fixed'));
    drawing.vertices[edge] = updated.start;
    drawing.vertices[end] = updated.end;
    this.persist(); this.updateData(); this.popup?.remove();
  }
  deleteEdge(id, edge) {
    const drawing = this.drawings.find(item => item.id === id);
    if (!drawing || drawing.vertices.length <= 3) return;
    drawing.vertices.splice((edge + 1) % drawing.vertices.length, 1);
    this.persist(); this.updateData(); this.popup?.remove();
  }
  refresh() { this.updateData(); this.updateUi(); }
  updateData() {
    const features = [];
    const add = (drawing, draft, closed) => {
      const vertices = drawing.vertices;
      if (closed && vertices.length >= 3) features.push({ type: 'Feature', properties: { kind: 'area', draft, drawingId: drawing.id }, geometry: { type: 'Polygon', coordinates: [[...vertices, vertices[0]]] } });
      const edgeCount = closed ? vertices.length : Math.max(0, vertices.length - 1);
      for (let index = 0; index < edgeCount; index++) {
        const point = vertices[index], end = vertices[(index + 1) % vertices.length];
        const selected = this.selectedEdge?.drawingId === drawing.id && this.selectedEdge.edge === index;
        const properties = { draft, drawingId: drawing.id, edgeIndex: index, selected };
        features.push({ type: 'Feature', properties: { kind: 'edge', ...properties }, geometry: { type: 'LineString', coordinates: [point, end] } });
        if (closed) features.push({ type: 'Feature', properties: { kind: 'label', label: formatCall(callFor(point, end)), ...properties }, geometry: { type: 'Point', coordinates: [(point[0] + end[0]) / 2, (point[1] + end[1]) / 2] } });
      }
      vertices.forEach((point, index) => {
        const selected = this.selectedEdge?.drawingId === drawing.id;
        const role = selected && index === this.selectedEdge.edge ? 'Start' : selected && index === (this.selectedEdge.edge + 1) % vertices.length ? 'End' : null;
        features.push({ type: 'Feature', properties: { kind: 'vertex', draft, drawingId: drawing.id, vertexIndex: index, selectedRole: role }, geometry: { type: 'Point', coordinates: point } });
        if (role) features.push({ type: 'Feature', properties: { kind: 'selected-corner-label', label: role }, geometry: { type: 'Point', coordinates: point } });
      });
    };
    this.drawings.filter(item => item.visible).forEach(item => add(item, false, true));
    if (this.draft?.vertices.length) add(this.draft, true, false);
    this.map?.getSource('polygon-drawings')?.setData({ type: 'FeatureCollection', features });
  }
  updateUi() {
    if (!this.toggleButton) return;
    const count = this.draft?.vertices.length || 0;
    this.toggleButton.classList.toggle('active', this.active); this.toggleButton.setAttribute('aria-pressed', String(this.active));
    this.undoButton.hidden = !this.active || !count; this.finishButton.hidden = !this.active; this.finishButton.disabled = count < 3; this.openButton.hidden = !this.drawings.length;
    const message = this.active ? `Click vertices (${count} placed).` : '';
    this.output.hidden = !message; this.output.textContent = message;
  }
}
