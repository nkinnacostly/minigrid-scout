import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingCsv } from '../src/csv.js';

const row = (over = {}) => ({
  rank: 1, name: 'Yakila', nameSource: 'schools and clinics', townName: null, also: ['Mazadu'], ward: 'Gunna Central',
  lat: 9.94976, lon: 6.1417, buildings: 798, schools: [{}, {}], health: [], markets: [{}], gridKm: 10.7, gridKv: 132,
  roadKm: 0, road: 'F215', score: 89.64, parts: { customers: 93, grid: 74, anchors: 98, access: 95 }, ...over,
});
const analysis = { lga: 'Rafi', state: 'Niger' };

test('CSV has a header and one line per ranked settlement', () => {
  const lines = rankingCsv([row(), row({ rank: 2, name: 'Madaka' })], analysis).split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith('rank,name,name_confidence'));
  assert.ok(lines[1].startsWith('1,Yakila,good,Mazadu,Gunna Central,Rafi,Niger,9.94976,6.1417,798,2,0,1,10.7,132,0,F215,90,'));
});

test('CSV quotes commas and quotes, and defuses spreadsheet formulas', () => {
  const line = rankingCsv([row({ name: '=HYPERLINK("x")', also: ['A, B'], nameSource: 'neighbourhood name' })], analysis).split('\n')[1];
  assert.ok(line.includes(`"'=HYPERLINK(""x"")"`), line);
  assert.ok(line.includes('"A, B"'));
  assert.ok(line.includes(',uncertain,'));
});
