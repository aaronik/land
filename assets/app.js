'use strict';

const COLORS = { private: '#42d7a6', public: '#ff9d4d', both: '#d77cff' };
const map = L.map('map', { zoomControl: false }).setView([41.45, -122.45], 9);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Imagery © Esri · Parcel data © Siskiyou County', maxNativeZoom: 19, maxZoom: 22
}).addTo(map);

let data;
let activeFilter = 'both';
let selectedLayer = null;
const layers = new Map();
const parcelGroup = L.featureGroup().addTo(map);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}
function money(value) { return value ? `$${Number(value).toLocaleString()}` : ''; }
function kinds(feature) { return new Set((feature.properties.records || []).map(record => record.kind)); }
function category(feature) {
  const set = kinds(feature);
  return set.size > 1 ? 'both' : (set.has('private') ? 'private' : 'public');
}
function visible(feature) { return activeFilter === 'both' || kinds(feature).has(activeFilter); }
function style(feature) {
  const color = COLORS[category(feature)];
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
  if (record.kind === 'private') return `<article class="record private"><strong>Private listing</strong><p>${escapeHtml(record.title)}</p><p>${money(record.price)} · ${escapeHtml(record.acres || '—')} acres · ${escapeHtml(record.status)}</p><a href="${escapeHtml(record.url)}" target="_blank" rel="noopener">Open listing ↗</a></article>`;
  const bid = record.minimumBid || 'No parsed minimum';
  return `<article class="record public"><strong>Public auction record</strong><p>${escapeHtml(bid)} · ${escapeHtml(record.status || 'Unknown status')}${record.auctionEnd ? ` · ended ${escapeHtml(record.auctionEnd)}` : ''}</p><p>${escapeHtml(record.source || '')}</p><a href="${escapeHtml(record.sourceUrl)}" target="_blank" rel="noopener">Source PDF ↗</a></article>`;
}
function showDetails(feature) {
  const p = feature.properties;
  document.querySelector('#details').innerHTML = `<h3>${escapeHtml(p.APN)}</h3><p class="meta">${escapeHtml(p.Acres || '—')} GIS acres · Land use ${escapeHtml(p.LandUse1 || '—')} · ${escapeHtml(p.Township || '')} ${escapeHtml(p.Range || '')}</p>${(p.records || []).map(recordCard).join('')}`;
}
function draw() {
  parcelGroup.clearLayers();
  let privateCount = 0, publicCount = 0, visibleCount = 0;
  for (const feature of data.features) {
    const set = kinds(feature);
    if (set.has('private')) privateCount++;
    if (set.has('public')) publicCount++;
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

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
  selectedLayer = null;
  layers.clear();
  draw();
  if (parcelGroup.getLayers().length) map.fitBounds(parcelGroup.getBounds(), { padding: [25, 25] });
}));
document.querySelector('#search-button').addEventListener('click', findParcel);
document.querySelector('#search').addEventListener('keydown', event => { if (event.key === 'Enter') findParcel(); });

fetch('data/parcels.json').then(response => {
  if (!response.ok) throw new Error(`Parcel data returned ${response.status}`);
  return response.json();
}).then(result => {
  data = result;
  draw();
  if (parcelGroup.getLayers().length) map.fitBounds(parcelGroup.getBounds(), { padding: [25, 25] });
  document.querySelector('#updated').textContent = `Data refreshed ${new Date(data.generatedAt).toLocaleString()}`;
}).catch(error => {
  document.querySelector('#updated').textContent = `Could not load parcel data: ${error.message}`;
});
