'use strict';

import * as maplibregl from './vendor/maplibre/maplibre-gl.mjs';
import mlcontour from 'maplibre-contour';
import { Protocol } from './vendor/pmtiles/pmtiles.js';
import { installMapControls } from './map/controls.js';
import { createListingData } from './data/listings.js';
import { createParcelDetails } from './ui/parcel-details.js';
import { installMapSourcesAndLayers } from './map/layers.js';
import { createSearchController, initializeMobileSheet } from './state/ui.js';
import { updateUrlParameter } from './state/url.js';

const COLORS = { 'private-land': '#42d7a6', 'private-home': '#7653b5', 'public-land': '#ff9d4d', 'public-home': '#b94b18' };
// Colors follow the unique-value renderer saved on Siskiyou County's official
// zoning layer. MapLibre cannot reproduce every ArcGIS hatch, so buffered
// variants retain their official zoning-family color.
const ZONING_FILL_COLOR = ['match', ['get', 'zoning'],
  ['AG-1', 'AG-1-B-40', 'AG-1-B-80'], '#38a800',
  ['AG-2', 'AG-2-B-20', 'AG-2-B-40', 'AG-2-B-80'], '#b4d79e',
  'C-C', '#ff0000', 'C-C-B-10', '#e60000', 'C-C-B-2.5', '#ff9b9b',
  'C-H', '#ffa77f', ['C-R', 'C-U'], '#ff7f7f',
  ['C-R-B-10', 'C-U-B-2.5'], '#e60000', 'C-R-B-80', '#e64c00',
  ['M-L', 'M-L-B-40'], '#e8beff',
  ['M-M', 'M-M-B-2.5', 'M-M-B-5', 'M-M-B-10'], '#aa66cd',
  'M-H', '#8400a8', 'O', '#7af5ca',
  'PD', '#d0d0d0', 'PD (C-U)', '#ff7f7f', 'PD (M-M)', '#df73ff',
  'PD (Ski Park)', '#73b2ff', 'PD (Chalets)', '#ffaa00', 'PD (MH)', '#c500ff',
  'PD (R-R)', '#ffffbe', 'PD (R-R-B-1)', '#ffff32',
  ['PD (RES-1)', 'PD (RES-1-B-5)'], '#fff000',
  'PD (RES-3)', '#ffc800', 'PD (RES-4)', '#ff9600', 'PD (Sw Ponds)', '#bee8ff',
  ['R-R', 'R-R-B-1', 'R-R-B-2.5', 'R-R-B-10', 'R-R-B-20', 'R-R-B-40', 'R-R-B-80', 'R-R-B-160'], '#ffff8c',
  'R-R-B-5', '#ffffbe',
  ['R-R-MH', 'R-R-MH-B-1', 'R-R-MH-B-2.5', 'R-R-MH-B-5', 'R-R-MH-B-10', 'R-R-MH-B-20', 'R-R-MH-B-40'], '#cdaa66',
  'RES-1', '#fff000', 'RES-2', '#ffdc00',
  ['RES-3', 'RES-3-B-2.5', 'RES-3-B-5', 'RES-3-B-20'], '#ffc800',
  ['RES-4', 'RES-4-B-2.5'], '#ff9600',
  ['TP', 'TP-B-80'], '#267300', ['Incorporated', 'Incorporated ROW'], '#e1e1e1',
  'WETLANDS', '#4065eb', 'transparent'
];
const PARCELQUEST_URL = 'https://assr.parcelquest.com/impl/SISASSR';
const DIRECTIONS_ORIGIN = 'Mt. Shasta City Park, 1315 Nixon Road, Mount Shasta, CA 96067';
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
const MAX_SAFE_TERRAIN_PITCH = 85;
const TERRAIN_RECOVERY_PITCH = 78;
const initialUrl = new URL(window.location.href);
const initialTerrainEnabled = initialUrl.searchParams.get(TERRAIN_URL_PARAM) === '1';
const initialSelectedApn = initialUrl.searchParams.get(PARCEL_URL_PARAM) || '';
let enabledCategories = new Set(Object.keys(COLORS));
let searchQuery = '';
let minimumAcreage = 0;
let maximumAcreage = 0;
let listedSince = '';
let listedBefore = '';

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

