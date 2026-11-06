import puppeteer from '@cloudflare/puppeteer';
import { APP_ORIGIN, appUrl, imagePath, viewFromUrl } from './view.js';

const IMAGE_VERSION = 'v2';
const FALLBACK = `${APP_ORIGIN}/social-preview.jpg`;
const IMAGE_HEADERS = { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' };
const inFlight = new Map();
const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function renderImage(view, env) {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    // Restrict navigation to our app even if a malformed link is supplied.
    await page.goto(appUrl(view, true), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('body.map-ready', { timeout: 20000 });
    // Only cache complete frames; failing tiles or missing WebGL get the fallback.
    await page.waitForFunction(() => window.__landMap?.loaded(), { timeout: 12000 });
    const correctLayout = await page.evaluate(() => {
      const rect = document.querySelector('#map')?.getBoundingClientRect();
      return document.body.classList.contains('preview-capture') && rect?.width === 1200 && rect?.height === 630;
    });
    if (!correctLayout) throw new Error('Atlas capture mode is not deployed or map layout is incomplete');
    const map = await page.$('#map');
    return await map.screenshot({ type: 'jpeg', quality: 80 });
  } finally {
    await browser.close();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/image') return new Response('Not found', { status: 404 });
    const view = viewFromUrl(url);
    if (!view) return new Response('Invalid map view', { status: 400 });
    if (url.pathname === '/image') {
      const key = `${IMAGE_VERSION}:${imagePath(view)}`;
      try {
        const cached = await env.PREVIEWS.get(key, { type: 'arrayBuffer' });
        if (cached) return new Response(cached, { headers: IMAGE_HEADERS });
        if (!inFlight.has(key)) {
          const pending = (async () => {
            const image = await renderImage(view, env);
            try { await env.PREVIEWS.put(key, image, { expirationTtl: 60 * 60 * 24 * 30 }); }
            catch (error) { console.error('Preview cache write failed', error); }
            return image;
          })();
          inFlight.set(key, pending);
          pending.finally(() => inFlight.delete(key)).catch(() => {});
        }
        return new Response(await inFlight.get(key), { headers: IMAGE_HEADERS });
      } catch (error) {
        console.error('Preview capture failed', error);
        return Response.redirect(FALLBACK, 302);
      }
    }
    const destination = appUrl(view);
    const image = new URL(imagePath(view), url.origin).href;
    const title = 'Shasta Land Atlas — map view';
    const description = 'Explore this view of the Siskiyou County land map.';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${escapeHtml(url.href)}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:secure_url" content="${escapeHtml(image)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escapeHtml(image)}"></head><body><p>Opening <a href="${escapeHtml(destination)}">Shasta Land Atlas</a>…</p><script>window.location.replace(${JSON.stringify(destination).replace(/</g, '\\u003c')});</script></body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
  }
};
