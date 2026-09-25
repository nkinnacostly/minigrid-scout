import { fetchJson } from '../lib/http.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const ATTEMPTS = 4;
const GAP_MS = 6_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let queue = Promise.resolve();
let lastRun = 0;

/**
 * Run an Overpass query. The public servers rate-limit hard, so queries run one
 * at a time with a gap between them, moving to the next mirror on failure.
 * @param {string} ql
 * @param {(attempt: number, attempts: number) => void} [onRetry] - Called before each retry.
 * @returns {Promise<Array<object>>} OSM elements.
 */
export function overpass(ql, onRetry = () => {}) {
  const run = async () => {
    let lastError;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await sleep(Math.max(0, lastRun + GAP_MS - Date.now()));
      const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
      try {
        const r = await fetchJson(endpoint, {
          method: 'POST', body: new URLSearchParams({ data: ql }), retries: 0, timeoutMs: 200_000,
        });
        return r.elements || [];
      } catch (err) {
        lastError = err;
        console.warn(`Overpass ${new URL(endpoint).host} failed (attempt ${attempt + 1} of ${ATTEMPTS}): ${err.message}`);
        if (attempt + 1 < ATTEMPTS) {
          onRetry(attempt + 2, ATTEMPTS);
          await sleep(20_000);
        }
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

const POWER = '^(line|minor_line)$';
const ROADS = '^(trunk|primary|secondary|tertiary)$';
const TOWNS = '^(town|city)$';

/** Sort the elements of an osmLayers() answer back into its three layers. */
export function splitOsmLayers(elements) {
  const pick = (type, key, pattern) => {
    const re = new RegExp(pattern);
    const seen = new Set();
    return elements.filter((e) => e.type === type && re.test(e.tags?.[key] ?? '') && !seen.has(e.id) && seen.add(e.id));
  };
  return {
    power: pick('way', 'power', POWER),
    roads: pick('way', 'highway', ROADS),
    towns: pick('node', 'place', TOWNS).map((n) => ({ name: n.tags?.name || 'Town', lat: n.lat, lon: n.lon })),
  };
}

/**
 * Everything the ranking needs from OpenStreetMap, in one request so a busy
 * server is waited on once rather than three times:
 *   power: power lines within ~27 km of the area, so distances near the edge are right
 *   roads: trunk, primary, secondary and tertiary roads
 *   towns: town and city points, used to leave out places that are probably on the grid
 */
export async function osmLayers(bbox, onRetry) {
  const elements = await overpass(
    '[out:json][timeout:180];'
      + `way["power"~"${POWER}"](${box(bbox, 0.25)});out geom tags;`
      + `way["highway"~"${ROADS}"](${box(bbox, 0.05)});out geom tags;`
      + `node["place"~"${TOWNS}"](${box(bbox, 0.1)});out;`,
    onRetry,
  );
  return splitOsmLayers(elements);
}
