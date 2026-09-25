import test from 'node:test';
import assert from 'node:assert/strict';
import { splitOsmLayers } from '../server/sources/overpass.js';

const way = (id, tags) => ({ type: 'way', id, tags, geometry: [{ lat: 9, lon: 6 }, { lat: 9.1, lon: 6.1 }] });
const node = (id, tags) => ({ type: 'node', id, lat: 9.5, lon: 6.5, tags });

test('one combined OpenStreetMap answer splits back into power, roads and towns', () => {
  const { power, roads, towns } = splitOsmLayers([
    way(1, { power: 'line', voltage: '132000' }),
    way(2, { power: 'minor_line' }),
    way(3, { highway: 'primary', ref: 'F215' }),
    way(4, { highway: 'tertiary' }),
    node(5, { place: 'town', name: 'Kagara' }),
    node(6, { place: 'city' }),
  ]);
  assert.deepEqual(power.map((w) => w.id), [1, 2]);
  assert.deepEqual(roads.map((w) => w.id), [3, 4]);
  assert.deepEqual(towns, [{ name: 'Kagara', lat: 9.5, lon: 6.5 }, { name: 'Town', lat: 9.5, lon: 6.5 }]);
});

test('elements outside the three layers are dropped, and repeats kept once', () => {
  const { power, roads, towns } = splitOsmLayers([
    way(1, { power: 'cable' }),
    way(2, { highway: 'residential' }),
    node(3, { place: 'village' }),
    way(4, { power: 'line' }),
    way(4, { power: 'line' }),
    node(5, {}),
  ]);
  assert.deepEqual(power.map((w) => w.id), [4]);
  assert.deepEqual(roads, []);
  assert.deepEqual(towns, []);
});
