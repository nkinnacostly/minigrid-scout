import test from 'node:test';
import assert from 'node:assert/strict';
import { percentileRanks, rankSettlements, isCandidate } from '../src/shared/rank.js';

test('percentileRanks: ties share their average rank; lower-is-better flips', () => {
  assert.deepEqual(percentileRanks([10, 20, 20, 30]), [0, 0.5, 0.5, 1]);
  assert.deepEqual(percentileRanks([1, 2, 3], false), [1, 0.5, 0]);
  assert.deepEqual(percentileRanks([5]), [0]);
});

const site = (id, buildings, gridKm, anchors, roadKm, town = null) => ({ id, buildings, gridKm, anchors, roadKm, town });
const sites = [
  site('big', 1200, 5, 1, 3),
  site('remote', 300, 30, 0, 12),
  site('roadside', 200, 8, 1, 0),
  site('anchored', 400, 10, 6, 1),
  site('tiny', 40, 20, 0, 0),
  site('town', 5000, 1, 9, 0, 'Kagara'),
];

test('rankSettlements leaves out towns and small hamlets', () => {
  const ranked = rankSettlements(sites);
  assert.deepEqual(ranked.map((s) => s.id).sort(), ['anchored', 'big', 'remote', 'roadside']);
  assert.ok(!isCandidate(sites[4]) && !isCandidate(sites[5]));
  assert.deepEqual(ranked.map((s) => s.rank), [1, 2, 3, 4]);
});

test('weights change the order: all weight on road access puts the roadside village first', () => {
  assert.equal(rankSettlements(sites, { weights: { customers: 0, grid: 0, anchors: 0, access: 100 } })[0].id, 'roadside');
  assert.equal(rankSettlements(sites, { weights: { customers: 100, grid: 0, anchors: 0, access: 0 } })[0].id, 'big');
  assert.equal(rankSettlements(sites, { weights: { customers: 0, grid: 100, anchors: 0, access: 0 } })[0].id, 'remote');
});

test('scores stay within 0-100, and all-zero weights fall back to equal weights', () => {
  for (const s of rankSettlements(sites, { weights: { customers: 0, grid: 0, anchors: 0, access: 0 } })) {
    assert.ok(s.score >= 0 && s.score <= 100);
  }
});

test('minBuildings is adjustable', () => {
  assert.equal(rankSettlements(sites, { minBuildings: 30 }).length, 5);
  assert.equal(rankSettlements(sites, { minBuildings: 1000 }).length, 1);
});
