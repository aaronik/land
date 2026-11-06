import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { appUrl, imagePath, parseView, viewFromUrl } from '../src/view.js';

const view = '10.5/41.32/-122.31/16/50';
test('validates and reconstructs map location, terrain and parcel', () => {
  assert.equal(parseView(view), view);
  assert.equal(parseView('10/41/-122'), '10/41/-122');
  for (const invalid of ['10/91/-122', '30/41/-122', '10/41/-122/0/91', '10/x/-122', '10/41/-122/0/0/0']) assert.equal(parseView(invalid), null);
  const parsed = viewFromUrl(new URL(`https://example.com/?view=${view}&terrain=1&parcel=123-456`));
  assert.deepEqual(parsed, { view, terrain: true, parcel: '123-456' });
  assert.equal(appUrl(parsed), `https://land.aaronik.com/?terrain=1&parcel=123-456#${view}`);
  assert.equal(imagePath(parsed), `/image?view=${encodeURIComponent(view)}&terrain=1&parcel=123-456`);
  assert.equal(viewFromUrl(new URL('https://example.com/?parcel=%3Cscript%3E')), null);
});

test('crawler receives image metadata while human navigates to app', async () => {
  const url = `https://preview.example.com/?view=${view}&terrain=1`;
  const response = await worker.fetch(new Request(url), {});
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /property="og:image" content="https:\/\/preview.example.com\/image\?/);
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.match(html, /og:image:type" content="image\/jpeg"/);
  assert.doesNotMatch(html, /http-equiv="refresh"/);
  assert.match(html, new RegExp(`https://land.aaronik.com/\\?terrain=1#${view}`));
});

test('cached image does not launch browser', async () => {
  const jpeg = new Uint8Array([255, 216, 255, 217]);
  const response = await worker.fetch(new Request(`https://preview.example.com/image?view=${view}`), {
    PREVIEWS: { get: async () => jpeg.buffer }
  });
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
});

test('rejects invalid view and paths', async () => {
  assert.equal((await worker.fetch(new Request('https://preview.example.com/?view=foo'), {})).status, 400);
  assert.equal((await worker.fetch(new Request('https://preview.example.com/other'), {})).status, 404);
});
