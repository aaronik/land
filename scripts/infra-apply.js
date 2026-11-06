'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join, resolve } = require('node:path');
const env = { ...process.env };

if (!env.CLOUDFLARE_API_TOKEN) {
  // cf refreshes its OAuth token as needed. Never print or persist the token.
  const identity = JSON.parse(execFileSync('cf', ['auth', 'whoami'], { encoding: 'utf8' }));
  if (!identity.authenticated || !identity.tokenValid) throw new Error('Run `cf auth login` first.');
  const accountIds = identity.accounts?.map(account => account.id) || [];
  if (!env.TF_VAR_cloudflare_account_id) {
    if (accountIds.length !== 1) throw new Error('Set TF_VAR_cloudflare_account_id to the desired Cloudflare account.');
    env.TF_VAR_cloudflare_account_id = accountIds[0];
  }
  if (!accountIds.includes(env.TF_VAR_cloudflare_account_id)) throw new Error('Selected Cloudflare account is not available to the current cf login.');
  const credentialFile = process.platform === 'darwin'
    ? join(homedir(), 'Library/Preferences/cloudflare/config/default.json')
    : join(homedir(), '.config/cloudflare/config/default.json');
  env.CLOUDFLARE_API_TOKEN = JSON.parse(readFileSync(credentialFile, 'utf8')).oauth_token;
  if (!env.CLOUDFLARE_API_TOKEN) throw new Error('No cf OAuth credential found; set CLOUDFLARE_API_TOKEN instead.');
} else if (!env.TF_VAR_cloudflare_account_id) {
  throw new Error('Set TF_VAR_cloudflare_account_id when using CLOUDFLARE_API_TOKEN.');
}

for (const args of [['init', '-input=false'], ['apply', '-input=true']]) {
  const result = spawnSync('tofu', ['-chdir=infrastructure', ...args], { cwd: resolve(__dirname, '..'), env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
