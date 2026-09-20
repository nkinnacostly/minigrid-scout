import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCache } from '../server/lib/cache.js';

test('cache computes once for concurrent callers and survives a restart', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'minigrid-cache-'));
  try {
    let calls = 0;
    const create = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { n: 42 }; };
    const a = createCache(dir);
    const [x, y] = await Promise.all([a.remember('lga/Niger/Rafi', 60_000, create), a.remember('lga/Niger/Rafi', 60_000, create)]);
    assert.deepEqual([x, y, calls], [{ n: 42 }, { n: 42 }, 1]);
    const b = createCache(dir); // a fresh process
    assert.deepEqual(await b.get('lga/Niger/Rafi', 60_000), { n: 42 });
    assert.equal(await b.get('lga/Niger/Rafi', -1), undefined, 'expired entries are ignored');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