const mapHelpDialog = document.querySelector('#map-controls-help');
const mapHelpControl = {
  onAdd() {
    const container = document.createElement('div');
    container.className = 'maplibregl-ctrl maplibregl-ctrl-group map-help-control';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'How to control the map');
    button.title = 'How to control the map';
    button.textContent = '?';
    button.addEventListener('click', () => mapHelpDialog.showModal());
    container.appendChild(button);
    return container;
  },
  onRemove() {}
};
map.addControl(mapHelpControl, 'bottom-right');
document.querySelector('#map-controls-help .dialog-close').addEventListener('click', () => mapHelpDialog.close());

// MapLibre's built-in control tracks position but does not render a compass
// heading. Add a cone behind its location dot when the device exposes one.
const headingElement = document.createElement('div');
headingElement.className = 'user-heading-cone';
headingElement.setAttribute('aria-hidden', 'true');
const headingMarker = new maplibregl.Marker({
  element: headingElement,
  anchor: 'center',
  rotationAlignment: 'viewport'
});
let userLocation;
let deviceHeading;

function normalizeHeading(heading) {
  return Number.isFinite(heading) ? (heading % 360 + 360) % 360 : null;
}

function updateUserHeading() {
  if (!userLocation || !Number.isFinite(deviceHeading)) return;
  headingMarker
    .setLngLat(userLocation)
    // Device heading is relative to north; the map may be rotated.
    .setRotation(deviceHeading - map.getBearing())
    .addTo(map);
}

geolocateControl.on('geolocate', position => {
  userLocation = [position.coords.longitude, position.coords.latitude];
  // GPS heading is especially useful while moving and needs no motion-sensor
  // permission. A compass reading, when available, takes precedence below.
  const gpsHeading = normalizeHeading(position.coords.heading);
  if (gpsHeading !== null) deviceHeading = gpsHeading;
  updateUserHeading();
});

function deviceCompassHeading(event) {
  // iOS provides a magnetic-north compass value directly. Other browsers
  // expose alpha as a clockwise device rotation, so invert it to get heading.
  if (Number.isFinite(event.webkitCompassHeading)) return event.webkitCompassHeading;
  if (!Number.isFinite(event.alpha)) return null;
  const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
  return (360 - event.alpha + screenAngle) % 360;
}

function startDeviceHeading() {
  if (startDeviceHeading.started || typeof window.DeviceOrientationEvent === 'undefined') return;
  startDeviceHeading.started = true;
  window.addEventListener('deviceorientationabsolute', onDeviceOrientation, true);
  window.addEventListener('deviceorientation', onDeviceOrientation, true);
}

function onDeviceOrientation(event) {
  const heading = deviceCompassHeading(event);
  if (heading === null) return;
  deviceHeading = heading;
  updateUserHeading();
}

// iOS requires this permission request to happen in the location-button tap.
const geolocateButton = geolocateControl._geolocateButton;
geolocateButton?.addEventListener('click', () => {
  const requestPermission = window.DeviceOrientationEvent?.requestPermission;
  if (typeof requestPermission === 'function') {
    requestPermission.call(window.DeviceOrientationEvent)
      .then(permission => { if (permission === 'granted') startDeviceHeading(); })
      .catch(() => {});
  } else {
    startDeviceHeading();
  }
});
const distanceMeasureControl = installMapControls(map, maplibregl);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function money(value) { return value ? `$${Number(value).toLocaleString()}` : ''; }
const listingData = createListingData(() => ({ saleData, enabledCategories, searchQuery, minimumAcreage, maximumAcreage, listedSince, listedBefore }));
const { categories, featureCenter, filteredMappedListings, filteredUnmappedListings, normalizeSearch, saleGeoJson, salePointGeoJson, unmappedGeoJson } = listingData;

function parcelQuestUsageKey() { return `shasta-land-parcelquest:${new Date().toISOString().slice(0, 7)}`; }
const parcelDetails = createParcelDetails({
  detailsElement: document.querySelector('#details'),
  directionsOrigin: DIRECTIONS_ORIGIN,
  featureCenter,
  getApnIndex: () => apnIndex,
  getSaleData: () => saleData,
  onParcelQuest: apn => { selectedResearchApn = apn; document.querySelector('#parcelquest-warning').showModal(); },
  onSaveResearch: apn => showParcelDetails({ APN: apn })
});
const { recordCard, showParcelDetails } = parcelDetails;

