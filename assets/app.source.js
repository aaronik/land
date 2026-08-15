'use strict';

import * as maplibregl from './vendor/maplibre/maplibre-gl.mjs';
import { Protocol } from './vendor/pmtiles/pmtiles.js';

const COLORS = { 'private-land': '#42d7a6', 'private-home': '#7653b5', 'public-land': '#ff9d4d', 'public-home': '#b94b18' };
const PARCELQUEST_URL = 'https://assr.parcelquest.com/impl/SISASSR';
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
const assetUrl = path => new URL(path, window.location.href).href;

let saleData;
let apnIndex = {};
let selectedResearchApn = '';
let selectedApn = '';
let selectedGeometry = null;
let terrainEnabled = false;
let enabledCategories = new Set(Object.keys(COLORS));

const map = new maplibregl.Map({
  container: 'map',
  center: [-122.45, 41.45],
  zoom: 8.25,
  maxZoom: 18,
  pitch: 0,
  hash: true,
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      satellite: {
        type: 'raster', tileSize: 256, maxzoom: 19,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: 'Imagery © Esri'
      },
      terrain: {
        type: 'raster-dem', tileSize: 256, maxzoom: 13, encoding: 'terrarium',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        attribution: 'Terrain © AWS Terrain Tiles / Mapzen'
      }
    },
    layers: [
      { id: 'satellite', type: 'raster', source: 'satellite' },
      { id: 'terrain-relief', type: 'hillshade', source: 'terrain', layout: { visibility: 'none' }, paint: { 'hillshade-shadow-color': '#172018', 'hillshade-highlight-color': '#f5f0d0', 'hillshade-exaggeration': 0.35 } }
    ],
    sky: { 'sky-color': '#9bc9e8', 'horizon-color': '#dce8e6', 'fog-color': '#dce8e6', 'sky-horizon-blend': 0.45 }
  }
});
window.__landMap = map;
window.__landErrors = [];
map.on('error', event => { window.__landErrors.push(event.error?.message || String(event.error)); console.error(event.error); });

const navigationControl = new maplibregl.NavigationControl({ showCompass: false });
map.addControl(navigationControl, 'bottom-right');
const terrainButton = document.createElement('button');
terrainButton.id = 'terrain-toggle';
terrainButton.className = 'maplibregl-ctrl-terrain-toggle';
terrainButton.type = 'button';
terrainButton.setAttribute('aria-label', 'Enable 3D terrain');
terrainButton.setAttribute('aria-pressed', 'false');
terrainButton.title = 'Enable 3D terrain';
terrainButton.innerHTML = '<span aria-hidden="true">3D</span>';
navigationControl._container.appendChild(terrainButton);
const geolocateControl = new maplibregl.GeolocateControl({
  positionOptions: {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000
  },
  fitBoundsOptions: { maxZoom: 17 },
  trackUserLocation: true,
  showUserLocation: true,
  showAccuracyCircle: true
});
// MapLibre markers use terrain elevation when terrain is enabled, keeping the
// live location dot on the 3D surface instead of on the flat map plane.
map.addControl(geolocateControl, 'bottom-right');
window.__landGeolocateControl = geolocateControl;
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
map.addControl(new CardinalCompassControl(), 'top-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-left');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function money(value) { return value ? `$${Number(value).toLocaleString()}` : ''; }
function categories(feature) { return new Set((feature.properties.records || []).map(record => record.category)); }
function visible(feature) { return [...categories(feature)].some(value => enabledCategories.has(value)); }
function firstCategory(feature) { return [...categories(feature)].find(value => enabledCategories.has(value)) || [...categories(feature)][0]; }
function researchKey(apn) { return `shasta-land-research:${apn}`; }
function parcelQuestUsageKey() { return `shasta-land-parcelquest:${new Date().toISOString().slice(0, 7)}`; }

