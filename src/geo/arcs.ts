import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Grid } from './grid';
import { gridOf } from './grid';

/** Owner id meaning "no kecamatan on this side" (open sea / outside the country). */
export const NONE = -1;

export interface ArcSpec { pts: Int32Array; a: number; b: number }
/** Everything needed to roll an edit back exactly. */
export interface ArcUndo { firstNewArc: number; killed: number[]; owners: Array<[number, number, number]> }

/**
 * Editable boundary store. Every boundary polyline is stored once with the two faces (kecamatan) on either side.
 * Boundary meshes (province / regency / kecamatan / coast lines) and adjacency are derived by scanning the arcs.
 */
export class ArcStore {
  pts: Int32Array[] = []; oa: number[] = []; ob: number[] = []; alive: boolean[] = [];
  readonly grid: Grid;
  constructor(topo: Topology, kec: GeometryCollection) {
    this.grid = gridOf(topo.transform as { scale: [number, number]; translate: [number, number] });
    for (const arc of topo.arcs) { const p = new Int32Array(arc.length * 2); let x = 0, y = 0; arc.forEach(([dx, dy], i) => { x += dx; y += dy; p[i * 2] = x; p[i * 2 + 1] = y; }); this.pts.push(p); }
    const n = this.pts.length; this.oa = new Array(n).fill(NONE); this.ob = new Array(n).fill(NONE); this.alive = new Array(n).fill(true);
    kec.geometries.forEach((g, i) => {
      const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      for (const poly of polys) for (const ring of poly as number[][]) for (const r of ring) { if (r >= 0) this.oa[r] = i; else this.ob[~r] = i; }
    });
  }
  get count(): number { return this.pts.length; }

  arcsOf(face: number): number[] { const out: number[] = []; for (let k = 0; k < this.pts.length; k++) if (this.alive[k] && (this.oa[k] === face || this.ob[k] === face)) out.push(k); return out; }
  /** Neighbour faces of every face, derived from arcs whose two sides are different faces. */
  adjacency(nFaces: number): Array<Set<number>> {
    const adj: Array<Set<number>> = Array.from({ length: nFaces }, () => new Set<number>());
    for (let k = 0; k < this.pts.length; k++) { if (!this.alive[k]) continue; const a = this.oa[k], b = this.ob[k]; if (a >= 0 && b >= 0 && a !== b) { adj[a].add(b); adj[b].add(a); } }
    return adj;
  }
  /** Faces with at least `minKm` of coastline (arcs with no face on the other side). Slivers left by boundary-vintage mismatches are shorter than 0.1 km, which is why a minimum is useful. */
  coastal(nFaces: number, minKm = 0): Uint8Array {
    const c = new Uint8Array(nFaces), len = new Float64Array(nFaces), g = this.grid;
    for (let k = 0; k < this.pts.length; k++) {
      if (!this.alive[k]) continue; const a = this.oa[k], b = this.ob[k]; const f = a === NONE && b >= 0 ? b : b === NONE && a >= 0 ? a : -1; if (f < 0) continue;
      if (minKm <= 0) { c[f] = 1; continue; }
      const p = this.pts[k]; let L = 0;
      for (let i = 1; i < p.length / 2; i++) { const x0 = p[(i - 1) * 2] * g.sx + g.tx, y0 = p[(i - 1) * 2 + 1] * g.sy + g.ty, x1 = p[i * 2] * g.sx + g.tx, y1 = p[i * 2 + 1] * g.sy + g.ty; L += 111.2 * Math.hypot((x1 - x0) * Math.cos(((y0 + y1) / 2) * Math.PI / 180), y1 - y0); }
      len[f] += L; if (len[f] >= minKm) c[f] = 1;
    }
    return c;
  }
  /** Lines for which `keep(faceA, faceB)` is true. `faceB` is NONE for coast arcs. Returned in lon/lat. */
  mesh(keep: (a: number, b: number) => boolean): GeoJSON.MultiLineString {
    const g = this.grid, coords: number[][][] = [];
    for (let k = 0; k < this.pts.length; k++) {
      if (!this.alive[k]) continue; const a = this.oa[k], b = this.ob[k];
      if (!keep(a, b)) continue;
      const p = this.pts[k], line: number[][] = new Array(p.length / 2);
      for (let i = 0; i < line.length; i++) line[i] = [p[i * 2] * g.sx + g.tx, p[i * 2 + 1] * g.sy + g.ty];
      coords.push(line);
    }
    return { type: 'MultiLineString', coordinates: coords };
  }
  /** Apply a surgery: kill arcs, change owners, append arcs. Returns the journal for undo. */
  edit(kill: number[], relabel: Array<[number, number, number]>, add: ArcSpec[]): ArcUndo {
    const undo: ArcUndo = { firstNewArc: this.pts.length, killed: [], owners: [] };
    for (const k of kill) if (this.alive[k]) { this.alive[k] = false; undo.killed.push(k); }
    for (const [k, a, b] of relabel) { undo.owners.push([k, this.oa[k], this.ob[k]]); this.oa[k] = a; this.ob[k] = b; }
    for (const s of add) { this.pts.push(s.pts); this.oa.push(s.a); this.ob.push(s.b); this.alive.push(true); }
    return undo;
  }
  rollback(u: ArcUndo): void {
    this.pts.length = u.firstNewArc; this.oa.length = u.firstNewArc; this.ob.length = u.firstNewArc; this.alive.length = u.firstNewArc;
    for (const k of u.killed) this.alive[k] = true;
    for (let i = u.owners.length - 1; i >= 0; i--) { const [k, a, b] = u.owners[i]; this.oa[k] = a; this.ob[k] = b; }
  }
}
