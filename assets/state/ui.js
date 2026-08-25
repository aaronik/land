'use strict';

export function initializeMobileSheet({ panel = document.querySelector('.panel'), handle = document.querySelector('.sheet-handle') } = {}) {
  const mobile = window.matchMedia('(max-width: 760px)');
  let startY = 0, startOffset = 0, currentOffset = 0, dragged = false;
  const collapsedOffset = () => Math.max(0, panel.offsetHeight - (parseFloat(getComputedStyle(panel).getPropertyValue('--mobile-sheet-peek')) || 132));
  const setOpen = open => { panel.classList.toggle('sheet-open', open); panel.classList.remove('sheet-dragging'); panel.style.transform = ''; handle.setAttribute('aria-expanded', String(open)); handle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} map information`); };
  handle.addEventListener('click', () => { if (!dragged && mobile.matches) setOpen(!panel.classList.contains('sheet-open')); dragged = false; });
  handle.addEventListener('pointerdown', event => { if (!mobile.matches) return; startY = event.clientY; startOffset = panel.classList.contains('sheet-open') ? 0 : collapsedOffset(); currentOffset = startOffset; dragged = false; panel.classList.add('sheet-dragging'); handle.setPointerCapture(event.pointerId); });
  handle.addEventListener('pointermove', event => { if (!handle.hasPointerCapture(event.pointerId)) return; const delta = event.clientY - startY; dragged ||= Math.abs(delta) > 5; currentOffset = Math.max(0, Math.min(collapsedOffset(), startOffset + delta)); panel.style.transform = `translateY(${currentOffset}px)`; });
  const finishDrag = event => { if (!handle.hasPointerCapture(event.pointerId)) return; handle.releasePointerCapture(event.pointerId); setOpen(currentOffset < collapsedOffset() / 2); requestAnimationFrame(() => { dragged = false; }); };
  handle.addEventListener('pointerup', finishDrag); handle.addEventListener('pointercancel', finishDrag); mobile.addEventListener('change', () => setOpen(false));
}

export function createSearchController({ map, maplibregl, detailsElement, featureCenter, filteredMappedListings, filteredUnmappedListings, normalizeSearch, getApnIndex, getPlaceIndex, setSearchQuery, updateSales, selectApn, showParcelDetails }) {
  const fitResults = (mapped, unmapped) => {
    const points = [...mapped.map(featureCenter), ...unmapped.map(record => [record.latLng?.[1], record.latLng?.[0]])].filter(point => point?.every(Number.isFinite));
    if (!points.length) return;
    if (points.length === 1) return map.easeTo({ center: points[0], zoom: 15 });
    map.fitBounds(points.reduce((bounds, point) => bounds.extend(point), new maplibregl.LngLatBounds(points[0], points[0])), { padding: 90, maxZoom: 15 });
  };
  return () => {
    const input = document.querySelector('#search').value.trim(), normalized = normalizeSearch(input), compact = normalized.replaceAll(' ', ''), apnIndex = getApnIndex();
    const apn = Object.keys(apnIndex).find(key => normalizeSearch(key).replaceAll(' ', '') === compact);
    if (input && apn) { setSearchQuery(''); updateSales(); const item = apnIndex[apn]; selectApn(apn); map.fitBounds([[item.bbox[0], item.bbox[1]], [item.bbox[2], item.bbox[3]]], { padding: 90, maxZoom: 16 }); showParcelDetails({ APN: apn, Acres: item.acres }); return; }
    const place = input && getPlaceIndex().find(item => normalizeSearch(item.name) === normalized);
    if (place) {
      setSearchQuery(''); updateSales();
      const [west, south, east, north] = place.bbox;
      const isPoint = west === east && south === north;
      if (isPoint) map.easeTo({ center: place.center, zoom: 12 });
      else map.fitBounds([[west, south], [east, north]], { padding: 90, maxZoom: 14 });
      detailsElement.innerHTML = `<h3>${place.name.replace(/[&<>]/g, '')}</h3><p class="meta">${place.type}</p>`;
      return;
    }
    setSearchQuery(normalized); updateSales(); const mapped = filteredMappedListings(), unmapped = filteredUnmappedListings(), count = mapped.length + unmapped.length;
    if (!input) detailsElement.innerHTML = '<h3>No parcel selected</h3><p class="meta">Showing all listings and auctions.</p>';
    else if (!count) detailsElement.innerHTML = `<p class="muted">No listing matched “${input.replace(/[&<>]/g, '')}”.</p>`;
    else { detailsElement.innerHTML = `<h3>${count} matching ${count === 1 ? 'listing' : 'listings'}</h3><p class="meta">Showing results containing “${input.replace(/[&<>]/g, '')}”. Clear the search to show everything.</p>`; fitResults(mapped, unmapped); }
  };
}
