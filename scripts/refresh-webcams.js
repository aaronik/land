'use strict';

// Run directly with Node 18+. No images or full upstream inventories are archived.
const { createHash, randomUUID } = require('node:crypto');
const { mkdir, writeFile, rename, rm } = require('node:fs/promises');
const path = require('node:path');

const OUTPUT = path.join(__dirname, '..', 'data', 'webcams.geojson');
const SOURCES = {
  caltrans: {
    name: 'Caltrans District 2 CCTV',
    url: 'https://cwwp2.dot.ca.gov/data/d2/cctv/cctvStatusD02.json',
    documentationUrl: 'https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm',
    licenseUrl: 'https://dot.ca.gov/conditions-of-use',
    attribution: 'California Department of Transportation (Caltrans)',
  },
  alertcalifornia: {
    name: 'ALERTCalifornia / UC San Diego',
    url: 'https://cameras.alertcalifornia.org/public-camera-data/all_cameras-v3.json',
    documentationUrl: 'https://alertcalifornia.org/camera-user-guide/',
    termsUrl: 'https://alertcalifornia.org/terms/',
    licenseUrl: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
    attribution: 'ALERTCalifornia / UC San Diego, CC BY-NC-ND 4.0',
  },
};

function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500 || /[\x00-\x1f\x7f<>]/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value.trim();
}

function number(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim())) ? Number(value) : NaN;
}

function coordinates(lon, lat) {
  const x = number(lon);
  const y = number(lat);
  // County comes from the provider. This generous county-area sanity envelope also
  // rejects swapped coordinates, null/blank/zero values and valid-but-wrong countries.
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < -124 || x > -121 || y < 41 || y > 42.1) {
    throw new Error('Invalid Siskiyou camera coordinates');
  }
  return [Number(x.toFixed(6)), Number(y.toFixed(6))];
}

function safeUrl(value, provider, kind) {
  if (typeof value !== 'string' || value !== value.trim() || /[\s\\]/.test(value)) throw new Error('Invalid camera URL');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid camera URL'); }
  const host = provider === 'caltrans' ? 'cwwp2.dot.ca.gov' : provider === 'alertcalifornia' ? 'cameras.alertcalifornia.org' : '';
  if (!host || url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.hash) {
    throw new Error('Unsafe camera URL');
  }
  const validPath = provider === 'caltrans'
    ? /^\/data\/d2\/cctv\/image\/[a-zA-Z0-9_/-]+\.jpe?g$/.test(url.pathname) && !url.search
    : kind === 'image'
      ? /^\/public-camera-data\/[a-zA-Z0-9_-]+\/latest-frame\.jpg$/.test(url.pathname) && !url.search
      : url.pathname === '/' && /^\?id=[a-zA-Z0-9_-]+$/.test(url.search);
  if (!validPath || /%|\/\.\.?\//.test(value)) throw new Error('Unsafe camera URL path');
  return url.href;
}

function siskiyou(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'siskiyou';
}

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// Group only within a provider at the same coordinates (six decimal places,
// sub-meter precision). Never merge neighboring sites by name or a large radius.
// Coordinate-derived site IDs do not depend on array order or camera membership.
function groupSites(provider, rows) {
  if (!rows.length) throw new Error(`Empty ${provider} Siskiyou camera results`);
  const sites = new Map();
  const seen = new Map();
  for (const row of rows) {
    const key = row.coordinates.join(',');
    const signature = JSON.stringify(row);
    if (seen.has(row.camera.id)) {
      if (seen.get(row.camera.id) === signature) continue;
      throw new Error(`Conflicting ${provider} camera ID: ${row.camera.id}`);
    }
    seen.set(row.camera.id, signature);
    if (!sites.has(key)) sites.set(key, { coordinates: row.coordinates, rows: [] });
    sites.get(key).rows.push(row);
  }
  return [...sites.entries()].map(([key, site]) => {
    site.rows.sort((a, b) => compare(a.camera.id, b.camera.id));
    const names = [...new Set(site.rows.map(row => row.siteName))].sort(compare);
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: site.coordinates },
      properties: {
        id: `${provider}-site-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`,
        provider,
        name: names.join(' / '),
        cameras: JSON.stringify(site.rows.map(row => row.camera)),
      },
    };
  }).sort((a, b) => compare(a.properties.id, b.properties.id));
}

