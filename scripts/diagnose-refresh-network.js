'use strict';

// Read-only diagnostics: no HTTP requests, response bodies, or repository data.
const dns = require('node:dns');
const net = require('node:net');
const tls = require('node:tls');
const { Resolver } = require('node:dns/promises');

const HOSTS = ['www.mountshastarealty.com', 'www.realtymtshasta.com', 'www.siskiyoucounty.gov'];
const DNS_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 10_000;
const MAX_ADDRESSES_PER_FAMILY = 2;

function errorDetails(error) {
  return Object.fromEntries(['name', 'message', 'code', 'errno', 'syscall', 'address', 'port']
    .filter(key => error?.[key] !== undefined).map(key => [key, error[key]]));
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('DNS diagnostic timed out'), { code: 'DIAGNOSTIC_TIMEOUT' })), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Connect to an explicit IP but retain the original hostname for SNI and
// certificate verification. One absolute deadline covers TCP plus TLS.
function probeAddress(host, address, family, {
  connect = net.connect, secureConnect = tls.connect, timeoutMs = CONNECT_TIMEOUT_MS
} = {}) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const result = { host, address, family, port: 443, timeoutMs };
    let socket, secureSocket, stage = 'tcp', finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      secureSocket?.destroy();
      socket?.destroy();
      resolve({ ...result, ok: !error, stage, elapsedMs: Date.now() - startedAt,
        ...(error ? { error: errorDetails(error) } : {}) });
    };
    const timer = setTimeout(() => finish(Object.assign(new Error(`${stage.toUpperCase()} diagnostic timed out`), { code: 'DIAGNOSTIC_TIMEOUT' })), timeoutMs);
    try {
      socket = connect({ host: address, family, port: 443 });
      socket.once('error', finish);
      socket.once('connect', () => {
        if (finished) return;
        result.tcpElapsedMs = Date.now() - startedAt;
        result.remoteAddress = socket.remoteAddress;
        stage = 'tls';
        try {
          secureSocket = secureConnect({ socket, servername: host, rejectUnauthorized: true });
          secureSocket.once('error', finish);
          secureSocket.once('secureConnect', () => {
            result.tlsProtocol = secureSocket.getProtocol();
            result.authorized = secureSocket.authorized;
            finish();
          });
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
}

async function diagnoseHost(host, log) {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  const queries = [
    ['lookup', () => dns.promises.lookup(host, { all: true })],
    ['A', async () => (await resolver.resolve4(host)).map(address => ({ address, family: 4 }))],
    ['AAAA', async () => (await resolver.resolve6(host)).map(address => ({ address, family: 6 }))]
  ];
  const answers = await Promise.all(queries.map(async ([query, operation]) => {
    const start = Date.now();
    try {
      const addresses = await withTimeout(operation, DNS_TIMEOUT_MS);
      log('dns', { host, query, addresses, elapsedMs: Date.now() - start });
      return addresses;
    } catch (error) {
      log('dns', { host, query, error: errorDetails(error), elapsedMs: Date.now() - start });
      return [];
    }
  }));
  resolver.cancel();
  const unique = [...new Map(answers.flat().map(item => [`${item.family}:${item.address}`, item])).values()];
  const selected = [4, 6].flatMap(family => unique.filter(item => item.family === family).slice(0, MAX_ADDRESSES_PER_FAMILY));
  log('probe-plan', { host, resolvedCount: unique.length, selected, omittedCount: unique.length - selected.length });
  await Promise.all(selected.map(async ({ address, family }) => {
    log('connection', await probeAddress(host, address, family));
  }));
}

async function main() {
  const log = (event, details) => console.log(`[network] ${JSON.stringify({ timestamp: new Date().toISOString(), event, ...details })}`);
  log('environment', {
    node: process.version, openssl: process.versions.openssl, platform: process.platform,
    arch: process.arch, runnerOS: process.env.RUNNER_OS, runnerArch: process.env.RUNNER_ARCH,
    dnsResultOrder: dns.getDefaultResultOrder(), autoSelectFamily: net.getDefaultAutoSelectFamily(),
    autoSelectFamilyAttemptTimeout: net.getDefaultAutoSelectFamilyAttemptTimeout(), dnsServers: dns.getServers()
  });
  await Promise.all(HOSTS.map(host => diagnoseHost(host, log)));
}

if (require.main === module) {
  // Also bound a stuck OS resolver (dns.lookup itself is not cancellable).
  const deadline = setTimeout(() => {
    console.error('[network] Overall diagnostic deadline exceeded (30 seconds)');
    process.exit(1);
  }, 30_000);
  deadline.unref();
  main().catch(error => { console.error('[network]', errorDetails(error)); process.exitCode = 1; });
}

module.exports = { probeAddress, withTimeout };
