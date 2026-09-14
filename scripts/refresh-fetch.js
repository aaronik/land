'use strict';

const { Agent } = require('undici');
const { setTimeout: sleep } = require('node:timers/promises');

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 4;
const MAX_DELAY_MS = 30_000;
const dispatcher = new Agent({ connectTimeout: CONNECT_TIMEOUT_MS });

function fetchErrorDetails(error) {
  const details = [];
  const seen = new Set();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    details.push(Object.fromEntries(
      ['name', 'message', 'code', 'errno', 'syscall', 'hostname', 'address', 'port']
        .filter(key => current[key] !== undefined)
        .map(key => [key, current[key]])
    ));
  }
  return details;
}

// These requests only read data, including the replayable MLS search POSTs.
// Do not use this helper for mutations or streaming request bodies.
function createFetchOk({ fetchImpl = fetch, wait = sleep, random = Math.random, logger = console, now = Date.now } = {}) {
  return async function fetchOk(url, options = {}) {
    const parsed = new URL(url);
    const target = `${parsed.origin}${parsed.pathname}`;
    const method = options.method || 'GET';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      options.signal?.throwIfAborted();
      const startedAt = now();
      const context = { method, target, attempt, maxAttempts: MAX_ATTEMPTS };
      logger.log(`[fetch] starting ${JSON.stringify({ ...context, connectTimeoutMs: CONNECT_TIMEOUT_MS })}`);
      let response;
      let failure;
      try {
        response = await fetchImpl(url, {
          ...options, dispatcher,
          headers: { 'User-Agent': 'Mozilla/5.0 shasta-land-map/1.0', ...(options.headers || {}) }
        });
      } catch (error) {
        failure = error;
      }
      let retryable;
      let retryAfterMs = 0;
      if (response) {
        logger.log(`[fetch] response ${JSON.stringify({ ...context, status: response.status, statusText: response.statusText, elapsedMs: now() - startedAt })}`);
        if (response.ok) return response;
        failure = new Error(`${response.status} ${response.statusText}: ${target}`);
        retryable = response.status === 429 || response.status >= 500;
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter !== null) {
          const seconds = Number(retryAfter);
          retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter) - now()) || 0;
        }
        // Release unsuccessful responses before attempting another connection.
        await response.body?.cancel().catch(() => {});
      } else {
        retryable = failure instanceof TypeError && failure.message === 'fetch failed';
      }
      const willRetry = retryable && !options.signal?.aborted && attempt < MAX_ATTEMPTS && retryAfterMs <= MAX_DELAY_MS;
      logger.error(`[fetch] failed ${JSON.stringify({ ...context, elapsedMs: now() - startedAt, willRetry, errors: fetchErrorDetails(failure) })}`);
      if (!willRetry) throw failure;
      const delayMs = Math.max(retryAfterMs, 2000 * 2 ** (attempt - 1) + Math.floor(random() * 1000));
      logger.log(`[fetch] retry ${JSON.stringify({ ...context, nextAttempt: attempt + 1, delayMs })}`);
      await wait(delayMs, undefined, { signal: options.signal });
    }
  };
}

module.exports = { createFetchOk, fetchOk: createFetchOk() };
