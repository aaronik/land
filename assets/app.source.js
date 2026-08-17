'use strict';

import * as maplibregl from './vendor/maplibre/maplibre-gl.mjs';
import mlcontour from 'maplibre-contour';
import { Protocol } from './vendor/pmtiles/pmtiles.js';

const COLORS = { 'private-land': '#42d7a6', 'private-home': '#7653b5', 'public-land': '#ff9d4d', 'public-home': '#b94b18' };
const PARCELQUEST_URL = 'https://assr.parcelquest.com/impl/SISASSR';
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile.bind(protocol));
const contourDemSource = new mlcontour.DemSource({
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  maxzoom: 13,
  worker: true,
  cacheSize: 80,
  timeoutMs: 10000
});
contourDemSource.setupMaplibre(maplibregl);
const assetUrl = path => new URL(path, window.location.href).href;

let saleData;
let apnIndex = {};
let selectedResearchApn = '';
let selectedApn = '';
let terrainEnabled = false;
const TERRAIN_URL_PARAM = 'terrain';
const PARCEL_URL_PARAM = 'parcel';
const initialUrl = new URL(window.location.href);
const initialTerrainEnabled = initialUrl.searchParams.get(TERRAIN_URL_PARAM) === '1';
const initialSelectedApn = initialUrl.searchParams.get(PARCEL_URL_PARAM) || '';
let enabledCategories = new Set(Object.keys(COLORS));
let searchQuery = '';

