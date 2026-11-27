const item = id => `https://www.arcgis.com/home/item.html?id=${id}`;
const link = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const UTILITY_LIMITS_KEY = 'shasta-land-atlas.utility-limits.v1';
const countyReport = 'https://siskiyou2050.com/images/docs/SKYGP_BR_FULL_2024-05-07-RL-Reduced.pdf';
const feeds = {
  'electric-iou': { title: 'Mapped electric territory', agency: 'California Energy Commission', url: item('30410214d637434ba1003cbdcc32cf55'), note: 'Approximate electric utility territory. It does not show local distribution lines, a meter, or approval to connect.' },
  'electric-other': { title: 'Mapped electric territory', agency: 'California Energy Commission', url: item('07224640a2fe42f89399be796e7b8810'), note: 'Approximate electric co-op or tribal territory. It does not show local distribution lines, a meter, or approval to connect.' },
  'water-area': { title: 'Mapped drinking-water service area', agency: 'California Water Boards · Division of Drinking Water', url: item('fbba842bf134497c9d611ad506ec48cc'), note: 'Reported public water service area. It does not guarantee a main at the property, pressure, capacity, a meter, or approval to connect.' },
  'sewer-district': { title: 'Sewer provider district boundary', agency: 'California Special Districts Association / FEMA Region 9', url: item('35bc7aa8625b421a8e4d6e0287504eda'), note: 'District jurisdiction only, not the actual sewer service area. The district operates a sewer system, but some properties within the boundary may not be served.' },
  'sewer-lines': { title: 'Mapped sewer line', agency: 'Siskiyou County GIS', url: item('70d03b743c904077be50fda6897e5150'), note: 'Public Fort Jones sewer system inventory. A line at or near a parcel does not establish a service lateral, a working connection, capacity, or permission to connect.' },
  'water-meter': { title: 'Mapped potable-water meter', agency: 'City of Yreka public meter inventory', url: item('7c87c5ba3f2d423d91e2620f40581fad'), note: 'A mapped meter is physical hookup evidence, not proof of the parcel it serves, a live account, an operable connection, or approval for new service.' }
};
const designation = { IOU: 'Investor-owned utility', POU: 'Publicly owned utility', 'CO-OP': 'Electric cooperative', TRIBAL: 'Tribal utility' };

export const UTILITY_LAYER_GROUPS = {
  'utility-electric': ['utility-electric-fill', 'utility-electric-outline'],
  'utility-water': ['utility-water-fill', 'utility-water-outline'],
  'utility-sewer-district': ['utility-sewer-fill', 'utility-sewer-outline'],
  'utility-sewer-lines': ['utility-sewer-lines'],
  'utility-water-meters': ['utility-water-meters']
};
const polygonLayers = ['utility-electric-fill', 'utility-water-fill', 'utility-sewer-fill'];