function recordCard(record) {
  if (record.kind === 'private') {
    const home = record.category === 'private-home';
    const homeDetails = home ? [record.beds && `${record.beds} bd`, record.baths && `${record.baths} ba`, record.sqft && `${Number(record.sqft).toLocaleString()} sq ft`].filter(Boolean).join(' · ') : '';
    return `<article class="record ${home ? 'home' : ''}"><strong>${home ? 'Private home' : 'Private land'}</strong><p>${escapeHtml(record.title || '')}</p><p>${money(record.price)} · ${escapeHtml(record.acres || '—')} acres${homeDetails ? ` · ${escapeHtml(homeDetails)}` : ''} · ${escapeHtml(record.status || '')}</p>${record.url ? `<a href="${escapeHtml(record.url)}" target="_blank" rel="noopener">Open listing ↗</a>` : ''}</article>`;
  }
  return `<article class="record public"><strong>Public auction record</strong><p>${escapeHtml(record.minimumBid || 'No parsed minimum')} · ${escapeHtml(record.status || 'Unknown status')}</p><p>${escapeHtml(record.source || '')}</p>${record.sourceUrl ? `<a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener">Source PDF ↗</a>` : ''}</article>`;
}
function researchControls(apn) {
  if (!apn) return '';
  const saved = JSON.parse(localStorage.getItem(researchKey(apn)) || '{}');
  const opens = Number(localStorage.getItem(parcelQuestUsageKey()) || 0);
  return `<section class="research"><h4>Private research</h4><div class="research-actions"><button type="button" data-copy-apn>Copy APN</button><button type="button" data-parcelquest>Research in ParcelQuest Lite</button></div><textarea data-research-notes rows="4" placeholder="Notes stored only in this browser">${escapeHtml(saved.notes || '')}</textarea><button type="button" data-save-research>Save private notes</button><p>${saved.updated ? `Saved ${escapeHtml(new Date(saved.updated).toLocaleString())}. ` : ''}Estimated ParcelQuest opens this month: ${opens} / 50.</p></section>`;
}
function bindResearchControls(apn) {
  document.querySelector('[data-copy-apn]')?.addEventListener('click', () => navigator.clipboard.writeText(apn));
  document.querySelector('[data-parcelquest]')?.addEventListener('click', () => { selectedResearchApn = apn; document.querySelector('#parcelquest-warning').showModal(); });
  document.querySelector('[data-save-research]')?.addEventListener('click', () => {
    const notes = document.querySelector('[data-research-notes]').value;
    localStorage.setItem(researchKey(apn), JSON.stringify({ notes, updated: new Date().toISOString() }));
    showParcelDetails({ APN: apn });
  });
}
function matchingSale(apn) { return saleData?.features.find(feature => feature.properties.APN === apn); }
function displayAddress(records) {
  const title = records.find(record => record.kind === 'private')?.title || '';
  return title.replace(/,\s*(?:CA|California)(?:\s+\d{5}(?:-\d{4})?)?\s*$/i, '').trim();
}
function showParcelDetails(properties, saleFeature = matchingSale(properties.APN)) {
  const p = { ...(saleFeature?.properties || {}), ...properties };
  const records = saleFeature?.properties.records || p.records || [];
  const acres = p.Acres ?? apnIndex[p.APN]?.acres;
  const address = displayAddress(records);
  document.querySelector('#details').innerHTML = `<h3>${escapeHtml(address || 'Parcel')}</h3><p class="meta">${escapeHtml(acres || '—')} GIS acres${p.LandUse1 ? ` · Land use ${escapeHtml(p.LandUse1)}` : ''}${p.APN ? ` · APN ${escapeHtml(p.APN)}` : ''}</p>${records.map(recordCard).join('') || '<p class="muted">Official county parcel. No current listing or auction record is attached.</p>'}${researchControls(p.APN)}`;
  bindResearchControls(p.APN);
}
function setSelectedApn(apn, geometry = null) {
  selectedApn = apn || '';
  selectedGeometry = geometry;
  const source = map.getSource('selection');
  if (source) source.setData({
    type: 'FeatureCollection',
    features: selectedGeometry ? [{ type: 'Feature', properties: { APN: selectedApn }, geometry: selectedGeometry }] : []
  });
}
function selectParcel(properties, geometry = null) {
  if (!properties?.APN) return;
  const saleGeometry = matchingSale(properties.APN)?.geometry;
  const outlineGeometry = geometry?.type === 'Point' ? saleGeometry : (geometry || saleGeometry);
  setSelectedApn(properties.APN, outlineGeometry || null);
  showParcelDetails(properties);
}
function saleGeoJson() {
  return {
    type: 'FeatureCollection',
    features: (saleData?.features || []).filter(visible).map(feature => ({ ...feature, properties: { ...feature.properties, displayCategory: firstCategory(feature) } }))
  };
}
function featureCenter(feature) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const collect = value => {
    if (typeof value?.[0] === 'number') {
      minX = Math.min(minX, value[0]); maxX = Math.max(maxX, value[0]);
      minY = Math.min(minY, value[1]); maxY = Math.max(maxY, value[1]);
    } else value?.forEach(collect);
  };
  collect(feature.geometry?.coordinates);
  return Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : null;
}
function salePointGeoJson() {
  return {
    type: 'FeatureCollection',
    features: (saleData?.features || []).filter(visible).map(feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: featureCenter(feature) }, properties: { ...feature.properties, displayCategory: firstCategory(feature) } })).filter(feature => feature.geometry.coordinates)
  };
}
function unmappedGeoJson() {
  return {
    type: 'FeatureCollection',
    features: (saleData?.unmappedListings || []).filter(record => enabledCategories.has(record.category)).map(record => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [record.latLng[1], record.latLng[0]] }, properties: { ...record } }))
  };
}
function updateSales() {
  map.getSource('sales')?.setData(saleGeoJson());
  map.getSource('sale-points')?.setData(salePointGeoJson());
  map.getSource('unmapped')?.setData(unmappedGeoJson());
  const shown = (saleData?.features || []).filter(visible);
  document.querySelector('#visible-count').textContent = shown.length + (saleData?.unmappedListings || []).filter(record => enabledCategories.has(record.category)).length;
  document.querySelector('#private-count').textContent = shown.filter(f => [...categories(f)].some(c => c.startsWith('private-'))).length;
  document.querySelector('#public-count').textContent = shown.filter(f => [...categories(f)].some(c => c.startsWith('public-'))).length;
}
function addPmtilesSource(id) { map.addSource(id, { type: 'vector', url: `pmtiles://${assetUrl(`data/generated/${id}.pmtiles`)}` }); }
function toggleLayer(id, visibleValue) {
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibleValue ? 'visible' : 'none');
}
function applyTerrain(enabled) {
  terrainEnabled = enabled;
  map.setTerrain(enabled ? { source: 'terrain', exaggeration: 1.5 } : null);
  if (map.getLayer('terrain-relief')) map.setLayoutProperty('terrain-relief', 'visibility', enabled ? 'visible' : 'none');
  map.easeTo({ pitch: enabled ? 60 : 0, bearing: enabled ? -12 : 0, duration: 700 });
  const button = document.querySelector('#terrain-toggle');
  button.classList.toggle('active', enabled);
  button.setAttribute('aria-pressed', String(enabled));
  const label = enabled ? 'Disable 3D terrain' : 'Enable 3D terrain';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.querySelector('span').textContent = '3D';
}
function toggleTerrain(force) {
  const enabled = force ?? !terrainEnabled;
  applyTerrain(enabled);
}

