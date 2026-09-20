import { fetchJson } from '../lib/http.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const GAP_MS = 6_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let queue = Promise.resolve();
let lastRun = 0;

/**
 * Run an Overpass query. The public servers rate-limit hard, so queries run one
 * at a time with a gap between them, alternating mirrors on failure.
 * @returns {Promise<Array<object>>} OSM elements.
 */
export function overpass(ql) {
  const run = async () => {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await sleep(Math.max(0, lastRun + GAP_MS - Date.now()));
      try {
        const r = await fetchJson(ENDPOINTS[attempt % ENDPOINTS.length], {
          method: 'POST', body: new URLSearchParams({ data: ql }), retries: 0, timeoutMs: 320_000,
        });
        return r.elements || [];
      } catch (err) {
        lastError = err;
        await sleep(20_000);
      } finally {
        lastRun = Date.now();
      }
    }
    throw lastError;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

const box = ([s, w, n, e], pad) => `${s - pad},${w - pad},${n + pad},${e + pad}`;

/** Mapped power lines within ~27 km of the area, so distances near the edge are right. */
export const powerLines = (bbox) =>
  overpass(`[out:json][timeout:300];way["power"~"^(line|minor_line)$"](${box(bbox, 0.25)});out geom tags;`);

/** Trunk, primary, secondary and tertiary roads. */
export const mainRoads = (bbox) =>
  overpass(`[out:json][timeout:300];way["highway"~"^(trunk|primary|secondary|tertiary)$"](${box(bbox, 0.05)});out geom tags;`);

/** Town and city points, used to leave out places that are probably on the grid. */
export const townPoints = async (bbox) =>
  (await overpass(`[out:json][timeout:120];node["place"~"^(town|city)$"](${box(bbox, 0.1)});out;`))
    .map((n) => ({ name: n.tags?.name || 'Town', lat: n.lat, lon: n.lon }));
