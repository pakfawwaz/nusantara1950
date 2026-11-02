import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import InteriorPointArea from 'jsts/org/locationtech/jts/algorithm/InteriorPointArea.js';
import type { Pt, Ring, Poly } from './grid';
import { pointInPolys } from './grid';

const f = new GeometryFactory();
const C = (p: Pt) => new Coordinate(p[0], p[1]);
const ringJ = (r: Ring) => f.createLinearRing(r.map(C));
export const polyJ = (p: Poly) => f.createPolygon(ringJ(p[0]), p.slice(1).map(ringJ));
export const multiJ = (ps: Poly[]) => f.createMultiPolygon(ps.map(polyJ));
export const lineJ = (pts: Pt[]) => f.createLineString(pts.map(C));

export function toPolys(g: { getGeometryType(): string; getNumGeometries(): number; getGeometryN(i: number): unknown }): Poly[] {
  const type = g.getGeometryType();
  const one = (p: any): Poly => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: Poly = [(p.getExteriorRing().getCoordinates() as Array<{ x: number; y: number }>).map(c => [c.x, c.y] as Pt)];
    for (let i = 0; i < p.getNumInteriorRing(); i++) out.push((p.getInteriorRingN(i).getCoordinates() as Array<{ x: number; y: number }>).map(c => [c.x, c.y] as Pt));
    return out;
  };
  if (type === 'Polygon') return [one(g)];
  const res: Poly[] = []; for (let i = 0; i < g.getNumGeometries(); i++) { const q = g.getGeometryN(i) as { getGeometryType(): string }; if (q.getGeometryType() === 'Polygon') res.push(one(q)); }
  return res;
}
export function roundPoly(p: Poly): Poly | null {
  const rings: Poly = [];
  for (const r of p) {
    const out: Ring = []; for (const c of r) { const q: Pt = [Math.round(c[0]), Math.round(c[1])]; const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); }
    if (out.length > 1 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
    if (out.length < 4) { if (rings.length === 0) return null; continue; } // drop collapsed holes, reject collapsed outer rings
    rings.push(out);
  }
  return rings;
}
export function isValidPolys(ps: Poly[]): boolean { try { return IsValidOp.isValid(multiJ(ps)); } catch { return false; } }
export function unionPolys(ps: Poly[]): Poly[] { return toPolys(UnaryUnionOp.union(f.createGeometryCollection(ps.map(polyJ))) as never); }
export function pointOnSurface(ps: Poly[]): Pt { const c = new InteriorPointArea(multiJ(ps)).getInteriorPoint(); return [c.x, c.y]; }

/** Node a polygon set's boundary with a polyline and polygonise; returns faces lying inside the original shape (still unrounded). */
export function cutFaces(parts: Poly[], line: Pt[]): Poly[] | { error: string } {
  const R = multiJ(parts);
  if (!IsValidOp.isValid(R)) return { error: 'The kecamatan outline is not a valid polygon.' };
  const u = UnaryUnionOp.union(f.createGeometryCollection([R.getBoundary(), lineJ(line)]));
  const pz = new Polygonizer(); pz.add(u as never);
  const list = pz.getPolygons(); const faces: Poly[] = [];
  for (let i = 0; i < list.size(); i++) {
    const g = list.get(i); const ip = new InteriorPointArea(g).getInteriorPoint();
    if (pointInPolys(parts, ip.x, ip.y)) faces.push(toPolys(g as never)[0]);
  }
  return faces;
}
