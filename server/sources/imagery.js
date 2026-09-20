import { fetchJson } from '../lib/http.js';

/**
 * Imagery choices. Esri works with no key; Google and Bing need the user's own
 * credentials and are only offered when those are configured.
 *
 * Esri "Clarity" carries sharper, more recent scenes than the standard layer in
 * many rural areas, but covers fewer zoom levels — so both are offered.
 */
export const IMAGERY = [
  {
    id: 'esri',
    label: 'Esri satellite',
    note: 'Free, worldwide. Detail runs out around 1 m in rural areas.',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    kind: 'arcgis',
    credit: 'Imagery: Esri, Maxar, Earthstar Geographics',
    detailFloorM: 350,
  },
  {
    id: 'clarity',
    label: 'Esri Clarity',
    note: 'Free, and usually sharper. Falls back to Esri satellite where Clarity has no tile.',
    url: '/api/imagery/tiles/clarity/{z}/{x}/{y}',
    kind: 'template',
    maximumLevel: 19,
    credit: 'Imagery: Esri Clarity / Esri, Maxar',
    detailFloorM: 450,
  },
  { id: 'google', label: 'Google satellite', note: 'Sharpest, but uses your Google key and is billed per use.', kind: 'google', credit: 'Imagery: Google', detailFloorM: 120, needs: 'GOOGLE_MAPS_API_KEY' },
  { id: 'bing', label: 'Bing satellite', note: 'Uses your Cesium ion token (free tier available).', kind: 'ion', credit: 'Imagery: Bing Maps, Microsoft', detailFloorM: 350, needs: 'CESIUM_ION_TOKEN' },
];

/**
 * A Google Map Tiles session, renewed when it expires. Google's terms forbid
 * storing their tiles, so this proxies each request and caches nothing.
 */
function googleSession(apiKey) {
  let current = null;
  return async () => {
    if (current && current.expiresAt > Date.now() + 60_000) return current.session;
    const r = await fetchJson(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      body: JSON.stringify({ mapType: 'satellite', language: 'en-GB', region: 'NG' }),
      retries: 1,
    });
    if (!r.session) throw new Error('Google did not return a tile session');
    current = { session: r.session, expiresAt: Number(r.expiry) * 1000 || Date.now() + 60 * 60_000 };
    return current.session;
  };
}

/** Handler for /api/imagery/google/{z}/{x}/{y}, or null when no key is configured. */
export function googleTileProxy(apiKey) {
  if (!apiKey) return null;
  const session = googleSession(apiKey);
  return async (z, x, y, res) => {
    const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(await session())}&key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!upstream.ok) {
      res.writeHead(upstream.status, { 'Content-Type': 'text/plain' });
      res.end(`Google tile service answered ${upstream.status}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'no-store', // Google's terms don't allow storing their tiles
    });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  };
}

const ESRI_TILES = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
const CLARITY_TILES = 'https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile';

/**
 * Serve an Esri tile, trying Clarity first and falling back to the standard
 * layer where Clarity has nothing — otherwise the globe shows holes. Also
 * sidesteps Clarity's metadata endpoint, which sends no CORS header.
 */
export async function esriTile(layer, z, x, y, res) {
  const candidates = layer === 'clarity' ? [CLARITY_TILES, ESRI_TILES] : [ESRI_TILES];
  for (const base of candidates) {
    try {
      const upstream = await fetch(`${base}/${z}/${y}/${x}`, { signal: AbortSignal.timeout(20_000) });
      if (!upstream.ok) continue;
      res.writeHead(200, {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=3600',
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    } catch {
      /* try the next source */
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('No tile');
}
