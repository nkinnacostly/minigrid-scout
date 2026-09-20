import { esc, num, displayName, reliableName, roadText } from './format.js';
import { FACTORS } from './shared/rank.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function sunChart(monthly) {
  const max = Math.max(...monthly);
  const low = monthly.indexOf(Math.min(...monthly));
  const bars = monthly.map((v, i) => {
    const h = (v / max) * 40;
    return `<rect class="bar${i === low ? ' low' : ''}" x="${i * 12 + 1}" y="${44 - h}" width="9" height="${h}"></rect>`
      + `<text class="lbl" x="${i * 12 + 5.5}" y="54" text-anchor="middle">${MONTHS[i][0]}</text>`;
  }).join('');
  return `<svg viewBox="0 0 144 56" role="img" aria-label="Monthly solar output; lowest in ${MONTHS[low]}">${bars}</svg>`;
}

function gridFact(s) {
  if (s.gridKm == null) return { v: 'None mapped', s: 'No power line is mapped within about 25 km.' };
  const high = s.gridKv == null || s.gridKv >= 66;
  return {
    v: `${s.gridKm.toFixed(1)} <small>km</small>`,
    s: high
      ? `Nearest mapped line is ${s.gridKv ? `${s.gridKv} kV transmission` : 'of unknown voltage'}. Villages can't connect to it directly, and local 33/11 kV lines aren't in open data. Check before a visit.`
      : `Nearest mapped line is ${s.gridKv} kV, the kind villages connect to. The grid may be close.`,
  };
}

function anchorList(s) {
  const items = [
    ...s.schools.map((x) => ({ name: x.name, what: x.level, km: x.km })),
    ...s.health.map((x) => ({ name: x.name, what: `${x.type || 'Health facility'} · working status ${String(x.functional || 'unknown').toLowerCase()}`, km: x.km })),
    ...s.markets.map((x) => ({ name: x.name || 'Market', what: 'Market', km: x.km })),
  ].sort((a, b) => a.km - b.km);
  if (!items.length) return '<p class="empty">None mapped. Worth checking on a visit: anchor customers make a mini-grid viable sooner.</p>';
  return `<ul class="anchors">${items.map((a) => `<li><span>${esc(a.name)}</span><span class="d">${a.km.toFixed(1)} km</span><span class="what">${esc(a.what)}</span></li>`).join('')}</ul>`;
}

function siteFacts(site, s) {
  if (!site) {
    return {
      people: '<span class="loading">loading…</span>',
      sun: '<p class="loading">Loading sun and land figures…</p>',
    };
  }
  if (site.error) {
    return { people: '—', sun: `<p class="empty">Couldn't load sun and land figures: ${esc(site.error)}</p>` };
  }
  const people = site.people != null ? `~${num(site.people)}` : '—';
  let sun = '';
  if (site.solar) {
    const { yearly, monthly } = site.solar;
    const low = monthly.indexOf(Math.min(...monthly));
    const high = monthly.indexOf(Math.max(...monthly));
    const drop = Math.round((1 - monthly[low] / monthly[high]) * 100);
    sun = `<div class="sun"><div class="fact"><span class="k">Solar yield</span><span class="v">${num(yearly)} <small>kWh per kWp a year</small></span>
      <span class="s">Size for ${MONTHS[low]}: the rainy season cuts output ${drop}% below ${MONTHS[high]}.</span></div>${sunChart(monthly)}</div>`;
  }
  if (site.terrain) {
    sun += `<div class="facts" style="margin-top:12px"><div class="fact"><span class="k">Slope</span><span class="v">${site.terrain.slopeDeg}°</span>
      <span class="s">${site.terrain.slopeDeg < 5 ? 'Gentle enough for ground-mounted panels' : 'Steep; check where panels would go'}</span></div>
      <div class="fact"><span class="k">Elevation</span><span class="v">${num(site.terrain.elevationM)} <small>m</small></span></div></div>`;
  }
  const missing = [site.people == null && 'people', !site.solar && 'sun', !site.terrain && 'slope'].filter(Boolean);
  if (missing.length) {
    sun += `<p class="empty" style="margin-top:10px">Couldn't load ${missing.join(', ')} this time. The free services behind them are sometimes slow.
      <button class="link retry-site" type="button">Try again</button></p>`;
  }
  return { people, sun };
}