export function createUtilities({ map, Popup, dataUrl, parcelsQueryUrl }) {
  const source = 'utility-evidence';
  const popup = new Popup({ className: 'utility-popup', maxWidth: '330px', closeOnClick: false });
  map.on('remove', () => popup.remove());
  let snapshot;
  function load() {
    snapshot ||= fetch(dataUrl).then(async response => {
      if (!response.ok) throw new Error(`Utility snapshot returned ${response.status}`);
      const collection = await response.json();
      if (collection.type !== 'FeatureCollection' || !collection.features?.length) throw new Error('Invalid utility snapshot');
      return collection;
    }).catch(error => { snapshot = null; throw error; });
    return snapshot;
  }
  let mapSnapshot;
  function showLayer(visible) {
    if (!visible) popup.remove();
    if (!visible || mapSnapshot || !map.getSource(source)) return;
    const statuses = () => document.querySelectorAll('[data-utility-layer-status]');
    for (const status of statuses()) status.textContent = 'Loading utility map…';
    mapSnapshot = load().then(collection => {
      map.getSource(source)?.setData(collection);
      for (const status of statuses()) status.textContent = '';
    }).catch(() => {
      mapSnapshot = null;
      for (const status of statuses()) status.textContent = 'Utility map unavailable. Turn the layer off and on to retry.';
    });
  }
  function install() {
    map.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Utility evidence: California Energy Commission · California Water Boards · CSDA/FEMA · Siskiyou County · City of Yreka' });
    const insert = (id, type, keys, paint, before, minzoom) => map.addLayer({ id, type, source, minzoom, layout: { visibility: 'none' }, filter: ['in', ['get', 'feed'], ['literal', keys]], paint }, before);
    for (const [key, keys, color, opacity] of [
      ['electric', ['electric-iou', 'electric-other'], '#b26d13', 0.14],
      ['water', ['water-area'], '#136caf', 0.25],
      ['sewer', ['sewer-district'], '#8d3a96', 0.2]
    ]) {
      insert(`utility-${key}-fill`, 'fill', keys, { 'fill-color': color, 'fill-opacity': opacity }, 'parcel-fill', 6);
      insert(`utility-${key}-outline`, 'line', keys, { 'line-color': color, 'line-width': 1.8, ...(key === 'sewer' ? { 'line-dasharray': [3, 2] } : {}) }, 'parcel-fill', 6);
    }
    insert('utility-sewer-lines', 'line', ['sewer-lines'], { 'line-color': '#9a2d73', 'line-width': 3, 'line-opacity': 0.95 }, 'sale-markers', 11);
    insert('utility-water-meters', 'circle', ['water-meter'], { 'circle-radius': 4, 'circle-color': '#075f9b', 'circle-stroke-width': 1.25, 'circle-stroke-color': '#fff' }, 'sale-markers', 14);
    for (const layer of [...polygonLayers, 'utility-sewer-lines', 'utility-water-meters']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
  }
  function inspect({ point, lngLat }, includeAreas, allow = true) {
    if (!allow || !mapSnapshot) { popup.remove(); return false; }
    const query = (location, layers) => {
      const visible = layers.filter(id => map.getLayoutProperty(id, 'visibility') === 'visible');
      return visible.length ? map.queryRenderedFeatures(location, { layers: visible }) : [];
    };
    const near = [[point.x - 5, point.y - 5], [point.x + 5, point.y + 5]];
    const hits = [...query(near, ['utility-water-meters', 'utility-sewer-lines']), ...(includeAreas ? query(point, polygonLayers) : [])];
    if (!hits.length) { popup.remove(); return false; }
    const records = [...new Map(hits.map(({ properties: p }) => [`${p.feed}|${p.name}|${p.system || ''}|${p.verification || ''}`, p])).values()];
    popup.setLngLat(lngLat).setHTML(`<div class="utility-popup-evidence"><h3>Utility map evidence</h3>${records.map(p => {
      const feed = feeds[p.feed];
      return `<article><h4>${feed.title}</h4><strong>${escapeHtml(p.name)}</strong>${p.designation ? `<br>${escapeHtml(designation[p.designation] || p.designation)}` : ''}${p.system ? `<br>System ID: ${escapeHtml(p.system)}` : ''}${p.verification ? `<br>Boundary verification: ${escapeHtml(p.verification)}` : ''}<p>${feed.note}</p>${link(feed.url, feed.agency)}${p.feed === 'sewer-district' ? ` · ${link(countyReport, 'County background report')}` : ''}</article>`;
    }).join('')}<p><strong>Parcel availability and active hookup: not verified.</strong></p></div>`).addTo(map);
    return true;
  }
  let parcelRequest;
  function updateParcel(details, apn) {
    parcelRequest?.abort();
    const target = details.querySelector('[data-utility-parcel-results]');
    const button = details.querySelector('[data-retry-utility-parcel]');
    if (!button || !target || !apn) return;
    if (/\bRW\b/i.test(apn)) {
      target.textContent = 'This is a county right-of-way record, not an individual property. Inspect nearby utility features on the map; parcel availability is unknown.';
      return;
    }
    async function lookup() {
      button.hidden = true;
      const request = new AbortController();
      parcelRequest = request;
      target.textContent = 'Checking mapped utility records against the county parcel…';
      try {
        const url = new URL(parcelsQueryUrl);
        url.search = new URLSearchParams({ f: 'json', where: `APN = '${String(apn).replace(/'/g, "''")}'`, outFields: 'APN', returnGeometry: 'true', outSR: '4326' });
        const [collection, response] = await Promise.all([load(), fetch(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) })]);
        if (!response.ok) throw new Error(`Parcel query returned ${response.status}`);
        const { features, error } = await response.json();
        const parcels = features?.map(feature => feature.geometry?.rings).filter(rings => rings?.length);
        if (error || !parcels?.length) throw new Error('No parcel geometry');
        if (request.signal.aborted || !target.isConnected) return;
        target.innerHTML = renderParcelUtilityEvidence(matchParcelUtilities(parcels, collection.features), collection.retrieved);
        const limits = target.querySelector('details');
        try { limits.open = localStorage.getItem(UTILITY_LIMITS_KEY) === 'open'; } catch { /* Optional storage. */ }
        limits.addEventListener('toggle', () => {
          if (!limits.isConnected) return;
          try {
            if (limits.open) localStorage.setItem(UTILITY_LIMITS_KEY, 'open');
            else localStorage.removeItem(UTILITY_LIMITS_KEY);
          } catch { /* Optional storage. */ }
        });
      } catch {
        if (request.signal.aborted || !target.isConnected) return;
        target.textContent = 'Mapped utilities could not be checked for this parcel.';
        button.hidden = false;
      } finally {
        if (parcelRequest === request) parcelRequest = null;
      }
    }
    button.addEventListener('click', lookup);
    void lookup();
  }
  return { install, showLayer, inspect, updateParcel };
}

