import { makeProjector, nearestWay, haversineKm, r5 } from './geo.js';

/** Words in facility names that never identify a village ("Primary", "Health", ...). */
const GENERIC = new Set(`primary secondary junior senior school schools sch pry jss sss lgea ube government govt gov't model
community islamic arabic nursery science technical college girls boys day health centre center clinic post dispensary phc
hospital general maternity comprehensive basic market of the and new old central st saint memorial private public quranic
tsangaya education unity comm integrated mission baptist ecwa catholic anglican ss sec pri pr c h p u b e l g a i s
universal`.split(/\s+/).filter(Boolean));

/** "Unguwar X" / "Anguwan X" means "X's quarter" in Hausa — a neighbourhood, not a village. */
export const isQuarterName = (name) => /^(unguwa|anguwa)/i.test(name);

const titleCase = (s) => s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, pre, c) => pre + c.toUpperCase());
const trimPunct = (s) => s.replace(/^[.,()'-]+|[.,()'-]+$/g, '');

/**
 * Name a settlement. Pins in village-name datasets are often off-centre or name a
 * neighbourhood, so facility names inside the settlement ("Yakila Primary Health
 * Centre", "JSS Yakila") are the stronger signal when two or more agree.
 * @param {Array<{name: string, km: number}>} names - Name points attached to the settlement, any order.
 * @param {string[]} facilityNames - School, clinic and market names inside it.
 * @returns {{name: string|null, source: string|null, also: string[]}}
 */
