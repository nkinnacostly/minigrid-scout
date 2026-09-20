import * as Cesium from 'cesium';
import { reducedMotion } from './format.js';

// The keyless map stack God's Eye View uses: satellite imagery on Re:Earth terrain.
const REEARTH_TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const NIGERIA = Cesium.Rectangle.fromDegrees(2.6, 4.2, 14.7, 13.9);

const color = (css, alpha = 1) => Cesium.Color.fromCssColorString(css).withAlpha(alpha);
const COLORS = {
  boundary: color('#eef0ff', 0.95),
  power: color('#f0935a'),
  roadMajor: color('#e2e5f2', 0.7),
  road: color('#e2e5f2', 0.4),
  outline: color('#0d1020', 0.9),
  town: color('#ffffff'),
};
const ON_TOP = Number.POSITIVE_INFINITY;
const TOP_BADGES = 10;

export async function createGlobe(container) {
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
  });
  // Cesium draws at CSS pixels by default, which looks soft on a high-density
  // screen. Drawing at the screen's real pixels is the biggest single win for sharpness.
  viewer.useBrowserRecommendedResolution = false;
  viewer.scene.globe.maximumScreenSpaceError = 1.5;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80;
  Cesium.CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN)
    .then((terrain) => { viewer.terrainProvider = terrain; })
    .catch((err) => console.warn('Terrain unavailable, using a smooth globe:', err?.message || err));
  viewer.creditDisplay.addStaticCredit(new Cesium.Credit('Terrain: Re:Earth Terrain / Mapterhorn (CC BY 4.0)'));
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.globe.enableLighting = false;
  viewer.camera.setView({ destination: NIGERIA });
  return viewer;
}

/**
 * Swap the satellite imagery, removing whatever was there before. Esri needs no
 * key; Google is proxied through this app's own server so the key stays on this
 * machine; Bing comes through Cesium ion.
 */
export function setImagery(viewer, option, ionToken) {
  let provider;
  if (option.kind === 'google') {
    provider = Promise.resolve(new Cesium.UrlTemplateImageryProvider({
      url: '/api/imagery/google/{z}/{x}/{y}',
      maximumLevel: 20,
      credit: new Cesium.Credit(option.credit),
    }));
  } else if (option.kind === 'template') {
    provider = Promise.resolve(new Cesium.UrlTemplateImageryProvider({
      url: option.url,
      maximumLevel: option.maximumLevel ?? 19,
      credit: new Cesium.Credit(option.credit),
    }));
  } else if (option.kind === 'ion') {
    Cesium.Ion.defaultAccessToken = ionToken;
    provider = Cesium.createWorldImageryAsync();
  } else {
    provider = Cesium.ArcGisMapServerImageryProvider.fromUrl(option.url, {
      enablePickFeatures: false,
      credit: new Cesium.Credit(option.credit),
    });
  }
  const layers = viewer.imageryLayers;
  const previous = [];
  for (let i = 0; i < layers.length; i += 1) previous.push(layers.get(i));
  layers.add(Cesium.ImageryLayer.fromProviderAsync(provider, {}));
  for (const layer of previous) layers.remove(layer, true);
}

/**
 * Report how high the camera is above the ground, so the app can say when the
 * imagery has run out of detail.
 * @param {(metresAboveGround: number) => void} onChange
 */
export function watchCameraHeight(viewer, onChange) {
  viewer.camera.percentageChanged = 0.2;
  const report = () => {
    const carto = viewer.scene.globe.ellipsoid.cartesianToCartographic(viewer.camera.positionWC);
    const ground = viewer.scene.globe.getHeight(carto);
    onChange(carto.height - (Number.isFinite(ground) ? ground : 0));
  };
  viewer.camera.changed.addEventListener(report);
  viewer.camera.moveEnd.addEventListener(report);
  let last = 0;
  viewer.scene.postRender.addEventListener(() => {
    const now = Date.now();
    if (now - last < 400) return;
    last = now;
    report();
  });
  report();
}

/**
 * Every settlement marker is a small canvas image on one billboard. (Cesium draws
 * ground-clamped "points" as billboards too, and an entity gets only one, so
 * mixing points and badges on the same entity makes them overwrite each other.)
 * Drawn at 2x for sharp edges; cached per look.
 */
const markerCache = new Map();
function marker(key, size, draw) {
  if (!markerCache.has(key)) {
    const canvas = Object.assign(document.createElement('canvas'), { width: size * 2, height: size * 2 });
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    draw(ctx, size);
    markerCache.set(key, { image: canvas, size });
  }
  return markerCache.get(key);
}
const circle = (ctx, size, fill, stroke, strokeWidth) => {
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - strokeWidth / 2 - 0.5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (strokeWidth) { ctx.lineWidth = strokeWidth; ctx.strokeStyle = stroke; ctx.stroke(); }
};
const rankBadge = (rank, selected) => marker(`rank:${rank}:${selected}`, 30, (ctx, size) => {
  circle(ctx, size, selected ? '#ffd479' : '#c5ccff', '#0d1020', 2);
  ctx.fillStyle = '#0d1020';
  ctx.font = '600 13px "JetBrains Mono", Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), size / 2, size / 2 + 0.5);
});
const candidateDot = (px, selected) => marker(`cand:${px}:${selected}`, px + (selected ? 6 : 2), (ctx, size) =>
  circle(ctx, size, '#8e9cf5', selected ? '#ffd479' : '#0d1020', selected ? 3 : 1.2));
