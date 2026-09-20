import { promises as fsp } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { coalesceProxyRequest } from './http.js';

/**
 * Memory + disk JSON cache with single-flight fills. The upstreams are free
 * public services with tight quotas, so every result is kept on disk and a
 * value being computed is shared with anyone else who asks for it meanwhile.
 * @param {string} dir - Directory for the JSON files.
 */
export function createCache(dir) {
  const mem = new Map();
  const inFlight = new Map();

  const fileFor = (key) => {
    const safe = key.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 80);
    const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
    return path.join(dir, `${safe}-${hash}.json`);
  };

  async function get(key, ttlMs) {
    const now = Date.now();
    const hit = mem.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    try {
      const stored = JSON.parse(await fsp.readFile(fileFor(key), 'utf8'));
      if (now - stored.at < ttlMs) {
        mem.set(key, stored);
        return stored.value;
      }
    } catch {
      /* not cached yet */
    }
    return undefined;
  }

  async function set(key, value) {
    const stored = { at: Date.now(), value };
    mem.set(key, stored);
    await fsp.mkdir(dir, { recursive: true });
    const file = fileFor(key);
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(stored));
    await fsp.rename(`${file}.tmp`, file);
  }

  /** Return the cached value, or compute it once however many callers ask at the same time. */
  async function remember(key, ttlMs, create) {
    const hit = await get(key, ttlMs);
    if (hit !== undefined) return hit;
    return coalesceProxyRequest(inFlight, key, async () => {
      const value = await create();
      await set(key, value);
      return value;
    }).promise;
  }

  return { get, set, remember };
}