function updateSelectedParcelUrl(apn) { updateUrlParameter(PARCEL_URL_PARAM, apn); }
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
    springs: '<a href="https://www.usgs.gov/national-hydrography/national-hydrography-dataset" target="_blank">USGS National Hydrography Dataset</a>',
    geology: '<a href="https://mrdata.usgs.gov/geology/state/" target="_blank">USGS State Geologic Map Compilation</a>',
    huc12: '<a href="https://www.usgs.gov/national-hydrography/watershed-boundary-dataset" target="_blank">USGS Watershed Boundary Dataset</a>',
    groundwater_basins: '<a href="https://data.cnra.ca.gov/dataset/i08-b118-ca-groundwaterbasins" target="_blank">CA DWR Bulletin 118 groundwater basins</a>',
    groundwater_wells: '<a href="https://data.cnra.ca.gov/dataset/well-completion-reports" target="_blank">CA DWR Well Completion Reports</a>',
    zoning: '<a href="https://open-data-siskiyou.hub.arcgis.com/" target="_blank">Siskiyou County GIS</a>'
  };
  map.addSource(id, { type: 'vector', url: `pmtiles://${url.href}`, attribution: attributions[id], ...(id === 'parcels' ? { promoteId: 'APN' } : {}) });
}
const MAP_LAYER_STORAGE_KEY = 'shasta-land-atlas.map-layer-visibility.v1';
const mapLayerInputs = [...document.querySelectorAll('[data-map-layer]')];
const defaultMapLayerVisibility = Object.fromEntries(mapLayerInputs.map(input => [input.dataset.mapLayer, input.defaultChecked]));
function loadMapLayerVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(MAP_LAYER_STORAGE_KEY));
    if (!saved || typeof saved !== 'object') return;
    for (const input of mapLayerInputs) if (typeof saved[input.dataset.mapLayer] === 'boolean') input.checked = saved[input.dataset.mapLayer];
  } catch { /* Use markup defaults when storage is unavailable or malformed. */ }
}
function saveMapLayerVisibility() {
  try { localStorage.setItem(MAP_LAYER_STORAGE_KEY, JSON.stringify(Object.fromEntries(mapLayerInputs.map(input => [input.dataset.mapLayer, input.checked])))); } catch { /* Storage may be disabled. */ }
}
function applyMapLayerVisibility() {
  for (const input of mapLayerInputs) toggleLayer(input.dataset.mapLayer, input.checked);
}
loadMapLayerVisibility();

function toggleLayer(id, visibleValue) {
  const groupedLayers = {
    'topographic-contours': ['topographic-contours', 'topographic-contour-labels'],
    roads: ['roads', 'road-labels'],
    railroads: ['railroad-casing', 'railroads', 'railroad-ties', 'railroad-labels'],
    waterways: ['waterways-casing', 'waterways', 'waterway-labels', 'springs'],
    huc12: ['huc12-fill', 'huc12-lines', 'huc12-labels'],
    'groundwater-basins': ['groundwater-basins-fill', 'groundwater-basins-lines', 'groundwater-basins-labels'],
    zoning: ['zoning-fill', 'zoning-lines']
  };
  const layerIds = groupedLayers[id] || [id];
  for (const layerId of layerIds) if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', visibleValue ? 'visible' : 'none');
  document.querySelector(`[data-layer-key="${id}"]`)?.classList.toggle('visible', visibleValue);
}
function updateTerrainUrl(enabled) { updateUrlParameter(TERRAIN_URL_PARAM, enabled ? '1' : ''); }
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

// Near 90°, the camera can cross steep terrain while zooming or panning. Once
// an interaction settles, ease back to a useful above-ground viewing angle.
let recoveringTerrainCamera = false;
map.on('moveend', () => {
  if (!terrainEnabled || recoveringTerrainCamera || map.getPitch() <= MAX_SAFE_TERRAIN_PITCH) return;
  recoveringTerrainCamera = true;
  map.easeTo({ pitch: TERRAIN_RECOVERY_PITCH, duration: 350 });
  map.once('moveend', () => { recoveringTerrainCamera = false; });
});

