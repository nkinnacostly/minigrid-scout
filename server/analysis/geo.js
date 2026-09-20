const EARTH_R_KM = 6371;
const RAD = Math.PI / 180;

/** Great-circle distance in km. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2
    + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return EARTH_R_KM * 2 * Math.asin(Math.sqrt(a));
}

/**
 * Flat x/y in km around a reference latitude. Across one LGA (~100 km) the
 * error is well under 1%, which is plenty for ranking distances.
 * @returns {(lat: number, lon: number) => [number, number]}
 */
export function makeProjector(lat0) {
  const kx = 111.32 * Math.cos(lat0 * RAD);
  const ky = 110.57;
  return (lat, lon) => [lon * kx, lat * ky];
}

/** Distance from point p to segment ab, all in projected km. */
export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Nearest projected polyline to a point.
 * @param {[number, number]} p
 * @param {Array<{xy: Array<[number, number]>, tags: object}>} ways
 * @returns {{km: number, tags: object} | null}
 */
export function nearestWay(p, ways) {
  let best = null;
  for (const way of ways) {
    for (let i = 1; i < way.xy.length; i += 1) {
      const d = segmentDistance(p, way.xy[i - 1], way.xy[i]);
      if (!best || d < best.km) best = { km: d, tags: way.tags };
    }
  }
  return best;
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Compass word for the direction from one point to another. */
export function compassWord(fromLat, fromLon, toLat, toLon) {
  const y = Math.sin((toLon - fromLon) * RAD) * Math.cos(toLat * RAD);
  const x = Math.cos(fromLat * RAD) * Math.sin(toLat * RAD)
    - Math.sin(fromLat * RAD) * Math.cos(toLat * RAD) * Math.cos((toLon - fromLon) * RAD);
  const deg = (Math.atan2(y, x) / RAD + 360) % 360;
  return COMPASS[Math.floor((deg + 22.5) / 45) % 8];
}

/** Round a coordinate for transport; 5 decimals is about 1 m. */
export const r5 = (v) => Math.round(v * 1e5) / 1e5;
