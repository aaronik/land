'use strict';

const assert = require('node:assert/strict');
const { createFetchOk } = require('./refresh-fetch');
const url = 'https://example.com/search?secret=hidden';
const timeout = new TypeError('fetch failed', {
  cause: Object.assign(new Error('Connect timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
});

function fixture(results, overrides = {}) {
  const calls = [], delays = [], logs = [];
  const fetchOk = createFetchOk({
    fetchImpl: async (...args) => {
      calls.push(args);
      const result = results[Math.min(calls.length - 1, results.length - 1)];
      if (result instanceof Error) throw result;
      return result;
    },
    wait: async ms => { delays.push(ms); },
    random: () => 0.5,
    now: () => Date.parse('2026-01-01T00:00:00Z'),
    logger: { log: line => logs.push(line), error: line => logs.push(line) },
    ...overrides
  });
  return { fetchOk, calls, delays, logs };
}

async function main() {
  const success = new Response('ok');
  let test = fixture([success]);
  assert.equal(await test.fetchOk(url), success);
  assert.equal(test.calls.length, 1);
  assert.deepEqual(test.delays, []);
  assert.equal(await success.text(), 'ok', 'successful body stays readable');

  test = fixture([timeout, new Response('ok')]);
  const body = new URLSearchParams({ page: '1' });
  await test.fetchOk(url, { method: 'POST', body, headers: { Accept: 'application/json' } });
  assert.equal(test.calls.length, 2);
  assert.deepEqual(test.delays, [2500]);
  for (const [, options] of test.calls) {
    assert.equal(options.body, body);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.dispatcher);
  }
  assert.ok(test.logs.some(line => line.includes('UND_ERR_CONNECT_TIMEOUT')));
  assert.ok(test.logs.some(line => line.includes('"connectTimeoutMs":60000')));
  assert.ok(test.logs.every(line => !line.includes('secret=hidden')));

  test = fixture([timeout]);
  await assert.rejects(test.fetchOk(url), error => error === timeout);
  assert.equal(test.calls.length, 4);
  assert.deepEqual(test.delays, [2500, 4500, 8500]);
  assert.ok(test.logs.at(-1).includes('"willRetry":false'));

  for (const status of [429, 500, 502, 503, 504]) {
    const failed = new Response('unavailable', { status });
    test = fixture([failed, new Response('ok')]);
    await test.fetchOk(url);
    assert.equal(test.calls.length, 2);
    assert.equal(failed.bodyUsed, true, 'failed response body is cancelled');
  }
  for (const status of [400, 401, 403, 404]) {
    test = fixture([new Response('bad request', { status })]);
    await assert.rejects(test.fetchOk(url), new RegExp(String(status)));
    assert.equal(test.calls.length, 1);
    assert.deepEqual(test.delays, []);
  }
  test = fixture(Array.from({ length: 4 }, () => new Response('unavailable', { status: 503 })));
  await assert.rejects(test.fetchOk(url), /503/);
  assert.equal(test.calls.length, 4);

  for (const retryAfter of ['10', 'Thu, 01 Jan 2026 00:00:10 GMT']) {
    test = fixture([new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }), new Response('ok')]);
    await test.fetchOk(url);
    assert.deepEqual(test.delays, [10_000]);
  }
  test = fixture([new Response('', { status: 429, headers: { 'Retry-After': '120' } })]);
  await assert.rejects(test.fetchOk(url), /429/);
  assert.equal(test.calls.length, 1, 'do not retry earlier than a long Retry-After');

  for (const error of [new Error('programming error'), new DOMException('aborted', 'AbortError')]) {
    test = fixture([error]);
    await assert.rejects(test.fetchOk(url), caught => caught === error);
    assert.equal(test.calls.length, 1);
  }
  const controller = new AbortController();
  test = fixture([timeout], { wait: async () => { controller.abort(); } });
  await assert.rejects(test.fetchOk(url, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(test.calls.length, 1, 'abort during backoff prevents another fetch');
  test = fixture([success]);
  await assert.rejects(test.fetchOk(url, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(test.calls.length, 0);
  console.log('Passed: bounded refresh retries, backoff, HTTP handling, diagnostics, and cancellation.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