/**
 * Render the site brief for one settlement.
 * @param {HTMLElement} el
 * @param {{s: object, r: object|undefined, total: number, analysis: object, minBuildings: number, site: object|undefined}} ctx
 */
export function renderBrief(el, { s, r, total, analysis, minBuildings, site }) {
  const facts = siteFacts(site, s);
  const grid = gridFact(s);
  let badge;
  let status = '';
  if (r) badge = `<span class="badge">#${r.rank} of ${num(total)}</span>`;
  else if (s.town) {
    badge = '<span class="badge muted">Town · not ranked</span>';
    status = '<p class="note">Towns near the power line are probably already connected, so they aren\'t ranked.</p>';
  } else {
    badge = '<span class="badge muted">Below the size cut-off</span>';
    status = `<p class="note">Fewer than ${num(minBuildings)} buildings. Places this size are usually better served by solar home kits.</p>`;
  }
  const nameNote = s.town || reliableName(s) ? ''
    : `<p class="note">${s.name ? 'Name uncertain: we only found a neighbourhood name here.' : 'No name found in the data.'}</p>`;
  const where = [s.ward && `${s.ward} ward`, `${analysis.lga} LGA`, `${analysis.state} State`].filter(Boolean).map(esc).join(' · ');
  const score = r ? `<section><h3>Score</h3><div class="scorebox"><span class="big">${Math.round(r.score)}<small>/100</small></span>
    <div class="parts">${FACTORS.map((f) => `<div class="part" title="${esc(f.label)}: ${esc(f.help)}"><span>${esc(f.short)}</span>
      <span class="track"><i style="width:${r.parts[f.key]}%"></i></span><output>${r.parts[f.key]}</output></div>`).join('')}</div></div>
    <p class="fine">Each bar compares this site with the others in ${esc(analysis.lga)}. 100 means the best in the LGA on that factor.</p></section>` : '';
  const maps = `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`;
  const radius = Math.min(3, Math.max(1, (s.radiusKm || 0) + 0.3)).toFixed(1);

  el.innerHTML = `
    <div class="brief-head">
      <div class="brief-top">${badge}<button class="close" type="button" aria-label="Close the site brief">×</button></div>
      <h2>${esc(displayName(s))}</h2>
      <p class="where">${where}</p>
      ${nameNote}${status}
    </div>
    ${score}
    <section>
      <h3>The two things that decide a site</h3>
      <div class="facts">
        <div class="fact"><span class="k">Buildings</span><span class="v">${num(s.buildings)}</span><span class="s">mapped from satellite images</span></div>
        <div class="fact"><span class="k">People</span><span class="v">${facts.people}</span><span class="s">2020 estimate, within ${radius} km</span></div>
        <div class="fact wide"><span class="k">To the mapped grid</span><span class="v">${grid.v}</span><span class="s">${grid.s}</span></div>
        <div class="fact wide"><span class="k">Road access</span><span class="s" style="font-size:14px;color:var(--ink)">${esc(roadText(s))}</span></div>
      </div>
    </section>
    <section><h3>Anchor customers</h3>${anchorList(s)}</section>
    <section><h3>Sun and land</h3>${facts.sun}</section>
    ${s.also.length ? `<section><h3>Other names nearby</h3><p class="empty">${s.also.map(esc).join(' · ')}</p></section>` : ''}
    <section>
      <div class="actions"><a class="ghost" href="${maps}" target="_blank" rel="noopener">Open in Google Maps</a></div>
      <p class="fine">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}. This is desk screening from open data. Confirm local power lines, existing mini-grids, security and what the community wants before committing.</p>
    </section>`;
  el.hidden = false;
}
