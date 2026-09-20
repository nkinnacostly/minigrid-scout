import * as grid3 from '../sources/grid3.js';
import { powerLines, mainRoads, townPoints } from '../sources/overpass.js';
import { analyzeSettlements, parseKv } from './settlements.js';
import { r5 } from './geo.js';

/**
 * Download everything needed to rank one LGA.
 * @param {(step: string, message: string) => void} [progress]
 */
export async function fetchLgaRaw(state, lga, progress = () => {}) {
  progress('boundary', `Finding the ${lga} boundary`);
  const rings = await grid3.lgaBoundary(state, lga);
  const lons = rings.flat().map((p) => p[0]);
  const lats = rings.flat().map((p) => p[1]);
  const bbox = [Math.min(...lats), Math.min(...lons), Math.max(...lats), Math.max(...lons)];

  progress('blocks', 'Downloading mapped buildings');
  const blocks = await grid3.featuresInPolygon(grid3.LAYERS.blocks, rings, 'building_count,extent_type', {
    centroid: true,
    onPage: (n) => progress('blocks', `Downloading mapped buildings (${n.toLocaleString('en')} blocks so far)`),
  });
  progress('names', 'Downloading village names');
  const names = await grid3.featuresInPolygon(grid3.LAYERS.names, rings, 'set_name,wardname');
  progress('facilities', 'Downloading schools, clinics and markets');
  const [schools, health, markets] = await Promise.all([
    grid3.featuresInPolygon(grid3.LAYERS.schools, rings, 'name,category,subtype'),
    grid3.featuresInPolygon(grid3.LAYERS.health, rings, 'facility_name,facility_type,functional'),
    grid3.featuresInPolygon(grid3.LAYERS.markets, rings, 'market_nam'),
  ]);
  progress('osm', 'Downloading power lines from OpenStreetMap');
  const power = await powerLines(bbox);
  progress('osm', 'Downloading main roads from OpenStreetMap');
  const roads = await mainRoads(bbox);
  progress('osm', 'Downloading town locations from OpenStreetMap');
  const towns = await townPoints(bbox);
  return { state, lga, rings, bbox, blocks, names, schools, health, markets, power, roads, towns };
}

/** Turn downloaded records into what the app draws and ranks. */
export function buildAnalysis(raw) {
  const line = (w) => w.geometry.map((g) => [r5(g.lat), r5(g.lon)]);
  return {
    state: raw.state,
    lga: raw.lga,
    bbox: raw.bbox,
    rings: raw.rings.map((ring) => ring.map(([lon, lat]) => [r5(lon), r5(lat)])),
    settlements: analyzeSettlements(raw),
    power: raw.power.filter((w) => w.geometry?.length > 1).map((w) => ({ kv: parseKv(w.tags?.voltage), pts: line(w) })),
    roads: raw.roads.filter((w) => w.geometry?.length > 1).map((w) => ({ cls: w.tags?.highway, ref: w.tags?.ref || null, pts: line(w) })),
    towns: raw.towns,
    counts: { blocks: raw.blocks.length, names: raw.names.length, schools: raw.schools.length, health: raw.health.length, markets: raw.markets.length },
    generatedAt: new Date().toISOString(),
  };
}
