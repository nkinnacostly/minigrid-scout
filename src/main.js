import './style.css';
import { createGlobe, AreaLayer, setImagery, watchCameraHeight } from './globe.js';
import { rankSettlements, DEFAULT_WEIGHTS, DEFAULT_MIN_BUILDINGS } from './shared/rank.js';
import { populatePicker, renderFunnel, renderWeights, renderList, markSelected } from './sidebar.js';
import { renderBrief } from './brief.js';
import { rankingCsv, download } from './csv.js';
import { esc, num, displayName } from './format.js';

const $ = (id) => document.getElementById(id);
const ui = {
  state: $('state'), lga: $('lga'), run: $('run'), status: $('status'), results: $('results'), funnel: $('funnel'),
  weights: $('weights'), minBuildings: $('min-buildings'), reset: $('reset-weights'), list: $('ranklist'),
  listTitle: $('list-title'), exportBtn: $('export'), brief: $('brief'), tooltip: $('tooltip'),
  imagery: $('imagery'), imageryNote: $('imagery-note'), detailNote: $('detail-note'),
};
const app = {
  analysis: null, weights: { ...DEFAULT_WEIGHTS }, minBuildings: DEFAULT_MIN_BUILDINGS,
  ranked: [], rankById: new Map(), byId: new Map(), selectedId: null, site: new Map(), stream: null,
  imagery: null, imageryOptions: [], missingImagery: [], ionToken: null, cameraHeight: Infinity,
};
let viewer;
let layer;

