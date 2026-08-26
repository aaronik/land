'use strict';

const STORAGE_KEY = 'shasta-land-atlas.plat-traces.v1';
const EARTH_RADIUS_METERS = 6371008.8;

function emptyCollection() { return { type: 'FeatureCollection', features: [] }; }
function radians(value) { return value * Math.PI / 180; }
function degrees(value) { return value * 180 / Math.PI; }

function azimuthFor(call) {
  const angle = Number(call.degrees) + Number(call.minutes) / 60 + Number(call.seconds) / 3600;
  if (call.ns === 'N' && call.ew === 'E') return angle;
  if (call.ns === 'S' && call.ew === 'E') return 180 - angle;
  if (call.ns === 'S' && call.ew === 'W') return 180 + angle;
  return 360 - angle;
}

function destination([longitude, latitude], bearingDegrees, distanceFeet) {
  const angularDistance = distanceFeet * 0.3048 / EARTH_RADIUS_METERS;
  const bearing = radians(bearingDegrees);
  const latitude1 = radians(latitude);
  const longitude1 = radians(longitude);
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance)
    + Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const longitude2 = longitude1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
    Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
  );
  return [((degrees(longitude2) + 540) % 360) - 180, degrees(latitude2)];
}

function coordinatesFor(trace) {
  const coordinates = [trace.start];
  for (const call of trace.calls) coordinates.push(destination(coordinates.at(-1), azimuthFor(call), call.distance));
  return coordinates;
}

function distanceFeet(a, b) {
  const latitude1 = radians(a[1]), latitude2 = radians(b[1]);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = radians(b[0] - a[0]);
  const value = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)) / 0.3048;
}

function formatCall(call) {
  return `${call.ns} ${call.degrees}° ${String(call.minutes).padStart(2, '0')}′ ${String(call.seconds).padStart(2, '0')}″ ${call.ew} · ${Number(call.distance).toLocaleString()} ft`;
}

export class PlatTraceControl {
  constructor(onActivate = () => {}) {
    this.onActivate = onActivate;
    this.traces = this.load();
    this.draft = null;
    this.active = false;
  }

