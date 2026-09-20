const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text from outside data before putting it into HTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
export const num = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en') : '—');
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
export const displayName = (s) => s.townName || s.name || 'Unnamed settlement';
export const reliableName = (s) => s.nameSource === 'schools and clinics' || s.nameSource === 'village-name data';
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** "3 schools · clinic · market" */
export function anchorSummary(s) {
  const parts = [];
  if (s.schools.length) parts.push(plural(s.schools.length, 'school'));
  if (s.health.length) parts.push(s.health.length === 1 ? 'clinic' : plural(s.health.length, 'clinic'));
  if (s.markets.length) parts.push(s.markets.length === 1 ? 'market' : plural(s.markets.length, 'market'));
  return parts.join(' · ') || 'none mapped';
}

export const roadText = (s) => {
  if (s.roadKm == null) return 'No main road mapped nearby';
  const which = s.road && !/^(primary|secondary|tertiary|trunk)$/.test(s.road) ? ` (${s.road})` : '';
  return s.roadKm < 0.1 ? `On a main road${which}` : `${s.roadKm.toFixed(1)} km to a main road${which}`;
};
