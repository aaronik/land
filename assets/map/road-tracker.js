'use strict';

const STORAGE_KEY = 'shasta-land-atlas.road-tracks.v1';
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

export class RoadTrackerControl {
  constructor(onActivate = () => {}) {
    this.onActivate = onActivate;
    this.tracks = this.load();
    this.recording = false;
    this.watchId = null;
  }
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(saved) ? saved.filter(track => Array.isArray(track.coordinates) && track.coordinates.length > 1) : [];
    } catch { return []; }
  }
  persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tracks)); } catch { /* Storage may be unavailable. */ }
  }
  onAdd(map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl road-tracker-control';
    this.container.innerHTML = '<button type="button" class="road-tracker-toggle" aria-pressed="false" aria-label="Start road tracking" title="Start road tracking"><span aria-hidden="true">⌁</span><b>Track road</b></button><button type="button" class="road-tracker-manage" aria-label="Manage saved road tracks" title="Manage saved road tracks" hidden>☰</button><output aria-live="polite" hidden></output>';
    this.toggleButton = this.container.querySelector('.road-tracker-toggle');
    this.manageButton = this.container.querySelector('.road-tracker-manage');
    this.output = this.container.querySelector('output');
    this.toggleButton.addEventListener('click', () => this.toggle());
    this.manageButton.addEventListener('click', () => this.openManager());
    this.createManager();
    this.updateData(); this.updateUi();
    return this.container;
  }
  onRemove() {
    this.stop();
    this.manager?.remove();
    this.container.remove();
    this.map = undefined;
  }
  isActive() { return this.recording; }
  toggle() { this.recording ? this.stop() : this.start(); }
  start() {
    if (!navigator.geolocation) { this.setMessage('Location tracking is not supported by this browser.'); return; }
    this.onActivate();
    const track = { id: makeId(), name: this.defaultName(), coordinates: [], timestamps: [], createdAt: new Date().toISOString() };
    this.tracks.push(track);
    this.currentTrack = track;
    this.recording = true;
    this.watchId = navigator.geolocation.watchPosition(
      position => this.addPosition(position),
      error => { this.setMessage(error.code === error.PERMISSION_DENIED ? 'Location permission is needed to track a road.' : 'Location unavailable. Keep the tracker on and try again.'); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    this.persist(); this.updateData(); this.updateUi();
  }
  stop() {
    if (!this.recording) return;
    if (this.watchId !== null) navigator.geolocation?.clearWatch(this.watchId);
    this.watchId = null;
    this.recording = false;
    if (this.currentTrack?.coordinates.length < 2) this.tracks = this.tracks.filter(track => track !== this.currentTrack);
    this.currentTrack = null;
    this.persist(); this.updateData(); this.updateUi();
  }
  addPosition(position) {
    if (!this.recording || !this.currentTrack) return;
    const { longitude, latitude, accuracy } = position.coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    // Ignore very poor fixes and duplicates; walking tracks remain useful without GPS jitter.
    if (Number.isFinite(accuracy) && accuracy > 65) { this.setMessage(`Waiting for a better GPS fix (${Math.round(accuracy)} m accuracy).`); return; }
    const point = [longitude, latitude];
    const last = this.currentTrack.coordinates.at(-1);
    if (last && Math.abs(last[0] - point[0]) < 0.000001 && Math.abs(last[1] - point[1]) < 0.000001) return;
    this.currentTrack.coordinates.push(point);
    this.currentTrack.timestamps.push(position.timestamp || Date.now());
    this.persist(); this.updateData(); this.updateUi();
  }
  defaultName() {
    const used = new Set(this.tracks.map(track => track.name)); let number = 1;
    while (used.has(`Road track ${number}`)) number++;
    return `Road track ${number}`;
  }
  setMessage(message) { if (this.output) { this.output.hidden = !message; this.output.textContent = message; } }
  createManager() {
    this.manager = document.createElement('dialog');
    this.manager.className = 'road-tracker-dialog';
    document.body.appendChild(this.manager);
    this.manager.addEventListener('click', event => {
      const button = event.target.closest('[data-action]'); if (!button) return;
      if (button.dataset.action === 'close') this.manager.close();
      if (button.dataset.action === 'delete' && window.confirm(`Delete “${button.dataset.name}”?`)) {
        this.tracks = this.tracks.filter(track => track.id !== button.dataset.id); this.persist(); this.updateData(); this.updateUi(); this.renderManager();
      }
      if (button.dataset.action === 'export') this.exportTracks();
    });
    this.manager.addEventListener('submit', event => {
      event.preventDefault(); const form = event.target;
      if (!form.matches('[data-rename]')) return;
      const track = this.tracks.find(item => item.id === form.dataset.rename);
      const name = new FormData(form).get('name').trim();
      if (track && name) { track.name = name; this.persist(); this.updateData(); this.renderManager(); }
    });
  }
  openManager() { this.renderManager(); this.manager.showModal(); }
  renderManager() {
    const tracks = this.tracks.filter(track => track !== this.currentTrack || !this.recording);
    const items = tracks.map(track => `<li><form data-rename="${escapeHtml(track.id)}"><label>Track name<input name="name" value="${escapeHtml(track.name)}" aria-label="Track name"></label><small>${track.coordinates.length} GPS points</small><button type="submit">Rename</button></form><button type="button" data-action="delete" data-id="${escapeHtml(track.id)}" data-name="${escapeHtml(track.name)}">Delete</button></li>`).join('');
    this.manager.innerHTML = `<button class="dialog-close" type="button" data-action="close" aria-label="Close saved road tracks">×</button><h2>Saved road tracks</h2><p>Tracks stay only on this device. Export a GeoJSON backup or import it into another mapping app.</p><div class="road-tracker-actions"><button type="button" data-action="export" ${tracks.length ? '' : 'disabled'}>Export GeoJSON</button></div>${items ? `<ul class="saved-road-tracks">${items}</ul>` : '<p class="meta">No completed road tracks yet.</p>'}`;
  }
  exportTracks() {
    const features = this.tracks.filter(track => track.coordinates.length > 1).map(track => ({ type: 'Feature', properties: { name: track.name, createdAt: track.createdAt }, geometry: { type: 'LineString', coordinates: track.coordinates } }));
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'road-tracks.geojson'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  refresh() { this.updateData(); this.updateUi(); }
  updateData() {
    const features = this.tracks.filter(track => track.coordinates.length > 1).map(track => ({ type: 'Feature', properties: { id: track.id, name: track.name, recording: track === this.currentTrack }, geometry: { type: 'LineString', coordinates: track.coordinates } }));
    this.map?.getSource('road-tracks')?.setData({ type: 'FeatureCollection', features });
  }
  updateUi() {
    if (!this.toggleButton) return;
    const points = this.currentTrack?.coordinates.length || 0;
    this.toggleButton.classList.toggle('active', this.recording);
    this.toggleButton.setAttribute('aria-pressed', String(this.recording));
    this.toggleButton.title = this.recording ? 'Stop and save road track' : 'Start road tracking';
    this.toggleButton.setAttribute('aria-label', this.toggleButton.title);
    this.toggleButton.querySelector('b').textContent = this.recording ? 'Stop track' : 'Track road';
    this.manageButton.hidden = !this.tracks.length;
    if (this.recording) this.setMessage(points ? `Recording road: ${points} GPS points.` : 'Recording road: waiting for GPS.');
    else this.setMessage('');
  }
}
