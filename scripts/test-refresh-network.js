'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { probeAddress, withTimeout } = require('./diagnose-refresh-network');

function fakeSocket() {
  const socket = new EventEmitter();
  socket.destroy = () => { socket.destroyed = true; };
  return socket;
}

async function main() {
  assert.equal(await withTimeout(async () => 'resolved', 100), 'resolved');
  await assert.rejects(withTimeout(() => new Promise(() => {}), 5), { code: 'DIAGNOSTIC_TIMEOUT' });
  await assert.rejects(withTimeout(async () => { throw Object.assign(new Error('DNS failure'), { code: 'ENOTFOUND' }); }, 100), { code: 'ENOTFOUND' });

  for (const scenario of ['success', 'tcp-error', 'tcp-timeout', 'tls-error', 'tls-timeout']) {
    const socket = fakeSocket();
    const secureSocket = fakeSocket();
    socket.remoteAddress = '192.0.2.1';
    secureSocket.authorized = true;
    secureSocket.getProtocol = () => 'TLSv1.3';
    let tlsCalled = false;
    const result = await probeAddress('example.com', '192.0.2.1', 4, {
      timeoutMs: 20,
      connect: options => {
        assert.deepEqual(options, { host: '192.0.2.1', family: 4, port: 443 });
        queueMicrotask(() => {
          if (scenario === 'tcp-error') socket.emit('error', Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' }));
          else if (scenario !== 'tcp-timeout') socket.emit('connect');
        });
        return socket;
      },
      secureConnect: options => {
        tlsCalled = true;
        assert.equal(options.socket, socket);
        assert.equal(options.servername, 'example.com');
        assert.equal(options.rejectUnauthorized, true);
        queueMicrotask(() => {
          if (scenario === 'tls-error') secureSocket.emit('error', Object.assign(new Error('invalid certificate'), { code: 'CERT_HAS_EXPIRED' }));
          else if (scenario !== 'tls-timeout') secureSocket.emit('secureConnect');
        });
        return secureSocket;
      }
    });
    assert.equal(socket.destroyed, true);
    assert.equal(result.ok, scenario === 'success');
    assert.equal(result.stage, scenario.startsWith('tcp') ? 'tcp' : 'tls');
    if (tlsCalled) assert.equal(secureSocket.destroyed, true);
    if (scenario === 'success') {
      assert.equal(result.authorized, true);
      assert.equal(result.tlsProtocol, 'TLSv1.3');
      assert.equal(result.remoteAddress, '192.0.2.1');
    } else if (scenario.endsWith('timeout')) {
      assert.equal(result.error.code, 'DIAGNOSTIC_TIMEOUT');
    } else {
      assert.equal(result.error.code, scenario === 'tcp-error' ? 'ENETUNREACH' : 'CERT_HAS_EXPIRED');
    }
  }
  const ipv6 = await probeAddress('example.com', '2001:db8::1', 6, {
    connect: options => {
      assert.equal(options.family, 6);
      assert.equal(options.host, '2001:db8::1');
      throw Object.assign(new Error('unreachable'), { code: 'ENETUNREACH' });
    }
  });
  assert.equal(ipv6.error.code, 'ENETUNREACH');
  console.log('Passed: bounded DNS/TCP/TLS diagnostics, SNI, certificate verification, and socket cleanup.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
