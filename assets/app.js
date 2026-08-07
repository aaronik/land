'use strict';

const COLORS = { 'private-land': '#42d7a6', 'private-home': '#7653b5', 'public-land': '#ff9d4d', 'public-home': '#b94b18' };
const map = L.map('map', { zoomControl: false }).setView([41.45, -122.45], 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);

const GoogleMapsControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control google-maps-control');
    const button = L.DomUtil.create('button', 'google-maps-button', container);
    button.type = 'button';
    button.setAttribute('aria-label', 'Open this view in Google Maps satellite');
    button.title = 'Open this view in Google Maps satellite';
    button.innerHTML = '<span aria-hidden="true">↗</span><span>Google Maps</span>';
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(button, 'click', () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const url = `https://www.google.com/maps/@${center.lat.toFixed(6)},${center.lng.toFixed(6)},${zoom}z/data=!3m1!1e3`;
      window.open(url, '_blank', 'noopener');
    });
    return container;
  }
});
new GoogleMapsControl().addTo(map);

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Imagery © Esri · Parcel data © Siskiyou County', maxNativeZoom: 19, maxZoom: 22
}).addTo(map);

let data;
let selectedLayer = null;
let enabledCategories = new Set(['private-land', 'private-home', 'public-land', 'public-home']);
const layers = new Map();
const parcelGroup = L.featureGroup().addTo(map);
const unmappedGroup = L.featureGroup().addTo(map);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function money(value) { return value ? `$${Number(value).toLocaleString()}` : ''; }
function categories(feature) { return new Set((feature.properties.records || []).map(record => record.category)); }
function category(feature) {
  const available = [...categories(feature)].filter(value => enabledCategories.has(value));
  return available[0] || [...categories(feature)][0];
}
function visible(feature) { return [...categories(feature)].some(value => enabledCategories.has(value)); }
function style(feature) {
  const color = COLORS[category(feature)] || '#42d7a6';
  return { color, weight: 3, opacity: .95, fillColor: color, fillOpacity: .2 };
}
function parcelDestination(feature) {
  const records = feature.properties.records || [];
  const privateRecord = records.find(record => record.kind === 'private' && record.url);
  if (privateRecord) return privateRecord.url;
  // GovAuctions' public search is the best available listing-details search
  // when the county PDF does not expose a per-parcel auction URL.
  return `https://govauctions.app/feed?q=${encodeURIComponent(feature.properties.APN)}&category=real-estate`;
}
function summary(feature) {
  const p = feature.properties;
  const records = p.records || [];
  const privateRecord = records.find(record => record.kind === 'private');
  const publicRecord = records.find(record => record.kind === 'public');
  const rows = [
    ['APN', p.APN],
    ['GIS acres', p.Acres || privateRecord?.acres || '—'],
    ['Land use', p.LandUse1 || '—'],
    ['Township / range', [p.Township, p.Range].filter(Boolean).join(' / ') || '—'],
    ['Section', p.Section || '—'],
  ];
  if (privateRecord) {
    rows.push(['Listing', privateRecord.title || 'Private land listing']);
    rows.push(['Price', money(privateRecord.price) || '—']);
    rows.push(['Listing acres', privateRecord.acres || '—']);
    if (privateRecord.category === 'private-home') {
      rows.push(['Home', [privateRecord.beds && `${privateRecord.beds} bd`, privateRecord.baths && `${privateRecord.baths} ba`].filter(Boolean).join(' · ') || '—']);
      rows.push(['Interior', privateRecord.sqft ? `${Number(privateRecord.sqft).toLocaleString()} sq ft` : '—']);
      rows.push(['Built', privateRecord.yearBuilt || '—']);
    }
    rows.push(['Price / acre', privateRecord.price && privateRecord.acres ? money(Math.round(privateRecord.price / privateRecord.acres)) : '—']);
    rows.push(['Status', privateRecord.status || '—']);
    rows.push(['Listed', privateRecord.listingDate || '—']);
  }
  if (publicRecord) {
    rows.push(['Auction', publicRecord.source || 'County tax sale']);
    rows.push(['Minimum bid', publicRecord.minimumBid || '—']);
    rows.push(['Status', publicRecord.status || '—']);
    rows.push(['Auction ends', publicRecord.auctionEnd || '—']);
  }
  return `<div class="parcel-tooltip"><strong>${escapeHtml(p.APN)}</strong>${rows.map(([label, value]) => `<span><b>${escapeHtml(label)}</b>${escapeHtml(value)}</span>`).join('')}</div>`;
}
function recordCard(record) {
  if (record.kind === 'private') {
    const home = record.category === 'private-home';
    const homeDetails = home ? ` · ${[record.beds && `${record.beds} bd`, record.baths && `${record.baths} ba`, record.sqft && `${Number(record.sqft).toLocaleString()} sq ft`, record.yearBuilt && `built ${record.yearBuilt}`].filter(Boolean).join(' · ')}` : '';
    return `<article class="record ${home ? 'home' : ''}"><strong>${home ? 'Private home' : 'Private land'}</strong><p>${escapeHtml(record.title)}</p><p>${money(record.price)} · ${escapeHtml(record.acres || '—')} acres${escapeHtml(homeDetails)} · ${escapeHtml(record.status)}</p><a href="${escapeHtml(record.url)}" target="_blank" rel="noopener">Open listing ↗</a></article>`;
  }
  const bid = record.minimumBid || 'No parsed minimum';
  return `<article class="record public"><strong>Public auction record</strong><p>${escapeHtml(bid)} · ${escapeHtml(record.status || 'Unknown status')}${record.auctionEnd ? ` · ended ${escapeHtml(record.auctionEnd)}` : ''}</p><p>${escapeHtml(record.source || '')}</p><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener">Source PDF ↗</a></article>`;
}
function showDetails(feature) {
  const p = feature.properties;
  document.querySelector('#details').innerHTML = `<h3>${escapeHtml(p.APN)}</h3><p class="meta">${escapeHtml(p.Acres || '—')} GIS acres · Land use ${escapeHtml(p.LandUse1 || '—')} · ${escapeHtml(p.Township || '')} ${escapeHtml(p.Range || '')}</p>${(p.records || []).map(recordCard).join('')}`;
}
function unmappedSummary(record) {
  return `<div class="parcel-tooltip"><strong>Unmapped listing</strong><span><b>Listing</b>${escapeHtml(record.title)}</span><span><b>Price</b>${escapeHtml(money(record.price) || '—')}</span><span><b>Listing acres</b>${escapeHtml(record.acres || '—')}</span><span><b>Status</b>${escapeHtml(record.status || '—')}</span><span><b>Note</b>MLS location only — parcel boundary not verified</span></div>`;
}
function draw() {
  parcelGroup.clearLayers();
  unmappedGroup.clearLayers();
  let privateCount = 0, publicCount = 0, visibleCount = 0;
  for (const feature of data.features) {
    const set = categories(feature);
    if ([...set].some(value => value.startsWith('private-'))) privateCount++;
    if ([...set].some(value => value.startsWith('public-'))) publicCount++;
    if (!visible(feature)) continue;
    visibleCount++;
    const layer = L.geoJSON(feature, { style }).getLayers()[0];
    layer.bindTooltip(summary(feature), { sticky: true });
    layer.on({
      mouseover: event => { event.target.setStyle({ weight: 5, fillOpacity: .35 }); if (!selectedLayer) showDetails(feature); },
      mouseout: event => { if (event.target !== selectedLayer) event.target.setStyle(style(feature)); },
      click: event => {
        if (selectedLayer) selectedLayer.setStyle(style(selectedLayer.feature));
        selectedLayer = event.target;
        selectedLayer.feature = feature;
        selectedLayer.setStyle({ weight: 6, fillOpacity: .4 });
        showDetails(feature);
        window.open(parcelDestination(feature), '_blank', 'noopener');
      }
    });
    layer.feature = feature;
    layers.set(String(feature.properties.APN).toLowerCase(), layer);
    parcelGroup.addLayer(layer);
  }
  for (const record of data.unmappedListings || []) {
    if (!enabledCategories.has(record.category)) continue;
    privateCount++;
    visibleCount++;
    const color = COLORS[record.category] || '#42d7a6';
    const marker = L.circleMarker(record.latLng, { radius: 8, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, className: 'unmapped-marker' });
    marker.bindTooltip(unmappedSummary(record), { sticky: true });
    marker.on('click', () => { document.querySelector('#details').innerHTML = `<h3>Unmapped listing</h3><p class="meta">MLS location only — no verified county parcel boundary.</p>${recordCard(record)}`; window.open(record.url, '_blank', 'noopener'); });
    layers.set(`listing-${record.mlsNumber}`.toLowerCase(), marker);
    unmappedGroup.addLayer(marker);
  }
  document.querySelector('#visible-count').textContent = visibleCount;
  document.querySelector('#private-count').textContent = privateCount;
  document.querySelector('#public-count').textContent = publicCount;
}
function findParcel() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  if (!query) return;
  let layer = layers.get(query);
  if (!layer) layer = [...layers.values()].find(candidate => JSON.stringify(candidate.feature.properties.records).toLowerCase().includes(query));
  if (!layer) { document.querySelector('#details').innerHTML = '<p class="muted">No visible parcel matched that search.</p>'; return; }
  layer.fire('click');
}

document.querySelectorAll('.filter').forEach(input => input.addEventListener('change', () => {
  enabledCategories = new Set([...document.querySelectorAll('.filter:checked')].map(item => item.value));
  selectedLayer = null;
  layers.clear();
  draw();
  if (parcelGroup.getLayers().length || unmappedGroup.getLayers().length) map.fitBounds(L.featureGroup([parcelGroup, unmappedGroup]).getBounds(), { padding: [25, 25] });
}));
document.querySelector('#search-button').addEventListener('click', findParcel);
document.querySelector('#search').addEventListener('keydown', event => { if (event.key === 'Enter') findParcel(); });

fetch('data/parcels.json').then(response => {
  if (!response.ok) throw new Error(`Parcel data returned ${response.status}`);
  return response.json();
}).then(result => {
  data = result;
  draw();
  if (parcelGroup.getLayers().length || unmappedGroup.getLayers().length) map.fitBounds(L.featureGroup([parcelGroup, unmappedGroup]).getBounds(), { padding: [25, 25] });
  document.querySelector('#updated').textContent = `Data refreshed ${new Date(data.generatedAt).toLocaleString()}`;
}).catch(error => {
  document.querySelector('#updated').textContent = `Could not load parcel data: ${error.message}`;
});
