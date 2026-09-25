/*
 * Adapted from God's Eye View (server/providers/common/rate-limit.js),
 * Copyright (c) 2026 Bilawal Sidhu, MIT License — see NOTICE.
 */
/**
 * Minimal fixed-window per-key rate limiter for the dev proxies. Not a hard
 * security boundary (dev-only), just a backstop so a runaway client can't hammer
 * the public Overpass / OSRM mirrors or exhaust this process.
 */
const RATE_LIMITER_MAX_KEYS = 2000;

export function makeRateLimiter({ windowMs, max, globalMax }) {
  const hits = new Map(); // key -> number[] (timestamps within window)
  let globalTimes = []; // all hits in window, for the global backstop
  return function allow(key) {
    const now = Date.now();
    globalTimes = globalTimes.filter((t) => now - t < windowMs);
    if (globalMax && globalTimes.length >= globalMax) return false; // global backstop
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    globalTimes.push(now);
    // Hard key cap so a key-rotating caller can't grow the map without bound.
    if (hits.size > RATE_LIMITER_MAX_KEYS) {
      const oldest = hits.keys().next().value;
      if (oldest !== undefined) hits.delete(oldest);
    }
    if (hits.size > 256) {
      for (const [k, v] of hits) {
        if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
      }
    }
    return true;
  };
}

/**
 * Client key for rate limiting. Locally this is the socket peer address; we do
 * NOT trust X-Forwarded-For there (client-controlled; a rotating value would mint
 * fresh quota and grow the limiter map). Behind a hosting proxy (TRUST_PROXY=1)
 * every socket is the proxy, so use the last X-Forwarded-For entry: the one the
 * proxy itself appended, which the client can't forge.
 */
export function clientKey(req) {
  if (process.env.TRUST_PROXY === '1') {
    const last = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (last) return last;
  }
  return String(req.socket?.remoteAddress || 'local');
}
