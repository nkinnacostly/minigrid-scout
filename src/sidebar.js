import { esc, num, displayName, reliableName, anchorSummary } from './format.js';
import { FACTORS } from './shared/rank.js';

/** Fill the state and LGA pickers. */
export function populatePicker(stateEl, lgaEl, lgas, preferred) {
  const states = [...new Set(lgas.map((x) => x.state))];
  stateEl.innerHTML = states.map((s) => `<option>${esc(s)}</option>`).join('');
  const fillLgas = (state, pick) => {
    const list = lgas.filter((x) => x.state === state).map((x) => x.lga);
    lgaEl.innerHTML = list.map((l) => `<option>${esc(l)}</option>`).join('');
    if (pick && list.includes(pick)) lgaEl.value = pick;
  };
  stateEl.value = states.includes(preferred?.state) ? preferred.state : states[0];
  fillLgas(stateEl.value, preferred?.lga);
  stateEl.onchange = () => fillLgas(stateEl.value);
  stateEl.disabled = false;
  lgaEl.disabled = false;
}

export function renderFunnel(el, analysis, ranked, minBuildings) {
  const big = analysis.settlements.filter((s) => s.buildings >= minBuildings);
  const towns = big.filter((s) => s.town).length;
  el.innerHTML = `
    <div><b>${num(analysis.settlements.length)}</b><span>settlements found</span></div>
    <div><b>${num(big.length)}</b><span>with ${num(minBuildings)}+ buildings</span></div>
    <div><b>${num(towns)}</b><span>towns left out</span></div>
    <div class="final"><b>${num(ranked.length)}</b><span>ranked</span></div>`;
}

export function renderWeights(el, weights, onChange) {
  el.innerHTML = FACTORS.map((f) => `
    <div class="weight">
      <label for="w-${f.key}"><b>${esc(f.label)}</b><output id="o-${f.key}"></output></label>
      <input id="w-${f.key}" type="range" min="0" max="100" step="5" value="${weights[f.key]}" />
      <p>${esc(f.help)}</p>
    </div>`).join('');
  const show = () => {
    const total = FACTORS.reduce((t, f) => t + Number(el.querySelector(`#w-${f.key}`).value), 0);
    for (const f of FACTORS) {
      const v = Number(el.querySelector(`#w-${f.key}`).value);
      el.querySelector(`#o-${f.key}`).textContent = total ? `${Math.round((v / total) * 100)}%` : '25%';
    }
  };
  show();
  el.oninput = () => {
    show();
    onChange(Object.fromEntries(FACTORS.map((f) => [f.key, Number(el.querySelector(`#w-${f.key}`).value)])));
  };
}

export function renderList(el, ranked, selectedId, onSelect) {
  el.innerHTML = ranked.map((s) => `
    <li><button type="button" data-id="${s.id}" aria-current="${s.id === selectedId}">
      <span class="rk${s.rank <= 10 ? ' top' : ''}">${s.rank}</span>
      <span class="nm">${esc(displayName(s))}${reliableName(s) ? '' : ' <span style="color:var(--warn);font-weight:400">?</span>'}</span>
      <span class="sc">${Math.round(s.score)}</span>
      <span class="meta">${num(s.buildings)} buildings · ${esc(anchorSummary(s))}</span>
      <span class="bar"><i style="width:${Math.round(s.score)}%"></i></span>
    </button></li>`).join('');
  el.onclick = (e) => {
    const b = e.target.closest('button[data-id]');
    if (b) onSelect(Number(b.dataset.id));
  };
}

export function markSelected(el, selectedId) {
  for (const b of el.querySelectorAll('button[data-id]')) {
    const on = Number(b.dataset.id) === selectedId;
    b.setAttribute('aria-current', String(on));
    if (on) b.scrollIntoView({ block: 'nearest' });
  }
}
