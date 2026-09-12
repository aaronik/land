'use strict';

// Download public IDX photos for one or all unmapped MLS listings. The cache is
// intentionally untracked; verified MLS->APN links belong in parcel-overrides.json.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data', 'parcels.json'), 'utf8'));
const cache = path.join(root, '.cache', 'parcel-evidence');
const args = process.argv.slice(2), all = args.includes('--all'), requested = args.find(x => !x.startsWith('--'));
const max = Math.min(Number(args[args.indexOf('--max') + 1]) || 40, 100);
const records = (data.unmappedListings || []).filter(x => ['land', 'farm'].includes(x.propertyType) && (all || String(x.mlsNumber).toUpperCase() === String(requested || '').toUpperCase()));
if (!records.length) throw new Error(all ? 'No unmapped land listings' : 'Usage: npm run parcel-evidence -- <MLS> [--max 40] or --all');
function photoUrl(record, index) { return `https://idx-photos-ihouseprd.b-cdn.net/${encodeURIComponent(record.mlsId || 'CA-SISKIYOU')}/${encodeURIComponent(record.mlsNumber)}/org/${String(index).padStart(3, '0')}.jpg?width=1600`; }
async function collect(record) {
  const dir = path.join(cache, String(record.mlsNumber)); fs.mkdirSync(dir, { recursive: true });
  const photos = []; let misses = 0;
  for (let i = 0; i < max && misses < 3; i++) {
    const file = path.join(dir, `${String(i).padStart(3, '0')}.jpg`), url = photoUrl(record, i);
    if (fs.existsSync(file)) { photos.push({ index: i, file, url }); misses = 0; continue; }
    let response; try { response = await fetch(url); } catch { response = null; }
    if (!response?.ok || !(response.headers.get('content-type') || '').startsWith('image/')) { misses++; continue; }
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer())); photos.push({ index: i, file, url }); misses = 0;
  }
  const manifest = { mlsNumber: record.mlsNumber, title: record.title, acres: record.acres, listingUrl: record.url, photos: photos.map(x => ({ ...x, file: path.relative(root, x.file) })) };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${record.mlsNumber}: ${photos.length} photos -> ${path.relative(root, dir)}`);
}
(async () => { for (let i = 0; i < records.length; i += 6) await Promise.all(records.slice(i, i + 6).map(collect)); })().catch(error => { console.error(error); process.exitCode = 1; });
