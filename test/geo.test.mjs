import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, segmentDistance, compassWord, makeProjector } from '../server/analysis/geo.js';

test('haversine: one degree of latitude is about 111 km', () => {
  assert.ok(Math.abs(haversineKm(10, 6, 11, 6) - 111.19) < 0.1);
});

test('segmentDistance: perpendicular, beyond an end, and a zero-length segment', () => {
  assert.equal(segmentDistance([0, 1], [-1, 0], [1, 0]), 1);
  assert.equal(segmentDistance([3, 4], [-1, 0], [0, 0]), 5);
  assert.equal(segmentDistance([3, 4], [0, 0], [0, 0]), 5);
});

test('compassWord names the direction of travel', () => {
  assert.equal(compassWord(10, 6, 10.1, 6), 'north');
  assert.equal(compassWord(10, 6, 10, 6.1), 'east');
  assert.equal(compassWord(10, 6, 9.9, 5.9), 'south-west');
});

test('projector distances agree with haversine across an LGA', () => {
  const xy = makeProjector(10);
  const [a, b] = [xy(9.9, 6.0), xy(10.3, 6.4)];
  const flat = Math.hypot(a[0] - b[0], a[1] - b[1]);
  assert.ok(Math.abs(flat - haversineKm(9.9, 6.0, 10.3, 6.4)) / flat < 0.01);
});