const hamletDot = (selected) => marker(`hamlet:${selected}`, selected ? 10 : 5, (ctx, size) =>
  circle(ctx, size, selected ? '#ffd479' : 'rgba(215, 219, 239, 0.75)', '#0d1020', selected ? 1.5 : 0));
const townSquare = () => marker('town', 12, (ctx, size) => {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0d1020';
  ctx.lineWidth = 2;
  ctx.fillRect(1.5, 1.5, size - 3, size - 3);
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3);
});

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

export class AreaLayer {
  constructor(viewer, { onPick, onHover }) {
    this.viewer = viewer;
    this.ds = new Cesium.CustomDataSource('area');
    viewer.dataSources.add(this.ds);
    this.bySettlement = new Map();
    this.orbitOff = null;

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((e) => onPick(this.#settlementAt(e.position)), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handler.setInputAction((e) => onHover(this.#settlementAt(e.endPosition), e.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    const stop = () => this.stopOrbit();
    viewer.scene.canvas.addEventListener('pointerdown', stop);
    viewer.scene.canvas.addEventListener('wheel', stop, { passive: true });
  }

  #settlementAt(position) {
    if (!position) return null;
    const picked = this.viewer.scene.pick(position);
    return picked?.id?.settlementId ?? null;
  }

  /** Draw the area: boundary, roads, power lines and one entity per settlement. */
  draw(analysis) {
    const { entities } = this.ds;
    entities.suspendEvents();
    entities.removeAll();
    this.bySettlement.clear();
    const line = (pts, width, material) => entities.add({
      polyline: { positions: Cesium.Cartesian3.fromDegreesArray(pts.flatMap(([lat, lon]) => [lon, lat])), width, material, clampToGround: true },
    });
    for (const road of analysis.roads) {
      const major = road.cls === 'trunk' || road.cls === 'primary';
      line(road.pts, major ? 2.5 : 1.5, major ? COLORS.roadMajor : COLORS.road);
    }
    for (const p of analysis.power) {
      line(p.pts, 3, new Cesium.PolylineDashMaterialProperty({ color: COLORS.power, dashLength: 18 }));
    }
    for (const ring of analysis.rings) {
      line(ring.map(([lon, lat]) => [lat, lon]), 2.5, COLORS.boundary);
    }
    for (const s of analysis.settlements) {
      const entity = entities.add({
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat),
        billboard: {
          image: hamletDot(false).image, width: 5, height: 5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: ON_TOP,
        },
        label: s.town && s.buildings >= 100 ? {
          text: s.townName, font: '700 13px "Atkinson Hyperlegible", sans-serif', fillColor: COLORS.town, outlineColor: COLORS.outline,
          outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(10, 0),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: ON_TOP, distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 400_000),
        } : undefined,
      });
      entity.settlementId = s.id;
      this.bySettlement.set(s.id, { entity, s });
    }
    entities.resumeEvents();
  }

  /** Restyle every settlement for the current ranking and selection. */
  style({ rankById, minBuildings, selectedId }) {
    for (const { entity, s } of this.bySettlement.values()) {
      const r = rankById.get(s.id);
      const selected = s.id === selectedId;
      let m;
      if (r && r.rank <= TOP_BADGES) m = rankBadge(r.rank, selected);
      else if (s.town && s.buildings >= minBuildings) m = townSquare();
      else if (r) m = candidateDot(Math.round(5 + Math.sqrt(s.buildings) / 3.2), selected);
      else m = hamletDot(selected);
      const b = entity.billboard;
      b.image = m.image;
      b.width = m.size;
      b.height = m.size;
      b.eyeOffset = new Cesium.Cartesian3(0, 0, r ? (r.rank <= TOP_BADGES ? -30 : -10) : 0);
    }
  }

  flyToArea(analysis) {
    this.stopOrbit();
    const [south, west, north, east] = analysis.bbox;
    const sphere = Cesium.BoundingSphere.fromRectangle3D(Cesium.Rectangle.fromDegrees(west, south, east, north));
    this.viewer.camera.flyToBoundingSphere(sphere, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-65), sphere.radius * 2.4),
      duration: reducedMotion() ? 0 : 2.5,
    });
  }

  /** Fly in low over a settlement, then circle it slowly until the user takes over. */
  async flyToSettlement(s) {
    this.stopOrbit();
    let height = 0;
    try {
      const [c] = await withTimeout(Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, [Cesium.Cartographic.fromDegrees(s.lon, s.lat)]), 1500);
      height = Number.isFinite(c.height) ? c.height : 0;
    } catch {
      /* flat fallback */
    }
    const center = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, height);
    const range = Math.max(1800, (s.radiusKm || 0.3) * 1000 * 3.6);
    const pitch = Cesium.Math.toRadians(-35);
    this.viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(center, 50), {
      offset: new Cesium.HeadingPitchRange(this.viewer.camera.heading, pitch, range),
      duration: reducedMotion() ? 0 : 2.2,
      complete: () => { if (!reducedMotion()) this.startOrbit(center, pitch, range); },
    });
  }

  startOrbit(center, pitch, range) {
    this.stopOrbit();
    let heading = this.viewer.camera.heading;
    this.orbitOff = this.viewer.clock.onTick.addEventListener(() => {
      heading += 0.0012;
      this.viewer.camera.lookAt(center, new Cesium.HeadingPitchRange(heading, pitch, range));
    });
  }

  stopOrbit() {
    if (!this.orbitOff) return;
    this.orbitOff();
    this.orbitOff = null;
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }
}
