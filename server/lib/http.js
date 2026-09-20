/*
 * Adapted from God's Eye View (server/providers/common/http.js),
 * Copyright (c) 2026 Bilawal Sidhu, MIT License — see NOTICE.
 */
/**
 * Read a fetch() Response body as text with a hard byte cap. Rejects early on an
 * oversized Content-Length, then streams with a running cap so a chunked or
 * length-omitted response cannot blow past the limit. Throws { code:'RESPONSE_TOO_LARGE' }.
 */
export async function readResponseTextCapped(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    const err = new Error('Upstream response too large');
    err.code = 'RESPONSE_TOO_LARGE';
    throw err;
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    return text;
  }
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* no-op */
      }
      const err = new Error('Upstream response too large');
      err.code = 'RESPONSE_TOO_LARGE';
      throw err;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/** Parse a fetch() JSON response only after enforcing a hard byte cap. */
export async function readResponseJsonCapped(response, maxBytes) {
  return JSON.parse(await readResponseTextCapped(response, maxBytes));
}

/**
 * Return the existing promise for a cache key, or create one and remove it
 * only when that exact promise settles.
 */
export function coalesceProxyRequest(inFlight, key, create) {
  const existing = inFlight.get(key);
  if (existing) return { promise: existing, shared: true };
  let promise;
  promise = Promise.resolve()
    .then(create)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return { promise, shared: false };
}

import https from 'node:https';

const UA = 'minigrid-scout/0.1 (+local prototype)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch() JSON with a timeout, a byte cap and simple retries. Upstreams here are
 * free public services, so failures are expected and retried with a backoff.
 * @param {string} url
 * @param {{method?: string, body?: string|URLSearchParams, timeoutMs?: number,
 *          retries?: number, backoffMs?: number, maxBytes?: number}} [opts]
 */
export async function fetchJson(url, opts = {}) {
  const { method = 'GET', body, timeoutMs = 120_000, retries = 3, backoffMs = 8_000, maxBytes = 64 * 1024 * 1024 } = opts;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { 'User-Agent': UA, ...(body instanceof URLSearchParams ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const err = new Error(`${new URL(url).host} answered ${res.status}`);
        err.status = res.status;
        throw err;
      }
      return await readResponseJsonCapped(res, maxBytes);
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastError;
}

/**
 * GET JSON over node:https on a fresh connection each attempt. Some hosts
 * (terrain.reearth.land) reject Node's built-in fetch with a TLS "bad record
 * mac" alert every time, while plain https works reliably.
 */
export async function getJsonHttps(url, { timeoutMs = 10_000, retries = 2, backoffMs = 700, maxBytes = 8 * 1024 * 1024 } = {}) {
  const once = () => new Promise((resolve, reject) => {
    const req = https.get(url, { agent: false, timeout: timeoutMs, headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        const err = new Error(`${new URL(url).host} answered ${res.statusCode}`);
        err.status = res.statusCode;
        reject(err);
        return;
      }
      let size = 0;
      const chunks = [];
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) req.destroy(Object.assign(new Error('Upstream response too large'), { code: 'RESPONSE_TOO_LARGE' }));
        else chunks.push(c);
      });
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`${new URL(url).host} timed out`)));
    req.on('error', reject);
  });
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await once();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastError;
}