export const parcelUtilitiesSection = () => `<section class="utility-parcel"><h4>Mapped utilities</h4><div data-utility-parcel-results aria-live="polite"></div><button type="button" data-retry-utility-parcel hidden>Retry utility lookup</button></section>`;

function bounds(points) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
    box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  }
  return box;
}
const boxesTouch = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const withinSegmentBox = (a, b, p) => p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) <= 1e-13 && withinSegmentBox(a, b, p);
function segmentsTouch(a, b, c, d) {
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b) ||
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}
// Even/odd across rings supports ArcGIS multipart parcels and polygon holes.
function inRings(point, rings) {
  let inside = false;
  for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if (onSegment(a, b, point)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0] > point[0]) inside = !inside;
  }
  return inside;
}
function geometryTouchesParcel(geometry, parcel, parcelBox) {
  const { type, coordinates } = geometry;
  if (type.startsWith('Multi')) return coordinates.some(part => geometryTouchesParcel({ type: type.slice(5), coordinates: part }, parcel, parcelBox));
  if (type === 'Point') return boxesTouch(parcelBox, [...coordinates, ...coordinates]) && inRings(coordinates, parcel);
  const rings = type === 'Polygon' ? coordinates : [coordinates];
  if (!boxesTouch(parcelBox, bounds(rings[0]))) return false;
  if (type === 'Polygon' && parcel.some(ring => inRings(ring[0], rings))) return true;
  if (rings.some(ring => inRings(ring[0], parcel))) return true;
  for (const ring of rings) for (let i = 1; i < ring.length; i++) {
    if (!boxesTouch(parcelBox, bounds([ring[i - 1], ring[i]]))) continue;
    for (const edge of parcel) for (let j = 1; j < edge.length; j++) {
      if (segmentsTouch(ring[i - 1], ring[i], edge[j - 1], edge[j])) return true;
    }
  }
  return false;
}

export function matchParcelUtilities(parcels, features) {
  const boxes = parcels.map(rings => bounds(rings.flat()));
  return features.filter(feature => parcels.some((parcel, i) => geometryTouchesParcel(feature.geometry, parcel, boxes[i])));
}

export function renderParcelUtilityEvidence(matches, retrieved) {
  const records = matches.map(match => match.properties);
  const findings = [], limits = [];
  const meters = records.filter(p => p.feed === 'water-meter').length;
  if (meters) findings.push(`${meters} mapped water ${meters === 1 ? 'meter lies' : 'meters lie'} on or inside this parcel’s boundary. · ${link(feeds['water-meter'].url, 'Yreka meter map')}`);
  else limits.push('No water meter matched. Meter records cover Yreka only.');
  if (records.some(p => p.feed === 'sewer-lines')) findings.push(`A mapped sewer line touches or crosses this parcel. · ${link(feeds['sewer-lines'].url, 'Fort Jones sewer map')}`);
  else limits.push('No sewer line matched. Line records cover Fort Jones only.');

  for (const [prefix, label, missing] of [
    ['water-area', 'Drinking-water system', 'No mapped public drinking-water area matched.'],
    ['sewer-district', 'Sewer district', 'No sewer district matched in the partial district inventory.'],
    ['electric-', 'Electric territory', 'No mapped electric territory matched.']
  ]) {
    const areas = new Map(records.filter(p => p.feed.startsWith(prefix)).map(p => [JSON.stringify([p.feed, p.name, p.system, p.verification]), p]));
    if (!areas.size) limits.push(missing);
    for (const p of areas.values()) {
      findings.push(`${label}: ${link(feeds[p.feed].url, escapeHtml(p.name))}`);
      if (p.system) limits.push(`${escapeHtml(p.name)}: system ${escapeHtml(p.system)}; boundary verification: ${escapeHtml(p.verification || 'Not reported')}.`);
    }
  }
  return `<div class="utility-findings">${findings.length ? findings.map(text => `<p>${text}</p>`).join('') : '<p>No mapped utility records matched this parcel.</p>'}</div>
    <details><summary>Coverage and limits</summary><ul>${limits.map(text => `<li>${text}</li>`).join('')}</ul>
    <p>Boundaries can touch just one edge of a parcel. A district is not a sewer service area, and a meter or line may serve a different parcel. No match does not mean service is unavailable.</p>
    <p>Ask the provider to confirm an active hookup or the cost and capacity for a new connection. Map records retrieved ${escapeHtml(retrieved)}.</p></details>`;
}
