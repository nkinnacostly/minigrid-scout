import { fetchJson } from '../lib/http.js';

/** GRID3 Nigeria hosted feature services (CC BY 4.0). */
const BASE = 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/';
export const LAYERS = Object.freeze({
  lgas: 'Socioeconomic_Vulnerability_Profile_by_LGA',
  blocks: 'GRID3_NGA_settlement_extents_v4_1',
  names: 'Settlements_in_Nigeria',
  schools: 'Schools_in_Nigeria',
  health: 'GRID3_NGA_health_facility_v3_0',
  markets: 'Markets_in_Nigeria',
});

const layerInfo = new Map();
async function info(layer) {
  if (!layerInfo.has(layer)) layerInfo.set(layer, fetchJson(`${BASE}${layer}/FeatureServer/0?f=json`));
  return layerInfo.get(layer);
}

async function query(layer, params) {
  const r = await fetchJson(`${BASE}${layer}/FeatureServer/0/query`, {
    method: 'POST',
    body: new URLSearchParams({ f: 'json', ...params }),
  });
  if (r.error) throw new Error(`GRID3 ${layer}: ${r.error.message || 'query failed'}`);
  return r;
}

/** Every page of a query, following ArcGIS resultOffset pagination. */
async function queryAll(layer, params, onPage) {
  const { objectIdField, maxRecordCount = 1000 } = await info(layer);
  const out = [];
  for (let offset = 0; ;) {
    const r = await query(layer, { ...params, orderByFields: objectIdField, resultOffset: offset, resultRecordCount: maxRecordCount });
    const feats = r.features || [];
    out.push(...feats);
    onPage?.(out.length);
    if (!r.exceededTransferLimit && feats.length < maxRecordCount) return out;
    offset += feats.length;
  }
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** All Nigerian LGAs as {state, lga}, sorted. */
export async function listLgas() {
  const feats = await queryAll(LAYERS.lgas, { where: '1=1', outFields: 'statename,lganame', returnGeometry: 'false' });
  return feats
    .map((f) => ({ state: f.attributes.statename, lga: f.attributes.lganame }))
    .filter((x) => x.state && x.lga)
    .sort((a, b) => a.state.localeCompare(b.state) || a.lga.localeCompare(b.lga));
}

/** LGA boundary rings in [lon, lat]. */
export async function lgaBoundary(state, lga) {
  const r = await query(LAYERS.lgas, {
    where: `statename = ${quote(state)} AND lganame = ${quote(lga)}`,
    outFields: 'statename,lganame',
    returnGeometry: 'true',
    outSR: 4326,
  });
  const feat = r.features?.[0];
  if (!feat) throw new Error(`No boundary found for ${lga}, ${state}`);
  return feat.geometry.rings;
}

/**
 * Features of a layer inside a polygon, flattened to attributes + lat/lon.
 * Polygons come back as their centroid.
 */
export async function featuresInPolygon(layer, rings, outFields, { centroid = false, onPage } = {}) {
  const feats = await queryAll(layer, {
    geometry: JSON.stringify({ rings, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPolygon',
    inSR: 4326,
    outSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    ...(centroid ? { returnGeometry: 'false', returnCentroid: 'true' } : { returnGeometry: 'true' }),
  }, onPage);
  return feats.map((f) => {
    const g = f.centroid || f.geometry || {};
    return { ...f.attributes, lat: g.y, lon: g.x };
  });
}