  load() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(value) ? value.filter(trace => Array.isArray(trace.start) && Array.isArray(trace.calls)) : [];
    } catch { return []; }
  }

  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.traces)); } catch { /* Browser storage may be unavailable. */ }
  }

  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl plat-trace-control';
    this.container.innerHTML = '<button type="button" class="plat-trace-toggle" aria-pressed="false" aria-label="Create a plat boundary trace" title="Create a plat boundary trace"><span aria-hidden="true">◇</span><b>Plat trace</b></button><button type="button" class="plat-trace-open" aria-label="Open saved plat traces" title="Open saved plat traces" hidden>☰</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.plat-trace-toggle');
    this.openButton = this.container.querySelector('.plat-trace-open');
    this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.openButton.addEventListener('click', () => this.openDialog());
    this.onMapClick = event => this.placeStart(event);
    this.map.on('click', this.onMapClick);
    this.createDialog();
    this.updateUi();
    return this.container;
  }

  onRemove() {
    this.map.off('click', this.onMapClick);
    this.dialog?.remove();
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
    if (this.active) {
      this.deactivate();
      return;
    }
    if (this.draft) {
      this.openDialog();
      return;
    }
    this.onActivate();
    this.active = true;
    this.map.getCanvas().style.cursor = 'crosshair';
    this.updateUi();
  }

  placeStart(event) {
    if (!this.active) return;
    this.draft = {
      id: crypto.randomUUID?.() || String(Date.now()),
      name: '',
      start: [event.lngLat.lng, event.lngLat.lat],
      calls: [],
      createdAt: new Date().toISOString()
    };
    this.active = false;
    this.map.getCanvas().style.cursor = '';
    this.updateData();
    this.renderDialog();
    this.dialog.showModal();
    this.dialog.querySelector('[name="degrees"]').focus();
    this.updateUi();
  }

  createDialog() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'plat-trace-dialog';
    this.dialog.setAttribute('aria-labelledby', 'plat-trace-title');
    this.dialog.innerHTML = `
      <button class="dialog-close" type="button" aria-label="Close plat trace">×</button>
      <h2 id="plat-trace-title">Plat boundary trace</h2>
      <div class="plat-trace-content"></div>`;
    document.body.appendChild(this.dialog);
    this.dialog.querySelector('.dialog-close').addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('submit', event => {
      event.preventDefault();
      if (event.target.matches('.plat-call-form')) this.addCall(new FormData(event.target));
    });
    this.dialog.addEventListener('click', event => this.handleDialogClick(event));
  }

  openDialog() {
    this.renderDialog();
    this.dialog.showModal();
  }

  handleDialogClick(event) {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'undo') {
      this.draft?.calls.pop();
      this.updateData();
      this.renderDialog();
    } else if (action === 'discard') {
      if (!this.draft || window.confirm('Discard this unfinished trace?')) {
        this.draft = null;
        this.updateData();
        this.renderDialog();
        this.updateUi();
      }
    } else if (action === 'save') {
      this.saveDraft();
    } else if (action === 'new') {
      this.dialog.close();
      this.draft = null;
      this.toggle();
    } else if (action === 'delete') {
      const id = event.target.closest('[data-trace-id]')?.dataset.traceId;
      const trace = this.traces.find(item => item.id === id);
      if (trace && window.confirm(`Delete “${trace.name}”?`)) {
        this.traces = this.traces.filter(item => item.id !== id);
        this.persist();
        this.updateData();
        this.renderDialog();
        this.updateUi();
      }
    }
  }

  addCall(formData) {
    if (!this.draft) return;
    const call = {
      ns: formData.get('ns'),
      degrees: Number(formData.get('degrees')),
      minutes: Number(formData.get('minutes')),
      seconds: Number(formData.get('seconds')),
      ew: formData.get('ew'),
      distance: Number(formData.get('distance'))
    };
    const angleIsValid = call.degrees >= 0 && call.degrees <= 90
      && call.minutes >= 0 && call.minutes < 60
      && call.seconds >= 0 && call.seconds < 60
      && (call.degrees < 90 || (!call.minutes && !call.seconds));
    if (!angleIsValid || !(call.distance > 0)) return;
    this.draft.calls.push(call);
    this.updateData();
    this.renderDialog();
    this.dialog.querySelector('[name="degrees"]').focus();
  }

  saveDraft() {
    if (!this.draft || this.draft.calls.length < 3) return;
    const nameInput = this.dialog.querySelector('[name="trace-name"]');
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      nameInput.setCustomValidity('Enter a name for this trace.');
      nameInput.reportValidity();
      nameInput.addEventListener('input', () => nameInput.setCustomValidity(''), { once: true });
      return;
    }
    this.draft.name = name;
    this.traces.push(this.draft);
    this.persist();
    this.draft = null;
    this.updateData();
    this.renderDialog();
    this.updateUi();
  }

  renderDialog() {
    const content = this.dialog.querySelector('.plat-trace-content');
    if (!this.draft) {
      const records = this.traces.map(trace => {
        const coordinates = coordinatesFor(trace);
        const gap = distanceFeet(coordinates.at(-1), coordinates[0]);
        return `<li><span><strong>${this.escape(trace.name)}</strong><small>${trace.calls.length} calls · closure gap ${Math.round(gap).toLocaleString()} ft</small></span><button type="button" data-action="delete" data-trace-id="${this.escape(trace.id)}">Delete</button></li>`;
      }).join('');
      content.innerHTML = `<p>Traces are stored only in this browser.</p>${records ? `<ul class="saved-plat-traces">${records}</ul>` : '<p class="meta">No saved plat traces yet.</p>'}<div class="dialog-actions"><button type="button" data-action="new">New plat trace</button></div><p class="plat-disclaimer">User reconstruction for screening only—not a survey or legal boundary.</p>`;
      return;
    }

    const coordinates = coordinatesFor(this.draft);
    const closure = this.draft.calls.length > 1 ? distanceFeet(coordinates.at(-1), coordinates[0]) : null;
    const rows = this.draft.calls.map((call, index) => `<li><b>${index + 1}</b><span>${formatCall(call)}</span></li>`).join('');
    content.innerHTML = `
      <p class="plat-start"><b>Starting corner</b> ${this.draft.start[1].toFixed(6)}, ${this.draft.start[0].toFixed(6)}</p>
      <form class="plat-call-form">
        <fieldset><legend>Next plat call</legend>
          <div class="plat-bearing-row">
            <label>From <select name="ns"><option>N</option><option>S</option></select></label>
            <label>Degrees <input name="degrees" type="number" min="0" max="90" step="1" required></label>
            <label>Minutes <input name="minutes" type="number" min="0" max="59" step="1" value="0" required></label>
            <label>Seconds <input name="seconds" type="number" min="0" max="59.99" step="0.01" value="0" required></label>
            <label>Toward <select name="ew"><option>E</option><option>W</option></select></label>
          </div>
          <div class="plat-distance-row"><label>Distance <input name="distance" type="number" min="0.01" step="0.01" required> feet</label><button type="submit">Add call</button></div>
        </fieldset>
      </form>
      ${rows ? `<ol class="plat-call-list">${rows}</ol>` : '<p class="meta">Enter the first bearing and distance from the known corner.</p>'}
      ${closure !== null ? `<p class="plat-closure"><b>Closure gap:</b> ${closure.toFixed(1)} ft from the current endpoint to the starting corner.</p>` : ''}
      <label class="plat-name">Trace name <input name="trace-name" value="${this.escape(this.draft.name)}" placeholder="APN or parcel name"></label>
      <div class="dialog-actions plat-actions">
        <button type="button" data-action="discard">Discard</button>
        <button type="button" data-action="undo" ${this.draft.calls.length ? '' : 'disabled'}>Undo last</button>
        <button type="button" data-action="save" ${this.draft.calls.length >= 3 ? '' : 'disabled'}>Save trace</button>
      </div>
      <p class="plat-disclaimer">Calls are projected from the selected corner on a spherical earth model. This is a user reconstruction for screening only—not a survey or legal boundary.</p>`;
  }

  escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  }

  refresh() { this.updateData(); this.updateUi(); }

  updateData() {
    const features = [];
    const addTrace = (trace, draft) => {
      const coordinates = coordinatesFor(trace);
      if (coordinates.length > 2) {
        features.push({ type: 'Feature', properties: { draft, kind: 'area', name: trace.name }, geometry: { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] } });
        features.push({ type: 'Feature', properties: { draft, kind: 'closure' }, geometry: { type: 'LineString', coordinates: [coordinates.at(-1), coordinates[0]] } });
      }
      for (let index = 1; index < coordinates.length; index++) {
        const call = trace.calls[index - 1];
        const start = coordinates[index - 1], end = coordinates[index];
        features.push({ type: 'Feature', properties: { draft, kind: 'course', label: formatCall(call) }, geometry: { type: 'LineString', coordinates: [start, end] } });
        features.push({ type: 'Feature', properties: { draft, kind: 'label', label: formatCall(call) }, geometry: { type: 'Point', coordinates: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] } });
      }
      coordinates.forEach((coordinate, index) => features.push({ type: 'Feature', properties: { draft, kind: 'vertex', vertex: index + 1 }, geometry: { type: 'Point', coordinates: coordinate } }));
    };
    this.traces.forEach(trace => addTrace(trace, false));
    if (this.draft) addTrace(this.draft, true);
    this.map?.getSource('plat-traces')?.setData({ type: 'FeatureCollection', features });
  }

  updateUi() {
    if (!this.toggleButton) return;
    this.toggleButton.classList.toggle('active', this.active || Boolean(this.draft));
    this.toggleButton.setAttribute('aria-pressed', String(this.active));
    this.openButton.hidden = !this.traces.length;
    const message = this.active
      ? 'Click the known starting corner.'
      : this.draft
        ? `${this.draft.calls.length} plat call${this.draft.calls.length === 1 ? '' : 's'} entered.`
        : '';
    this.output.hidden = !message;
    this.output.textContent = message;
  }
}
