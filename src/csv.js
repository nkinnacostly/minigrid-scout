import { displayName, reliableName } from './format.js';

/** Quote a CSV cell, and defuse values a spreadsheet would run as a formula. */
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rankingCsv(ranked, analysis) {
  const head = ['rank', 'name', 'name_confidence', 'also_known_as', 'ward', 'lga', 'state', 'lat', 'lon', 'buildings', 'schools', 'clinics', 'markets',
    'km_to_mapped_grid', 'grid_line_kv', 'km_to_main_road', 'main_road', 'score', 'score_customers', 'score_grid', 'score_anchors', 'score_access'];
  const rows = ranked.map((s) => [
    s.rank, displayName(s), reliableName(s) ? 'good' : 'uncertain', s.also.join('; '), s.ward, analysis.lga, analysis.state, s.lat, s.lon,
    s.buildings, s.schools.length, s.health.length, s.markets.length, s.gridKm, s.gridKv, s.roadKm, s.road,
    Math.round(s.score), s.parts.customers, s.parts.grid, s.parts.anchors, s.parts.access,
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

export function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
