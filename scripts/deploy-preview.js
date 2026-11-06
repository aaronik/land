'use strict';

const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const infrastructure = resolve(__dirname, '../infrastructure');
let kvId = process.env.PREVIEW_KV_ID;
if (!kvId) {
  try { kvId = execFileSync('tofu', ['output', '-raw', 'preview_kv_id'], { cwd: infrastructure, encoding: 'utf8' }).trim(); }
  catch { console.error('Run `tofu -chdir=infrastructure apply` first, or set PREVIEW_KV_ID.'); process.exit(1); }
}
if (!/^[a-f0-9]{32}$/i.test(kvId)) throw new Error('No valid preview KV ID. Run `tofu -chdir=infrastructure apply` first.');
const origin = new URL(process.env.SHARE_PREVIEW_ORIGIN || 'https://shasta-land-atlas-preview.aasullivan1618.workers.dev');
if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.hostname === 'preview.example.com') throw new Error('SHARE_PREVIEW_ORIGIN must be your deployed HTTPS Worker origin');
execFileSync('npm', ['run', 'deploy'], { cwd: resolve(__dirname, '../worker'), stdio: 'inherit', env: { ...process.env, PREVIEW_KV_ID: kvId } });
