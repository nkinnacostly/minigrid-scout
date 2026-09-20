# Minigrid Scout

Find and rank villages for solar mini-grids in any Nigerian LGA, on a 3D globe, from open data.

Pick a state and an LGA. Minigrid Scout finds every settlement from satellite-mapped buildings, names it, counts its schools, clinics and markets, measures how far it is from the mapped grid and a main road, and ranks the ones big enough for a mini-grid. Click a village to fly to it and open a site brief with people, sun, slope and anchor customers.

## Run it

Needs Node.js 24 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5178.

The first time you rank an LGA takes a minute or two while the data downloads. After that it's saved in `.cache/` and opens instantly.

## Using it

- **Rank settlements**: downloads and ranks the chosen LGA. The address bar updates (for example `#Niger/Rafi`), so you can bookmark or share an area.
- **Click a village** in the list or on the globe to fly to it and open its brief. Press Escape to close.
- **Adjust the score** to change what matters most, or the smallest village size to rank. The ranking updates as you move the sliders.
- **Export CSV** saves the full ranked list for Excel or Google Sheets.

## How the score works

Each ranked village is compared with the others in the same LGA on four things, then weighted:

| Factor | Default weight | Why it matters |
|---|---|---|
| Customers (buildings) | 40% | More buildings means more people to sell power to. |
| Distance from the mapped grid | 25% | The farther the grid, the less likely it arrives and takes your customers. |
| Anchor customers (schools, clinics, markets) | 20% | Steady daytime demand from the first day. |
| Road access | 15% | Cheaper to deliver and maintain equipment. |

Villages under 100 buildings (adjustable) aren't ranked; they're usually better served by solar home kits. Towns near the power line are left out because they're probably already connected.

## Know before a field visit

- **Only big power lines are mapped.** Local 33 and 11 kV lines aren't in any open data we found, so any village could already have local power. This is the biggest gap.
- **Existing mini-grids aren't checked.**
- **People figures are rough** (WorldPop 2020 model). The ranking uses buildings instead.
- **Names can be off.** A village is named from its schools and clinics when they agree, otherwise from the village-name list. Names marked "?" came from a neighbourhood name only.
- **Security, ability to pay and community views aren't included.** They need local knowledge.

## Map imagery, and why it goes blurry

Zoom in far enough and the picture turns to mush. That's the imagery running out of detail, not a display setting. Three things affect it:

- **The app draws at your screen's full resolution.** Cesium's default is half that, which looks soft on a high-density screen. Minigrid Scout turns this on.
- **Esri Clarity is usually sharper** than the standard Esri layer at the same zoom, and it's free. Where Clarity has no tile, the app falls back to standard Esri so the globe never shows holes.
- **Free imagery of rural Nigeria stops at roughly 1 m per pixel.** No setting recovers detail that was never captured. When you pass that point the app says so rather than letting you wonder.

Use the **Map imagery** picker to switch. For genuinely sharper pictures, add a key to `.env` (see `.env.example`):

- `GOOGLE_MAPS_API_KEY` — the sharpest option in most places. Needs billing enabled and is charged per use. Google's terms require showing their attribution and forbid storing their tiles, so the app proxies each tile and caches none. Check current pricing before leaving it switched on.
- `CESIUM_ION_TOKEN` — Bing imagery through Cesium ion, which has a free tier. Often similar to Esri.

Keys stay on your machine: the browser never sees the Google key, because tiles are fetched by this app's own server.

## Data and licences

| Data | Source | Licence |
|---|---|---|
| Buildings, village names, schools, health facilities, markets, LGA boundaries | GRID3 Nigeria | CC BY 4.0 |
| Population estimates | WorldPop | CC BY 4.0 |
| Roads, power lines, town locations | © OpenStreetMap contributors | ODbL |
| Solar yield | PVGIS © European Union | Free, with attribution |
| Terrain and slope | Re:Earth Terrain / Mapterhorn | CC BY 4.0 |
| Satellite imagery | Esri World Imagery and Esri Clarity | Esri terms of use |
| Sharper imagery (optional) | Google Map Tiles API, or Bing via Cesium ion | Your own key; provider terms apply |

All are free public services. They can be slow or briefly unavailable; the app retries and caches every answer. Attribution is shown in the app and must stay visible if you publish it.

## For developers

```bash
npm test        # unit tests for clustering, naming, scoring, caching and CSV
npm run build   # production build into dist/
```

- `server/`: the local API, mounted into the Vite server (`/api/lgas`, `/api/analysis`, `/api/site`)
  - `sources/`: GRID3, OpenStreetMap (Overpass), WorldPop, PVGIS and terrain clients
  - `analysis/settlements.js`: groups buildings into settlements, names them, measures distances
  - `lib/`: caching, rate limiting and HTTP helpers
- `src/`: the browser app. `shared/rank.js` is the scoring, used by both sides.

The globe setup, caching and rate-limiting code is adapted from [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) under the MIT licence; see `NOTICE`.
