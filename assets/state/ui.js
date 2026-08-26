'use strict';

export function initializeMobileSheet({ panel = document.querySelector('.panel'), handle = document.querySelector('.sheet-handle') } = {}) {
  if (!panel || !handle) return;

  const mobile = window.matchMedia('(max-width: 760px)');
  let startY = 0, startOffset = 0, currentOffset = 0, dragging = false, ignoreClick = false, trackingTouch = false;
  const collapsedOffset = () => Math.max(0, panel.offsetHeight - (parseFloat(getComputedStyle(panel).getPropertyValue('--mobile-sheet-peek')) || 132));
  const setOpen = open => {
    panel.classList.toggle('sheet-open', open);
    panel.classList.remove('sheet-dragging');
    panel.style.transform = '';
    handle.setAttribute('aria-expanded', String(open));
    handle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} map information`);
  };
  setOpen(false);
  const isControl = target => {
    const control = target.closest('input, select, textarea, button, a, label, [role="button"]');
    return control && control !== handle;
  };
  const begin = clientY => {
    startY = clientY;
    startOffset = panel.classList.contains('sheet-open') ? 0 : collapsedOffset();
    currentOffset = startOffset;
    dragging = false;
  };
  const move = (clientY, preventDefault) => {
    const delta = clientY - startY;
    if (!dragging) {
      // Let normal upward gestures scroll the open panel. A downward pull from its
      // top, or any gesture on the collapsed panel, operates the sheet instead.
      if (Math.abs(delta) <= 5 || (startOffset === 0 && (delta < 0 || panel.scrollTop > 0))) return false;
      dragging = true;
      panel.classList.add('sheet-dragging');
    }
    preventDefault();
    currentOffset = Math.max(0, Math.min(collapsedOffset(), startOffset + delta));
    panel.style.transform = `translateY(${currentOffset}px)`;
    return true;
  };
  const finish = () => {
    if (!dragging) return;
    ignoreClick = true;
    setOpen(currentOffset < collapsedOffset() / 2);
    setTimeout(() => { ignoreClick = false; }, 0);
  };

  panel.addEventListener('click', event => {
    if (!mobile.matches || ignoreClick || isControl(event.target)) return;
    setOpen(!panel.classList.contains('sheet-open'));
  });

  // Touch events allow a downward pull at scrollTop 0 to take over from scrolling.
  // They are deliberately non-passive so only an active sheet drag blocks scrolling.
  panel.addEventListener('touchstart', event => {
    trackingTouch = mobile.matches && event.touches.length === 1 && !isControl(event.target);
    if (!trackingTouch) return;
    begin(event.touches[0].clientY);
  }, { passive: true });
  panel.addEventListener('touchmove', event => {
    if (!trackingTouch || event.touches.length !== 1) return;
    move(event.touches[0].clientY, () => event.preventDefault());
  }, { passive: false });
  panel.addEventListener('touchend', () => { finish(); trackingTouch = false; });
  panel.addEventListener('touchcancel', () => { finish(); trackingTouch = false; });

  // Keep mouse/trackpad drag support for a mobile-sized browser viewport.
  panel.addEventListener('pointerdown', event => {
    if (!mobile.matches || event.pointerType === 'touch' || event.button !== 0 || isControl(event.target)) return;
    begin(event.clientY);
    panel.setPointerCapture(event.pointerId);
  });
  panel.addEventListener('pointermove', event => {
    if (!panel.hasPointerCapture(event.pointerId)) return;
    move(event.clientY, () => event.preventDefault());
  });
  const finishPointer = event => {
    if (!panel.hasPointerCapture(event.pointerId)) return;
    panel.releasePointerCapture(event.pointerId);
    finish();
  };
  panel.addEventListener('pointerup', finishPointer);
  panel.addEventListener('pointercancel', finishPointer);
  mobile.addEventListener('change', () => setOpen(false));
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