function normalizeCaltrans(payload) {
  if (!Array.isArray(payload?.data)) throw new Error('Invalid Caltrans feed: expected data array');
  const rows = [];
  for (const entry of payload.data) {
    const camera = entry?.cctv;
    if (!siskiyou(camera?.location?.county)) continue;
    const name = text(camera.location.locationName, 'Caltrans camera name');
    const image = camera.imageData?.static;
    const imageUrl = safeUrl(image?.currentImageURL, 'caltrans', 'image');
    const minutes = number(image.currentImageUpdateFrequency);
    const status = camera.inService;
    if (![true, false, 'true', 'false'].includes(status)) throw new Error('Invalid Caltrans inService');
    rows.push({
      coordinates: coordinates(camera.location.longitude, camera.location.latitude),
      siteName: name,
      camera: {
        // Upstream index is a row number, not a persistent camera identifier.
        id: `caltrans-${createHash('sha256').update(imageUrl).digest('hex').slice(0, 16)}`,
        name,
        imageUrl,
        // The feed does not document a supported per-camera viewer. Link to the
        // official still rather than fabricating QuickMap or video parameters.
        viewerUrl: imageUrl,
        refreshSeconds: Number.isFinite(minutes) && minutes >= 0.5 && minutes <= 1440 ? Math.round(minutes * 60) : 300,
        inService: status === true || status === 'true',
      },
    });
  }
  return groupSites('caltrans', rows);
}

function normalizeAlertCalifornia(payload) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('Invalid ALERTCalifornia feed: expected FeatureCollection');
  }
  const rows = [];
  for (const feature of payload.features) {
    const props = feature?.properties;
    if (!siskiyou(props?.county)) continue;
    if (feature.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) throw new Error('Invalid ALERTCalifornia Point');
    const id = text(props.id, 'ALERTCalifornia camera ID');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id)) throw new Error('Invalid ALERTCalifornia camera ID');
    const name = text(props.name, 'ALERTCalifornia camera name');
    const seconds = number(props.last_frame_ts);
    const frame = new Date(seconds * 1000);
    const lastFrameAt = seconds > 0 && Number.isFinite(frame.getTime()) ? frame.toISOString() : undefined;
    rows.push({
      coordinates: coordinates(...feature.geometry.coordinates.slice(0, 2)),
      siteName: name.replace(/\s+\d+$/, ''),
      camera: {
        id,
        name,
        imageUrl: safeUrl(`https://cameras.alertcalifornia.org/public-camera-data/${id}/latest-frame.jpg`, 'alertcalifornia', 'image'),
        viewerUrl: safeUrl(`https://cameras.alertcalifornia.org/?id=${id}`, 'alertcalifornia', 'viewer'),
        refreshSeconds: 30,
        // No explicit service flag is published: a frame indicates availability,
        // not freshness. Preserve its timestamp so consumers can mark stale feeds.
        inService: Boolean(lastFrameAt),
        ...(lastFrameAt ? { lastFrameAt } : {}),
      },
    });
  }
  return groupSites('alertcalifornia', rows);
}

async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json(); // The abort signal also bounds consumption of the body.
}

async function writeAtomic(output, inventory) {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(inventory)}\n`, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function refresh({ output = OUTPUT, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const [caltrans, alert] = await Promise.all([
    fetchJson(SOURCES.caltrans.url, { fetchImpl, timeoutMs }),
    fetchJson(SOURCES.alertcalifornia.url, { fetchImpl, timeoutMs }),
  ]);
  // Normalize both before touching the existing inventory; fail closed rather
  // than publishing an empty/partial provider after an upstream schema change.
  const features = [...normalizeCaltrans(caltrans), ...normalizeAlertCalifornia(alert)];
  const inventory = { type: 'FeatureCollection', fetchedAt: new Date().toISOString(), sources: SOURCES, features };
  await writeAtomic(output, inventory);
  return inventory;
}

if (require.main === module) {
  refresh().then(inventory => {
    const count = inventory.features.reduce((sum, feature) => sum + JSON.parse(feature.properties.cameras).length, 0);
    console.log(`Saved ${count} cameras at ${inventory.features.length} provider sites to ${OUTPUT}`);
  }).catch(error => { console.error(`Webcam refresh failed: ${error.message}`); process.exitCode = 1; });
}

module.exports = { normalizeCaltrans, normalizeAlertCalifornia, safeUrl, fetchJson, refresh, SOURCES, OUTPUT };
