import path from 'node:path';
import { createCache } from './lib/cache.js';
import { makeRateLimiter, clientKey } from './lib/rate-limit.js';
import { listLgas } from './sources/grid3.js';
import { population, solar, terrain } from './sources/site.js';
import { fetchLgaRaw, buildAnalysis } from './analysis/lga.js';
import { IMAGERY, googleTileProxy, esriTile } from './sources/imagery.js';

const DAY = 86_400_000;
const KEEP = 30 * DAY;

const sendJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

/** Plain-words message for an upstream failure. */
const friendly = (err) => {
  const detail = err?.message || String(err);
  if (/timed? ?out|abort/i.test(detail)) return `A data source took too long to answer (${detail}). Try again in a minute.`;
  return `A data source didn't answer properly (${detail}). Try again in a minute.`;
};

/**
 * Local API for the app, mounted into the Vite dev/preview server.
 *   GET /api/lgas                      → [{state, lga}]
 *   GET /api/analysis?state=&lga=      → event stream: progress…, then result | failure
 *   GET /api/site?lat=&lon=&r=         → {people, solar, terrain} for one settlement
 */
export function minigridApi({ cacheDir = path.join(process.cwd(), '.cache'), googleApiKey, ionToken } = {}) {
  const cache = createCache(cacheDir);
  const analysisLimit = makeRateLimiter({ windowMs: 60_000, max: 6, globalMax: 30 });
  const siteLimit = makeRateLimiter({ windowMs: 60_000, max: 90, globalMax: 400 });
  const listeners = new Map();
  const googleTile = googleTileProxy(googleApiKey);
  const keys = { google: Boolean(googleApiKey), bing: Boolean(ionToken) };
  const lgaList = () => cache.remember('lgas', KEEP, listLgas);

  async function analysis(req, res, url) {
    const state = url.searchParams.get('state');
    const lga = url.searchParams.get('lga');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const known = (await lgaList()).some((x) => x.state === state && x.lga === lga);
    if (!known) {
      send('failure', { error: `There's no LGA called ${lga} in ${state} State.` });
      return res.end();
    }
    const key = `analysis/v1/${state}/${lga}`;
    const cached = await cache.get(key, KEEP);
    if (cached) {
      send('result', cached);
      return res.end();
    }
    if (!listeners.has(key) && !analysisLimit(clientKey(req))) {
      send('failure', { error: 'Too many new areas at once. Wait a minute, then try again.' });
      return res.end();
    }
    if (!listeners.has(key)) listeners.set(key, new Set());
    const audience = listeners.get(key);
    audience.add(send);
    const keepAlive = setInterval(() => !res.writableEnded && res.write(': still working\n\n'), 15_000);
    req.on('close', () => { audience.delete(send); clearInterval(keepAlive); });
    try {
      const result = await cache.remember(key, KEEP, async () => {
        const broadcast = (step, message) => { for (const s of listeners.get(key) || []) s('progress', { step, message }); };
        const raw = await fetchLgaRaw(state, lga, broadcast);
        broadcast('analyse', 'Grouping buildings into settlements and measuring distances');
        return buildAnalysis(raw);
      });
      send('result', result);
    } catch (err) {
      send('failure', { error: friendly(err) });
    } finally {
      clearInterval(keepAlive);
      audience.delete(send);
      if (!audience.size) listeners.delete(key);
      res.end();
    }
  }

  async function site(req, res, url) {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const radiusKm = Math.min(3, Math.max(1, Number(url.searchParams.get('r')) || 1));
    if (!(lat >= 4 && lat <= 14.5 && lon >= 2.5 && lon <= 15)) return sendJson(res, 400, { error: 'That point is outside Nigeria.' });
    const key = `site/v1/${lat.toFixed(4)},${lon.toFixed(4)},${radiusKm.toFixed(1)}`;
    const hit = await cache.get(key, KEEP);
    if (hit) return sendJson(res, 200, hit);
    if (!siteLimit(clientKey(req))) return sendJson(res, 429, { error: 'Too many lookups. Wait a moment, then try again.' });
    const [people, sun, land] = await Promise.allSettled([population(lat, lon, radiusKm), solar(lat, lon), terrain(lat, lon)]);
    const value = (r) => (r.status === 'fulfilled' ? r.value : null);
    const body = { people: value(people), peopleRadiusKm: radiusKm, solar: value(sun), terrain: value(land) };
    // Only keep complete answers, so a one-off upstream failure isn't remembered for a month.
    if ([people, sun, land].every((r) => r.status === 'fulfilled')) await cache.set(key, body);
    return sendJson(res, 200, body);
  }

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    try {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Only GET is supported.' });
      if (url.pathname === '/api/lgas') return sendJson(res, 200, await lgaList());
      if (url.pathname === '/api/imagery') {
        return sendJson(res, 200, {
          options: IMAGERY.filter((o) => !o.needs || keys[o.id]).map(({ needs, ...o }) => o),
          missing: IMAGERY.filter((o) => o.needs && !keys[o.id]).map((o) => ({ id: o.id, label: o.label, needs: o.needs })),
          ionToken: ionToken || null,
        });
      }
      if (url.pathname.startsWith('/api/imagery/tiles/')) {
        const [layer, z, x, y] = url.pathname.split('/').slice(4);
        const nums = [z, x, y].map(Number);
        if (!['clarity', 'esri'].includes(layer) || !nums.every((n) => Number.isInteger(n) && n >= 0) || nums[0] > 22) {
          return sendJson(res, 400, { error: 'Bad tile address.' });
        }
        return await esriTile(layer, ...nums, res);
      }
      if (url.pathname.startsWith('/api/imagery/google/')) {
        if (!googleTile) return sendJson(res, 404, { error: 'No Google key is configured.' });
        const [z, x, y] = url.pathname.split('/').slice(4).map(Number);
        if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 22) return sendJson(res, 400, { error: 'Bad tile address.' });
        if (!siteLimit(clientKey(req))) return sendJson(res, 429, { error: 'Too many tile requests.' });
        return await googleTile(z, x, y, res);
      }
      if (url.pathname === '/api/analysis') return await analysis(req, res, url);
      if (url.pathname === '/api/site') return await site(req, res, url);
      return sendJson(res, 404, { error: 'Unknown endpoint.' });
    } catch (err) {
      if (!res.headersSent) return sendJson(res, 502, { error: friendly(err) });
      return res.end();
    }
  }

  return {
    name: 'minigrid-api',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
