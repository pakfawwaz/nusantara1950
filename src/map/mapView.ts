import ZONES from '../../config/zones.json';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// Vite bundling hides MapLibre's default worker location; point it at the shipped module worker explicitly.
maplibregl.setWorkerUrl(workerUrl);
import type { Feature, MultiLineString } from 'geojson';
import type { World } from '../world';
import { LOCKED_COLOR } from './palette';
import type { ModeResult } from './modes';

const OCEAN = '#cfe2ec';
const FILL_EXPR = ['to-color', ['coalesce', ['feature-state', 'color'], '#e4e0d6']];
export const INDONESIA_BOUNDS: [[number, number], [number, number]] = [[94.6, -11.4], [141.4, 6.4]];

function hatchImage(color = 'rgba(70,74,80,0.55)', flip = false): ImageData {
  const c = document.createElement('canvas'); c.width = c.height = 10; const g = c.getContext('2d') as CanvasRenderingContext2D;
  if (flip) { g.translate(10, 0); g.scale(-1, 1); }
  g.strokeStyle = color; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-2, 12); g.lineTo(12, -2); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(8, 12); g.lineTo(12, 8); g.stroke();
  return g.getImageData(0, 0, 10, 10);
}

export class MapView {
  readonly map: maplibregl.Map;
  private curColors: string[] = []; private curLocked: boolean[] = []; private selected = new Set<number>(); private hovered = -1;
  private curPrep: boolean[] = [];
  constructor(container: HTMLElement, readonly world: World) {
    this.map = new maplibregl.Map({
      container, style: { version: 8, sources: {}, layers: [{ id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } }] },
      center: [118, -2.5], zoom: 3.8,
      minZoom: 3.2, maxZoom: 13, maxBounds: [[60, -35], [175, 30]], attributionControl: false, dragRotate: false, boxZoom: false, doubleClickZoom: false, renderWorldCopies: false,
      pitchWithRotate: false, touchPitch: false
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.on('error', e => console.error('[maplibre]', e.error?.message ?? e));
  }

  /** Called when a foreign country is clicked (set by main). */
  onForeign?: (name: string) => void;

  ready(): Promise<void> {
    return new Promise(resolve => {
      this.map.on('load', () => {
        const w = this.world;
        this.map.addImage('hatch', hatchImage(), { pixelRatio: 1 });
        this.map.addImage('hatchPrep', hatchImage('rgba(140,47,43,0.75)', true), { pixelRatio: 1 });
        this.map.addSource('neighbors', { type: 'geojson', data: `${import.meta.env.BASE_URL}data/neighbors.json` });
        this.map.addLayer({ id: 'neighbors-fill', type: 'fill', source: 'neighbors', paint: { 'fill-color': '#cfc8b6', 'fill-opacity': 0.9 } });
        this.map.addLayer({ id: 'neighbors-line', type: 'line', source: 'neighbors', paint: { 'line-color': 'rgba(90,80,62,0.6)', 'line-width': 0.8, 'line-dasharray': [3, 2] } });
        this.map.on('click', 'neighbors-fill', e => { if (this.pick(e.point.x, e.point.y) >= 0) return; const nm = e.features?.[0]?.properties?.name; this.onForeign?.(String(nm ?? 'This country')); });
        this.map.addSource('kec', { type: 'geojson', data: { type: 'FeatureCollection', features: w.features.slice(0, w.n).filter((_, i) => w.alive[i]) }, promoteId: 'id', tolerance: 0.25, buffer: 32 });
        this.map.addLayer({ id: 'kec-fill', type: 'fill', source: 'kec', paint: { 'fill-color': FILL_EXPR as never, 'fill-antialias': false } });
        this.map.addLayer({ id: 'kec-locked', type: 'fill', source: 'kec', paint: { 'fill-pattern': 'hatch', 'fill-opacity': ['case', ['boolean', ['feature-state', 'locked'], false], 1, 0] } });
        this.map.addLayer({ id: 'kec-prep', type: 'fill', source: 'kec', paint: { 'fill-pattern': 'hatchPrep', 'fill-opacity': ['case', ['boolean', ['feature-state', 'prep'], false], 1, 0] } });
        for (const [id, w0, color, minz] of [['lines-kec', 0.4, 'rgba(60,45,30,0.38)', 6.2], ['lines-reg', 0.9, 'rgba(60,45,30,0.6)', 0], ['lines-prov', 2.0, 'rgba(45,30,18,0.9)', 0]] as const) {
          this.map.addSource(id, { type: 'geojson', data: this.emptyLine() });
          this.map.addLayer({ id, type: 'line', source: id, minzoom: minz, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, w0 * 0.5, 8, w0, 12, w0 * 1.7] } });
        }
        this.map.addSource('coast', { type: 'geojson', data: this.emptyLine() });
        this.map.addLayer({ id: 'coast', type: 'line', source: 'coast', paint: { 'line-color': 'rgba(35,50,60,0.75)', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 8, 0.8, 12, 1.4] } });
        this.map.addSource('infra', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        const isT = (t: string) => ['==', ['get', 't'], t] as never;
        this.map.addLayer({ id: 'infra-road-minor', type: 'line', source: 'infra', minzoom: 6.2, filter: ['all', isT('road'), ['<=', ['get', 'c'], 2]] as never, layout: { 'line-cap': 'round' }, paint: { 'line-color': ['match', ['get', 'c'], 1, '#8a7a5a', '#6f5d3a'], 'line-width': ['match', ['get', 'c'], 1, 0.9, 1.6] } });
        this.map.addLayer({ id: 'infra-road-major', type: 'line', source: 'infra', minzoom: 4.2, filter: ['all', isT('road'), ['>=', ['get', 'c'], 3]] as never, layout: { 'line-cap': 'round' }, paint: { 'line-color': ['match', ['get', 'c'], 3, '#b8472f', 4, '#c0392b', '#7d1d1d'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 9, ['match', ['get', 'c'], 3, 2.4, 3.4]] } });
        this.map.addLayer({ id: 'infra-rail-case', type: 'line', source: 'infra', minzoom: 4.2, filter: isT('rail'), paint: { 'line-color': '#2a2118', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 9, 3] } });
        this.map.addLayer({ id: 'infra-rail', type: 'line', source: 'infra', minzoom: 4.2, filter: isT('rail'), paint: { 'line-color': '#fffdf7', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.6], 'line-dasharray': [2.2, 2.2] } });
        this.map.addLayer({ id: 'infra-proj', type: 'line', source: 'infra', filter: isT('proj'), paint: { 'line-color': ['case', ['boolean', ['get', 'paused'], false], '#7a7f86', '#e08a1e'], 'line-width': 3.2, 'line-dasharray': [1.5, 1.2] } });
        this.map.addLayer({ id: 'infra-station', type: 'circle', source: 'infra', minzoom: 5.6, filter: isT('station'), paint: { 'circle-radius': ['match', ['get', 'l'], 2, 4.2, 2.8], 'circle-color': ['match', ['get', 'l'], 2, '#d6453d', '#f0a35a'], 'circle-stroke-color': '#2a2118', 'circle-stroke-width': 1 } });
        this.map.addLayer({ id: 'infra-port', type: 'circle', source: 'infra', minzoom: 4.2, filter: isT('port'), paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['+', 2, ['get', 'l']], 9, ['+', 4, ['*', 1.6, ['get', 'l']]]], 'circle-color': '#2b5f9e', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.4 } });
        this.map.addLayer({ id: 'infra-dep', type: 'circle', source: 'infra', minzoom: 5, filter: isT('dep'), paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#d9893a', 'circle-stroke-width': 2.2 } });
        this.map.addLayer({ id: 'infra-ind', type: 'circle', source: 'infra', minzoom: 4.6, filter: isT('ind'), paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4.6, 3, 9, 7], 'circle-color': ['match', ['get', 'o'], 'f', '#b8892d', 's', '#2a7f6f', '#7a5aa6'], 'circle-opacity': ['case', ['get', 'b'], 0.45, 1], 'circle-stroke-color': '#2a2118', 'circle-stroke-width': 1.2 } });
        this.map.addLayer({ id: 'infra-projpt', type: 'circle', source: 'infra', filter: isT('projpt'), paint: { 'circle-radius': 6, 'circle-color': 'rgba(224,138,30,0.25)', 'circle-stroke-color': '#e08a1e', 'circle-stroke-width': 2 } });
        this.map.addLayer({ id: 'hover-line', type: 'line', source: 'kec', paint: { 'line-color': '#1a2a3a', 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.0, 0] } });
        this.map.addLayer({ id: 'sel-line', type: 'line', source: 'kec', layout: { 'line-join': 'round' }, paint: { 'line-color': '#e0301e', 'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 3.0, 0] } });
        this.map.addSource('lanes', { type: 'geojson', data: { type: 'FeatureCollection', features: Object.entries(ZONES.lanes.routes).map(([name, c]) => ({ type: 'Feature' as const, properties: { name }, geometry: { type: 'LineString' as const, coordinates: c } })) } });
        this.map.addLayer({ id: 'lanes-line', type: 'line', source: 'lanes', paint: { 'line-color': 'rgba(40,90,150,0.55)', 'line-width': 2, 'line-dasharray': [1, 2.5] } });
        this.map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#1f8a8a', 'fill-opacity': 0.28 } });
        this.map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#0f5f5f', 'line-width': 1.6, 'line-dasharray': [2, 1] } });
        this.map.addSource('preview', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addLayer({ id: 'preview-fill', type: 'fill', source: 'preview', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.5 } });
        this.map.addLayer({ id: 'preview-pt', type: 'circle', source: 'preview', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.6 } });
        this.map.addLayer({ id: 'preview-line', type: 'line', source: 'preview', paint: { 'line-color': ['get', 'stroke'], 'line-width': ['case', ['==', ['get', 'kind'], 'cut'], 3, 2], 'line-dasharray': [2, 1.5] } });
        this.rebuildBoundaries();
        this.map.fitBounds(INDONESIA_BOUNDS, { padding: { top: 110, bottom: 40, left: 80, right: 380 }, animate: false });
        // Feature-state written before the GeoJSON tiles exist is not picked up by MapLibre, so only resolve once the source is loaded and the map idle.
        const done = () => { if (this.map.isSourceLoaded('kec')) { this.map.off('sourcedata', onData); this.map.once('idle', () => resolve()); } };
        const onData = () => done();
        this.map.on('sourcedata', onData); done();
      });
    });
  }
  private emptyLine(): Feature<MultiLineString> { return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [] } }; }

  /** Recompute boundary meshes from the editable arc store. Levels that an edit cannot have changed can be skipped. */
  rebuildBoundaries(levels: { kec?: boolean; reg?: boolean; prov?: boolean } = { kec: true, reg: true, prov: true }): void {
    const w = this.world, st = w.store; const kr = w.kecReg;
    const mk = (keep: (a: number, b: number) => boolean): Feature<MultiLineString> => ({ type: 'Feature', properties: {}, geometry: st.mesh(keep) as MultiLineString });
    const set = (id: string, f: Feature<MultiLineString>) => (this.map.getSource(id) as maplibregl.GeoJSONSource).setData(f);
    if (levels.kec) { set('lines-kec', mk((a, b) => a >= 0 && b >= 0 && a !== b)); set('coast', mk((a, b) => a < 0 || b < 0)); }
    if (levels.reg) set('lines-reg', mk((a, b) => a >= 0 && b >= 0 && a !== b && kr[a] !== kr[b]));
    if (levels.prov) set('lines-prov', mk((a, b) => a >= 0 && b >= 0 && a !== b && w.regProv[kr[a]] !== w.regProv[kr[b]]));
    this.refreshStates();
  }

  /** Per-kecamatan flags that depend on the admin structure: locked (Irian Barat) and persiapan hatching. */
  refreshStates(): void {
    const w = this.world;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue; const k = w.kecReg[i];
      const l = w.isLocked(i); if (this.curLocked[i] !== l) { this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { locked: l }); this.curLocked[i] = l; }
      const prep = k >= 0 && (w.regencies[k].status === 'preparing' || w.provinces[w.regProv[k]]?.status === 'preparing');
      if (this.curPrep[i] !== prep) { this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { prep }); this.curPrep[i] = prep; }
    }
  }
  refreshLocked(): void { this.refreshStates(); }

  /** Push changed / new / removed kecamatan polygons into the map source and forget their cached feature-state. */
  async syncFeatures(removedIds: string[], upserted: number[]): Promise<void> {
    const w = this.world; const src = this.map.getSource('kec') as maplibregl.GeoJSONSource;
    const up = upserted.filter(i => w.alive[i]);
    const removeIds = [...removedIds, ...upserted.filter(i => !w.alive[i]).map(i => w.ids[i]), ...up.map(i => w.ids[i])];
    await src.updateData({ remove: removeIds, add: up.map(i => w.features[i]) });
    for (const i of up) { this.curColors[i] = undefined as never; this.curLocked[i] = undefined as never; this.curPrep[i] = undefined as never; }
    for (const i of this.selected) if (up.includes(i)) this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { sel: true });
  }
  /** Drop selection entries that no longer exist. */
  prune(): void { const w = this.world; for (const i of [...this.selected]) if (i >= w.n || !w.alive[i]) this.selected.delete(i); }

  setInfra(fc: GeoJSON.FeatureCollection): void { (this.map.getSource('infra') as maplibregl.GeoJSONSource).setData(fc); }
  private zoneSig = '';
  /** Outline the special areas (teal, dashed). Cheap no-op when nothing changed. */
  setZones(zones: Array<{ id: number; kecs: number[] }>): void {
    const sig = zones.map(z => `${z.id}:${z.kecs.join(',')}`).join('|'); if (sig === this.zoneSig) return; this.zoneSig = sig; const w = this.world;
    const feats = zones.flatMap(z => z.kecs.filter(i => i < w.n && w.alive[i]).map(i => w.features[i]));
    (this.map.getSource('zones') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats });
  }
  setPreview(fc: GeoJSON.FeatureCollection | null): void { (this.map.getSource('preview') as maplibregl.GeoJSONSource).setData(fc ?? { type: 'FeatureCollection', features: [] }); }

  applyMode(res: ModeResult): void {
    const w = this.world;
    for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; const c = res.colors[i] ?? LOCKED_COLOR; if (this.curColors[i] !== c) { this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { color: c }); this.curColors[i] = c; } }
  }

  setSelection(sel: ReadonlySet<number>): void {
    const w = this.world;
    for (const i of this.selected) if (!sel.has(i)) this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { sel: false });
    for (const i of sel) if (!this.selected.has(i)) this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { sel: true });
    this.selected = new Set(sel);
  }
  setHover(i: number): void {
    if (i === this.hovered) return; const w = this.world;
    if (this.hovered >= 0) this.map.setFeatureState({ source: 'kec', id: w.ids[this.hovered] }, { hover: false });
    if (i >= 0) this.map.setFeatureState({ source: 'kec', id: w.ids[i] }, { hover: true });
    this.hovered = i;
  }
  pick(x: number, y: number): number {
    const f = this.map.queryRenderedFeatures([x, y], { layers: ['kec-fill'] })[0];
    const id = f?.properties?.id as string | undefined; return id === undefined ? -1 : (this.world.idIndex.get(id) ?? -1);
  }
  fitTo(bbox: [number, number, number, number], maxZoom = 11): void {
    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: { top: 120, bottom: 60, left: 90, right: 400 }, maxZoom, duration: 700 });
  }
}
