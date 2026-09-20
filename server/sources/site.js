import { fetchJson, getJsonHttps } from '../lib/http.js';

/** Estimated people within radiusKm (WorldPop 2020, CC BY 4.0). A rough model figure. */
export async function population(lat, lon, radiusKm = 1) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring = Array.from({ length: 33 }, (_, i) => {
    const a = (i * Math.PI) / 16;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] };
  const qs = new URLSearchParams({ dataset: 'wpgppop', year: '2020', geojson: JSON.stringify(geojson), runasync: 'false' });
  const r = await fetchJson(`https://api.worldpop.org/v1/services/stats?${qs}`, { timeoutMs: 45_000, retries: 1, backoffMs: 2_000 });
  const total = r?.data?.total_population;
  return Number.isFinite(total) ? Math.round(total) : null;
}

/** Solar yield per kWp at the best fixed tilt (PVGIS, © European Union). */
export async function solar(lat, lon) {
  const qs = new URLSearchParams({ lat, lon, peakpower: '1', loss: '14', optimalangles: '1', outputformat: 'json' });
  const r = await fetchJson(`https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?${qs}`, { timeoutMs: 45_000, retries: 1, backoffMs: 2_000 });
  const fixed = r.outputs.totals.fixed;
  const mount = r.inputs.mounting_system.fixed;
  return {
    yearly: fixed.E_y,
    daily: fixed.E_d,
    monthly: r.outputs.monthly.fixed.map((m) => m.E_m),
    tilt: mount.slope.value,
    azimuth: mount.azimuth.value,
    source: r.inputs.meteo_data.radiation_db,
  };
}

/** Elevation and slope from a 3x3 grid of terrain heights (Re:Earth Terrain / Mapterhorn, CC BY 4.0). */
export async function terrain(lat, lon, stepM = 50) {
  const dLat = stepM / 111_320;
  const dLon = stepM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const pts = [];
  for (const j of [1, 0, -1]) for (const i of [-1, 0, 1]) pts.push(`${(lon + i * dLon).toFixed(5)},${(lat + j * dLat).toFixed(5)}`);
  const r = await getJsonHttps(`https://terrain.reearth.land/heights.json?points=${pts.join(';')}`, { timeoutMs: 8_000 });
  const z = r.results.map((p) => p.elevation);
  const dzdx = ((z[2] + 2 * z[5] + z[8]) - (z[0] + 2 * z[3] + z[6])) / (8 * stepM);
  const dzdy = ((z[6] + 2 * z[7] + z[8]) - (z[0] + 2 * z[1] + z[2])) / (8 * stepM);
  return {
    elevationM: Math.round(z[4]),
    slopeDeg: Math.round((Math.atan(Math.hypot(dzdx, dzdy)) * 1800) / Math.PI) / 10,
  };
}