function initializeMobileSheet() {
  const panel = document.querySelector('.panel');
  const handle = document.querySelector('.sheet-handle');
  const mobile = window.matchMedia('(max-width: 760px)');
  let startY = 0;
  let startOffset = 0;
  let currentOffset = 0;
  let dragged = false;

  const collapsedOffset = () => {
    const peek = parseFloat(getComputedStyle(panel).getPropertyValue('--mobile-sheet-peek')) || 132;
    return Math.max(0, panel.offsetHeight - peek);
  };
  const setOpen = open => {
    panel.classList.toggle('sheet-open', open);
    panel.classList.remove('sheet-dragging');
    panel.style.transform = '';
    handle.setAttribute('aria-expanded', String(open));
    handle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} map information`);
  };

  handle.addEventListener('click', () => {
    if (!dragged && mobile.matches) setOpen(!panel.classList.contains('sheet-open'));
    dragged = false;
  });
  handle.addEventListener('pointerdown', event => {
    if (!mobile.matches) return;
    startY = event.clientY;
    startOffset = panel.classList.contains('sheet-open') ? 0 : collapsedOffset();
    currentOffset = startOffset;
    dragged = false;
    panel.classList.add('sheet-dragging');
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    const delta = event.clientY - startY;
    dragged ||= Math.abs(delta) > 5;
    currentOffset = Math.max(0, Math.min(collapsedOffset(), startOffset + delta));
    panel.style.transform = `translateY(${currentOffset}px)`;
  });
  const finishDrag = event => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    handle.releasePointerCapture(event.pointerId);
    setOpen(currentOffset < collapsedOffset() / 2);
    requestAnimationFrame(() => { dragged = false; });
  };
  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  mobile.addEventListener('change', () => setOpen(false));
}
initializeMobileSheet();

let layersInitialized = false;
function initializeMapLayers() {
  if (layersInitialized || !map.getStyle()) return;
  layersInitialized = true;
  try {
    addPmtilesSource('public_land');
  addPmtilesSource('fire_hazard');
  addPmtilesSource('zoning');
  addPmtilesSource('parcels');
  addPmtilesSource('roads');
  map.addSource('sales', { type: 'geojson', data: saleGeoJson() });
  map.addSource('sale-points', { type: 'geojson', data: salePointGeoJson() });
  map.addSource('unmapped', { type: 'geojson', data: unmappedGeoJson() });
  map.addSource('selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  map.addLayer({ id: 'public-land', type: 'fill', source: 'public_land', 'source-layer': 'public_land', paint: { 'fill-color': '#4e9f54', 'fill-opacity': 0.38 } });
  map.addLayer({ id: 'fire-hazard', type: 'fill', source: 'fire_hazard', 'source-layer': 'fire_hazard', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'HAZ_CLASS'], 'Very High', '#d73027', 'High', '#fc8d59', 'Moderate', '#fee08b', '#f5a623'], 'fill-opacity': 0.3 } });
  map.addLayer({ id: 'zoning', type: 'line', source: 'zoning', 'source-layer': 'zoning', layout: { visibility: 'none' }, paint: { 'line-color': '#64c7ff', 'line-width': 1.4, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcels', 'source-layer': 'parcels', minzoom: 8, paint: { 'fill-color': '#fff', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.01, 13, 0.045] } });
  map.addLayer({ id: 'parcel-lines', type: 'line', source: 'parcels', 'source-layer': 'parcels', minzoom: 8, paint: { 'line-color': '#aeb4b7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 13, 0.85], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 15, 1.8] } });
  map.addLayer({ id: 'roads', type: 'line', source: 'roads', 'source-layer': 'roads', minzoom: 9, paint: { 'line-color': '#f8d37c', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 15, 3], 'line-opacity': 0.9 } });
  map.addLayer({ id: 'sale-fill', type: 'fill', source: 'sales', paint: { 'fill-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'fill-opacity': 0.42 } });
  map.addLayer({ id: 'sale-lines', type: 'line', source: 'sales', paint: { 'line-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'line-width': 3 } });
  map.addLayer({ id: 'sale-markers', type: 'circle', source: 'sale-points', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.95, 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'parcel-selected', type: 'line', source: 'selection', paint: { 'line-color': '#fff', 'line-width': 5, 'line-blur': 0.3 } });
  map.addLayer({ id: 'unmapped-markers', type: 'circle', source: 'unmapped', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'category'], 'private-home', COLORS['private-home'], COLORS['private-land']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.9, 'circle-pitch-alignment': 'map' } });

  map.on('click', event => {
    const radius = 9;
    const markerHits = map.queryRenderedFeatures([
      [event.point.x - radius, event.point.y - radius],
      [event.point.x + radius, event.point.y + radius]
    ], { layers: ['unmapped-markers', 'sale-markers'] });
    const polygonHits = map.queryRenderedFeatures(event.point, { layers: ['sale-fill', 'parcel-fill'] });
    const feature = markerHits[0] || polygonHits[0];
    if (!feature) return;
    const props = feature.properties || {};
    if (feature.layer.id === 'unmapped-markers') {
      document.querySelector('#details').innerHTML = `<h3>Unmapped listing</h3><p class="meta">MLS point only — boundary unverified.</p>${recordCard(props)}`;
      return;
    }
    if (feature.layer.id === 'sale-markers' || feature.layer.id === 'sale-fill') {
      let records = props.records || [];
      if (typeof records === 'string') {
        try { records = JSON.parse(records); } catch { records = []; }
      }
      selectParcel({ ...props, records }, feature.geometry);
      return;
    }
    selectParcel(props, feature.geometry);
  });
  for (const id of ['parcel-fill', 'sale-fill', 'sale-markers', 'unmapped-markers']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
  const rotationHeavyLayers = ['public-land', 'parcel-fill', 'parcel-lines', 'sale-fill', 'sale-lines'];
  let rotationRestoreTimer;
  let rotationVisibility;
  map.on('rotate', () => {
    if (!terrainEnabled) return;
    if (!rotationVisibility) {
      rotationVisibility = new Map(rotationHeavyLayers.filter(id => map.getLayer(id)).map(id => [id, map.getLayoutProperty(id, 'visibility') || 'visible']));
      for (const id of rotationVisibility.keys()) map.setLayoutProperty(id, 'visibility', 'none');
    }
    clearTimeout(rotationRestoreTimer);
    rotationRestoreTimer = setTimeout(() => {
      for (const [id, visibility] of rotationVisibility || []) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
      rotationVisibility = null;
    }, 140);
  });
  updateSales();
  document.body.classList.add('map-ready');
  } catch (error) {
    layersInitialized = false;
    document.querySelector('#updated').textContent = `Could not initialize map layers: ${error.message}`;
    console.error(error);
  }
}
map.once('style.load', initializeMapLayers);

function findParcel() {
  const query = document.querySelector('#search').value.trim().toUpperCase();
  const apn = Object.keys(apnIndex).find(key => key === query || key.replaceAll('-', '') === query.replaceAll('-', ''));
  if (!apn) { document.querySelector('#details').innerHTML = '<p class="muted">No county parcel matched that APN.</p>'; return; }
  const item = apnIndex[apn];
  setSelectedApn(apn);
  map.fitBounds([[item.bbox[0], item.bbox[1]], [item.bbox[2], item.bbox[3]]], { padding: 90, maxZoom: 16 });
  showParcelDetails({ APN: apn, Acres: item.acres });
}

document.querySelector('#terrain-toggle').addEventListener('click', () => toggleTerrain());
document.querySelector('#search-button').addEventListener('click', findParcel);
document.querySelector('#search').addEventListener('keydown', event => { if (event.key === 'Enter') findParcel(); });
document.querySelectorAll('.filter').forEach(input => input.addEventListener('change', () => { enabledCategories = new Set([...document.querySelectorAll('.filter:checked')].map(item => item.value)); updateSales(); }));
document.querySelectorAll('[data-map-layer]').forEach(input => input.addEventListener('change', () => toggleLayer(input.dataset.mapLayer, input.checked)));
document.querySelector('#cancel-parcelquest').addEventListener('click', () => document.querySelector('#parcelquest-warning').close());
document.querySelector('#continue-parcelquest').addEventListener('click', async () => {
  await navigator.clipboard.writeText(selectedResearchApn).catch(() => {});
  localStorage.setItem(parcelQuestUsageKey(), String(Number(localStorage.getItem(parcelQuestUsageKey()) || 0) + 1));
  document.querySelector('#parcelquest-warning').close();
  window.open(PARCELQUEST_URL, '_blank', 'noopener,noreferrer');
});

Promise.all([
  fetch('data/parcels.json').then(response => { if (!response.ok) throw new Error(`sale data returned ${response.status}`); return response.json(); }),
  fetch('data/generated/apn-index.json').then(response => { if (!response.ok) throw new Error(`parcel index returned ${response.status}`); return response.json(); })
]).then(([sales, index]) => {
  saleData = sales;
  apnIndex = index;
  updateSales();
  document.querySelector('#updated').textContent = `Data refreshed ${new Date(sales.generatedAt).toLocaleString()}`;
}).catch(error => { document.querySelector('#updated').textContent = `Could not load map data: ${error.message}`; });