const FIRST_RUN_HINT = '<span class="hint">The first time an area is ranked takes a minute or two while the data downloads. After that it opens instantly.</span>';
const setStatus = (html, kind = '') => { ui.status.className = `status ${kind}`; ui.status.innerHTML = html; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const siteKey = (s) => `${app.analysis.state}/${app.analysis.lga}/${s.id}`;


const IMAGERY_CHOICE = 'minigrid-scout:imagery';

/**
 * Say, only when it's true, that zooming closer won't reveal more — and point
 * at imagery that genuinely does go closer. Free layers with more zoom levels
 * don't count: they just stretch the same picture.
 */
function updateDetailNote() {
  const option = app.imagery;
  const floor = option?.detailFloorM ?? 0;
  const tooClose = app.cameraHeight < floor;
  ui.detailNote.hidden = !tooClose;
  if (!tooClose) return;
  const paid = (o) => o.kind === 'google' || o.kind === 'ion';
  const sharper = app.imageryOptions.find((o) => o.id !== option.id && paid(o) && (o.detailFloorM ?? 1e9) < floor);
  const locked = app.missingImagery?.[0];
  let advice = 'This is about as sharp as free imagery gets here.';
  if (sharper) advice = `${esc(sharper.label)} goes closer.`;
  else if (locked) advice = `${esc(locked.label)} goes closer, but needs <code>${esc(locked.needs)}</code> in <code>.env</code>.`;
  ui.detailNote.innerHTML = `You're closer than ${esc(option.label)} has detail for, so the picture won't get sharper. ${advice}`;
}

function chooseImagery(id) {
  const option = app.imageryOptions.find((o) => o.id === id) || app.imageryOptions[0];
  if (!option) return;
  app.imagery = option;
  try { localStorage.setItem(IMAGERY_CHOICE, option.id); } catch { /* private mode */ }
  setImagery(viewer, option, app.ionToken);
  ui.imagery.value = option.id;
  ui.imageryNote.textContent = option.note;
  updateDetailNote();
}

async function loadImageryOptions() {
  try {
    const res = await fetch('/api/imagery');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    app.imageryOptions = body.options;
    app.missingImagery = body.missing;
    app.ionToken = body.ionToken;
    ui.imagery.innerHTML = body.options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('');
    ui.imagery.disabled = false;
    ui.imagery.onchange = () => chooseImagery(ui.imagery.value);
    let saved = null;
    try { saved = localStorage.getItem(IMAGERY_CHOICE); } catch { /* private mode */ }
    chooseImagery(saved || 'esri');
    if (body.missing.length) {
      ui.imageryNote.innerHTML += `<br>${body.missing.map((m) => `${esc(m.label)} needs <code>${esc(m.needs)}</code> in <code>.env</code>`).join('. ')}.`;
    }
  } catch (err) {
    ui.imageryNote.textContent = `Couldn't load imagery choices (${err.message}).`;
  }
}

function parseHash() {
  const [state, lga] = location.hash.slice(1).split('/').map((p) => decodeURIComponent(p || ''));
  return state && lga ? { state, lga } : null;
}

function run() {
  const state = ui.state.value;
  const lga = ui.lga.value;
  app.stream?.close();
  closeBrief();
  ui.run.disabled = true;
  setStatus(`Starting ${esc(lga)}…${FIRST_RUN_HINT}`, 'working');
  history.replaceState(null, '', `#${encodeURIComponent(state)}/${encodeURIComponent(lga)}`);
  const stream = new EventSource(`/api/analysis?${new URLSearchParams({ state, lga })}`);
  app.stream = stream;
  let finished = false;
  const finish = () => { finished = true; stream.close(); ui.run.disabled = false; };
  stream.addEventListener('progress', (e) => setStatus(`${esc(JSON.parse(e.data).message)}…${FIRST_RUN_HINT}`, 'working'));
  stream.addEventListener('result', (e) => { finish(); show(JSON.parse(e.data)); });
  stream.addEventListener('failure', (e) => { finish(); setStatus(esc(JSON.parse(e.data).error), 'error'); });
  stream.onerror = () => {
    if (finished) return;
    finish();
    setStatus('Lost the connection to the local server. Check it is still running, then try again.', 'error');
  };
}

function show(analysis) {
  app.analysis = analysis;
  app.byId = new Map(analysis.settlements.map((s) => [s.id, s]));
  app.selectedId = null;
  layer.draw(analysis);
  rerank();
  layer.flyToArea(analysis);
  ui.results.hidden = false;
  const when = new Date(analysis.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  setStatus(`${esc(analysis.lga)}, ${esc(analysis.state)} State. Data downloaded ${when}.`);
}

function rerank() {
  if (!app.analysis) return;
  app.ranked = rankSettlements(app.analysis.settlements, { weights: app.weights, minBuildings: app.minBuildings });
  app.rankById = new Map(app.ranked.map((r) => [r.id, r]));
  renderFunnel(ui.funnel, app.analysis, app.ranked, app.minBuildings);
  ui.listTitle.textContent = `Ranked settlements (${num(app.ranked.length)})`;
  renderList(ui.list, app.ranked, app.selectedId, (id) => select(id));
  layer.style({ rankById: app.rankById, minBuildings: app.minBuildings, selectedId: app.selectedId });
  if (app.selectedId != null) refreshBrief();
}

function select(id) {
  if (id == null || !app.byId.has(id)) return;
  app.selectedId = id;
  const s = app.byId.get(id);
  markSelected(ui.list, id);
  layer.style({ rankById: app.rankById, minBuildings: app.minBuildings, selectedId: id });
  layer.flyToSettlement(s);
  refreshBrief();
  loadSite(s);
}

async function loadSite(s) {
  const key = siteKey(s);
  if (app.site.has(key) && !app.site.get(key)?.error) return;
  app.site.set(key, undefined);
  const r = Math.min(3, Math.max(1, (s.radiusKm || 0) + 0.3)).toFixed(1);
  try {
    const res = await fetch(`/api/site?${new URLSearchParams({ lat: s.lat, lon: s.lon, r })}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || res.statusText);
    app.site.set(key, body);
  } catch (err) {
    app.site.set(key, { error: err.message });
  }
  if (app.selectedId === s.id) refreshBrief();
}

function refreshBrief() {
  const s = app.byId.get(app.selectedId);
  if (!s) return;
  renderBrief(ui.brief, {
    s, r: app.rankById.get(s.id), total: app.ranked.length, analysis: app.analysis, minBuildings: app.minBuildings, site: app.site.get(siteKey(s)),
  });
}

function closeBrief() {
  ui.brief.hidden = true;
  if (app.selectedId == null) return;
  app.selectedId = null;
  markSelected(ui.list, null);
  layer?.stopOrbit();
  layer?.style({ rankById: app.rankById, minBuildings: app.minBuildings, selectedId: null });
}

function hover(id, pos) {
  const canvas = viewer.scene.canvas;
  if (id == null || !pos || !app.byId.has(id)) {
    ui.tooltip.hidden = true;
    canvas.style.cursor = '';
    return;
  }
  const s = app.byId.get(id);
  const r = app.rankById.get(id);
  ui.tooltip.innerHTML = `<b>${r ? `#${r.rank} ` : ''}${esc(displayName(s))}</b> <span>· ${num(s.buildings)} buildings${s.town ? ' · town' : ''}</span>`;
  ui.tooltip.style.left = `${pos.x}px`;
  ui.tooltip.style.top = `${pos.y}px`;
  ui.tooltip.hidden = false;
  canvas.style.cursor = 'pointer';
}

function exportCsv() {
  if (!app.ranked.length) return;
  download(`${slug(app.analysis.lga)}-${slug(app.analysis.state)}-mini-grid-ranking.csv`, rankingCsv(app.ranked, app.analysis));
}

function wireControls() {
  ui.run.onclick = run;
  const onWeights = debounce((w) => { app.weights = w; rerank(); }, 120);
  renderWeights(ui.weights, app.weights, onWeights);
  ui.minBuildings.onchange = () => { app.minBuildings = Number(ui.minBuildings.value); rerank(); };
  ui.reset.onclick = () => {
    app.weights = { ...DEFAULT_WEIGHTS };
    app.minBuildings = DEFAULT_MIN_BUILDINGS;
    ui.minBuildings.value = String(DEFAULT_MIN_BUILDINGS);
    renderWeights(ui.weights, app.weights, onWeights);
    rerank();
  };
  ui.exportBtn.onclick = exportCsv;
  ui.brief.addEventListener('click', (e) => {
    if (e.target.closest('.close')) closeBrief();
    if (e.target.closest('.retry-site') && app.selectedId != null) {
      const s = app.byId.get(app.selectedId);
      app.site.delete(siteKey(s));
      refreshBrief();
      loadSite(s);
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.brief.hidden) closeBrief(); });
}

async function init() {
  viewer = await createGlobe($('globe'));
  layer = new AreaLayer(viewer, { onPick: select, onHover: hover });
  watchCameraHeight(viewer, (metres) => { app.cameraHeight = metres; updateDetailNote(); });
  wireControls();
  await loadImageryOptions();
  try {
    const res = await fetch('/api/lgas');
    const lgas = await res.json();
    if (!res.ok) throw new Error(lgas.error || res.statusText);
    const fromHash = parseHash();
    const known = fromHash && lgas.some((x) => x.state === fromHash.state && x.lga === fromHash.lga);
    populatePicker(ui.state, ui.lga, lgas, known ? fromHash : { state: 'Niger', lga: 'Rafi' });
    ui.run.disabled = false;
    if (known) run();
    else if (fromHash) setStatus(`The link asked for ${esc(fromHash.lga)}, ${esc(fromHash.state)}, which isn't in the LGA list. Choose an area below.`, 'error');
    else setStatus(`Choose one of ${num(lgas.length)} LGAs, then rank its settlements.`);
  } catch (err) {
    setStatus(`Couldn't load the list of LGAs. ${esc(err.message)}`, 'error');
  }
}

init();

// Development-only handle for debugging in the browser console.
if (import.meta.env.DEV) window.__scout = { app, get viewer() { return viewer; }, get layer() { return layer; } };