const map = new maplibregl.Map({
  container: 'map',
  center: [-122.45, 41.45],
  zoom: 8.25,
  maxZoom: 18,
  maxPitch: 90,
  pitch: 0,
  hash: true,
  attributionControl: false,
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
class GoogleStreetViewControl {
  onAdd(controlMap) {
    this.map = controlMap;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl google-maps-control';
    this.container.innerHTML = '<button class="google-maps-button" type="button" aria-label="Open Google Street View at the map center" title="Open Google Street View at the map center"><span aria-hidden="true">◉</span><span>Street View</span></button>';
    this.container.querySelector('button').addEventListener('click', () => {
      const center = this.map.getCenter();
      const url = new URL('https://www.google.com/maps/@');
      url.searchParams.set('api', '1');
      url.searchParams.set('map_action', 'pano');
      url.searchParams.set('viewpoint', `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`);
      url.searchParams.set('heading', String((this.map.getBearing() + 360) % 360));
      window.open(url.href, '_blank', 'noopener,noreferrer');
    });
    return this.container;
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
map.addControl(new GoogleStreetViewControl(), 'top-left');
map.addControl(new CardinalCompassControl(), 'top-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.addControl(new MilesScaleControl(), 'bottom-left');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function money(value) { return value ? `$${Number(value).toLocaleString()}` : ''; }
function compactNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return new Intl.NumberFormat('en-US', { maximumSignificantDigits: 3, useGrouping: false }).format(number).toLowerCase();
}
function markerLabel(properties) {
  const records = Array.isArray(properties.records) ? properties.records : [properties];
  const record = records.find(item => item.kind === 'private' && enabledCategories.has(item.category));
  if (!record) return '';
  const price = Number(record.price);
  const abbreviatedPrice = price >= 1e6 ? `${compactNumber(price / 1e6)}m` : price >= 1e3 ? `${compactNumber(price / 1e3)}k` : compactNumber(price);
  const acres = compactNumber(record.acres);
  return abbreviatedPrice && acres ? `${abbreviatedPrice}/${acres}` : '';
}
function categories(feature) { return new Set((feature.properties.records || []).map(record => record.category)); }
function normalizeSearch(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
function recordMatchesSearch(record, query = searchQuery) {
  if (!query) return true;
  const searchable = [record.title, record.APN, record.mlsNumber, record.item, record.listingSource];
  return normalizeSearch(searchable.filter(Boolean).join(' ')).includes(query);
}
function searchableFeature(feature) {
  if (!searchQuery) return feature;
  const apnMatches = normalizeSearch(feature.properties.APN).includes(searchQuery);
  const records = (feature.properties.records || []).filter(record => apnMatches || recordMatchesSearch(record));
  return records.length ? { ...feature, properties: { ...feature.properties, records } } : null;
}
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
function updateSelectedParcelUrl(apn) {
  const url = new URL(window.location.href);
  if (apn) url.searchParams.set(PARCEL_URL_PARAM, apn);
  else url.searchParams.delete(PARCEL_URL_PARAM);
  window.history.replaceState(window.history.state, '', url);
}
function setSelectedApn(apn, { updateUrl = true } = {}) {
  const nextApn = apn || '';
  if (selectedApn && map.getSource('parcels')) {
    map.removeFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: selectedApn }, 'selected');
  }
  selectedApn = nextApn;
  if (selectedApn && map.getSource('parcels')) {
    map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: selectedApn }, { selected: true });
  }
  if (updateUrl) updateSelectedParcelUrl(selectedApn);
}
function selectParcel(properties) {
  if (!properties?.APN) return;
  setSelectedApn(properties.APN);
  showParcelDetails(properties);
}
let initialParcelRestored = false;
function restoreInitialSelectedParcel() {
  if (initialParcelRestored || !initialSelectedApn || !map.getSource('parcels')) return;
  const item = apnIndex[initialSelectedApn];
  if (!item) return;
  initialParcelRestored = true;
  setSelectedApn(initialSelectedApn, { updateUrl: false });
  showParcelDetails({ APN: initialSelectedApn, Acres: item.acres });
}
function filteredMappedListings() {
  return (saleData?.features || []).map(searchableFeature).filter(feature => feature && visible(feature));
}
function filteredUnmappedListings() {
  return (saleData?.unmappedListings || []).filter(record => enabledCategories.has(record.category) && recordMatchesSearch(record));
}
function saleGeoJson() {
  return {
    type: 'FeatureCollection',
    features: filteredMappedListings().map(feature => ({ ...feature, properties: { ...feature.properties, displayCategory: firstCategory(feature) } }))
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
    features: filteredMappedListings().map(feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: featureCenter(feature) }, properties: { ...feature.properties, displayCategory: firstCategory(feature), markerLabel: markerLabel(feature.properties) } })).filter(feature => feature.geometry.coordinates)
  };
}
function separatedUnmappedListings() {
  const groups = new Map();
  for (const record of filteredUnmappedListings()) {
    const key = record.latLng.map(value => Number(value).toFixed(6)).join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].flatMap(records => records
    .sort((a, b) => String(a.mlsNumber).localeCompare(String(b.mlsNumber)))
    .map((record, index) => ({ record, index, count: records.length })));
}
function separatedCoordinate(latLng, index, count) {
  if (count === 1) return [latLng[1], latLng[0]];
  const angle = -Math.PI / 2 + index * Math.PI * 2 / count;
  const radiusFeet = 100;
  const latitudeFeetPerDegree = 364000;
  const longitudeFeetPerDegree = latitudeFeetPerDegree * Math.cos(latLng[0] * Math.PI / 180);
  return [
    latLng[1] + Math.cos(angle) * radiusFeet / longitudeFeetPerDegree,
    latLng[0] + Math.sin(angle) * radiusFeet / latitudeFeetPerDegree
  ];
}
function unmappedGeoJson() {
  return {
    type: 'FeatureCollection',
    features: separatedUnmappedListings().map(({ record, index, count }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: separatedCoordinate(record.latLng, index, count) },
      properties: { ...record, sharedLocationCount: count, markerLabel: markerLabel(record) }
    }))
  };
}
function updateSales() {
  map.getSource('sales')?.setData(saleGeoJson());
  map.getSource('sale-points')?.setData(salePointGeoJson());
  map.getSource('unmapped')?.setData(unmappedGeoJson());
  const shown = filteredMappedListings();
  const unmapped = filteredUnmappedListings();
  document.querySelector('#visible-count').textContent = shown.length + unmapped.length;
  document.querySelector('#private-count').textContent = shown.filter(f => [...categories(f)].some(c => c.startsWith('private-'))).length + unmapped.filter(r => r.category.startsWith('private-')).length;
  document.querySelector('#public-count').textContent = shown.filter(f => [...categories(f)].some(c => c.startsWith('public-'))).length + unmapped.filter(r => r.category.startsWith('public-')).length;
}
function addPmtilesSource(id) {
  const url = new URL(`data/generated/${id}.pmtiles`, window.location.href);
  url.searchParams.set('v', new URL(import.meta.url).pathname.split('/').pop());
  const attributions = {
    flood: '<a href="https://www.fema.gov/flood-maps/national-flood-hazard-layer" target="_blank">FEMA NFHL</a>',
    soils: '<a href="https://sdmdataaccess.nrcs.usda.gov/" target="_blank">USDA NRCS SSURGO</a>',
    fire_hazard: '<a href="https://osfm.fire.ca.gov/what-we-do/community-wildfire-preparedness-and-mitigation/fire-hazard-severity-zones" target="_blank">CAL FIRE FHSZ</a>',
    railroads: '<a href="https://doi.org/10.21949/1528950" target="_blank">USDOT/FRA North American Rail Network</a>',
    waterways: '<a href="https://www.usgs.gov/national-hydrography/national-hydrography-dataset" target="_blank">USGS National Hydrography Dataset</a>',
    huc12: '<a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset" target="_blank">USGS Watershed Boundary Dataset</a>'
  };
  map.addSource(id, { type: 'vector', url: `pmtiles://${url.href}`, attribution: attributions[id], ...(id === 'parcels' ? { promoteId: 'APN' } : {}) });
}
function toggleLayer(id, visibleValue) {
  const groupedLayers = {
    'topographic-contours': ['topographic-contours', 'topographic-contour-labels'],
    roads: ['roads', 'road-labels'],
    railroads: ['railroad-casing', 'railroads', 'railroad-ties', 'railroad-labels'],
    waterways: ['waterways-casing', 'waterways', 'waterway-labels'],
    huc12: ['huc12-fill', 'huc12-lines', 'huc12-labels']
  };
  const layerIds = groupedLayers[id] || [id];
  for (const layerId of layerIds) if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibleValue ? 'visible' : 'none');
  document.querySelector(`[data-layer-key="${id}"]`)?.classList.toggle('visible', visibleValue);
}
function updateTerrainUrl(enabled) {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.set(TERRAIN_URL_PARAM, '1');
  else url.searchParams.delete(TERRAIN_URL_PARAM);
  window.history.replaceState(window.history.state, '', url);
}
function applyTerrain(enabled, { updateUrl = true, animate = true } = {}) {
  terrainEnabled = enabled;
  map.setTerrain(enabled ? { source: 'terrain', exaggeration: 1.5 } : null);
  if (map.getLayer('terrain-relief')) map.setLayoutProperty('terrain-relief', 'visibility', enabled ? 'visible' : 'none');
  if (animate) map.easeTo({ pitch: enabled ? 60 : 0, bearing: enabled ? -12 : 0, duration: 700 });
  if (updateUrl) updateTerrainUrl(enabled);
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
  addPmtilesSource('flood');
  addPmtilesSource('soils');
  addPmtilesSource('huc12');
  addPmtilesSource('zoning');
  addPmtilesSource('parcels');
  addPmtilesSource('roads');
  addPmtilesSource('railroads');
  addPmtilesSource('waterways');
  map.addSource('sales', { type: 'geojson', data: saleGeoJson() });
  map.addSource('sale-points', { type: 'geojson', data: salePointGeoJson() });
  map.addSource('unmapped', { type: 'geojson', data: unmappedGeoJson() });
  map.addSource('topographic-contours', {
    type: 'vector',
    tiles: [contourDemSource.contourProtocolUrl({
      multiplier: 3.28084,
      thresholds: { 8: [1000, 5000], 10: [500, 2500], 12: [200, 1000], 14: [100, 500], 15: [50, 250] },
      contourLayer: 'contours',
      elevationKey: 'ele',
      levelKey: 'level'
    })],
    maxzoom: 15
  });

  map.addLayer({
    id: 'topographic-contours',
    type: 'line',
    source: 'topographic-contours',
    'source-layer': 'contours',
    minzoom: 8,
    paint: {
      'line-color': '#d9c79c',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.18, 12, 0.28, 16, 0.34],
      'line-width': ['match', ['get', 'level'], 1, 0.85, 0.45]
    }
  });
  map.addLayer({
    id: 'topographic-contour-labels',
    type: 'symbol',
    source: 'topographic-contours',
    'source-layer': 'contours',
    minzoom: 10,
    filter: ['>', ['get', 'level'], 0],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 350,
      'text-field': ['concat', ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }], ' ft'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-letter-spacing': 0.04,
      'text-padding': 5,
      'text-keep-upright': true,
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {
      'text-color': '#fff4d2',
      'text-halo-color': 'rgba(32, 35, 28, 0.92)',
      'text-halo-width': 2,
      'text-halo-blur': 0.4
    }
  });
  map.addLayer({ id: 'public-land', type: 'fill', source: 'public_land', 'source-layer': 'public_land', paint: { 'fill-color': '#4e9f54', 'fill-opacity': 0.38 } });
  map.addLayer({ id: 'huc12-fill', type: 'fill', source: 'huc12', 'source-layer': 'huc12', minzoom: 7, layout: { visibility: 'none' }, paint: { 'fill-color': '#27b8ca', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'huc12-lines', type: 'line', source: 'huc12', 'source-layer': 'huc12', minzoom: 7, layout: { visibility: 'none' }, paint: { 'line-color': '#44d7e8', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 2.2] } });
  map.addLayer({
    id: 'huc12-labels', type: 'symbol', source: 'huc12', 'source-layer': 'huc12', minzoom: 9,
    layout: { visibility: 'none', 'text-field': ['concat', ['coalesce', ['get', 'name'], 'Unnamed subwatershed'], '\nHUC ', ['get', 'huc12']], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12], 'text-max-width': 16, 'text-padding': 8 },
    paint: { 'text-color': '#d9fbff', 'text-halo-color': 'rgba(15, 37, 39, 0.92)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({ id: 'soils', type: 'fill', source: 'soils', 'source-layer': 'soils', minzoom: 9, layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'drclassdcd'], 'Very poorly drained', '#4f78a8', 'Poorly drained', '#6b94b7', 'Somewhat poorly drained', '#87adbf', 'Moderately well drained', '#b9a46b', 'Well drained', '#a97a45', 'Somewhat excessively drained', '#c48d54', 'Excessively drained', '#d5a767', '#9b8064'], 'fill-opacity': 0.34, 'fill-outline-color': 'rgba(69, 45, 25, 0.7)' } });
  map.addLayer({ id: 'flood', type: 'fill', source: 'flood', 'source-layer': 'flood', layout: { visibility: 'none' }, paint: { 'fill-color': ['case', ['==', ['get', 'SFHA_TF'], 'T'], '#00c5ff', ['all', ['==', ['get', 'FLD_ZONE'], 'X'], ['match', ['get', 'ZONE_SUBTY'], '0.2 PCT ANNUAL CHANCE FLOOD HAZARD', true, '0.2 PERCENT ANNUAL CHANCE FLOOD HAZARD', true, false]], '#75d5ec', ['==', ['get', 'FLD_ZONE'], 'D'], '#e8d15c', '#3db7de'], 'fill-opacity': 0.38, 'fill-outline-color': 'rgba(0, 104, 160, 0.8)' } });
  map.addLayer({ id: 'fire-hazard', type: 'fill', source: 'fire_hazard', 'source-layer': 'fire_hazard', layout: { visibility: 'none' }, paint: { 'fill-color': ['match', ['get', 'HAZ_CLASS'], 'Very High', '#d73027', 'High', '#fc8d59', 'Moderate', '#fee08b', '#f5a623'], 'fill-opacity': 0.3 } });
  map.addLayer({ id: 'zoning', type: 'line', source: 'zoning', 'source-layer': 'zoning', layout: { visibility: 'none' }, paint: { 'line-color': '#64c7ff', 'line-width': 1.4, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcels', 'source-layer': 'parcels', minzoom: 8, paint: { 'fill-color': '#fff', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.01, 13, 0.045] } });
  map.addLayer({ id: 'parcel-lines', type: 'line', source: 'parcels', 'source-layer': 'parcels', minzoom: 8, paint: { 'line-color': '#aeb4b7', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 13, 0.85], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 15, 1.8] } });
  map.addLayer({
    id: 'waterways-casing', type: 'line', source: 'waterways', 'source-layer': 'waterways', minzoom: 7,
    paint: { 'line-color': 'rgba(6, 31, 58, 0.78)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.3, 14, 5.2], 'line-opacity': 0.85 }
  });
  map.addLayer({
    id: 'waterways', type: 'line', source: 'waterways', 'source-layer': 'waterways', minzoom: 7,
    paint: {
      'line-color': '#38a8ff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, ['match', ['get', 'fcode'], 46006, 1.4, 0.8], 14, ['match', ['get', 'fcode'], 46006, 3.2, 1.8]],
      'line-opacity': ['match', ['get', 'fcode'], 46007, 0.6, 0.95],
      'line-dasharray': ['match', ['get', 'fcode'], 46003, ['literal', [3, 2]], 46007, ['literal', [1.5, 2]], ['literal', [1, 0]]]
    }
  });
  map.addLayer({
    id: 'waterway-labels', type: 'symbol', source: 'waterways', 'source-layer': 'waterways', minzoom: 10,
    filter: ['all', ['has', 'gnis_name'], ['!=', ['get', 'gnis_name'], '']],
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'gnis_name'],
      'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-letter-spacing': 0.03, 'text-offset': [0, 1], 'text-padding': 4, 'text-keep-upright': true
    },
    paint: { 'text-color': '#78c6ff', 'text-halo-color': 'rgba(6, 24, 43, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({ id: 'roads', type: 'line', source: 'roads', 'source-layer': 'roads', minzoom: 9, paint: { 'line-color': '#f8d37c', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 15, 3], 'line-opacity': 0.9 } });
  map.addLayer({
    id: 'road-labels',
    type: 'symbol',
    source: 'roads',
    'source-layer': 'roads',
    minzoom: 11,
    filter: ['all', ['has', 'ROADNAME'], ['!=', ['get', 'ROADNAME'], '']],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 300,
      'text-field': ['get', 'ROADNAME'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 15, 13],
      'text-letter-spacing': 0.02,
      'text-max-angle': 35,
      'text-padding': 3,
      'text-keep-upright': true
    },
    paint: {
      'text-color': '#fff7dc',
      'text-halo-color': 'rgba(35, 31, 21, 0.92)',
      'text-halo-width': 2,
      'text-halo-blur': 0.4
    }
  });
  map.addLayer({
    id: 'railroad-casing', type: 'line', source: 'railroads', 'source-layer': 'railroads', minzoom: 7,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': 'rgba(255, 255, 255, 0.9)', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2.8, 14, 6.5] }
  });
  map.addLayer({
    id: 'railroads', type: 'line', source: 'railroads', 'source-layer': 'railroads', minzoom: 7,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#e53935', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 14, 3.5] }
  });
  map.addLayer({
    id: 'railroad-ties', type: 'line', source: 'railroads', 'source-layer': 'railroads', minzoom: 10,
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': '#681616', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.4, 14, 2.2], 'line-dasharray': [0.5, 2.5] }
  });
  map.addLayer({
    id: 'railroad-labels', type: 'symbol', source: 'railroads', 'source-layer': 'railroads', minzoom: 10,
    filter: ['any', ['has', 'SUBDIV'], ['has', 'BRANCH'], ['has', 'RROWNER1']],
    layout: {
      'symbol-placement': 'line', 'symbol-spacing': 500,
      'text-field': ['coalesce', ['get', 'SUBDIV'], ['get', 'BRANCH'], ['get', 'RROWNER1']],
      'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12],
      'text-letter-spacing': 0.04, 'text-offset': [0, 1.1], 'text-padding': 4, 'text-keep-upright': true
    },
    paint: { 'text-color': '#ff6b67', 'text-halo-color': 'rgba(25, 16, 16, 0.95)', 'text-halo-width': 2, 'text-halo-blur': 0.4 }
  });
  map.addLayer({ id: 'sale-fill', type: 'fill', source: 'sales', paint: { 'fill-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'fill-opacity': 0.42 } });
  map.addLayer({ id: 'sale-lines', type: 'line', source: 'sales', paint: { 'line-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'line-width': 3 } });
  map.addLayer({ id: 'sale-markers', type: 'circle', source: 'sale-points', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'displayCategory'], 'private-land', COLORS['private-land'], 'private-home', COLORS['private-home'], 'public-land', COLORS['public-land'], COLORS['public-home']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.95, 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'sale-marker-labels', type: 'symbol', source: 'sale-points', filter: ['!=', ['get', 'markerLabel'], ''], layout: { 'text-field': ['get', 'markerLabel'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-padding': 3, 'text-pitch-alignment': 'viewport' }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(20, 25, 22, 0.9)', 'text-halo-width': 2, 'text-halo-blur': 0.4 } });
  map.addLayer({ id: 'parcel-selected', type: 'line', source: 'parcels', 'source-layer': 'parcels', paint: { 'line-color': '#fff', 'line-width': 5, 'line-blur': 0.3, 'line-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 1, 0] } });
  map.addLayer({ id: 'unmapped-markers', type: 'circle', source: 'unmapped', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5, 12, 8], 'circle-color': ['match', ['get', 'category'], 'private-home', COLORS['private-home'], COLORS['private-land']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.9, 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'unmapped-marker-labels', type: 'symbol', source: 'unmapped', filter: ['!=', ['get', 'markerLabel'], ''], layout: { 'text-field': ['get', 'markerLabel'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, -1.35], 'text-anchor': 'bottom', 'text-padding': 3, 'text-pitch-alignment': 'viewport' }, paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(20, 25, 22, 0.9)', 'text-halo-width': 2, 'text-halo-blur': 0.4 } });

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
      selectParcel({ ...props, records });
      return;
    }
    selectParcel(props);
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
  restoreInitialSelectedParcel();
  document.body.classList.add('map-ready');
  } catch (error) {
    layersInitialized = false;
    document.querySelector('#updated').textContent = `Could not initialize map layers: ${error.message}`;
    console.error(error);
  }
}
map.once('style.load', () => {
  initializeMapLayers();
  if (initialTerrainEnabled) applyTerrain(true, { updateUrl: false, animate: false });
});

function fitSearchResults(mapped, unmapped) {
  const points = [
    ...mapped.map(featureCenter),
    ...unmapped.map(record => [record.latLng?.[1], record.latLng?.[0]])
  ].filter(point => point?.every(Number.isFinite));
  if (!points.length) return;
  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: 15 });
    return;
  }
  const bounds = points.reduce((value, point) => value.extend(point), new maplibregl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: 90, maxZoom: 15 });
}
function findListings() {
  const input = document.querySelector('#search').value.trim();
  const normalized = normalizeSearch(input);
  const compact = normalized.replaceAll(' ', '');
  const apn = Object.keys(apnIndex).find(key => normalizeSearch(key).replaceAll(' ', '') === compact);
  if (input && apn) {
    searchQuery = '';
    updateSales();
    const item = apnIndex[apn];
    setSelectedApn(apn);
    map.fitBounds([[item.bbox[0], item.bbox[1]], [item.bbox[2], item.bbox[3]]], { padding: 90, maxZoom: 16 });
    showParcelDetails({ APN: apn, Acres: item.acres });
    return;
  }

  searchQuery = normalized;
  updateSales();
  const mapped = filteredMappedListings();
  const unmapped = filteredUnmappedListings();
  const count = mapped.length + unmapped.length;
  if (!input) {
    document.querySelector('#details').innerHTML = '<h3>No parcel selected</h3><p class="meta">Showing all listings and auctions.</p>';
  } else if (!count) {
    document.querySelector('#details').innerHTML = `<p class="muted">No listing matched “${escapeHtml(input)}”.</p>`;
  } else {
    document.querySelector('#details').innerHTML = `<h3>${count} matching ${count === 1 ? 'listing' : 'listings'}</h3><p class="meta">Showing results containing “${escapeHtml(input)}”. Clear the search to show everything.</p>`;
    fitSearchResults(mapped, unmapped);
  }
}

document.querySelector('#terrain-toggle').addEventListener('click', () => toggleTerrain());
document.querySelector('#search-button').addEventListener('click', findListings);
document.querySelector('#search').addEventListener('keydown', event => { if (event.key === 'Enter') findListings(); });
document.querySelector('#search').addEventListener('search', findListings);
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
  restoreInitialSelectedParcel();
  document.querySelector('#updated').textContent = `Data refreshed ${new Date(sales.generatedAt).toLocaleString()}`;
}).catch(error => { document.querySelector('#updated').textContent = `Could not load map data: ${error.message}`; });