initializeMobileSheet();

let layersInitialized = false;
function initializeMapLayers() {
  if (layersInitialized || !map.getStyle()) return;
  layersInitialized = true;
  try {
    installMapSourcesAndLayers({ map, addPmtilesSource, COLORS, ZONING_FILL_COLOR, contourDemSource, saleGeoJson, salePointGeoJson, unmappedGeoJson });
  map.on('click', event => {
    if (distanceMeasureControl.isActive()) return;
    const radius = 9;
    const markerHits = map.queryRenderedFeatures([
      [event.point.x - radius, event.point.y - radius],
      [event.point.x + radius, event.point.y + radius]
    ], { layers: ['springs', 'groundwater-wells', 'unmapped-markers', 'sale-markers'] });
    const polygonHits = map.queryRenderedFeatures(event.point, { layers: ['sale-fill', 'parcel-fill', 'geology'] });
    const feature = markerHits[0] || polygonHits[0];
    if (!feature) return;
    const props = feature.properties || {};
    if (feature.layer.id === 'geology') {
      const detail = value => value ? `<p>${escapeHtml(value)}</p>` : '';
      document.querySelector('#details').innerHTML = `<h3>Surface geology</h3><p class="meta">${escapeHtml(props.material_class || 'Mapped geologic unit')}</p><p><strong>${escapeHtml(props.unit_name || props.sgmc_label || props.orig_label || 'Not labeled')}</strong>${props.unit_age ? `<br>${escapeHtml(props.unit_age)}` : ''}${props.lithology ? `<br>Major lithology: ${escapeHtml(props.lithology)}` : ''}</p>${detail(props.unit_description)}<p class="source-note">Generalized statewide geologic mapping for context only. It does not establish groundwater depth, yield, quality, fractures, or drilling conditions at this site.</p>`;
      return;
    }
    if (feature.layer.id === 'springs') {
      const [longitude, latitude] = feature.geometry?.coordinates || [];
      const coordinates = Number.isFinite(longitude) && Number.isFinite(latitude) ? ` (${longitude.toFixed(5)}, ${latitude.toFixed(5)})` : '';
      document.querySelector('#details').innerHTML = `<h3>Mapped spring</h3><p class="meta">${escapeHtml(props.GNIS_NAME || 'Unnamed NHD spring')}${coordinates}</p><p class="source-note">USGS National Hydrography Dataset mapped spring location. This does not establish current flow, water quality, public access, or water rights.</p>`;
      return;
    }
    if (feature.layer.id === 'groundwater-wells') {
      const value = value => value === null || value === undefined || value === '' ? 'Not reported' : escapeHtml(value);
      const completedDepth = props.TotalCompletedDepth || props.TotalDrillDepth;
      const originalRecord = props.WCRLinks ? `<p><a href="${escapeHtml(props.WCRLinks)}" target="_blank" rel="noopener">View original DWR report ↗</a></p>` : '';
      const range = (low, high, unit) => low === null || low === undefined ? 'Not reported' : `${value(low)}${low === high ? '' : `–${value(high)}`} ${unit}`;
      const nearby = `<section class="sales-history"><h4>Approximate 1-mile report summary</h4><p>${value(props.NearbyReportCount)} mapped reports · median completed depth ${range(props.NearbyMedianDepthFt, props.NearbyMedianDepthFt, 'ft')}</p><p>Reported static level: ${range(props.NearbyStaticLevelMinFt, props.NearbyStaticLevelMaxFt, 'ft')}<br>Reported yield: ${range(props.NearbyYieldMinGpm, props.NearbyYieldMaxGpm, 'GPM')}<br>Newest completed report: ${value(props.NearbyNewestDate)}</p></section>`;
      document.querySelector('#details').innerHTML = `<h3>Reported well completion</h3><p class="meta">DWR report ${value(props.WCRNumber)} · ${value(props.RecordType)}</p><p><strong>Completed depth: ${value(completedDepth)} ft</strong><br>Static water level: ${value(props.StaticWaterLevel)} ft<br>Reported yield: ${value(props.WellYield)}${props.WellYield ? ` ${value(props.WellYieldUnitofMeasure)}` : ''}<br>Use: ${value(props.PlannedUseFormerUse)}</p>${nearby}<p class="source-note">Reported completion data, not a current water-level reading or a parcel-specific prediction. DWR notes that most locations are mapped to the center of a one-mile PLSS section; verify the original report.</p>${originalRecord}`;
      return;
    }
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
  for (const id of ['geology', 'springs', 'groundwater-wells', 'parcel-fill', 'sale-fill', 'sale-markers', 'unmapped-markers']) {
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
  applyMapLayerVisibility();
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

const findListings = createSearchController({
  map, maplibregl, detailsElement: document.querySelector('#details'), featureCenter,
  filteredMappedListings, filteredUnmappedListings, normalizeSearch, getApnIndex: () => apnIndex,
  setSearchQuery: value => { searchQuery = value; }, updateSales,
  selectApn: apn => setSelectedApn(apn), showParcelDetails
});

document.querySelector('#terrain-toggle').addEventListener('click', () => toggleTerrain());
document.querySelector('#search-button').addEventListener('click', findListings);
document.querySelector('#search').addEventListener('keydown', event => { if (event.key === 'Enter') findListings(); });
document.querySelector('#search').addEventListener('search', findListings);
document.querySelectorAll('.filter').forEach(input => input.addEventListener('change', () => { enabledCategories = new Set([...document.querySelectorAll('.filter:checked')].map(item => item.value)); updateSales(); }));
const minimumAcreageInput = document.querySelector('#minimum-acreage');
const maximumAcreageInput = document.querySelector('#maximum-acreage');
function updateAcreageFilter() {
  minimumAcreage = Number(minimumAcreageInput.value) || 0;
  const maximumValue = Number(maximumAcreageInput.value) || 0;
  maximumAcreage = maximumValue === Number(maximumAcreageInput.max) ? 0 : maximumValue;
  if (maximumAcreage && minimumAcreage > maximumAcreage) {
    if (document.activeElement === minimumAcreageInput) maximumAcreageInput.value = minimumAcreage;
    else minimumAcreageInput.value = maximumAcreage;
    minimumAcreage = Number(minimumAcreageInput.value) || 0;
    const adjustedMaximum = Number(maximumAcreageInput.value) || 0;
    maximumAcreage = adjustedMaximum === Number(maximumAcreageInput.max) ? 0 : adjustedMaximum;
  }
  const minimumLabel = minimumAcreage ? `${minimumAcreage.toLocaleString()}+ acres` : 'Any size';
  const maximumLabel = maximumAcreage && maximumAcreage < Number(maximumAcreageInput.max) ? `${maximumAcreage.toLocaleString()} acres` : 'Any size';
  document.querySelector('#minimum-acreage-value').textContent = minimumLabel;
  document.querySelector('#maximum-acreage-value').textContent = maximumLabel;
  minimumAcreageInput.setAttribute('aria-valuetext', minimumLabel);
  maximumAcreageInput.setAttribute('aria-valuetext', maximumLabel);
  updateSales();
}
minimumAcreageInput.addEventListener('input', updateAcreageFilter);
maximumAcreageInput.addEventListener('input', updateAcreageFilter);
const listedSinceInput = document.querySelector('#listed-since');
const listedBeforeInput = document.querySelector('#listed-before');
function updateListingDateFilter() {
  listedSince = listedSinceInput.value;
  listedBefore = listedBeforeInput.value;
  if (listedSince && listedBefore && listedSince > listedBefore) {
    if (document.activeElement === listedSinceInput) listedBeforeInput.value = listedSince;
    else listedSinceInput.value = listedBefore;
    listedSince = listedSinceInput.value;
    listedBefore = listedBeforeInput.value;
  }
  updateSales();
}
listedSinceInput.addEventListener('change', updateListingDateFilter);
listedBeforeInput.addEventListener('change', updateListingDateFilter);
mapLayerInputs.forEach(input => input.addEventListener('change', () => {
  toggleLayer(input.dataset.mapLayer, input.checked);
  saveMapLayerVisibility();
}));
document.querySelector('#reset-map-layers').addEventListener('click', () => {
  for (const input of mapLayerInputs) input.checked = defaultMapLayerVisibility[input.dataset.mapLayer];
  try { localStorage.removeItem(MAP_LAYER_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
  applyMapLayerVisibility();
});
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
