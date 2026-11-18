'use strict';

export function webcamCameras(properties) {
  try {
    const cameras = typeof properties.cameras === 'string' ? JSON.parse(properties.cameras) : properties.cameras;
    if (!Array.isArray(cameras)) return [];
    return cameras.filter(camera => {
      if (!camera || typeof camera.name !== 'string') return false;
      const image = new URL(camera.imageUrl);
      const viewer = new URL(camera.viewerUrl);
      if ([image, viewer].some(url => url.protocol !== 'https:' || url.username || url.password || url.port)) return false;
      if (properties.provider === 'caltrans') return image.hostname === 'cwwp2.dot.ca.gov' && /^\/data\/d2\/cctv\/image\/[\w/-]+\.jpg$/.test(image.pathname) && !image.search && viewer.href === image.href;
      return properties.provider === 'alertcalifornia' && image.hostname === 'cameras.alertcalifornia.org' && /^\/public-camera-data\/[\w-]+\/latest-frame\.jpg$/.test(image.pathname) && !image.search && viewer.origin === image.origin && viewer.pathname === '/' && [...viewer.searchParams.keys()].length === 1 && viewer.searchParams.get('id') === camera.id;
    });
  } catch { return []; }
}

// Only the selected camera requests imagery. Closing/switching/toggling the layer
// disposes its timer, image request and visibility listener.
export function createWebcamViewer({ map, Popup, document = window.document }) {
  let current;
  const close = () => { current?.remove(); };
  function open(feature) {
    close();
    const properties = feature.properties || {};
    const cameras = webcamCameras(properties);
    if (!cameras.length) return;
    const alert = properties.provider === 'alertcalifornia';
    const root = document.createElement('section');
    root.className = 'webcam-viewer';
    const element = (tag, text, className) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      root.append(node);
      return node;
    };
    element('h3', properties.name || 'Public webcam');
    element('p', alert ? 'ALERTCalifornia | UC San Diego' : 'Caltrans highway camera', 'webcam-credit');
    const select = element('select');
    select.setAttribute('aria-label', 'Camera at this location');
    cameras.forEach((camera, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = camera.name;
      select.append(option);
    });
    select.hidden = cameras.length < 2;
    const imageLink = element('a');
    imageLink.target = '_blank';
    imageLink.rel = 'noopener noreferrer';
    imageLink.setAttribute('aria-label', 'Open full-size camera image');
    const image = document.createElement('img');
    image.className = 'webcam-image';
    imageLink.append(image);
    const status = element('p', '', 'webcam-status');
    status.setAttribute('role', 'status');
    const refresh = element('button', 'Refresh image');
    refresh.type = 'button';
    const viewer = element('a', alert ? 'Open camera viewer ↗' : 'Open original image ↗', 'webcam-source');
    viewer.target = '_blank';
    viewer.rel = 'noopener noreferrer';
    element('p', 'Updating still images, not continuous video. Check the timestamp in the image; feeds can be delayed or offline. Not for emergency or travel decisions.', 'webcam-note');
    if (alert) {
      const terms = element('a', 'CC BY-NC-ND 4.0 · noncommercial use', 'webcam-license');
      terms.href = 'https://alertcalifornia.org/terms/';
      terms.target = '_blank';
      terms.rel = 'noopener noreferrer';
    }
    let disposed = false;
    let timer;
    let camera;
    const interval = () => Math.max(30, Math.min(3600, Number(camera.refreshSeconds) || 300)) * 1000;
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && !document.hidden) timer = setTimeout(load, interval());
    };
    function load() {
      clearTimeout(timer);
      if (disposed || document.hidden) return;
      if (camera.inService === false) {
        image.hidden = true;
        status.textContent = 'Provider reports this camera out of service.';
        return;
      }
      image.hidden = false;
      status.textContent = 'Loading camera image…';
      const url = new URL(camera.imageUrl);
      url.searchParams.set('rqts', String(Date.now()));
      image.src = url.href;
      // Retry even if a request hangs and never fires load/error.
      schedule();
    }
    image.onload = () => {
      if (disposed) return;
      status.textContent = `Image received ${new Date().toLocaleTimeString()}. Auto-refresh every ${interval() / 60000 < 1 ? '30 seconds' : `${Math.round(interval() / 60000)} min`}.`;
      schedule();
    };
    image.onerror = () => {
      if (disposed) return;
      image.hidden = true;
      status.textContent = 'Camera image unavailable. Try Refresh or the original source; automatic retries continue while open.';
      schedule();
    };
    function choose() {
      camera = cameras[Number(select.value)] || cameras[0];
      image.alt = camera.name;
      imageLink.href = camera.imageUrl;
      viewer.href = camera.viewerUrl;
      image.removeAttribute('src');
      load();
    }
    select.addEventListener('change', choose);
    refresh.addEventListener('click', load);
    const visibility = () => { clearTimeout(timer); if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', visibility);
    const popup = new Popup({ maxWidth: '440px', className: 'webcam-popup' })
      .setLngLat(feature.geometry.coordinates.slice(0, 2)).setDOMContent(root).addTo(map);
    current = popup;
    popup.on('close', () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      if (current === popup) current = null;
    });
    choose();
    return popup;
  }
  return { open, close };
}
