import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSettlements, nameSettlement, schoolLevel, parseKv, isQuarterName } from '../server/analysis/settlements.js';

test('names: two facilities that agree beat a nearer neighbourhood pin (the Yakila case)', () => {
  const r = nameSettlement(
    [{ name: 'Mazadu', km: 0.2 }, { name: 'Unguwar Bakana', km: 0.3 }],
    ['Nuru Islamic School Yakila', 'Junior Secondary School Yakila', 'Yakila Primary Health Centre'],
  );
  assert.equal(r.name, 'Yakila');
  assert.equal(r.source, 'schools and clinics');
  assert.deepEqual(r.also, ['Mazadu', 'Unguwar Bakana']);
});

test('names: a facility word expands to the full village name that contains it', () => {
  assert.equal(nameSettlement([{ name: 'Tungan Bako', km: 0.4 }], ['Tungan Bako Primary School', 'Bako Clinic']).name, 'Tungan Bako');
  assert.equal(
    nameSettlement([{ name: 'Inga Dadin Kowa', km: 0.3 }], ['Inga Dadi Kowa Primary School', 'Nakowa Clinic', 'Sabon Mariga Primary Health Centre']).name,
    'Inga Dadin Kowa',
  );
});

test('names: without facility evidence, prefer a village over a neighbourhood, and say so', () => {
  assert.deepEqual(nameSettlement([{ name: 'Unguwar Turaki', km: 0.1 }, { name: 'Madaka', km: 0.6 }], []).name, 'Madaka');
  const quarterOnly = nameSettlement([{ name: 'Unguwan Wakili', km: 0.1 }], ['Central Primary School']);
  assert.equal(quarterOnly.name, 'Unguwan Wakili');
  assert.equal(quarterOnly.source, 'neighbourhood name');
  assert.deepEqual(nameSettlement([], []), { name: null, source: null, also: [] });
  assert.ok(isQuarterName('Anguwan Sarki') && !isQuarterName('Gunna'));
});

test('school levels and voltages read as plain words and kV', () => {
  assert.equal(schoolLevel('Primary', 'Pre Primary'), 'Pre-primary school');
  assert.equal(schoolLevel('Primary', 'Standard'), 'Primary school');
  assert.equal(schoolLevel('Secondary', 'Junior'), 'Junior secondary school');
  assert.equal(parseKv('132000;33000'), 132);
  assert.equal(parseKv('33000'), 33);
  assert.equal(parseKv(undefined), null);
  assert.equal(parseKv('high'), null);
});

// Two villages 5 km apart plus a lone hamlet; a town sits on village B; one power line and one road.
const block = (lat, lon, n, type = 'Small Settlement Area') => ({ lat, lon, building_count: n, extent_type: type });
const raw = {
  bbox: [9.9, 6.0, 10.1, 6.2],
  blocks: [
    block(10.0, 6.05, 120), block(10.001, 6.051, 80), block(10.002, 6.0505, 50),
    block(10.0, 6.0957, 300), block(10.0015, 6.096, 200),
    block(10.05, 6.15, 12, 'Hamlet'),
  ],
  names: [{ set_name: 'Unguwar Sarki', wardname: 'North', lat: 10.0008, lon: 6.0505 }, { set_name: 'Kasuwa', wardname: 'East', lat: 10.0005, lon: 6.0958 }],
  schools: [{ name: 'Gidan Doka Primary School', category: 'Primary', subtype: 'Primary', lat: 10.0009, lon: 6.0506 }],
  health: [{ facility_name: 'Gidan Doka Health Post', facility_type: 'Health Post', functional: 'Unknown', lat: 10.001, lon: 6.0508 }],
  markets: [{ market_nam: 'Far Market', lat: 10.03, lon: 6.03 }],
  power: [{ tags: { voltage: '132000' }, geometry: [{ lat: 9.9, lon: 6.1 }, { lat: 10.1, lon: 6.1 }] }],
  roads: [{ tags: { highway: 'primary', ref: 'A1' }, geometry: [{ lat: 9.99, lon: 6.0 }, { lat: 9.99, lon: 6.2 }] }],
  towns: [{ name: 'Kasuwa Town', lat: 10.0005, lon: 6.0958 }],
};

test('analyzeSettlements groups blocks, attaches facilities, and flags towns', () => {
  const s = analyzeSettlements(raw);
  assert.equal(s.length, 3);
  const [town, village, hamlet] = s; // largest first
  assert.equal(town.buildings, 500);
  assert.equal(town.town, 'Kasuwa Town');
  assert.equal(village.buildings, 250);
  assert.equal(village.town, null);
  assert.equal(village.name, 'Gidan Doka');
  assert.equal(village.ward, 'North');
  assert.equal(village.schools.length, 1);
  assert.equal(village.health.length, 1);
  assert.equal(village.markets.length, 0, 'a market 4 km away is not this village\'s');
  assert.equal(village.anchors, 2);
  assert.equal(village.gridKv, 132);
  assert.ok(Math.abs(village.gridKm - 5.5) < 0.2, `grid ~5.5 km, got ${village.gridKm}`);
  assert.ok(Math.abs(village.roadKm - 1.2) < 0.2, `road ~1.2 km, got ${village.roadKm}`);
  assert.equal(hamlet.buildings, 12);
  assert.equal(hamlet.name, null);
});

test('analyzeSettlements ignores blocks without coordinates or buildings', () => {
  const s = analyzeSettlements({ ...raw, blocks: [...raw.blocks, { lat: null, lon: null, building_count: 5 }, block(10.07, 6.07, 0)] });
  assert.equal(s.length, 3);
});