export function nameSettlement(names, facilityNames) {
  const labels = [...names].sort((a, b) => a.km - b.km).map((n) => n.name).filter(Boolean);
  // Vote on runs of non-generic words, so "Gidan Doka Primary School" offers
  // "Gidan", "Doka" and "Gidan Doka" — and a multi-word name can win whole.
  const votes = new Map();
  for (const facility of facilityNames) {
    const seen = new Set();
    const runs = [[]];
    for (const word of String(facility || '').replace(/\//g, ' ').split(/\s+/)) {
      const token = titleCase(trimPunct(word));
      if (token.length > 2 && !GENERIC.has(token.toLowerCase()) && !/^\d+$/.test(token)) runs.at(-1).push(token);
      else if (runs.at(-1).length) runs.push([]);
    }
    for (const run of runs) {
      for (let size = 1; size <= Math.min(3, run.length); size += 1) {
        for (let i = 0; i + size <= run.length; i += 1) {
          const phrase = run.slice(i, i + size).join(' ');
          if (!seen.has(phrase)) {
            seen.add(phrase);
            votes.set(phrase, (votes.get(phrase) || 0) + 1);
          }
        }
      }
    }
  }
  const startsWord = (label, phrase) => new RegExp(`(^|\\s)${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label.toLowerCase());
  let top = null;
  for (const [phrase, count] of votes) {
    const inLabel = labels.some((l) => startsWord(l, phrase));
    const words = phrase.split(' ').length;
    const better = !top || count > top.count
      || (count === top.count && inLabel && !top.inLabel)
      || (count === top.count && inLabel === top.inLabel && words > top.words);
    if (better) top = { phrase, count, inLabel, words };
  }
  let name;
  let source;
  if (top && (top.count >= 2 || top.inLabel)) {
    const full = labels.find((l) => !isQuarterName(l) && startsWord(l, top.phrase));
    name = full || top.phrase;
    source = 'schools and clinics';
  } else {
    const village = labels.find((l) => !isQuarterName(l));
    if (village) [name, source] = [village, 'village-name data'];
    else if (labels.length) [name, source] = [labels[0], 'neighbourhood name'];
    else return { name: null, source: null, also: [] };
  }
  const also = [...new Set(labels.filter((l) => l.toLowerCase() !== name.toLowerCase()))].sort().slice(0, 6);
  return { name, source, also };
}

/** Plain-words school level from GRID3 category/subtype. */
export function schoolLevel(category, subtype) {
  const sub = String(subtype || '').trim();
  if (String(category || '').trim() === 'Secondary') return `${sub || 'Secondary'} secondary school`.replace('Secondary secondary', 'Secondary');
  return /pre/i.test(sub) ? 'Pre-primary school' : 'Primary school';
}

/** First voltage in an OSM voltage tag ("132000;33000") in kV, or null. */
export function parseKv(voltage) {
  const first = String(voltage || '').split(';')[0].trim();
  return /^\d+$/.test(first) ? Math.round(Number(first) / 1000) : null;
}

/**
 * Group GRID3 settlement blocks into settlements and measure everything a
 * mini-grid developer checks first. Pure: takes downloaded records, fetches nothing.
 *
 * @param {object} raw
 * @param {Array<{lat, lon, building_count, extent_type}>} raw.blocks
 * @param {Array<{lat, lon, set_name, wardname}>} raw.names
 * @param {Array<{lat, lon, name, category, subtype}>} raw.schools
 * @param {Array<{lat, lon, facility_name, facility_type, functional}>} raw.health
 * @param {Array<{lat, lon, market_nam}>} raw.markets
 * @param {Array<{tags: object, geometry: Array<{lat, lon}>}>} raw.power - OSM power lines.
 * @param {Array<{tags: object, geometry: Array<{lat, lon}>}>} raw.roads - OSM main roads.
 * @param {Array<{name, lat, lon}>} raw.towns - OSM town/city nodes.
 * @param {[number, number, number, number]} raw.bbox - [south, west, north, east].
 * @param {{linkM?: number}} [opts] - Blocks closer than linkM metres join one settlement.
 * @returns {Array<object>} Settlements, largest first.
 */
export function analyzeSettlements(raw, { linkM = 300 } = {}) {
  const [south, , north] = raw.bbox;
  const xy = makeProjector((south + north) / 2);
  const cell = linkM / 1000;
  const blocks = raw.blocks.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon) && b.building_count > 0);
  const pts = blocks.map((b) => xy(b.lat, b.lon));

  // Union-find over a grid hash: link blocks whose centres are within linkM.
  const parent = pts.map((_, i) => i);
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; }
    return r;
  };
  const grid = new Map();
  const cellOf = (p) => [Math.floor(p[0] / cell), Math.floor(p[1] / cell)];
  pts.forEach((p, i) => {
    const k = cellOf(p).join(',');
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  pts.forEach((p, i) => {
    const [cx, cy] = cellOf(p);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
          if (j > i && Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1]) <= cell) parent[find(i)] = find(j);
        }
      }
    }
  });

  const nearestBlock = (lat, lon, maxKm) => {
    const p = xy(lat, lon);
    const [cx, cy] = cellOf(p);
    const reach = Math.floor(maxKm / cell) + 1;
    let best = null;
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) || []) {
          const d = Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1]);
          if (d <= maxKm && (!best || d < best.km)) best = { km: d, index: j };
        }
      }
    }
    return best;
  };

  const groups = new Map();
  blocks.forEach((_, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { members: [], names: [], schools: [], health: [], markets: [] });
    groups.get(root).members.push(i);
  });

  for (const n of raw.names) {
    if (!Number.isFinite(n.lat) || !n.set_name) continue;
    const hit = nearestBlock(n.lat, n.lon, 0.5);
    if (hit) groups.get(find(hit.index)).names.push({ name: n.set_name, ward: n.wardname, lat: n.lat, lon: n.lon });
  }
  const attach = (records, bucket, shape) => {
    for (const r of records) {
      if (!Number.isFinite(r.lat)) continue;
      const hit = nearestBlock(r.lat, r.lon, 0.4);
      if (hit) groups.get(find(hit.index))[bucket].push({ ...shape(r), lat: r.lat, lon: r.lon });
    }
  };
  attach(raw.schools, 'schools', (s) => ({ name: s.name, level: schoolLevel(s.category, s.subtype) }));
  attach(raw.health, 'health', (h) => ({ name: h.facility_name, type: h.facility_type, functional: h.functional }));
  attach(raw.markets, 'markets', (m) => ({ name: m.market_nam }));

  const project = (ways) => ways
    .filter((w) => Array.isArray(w.geometry) && w.geometry.length > 1)
    .map((w) => ({ tags: w.tags || {}, xy: w.geometry.map((g) => xy(g.lat, g.lon)) }));
  const power = project(raw.power);
  const roads = project(raw.roads);
  const towns = raw.towns.map((t) => ({ name: t.name, p: xy(t.lat, t.lon) }));

  const settlements = [];
  for (const g of groups.values()) {
    const members = g.members.map((i) => blocks[i]);
    const buildings = members.reduce((s, b) => s + b.building_count, 0);
    const lat = members.reduce((s, b) => s + b.lat * b.building_count, 0) / buildings;
    const lon = members.reduce((s, b) => s + b.lon * b.building_count, 0) / buildings;
    const c = xy(lat, lon);
    const radiusKm = Math.max(...g.members.map((i) => Math.hypot(pts[i][0] - c[0], pts[i][1] - c[1])));
    const types = [...new Set(members.map((b) => b.extent_type).filter(Boolean))].sort();

    const nearTown = towns.find((t) => Math.hypot(t.p[0] - c[0], t.p[1] - c[1]) <= Math.max(1.5, radiusKm + 0.5));
    const town = nearTown ? nearTown.name : types.includes('Built-up Area') ? 'built-up area' : null;

    const withKm = (list) => list.map((f) => ({ ...f, km: Math.round(haversineKm(lat, lon, f.lat, f.lon) * 10) / 10 }))
      .sort((a, b) => a.km - b.km);
    const schools = withKm(g.schools);
    const health = withKm(g.health);
    const markets = withKm(g.markets);
    const named = nameSettlement(
      g.names.map((n) => ({ name: n.name, km: haversineKm(lat, lon, n.lat, n.lon) })),
      [...schools, ...health, ...markets].map((f) => f.name),
    );
    const wardCounts = new Map();
    for (const n of g.names) if (n.ward) wardCounts.set(n.ward, (wardCounts.get(n.ward) || 0) + 1);
    const ward = [...wardCounts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const grid = nearestWay(c, power);
    const road = nearestWay(c, roads);
    settlements.push({
      name: named.name,
      nameSource: named.source,
      also: named.also,
      ward,
      town,
      townName: town === 'built-up area' ? named.name : town,
      lat: r5(lat),
      lon: r5(lon),
      buildings,
      blocks: members.length,
      radiusKm: Math.round(radiusKm * 100) / 100,
      types,
      schools: schools.map(({ lat: _a, lon: _b, ...s }) => s),
      health: health.map(({ lat: _a, lon: _b, ...s }) => s),
      markets: markets.map(({ lat: _a, lon: _b, ...s }) => s),
      anchors: schools.length + health.length + markets.length,
      gridKm: grid ? Math.round(grid.km * 10) / 10 : null,
      gridKv: grid ? parseKv(grid.tags.voltage) : null,
      roadKm: road ? Math.round(road.km * 10) / 10 : null,
      road: road ? road.tags.ref || road.tags.name || road.tags.highway || null : null,
    });
  }
  settlements.sort((a, b) => b.buildings - a.buildings);
  settlements.forEach((s, i) => { s.id = i + 1; });
  return settlements;
}
