import { execFileSync } from 'node:child_process';

if (!process.env.PREVIEW_KV_ID) {
  console.error('Missing PREVIEW_KV_ID. Run OpenTofu apply and set PREVIEW_KV_ID from its output.');
  process.exit(1);
}
execFileSync('npm', ['exec', '--', 'cf', 'deploy'], { stdio: 'inherit', cwd: new URL('..', import.meta.url), env: process.env });
