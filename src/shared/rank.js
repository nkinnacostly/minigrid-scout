/**
 * Mini-grid site scoring. Shared by the server (default ranking) and the
 * browser (live re-ranking as the user moves the weight sliders).
 */

export const FACTORS = [
  { key: 'customers', label: 'Customers', short: 'Customers', help: 'More buildings means more people to sell power to.' },
  { key: 'grid', label: 'Distance from the grid', short: 'Grid distance', help: 'The farther the mapped grid, the less likely it arrives and takes your customers.' },
  { key: 'anchors', label: 'Anchor customers', short: 'Anchors', help: 'Schools, clinics and markets give steady daytime demand.' },
  { key: 'access', label: 'Road access', short: 'Road access', help: 'Near a main road means equipment is cheaper to deliver and maintain.' },
];

export const DEFAULT_WEIGHTS = Object.freeze({ customers: 40, grid: 25, anchors: 20, access: 15 });
export const DEFAULT_MIN_BUILDINGS = 100;

/** Caps stop one extreme value from dominating: past 25 km or 6 facilities, more doesn't help. */
const GRID_CAP_KM = 25;
const ANCHOR_CAP = 6;

/**
 * Rank of each value among the others, 0..1. Ties share their average rank.
 * @param {number[]} values
 * @param {boolean} [higherBetter=true]
 */
export function percentileRanks(values, higherBetter = true) {
  const order = values.map((v, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array(values.length).fill(0);
  const span = Math.max(1, values.length - 1);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && values[order[j + 1]] === values[order[i]]) j += 1;
    for (let k = i; k <= j; k += 1) ranks[order[k]] = (i + j) / 2 / span;
    i = j + 1;
  }
  return higherBetter ? ranks : ranks.map((r) => 1 - r);
}

/** Settlements eligible for ranking: big enough, and not a town that's probably on the grid. */
export const isCandidate = (s, minBuildings = DEFAULT_MIN_BUILDINGS) => s.buildings >= minBuildings && !s.town;

/**
 * Score and rank candidate settlements. Each factor is a percentile among the
 * candidates, so a score says "how this site compares with the rest of the LGA".
 * @param {Array<object>} settlements - From analyzeSettlements().
 * @param {{weights?: Record<string, number>, minBuildings?: number}} [opts]
 * @returns {Array<object>} Candidates with score (0-100), parts and rank, best first.
 */
export function rankSettlements(settlements, { weights = DEFAULT_WEIGHTS, minBuildings = DEFAULT_MIN_BUILDINGS } = {}) {
  const cands = settlements.filter((s) => isCandidate(s, minBuildings));
  const total = FACTORS.reduce((sum, f) => sum + Math.max(0, Number(weights[f.key]) || 0), 0);
  const w = Object.fromEntries(FACTORS.map((f) => [f.key, total > 0 ? Math.max(0, Number(weights[f.key]) || 0) / total : 1 / FACTORS.length]));
  const parts = {
    customers: percentileRanks(cands.map((s) => s.buildings)),
    grid: percentileRanks(cands.map((s) => Math.min(s.gridKm ?? GRID_CAP_KM, GRID_CAP_KM))),
    anchors: percentileRanks(cands.map((s) => Math.min(s.anchors, ANCHOR_CAP))),
    access: percentileRanks(cands.map((s) => s.roadKm ?? 99), false),
  };
  return cands
    .map((s, i) => {
      const p = Object.fromEntries(FACTORS.map((f) => [f.key, parts[f.key][i]]));
      const score = FACTORS.reduce((sum, f) => sum + w[f.key] * p[f.key], 0) * 100;
      return { ...s, score, parts: Object.fromEntries(FACTORS.map((f) => [f.key, Math.round(p[f.key] * 100)])) };
    })
    .sort((a, b) => b.score - a.score || b.buildings - a.buildings)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}
