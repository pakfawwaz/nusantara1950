import type { Grid, Poly, Pt } from './grid';
import { areaKm2, edgeKey } from './grid';
import { cutFaces, isValidPolys, roundPoly } from './jts';
import type { ArcSpec } from './arcs';

export interface SplitRules { minSliverKm2: number; minPieceFraction: number; maxPieces: number }
export interface SplitInput { grid: Grid; parts: Poly[]; arcs: Array<{ k: number; pts: Int32Array; a: number; b: number }>; face: number; line: Pt[]; rules: SplitRules }
export interface SplitPiece { polys: Poly[]; areaKm2: number }
export interface SplitPlan { pieces: SplitPiece[]; kill: number[]; add: ArcSpec[]; originalAreaKm2: number; areaErrorPct: number }
/** In `add`, an owner `-(2 + j)` refers to piece j (resolved once new face ids exist). */
export const pieceOwner = (j: number): number => -(2 + j);
export const isPieceOwner = (o: number): boolean => o <= -2;
export const pieceIndex = (o: number): number => -o - 2;

const ptKey = (p: Pt) => `${p[0]},${p[1]}`;

/** Pure geometry: cut one kecamatan with a polyline; returns pieces plus the arc surgery needed. Everything is on the shared integer grid. */
export function planSplit(inp: SplitInput): SplitPlan | { error: string } {
  const { grid, parts, face, rules } = inp;
  const line: Pt[] = []; for (const p of inp.line) { const q: Pt = [Math.round(p[0]), Math.round(p[1])]; const l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
  if (line.length < 2) return { error: 'Draw a line with at least two points.' };
  const raw = cutFaces(parts, line); if ('error' in raw) return raw;
  const faces: Poly[] = [];
  for (const r of raw) { const p = roundPoly(r); if (!p) return { error: 'Cut produced a degenerate piece; shift the line slightly.' }; faces.push(p); }
  if (faces.length < 2) return { error: 'The line must cut all the way across the kecamatan.' };
  for (const fc of faces) if (!isValidPolys([fc])) return { error: 'Cut produced an invalid piece; shift the line slightly.' };

  // edge bookkeeping: boundary edges of R appear once, cut edges twice (once per adjacent face)
  const edges = new Map<string, number[]>();
  faces.forEach((poly, fi) => poly.forEach(ring => { for (let i = 0; i < ring.length - 1; i++) { const k = edgeKey(ring[i], ring[i + 1]); const l = edges.get(k); if (l) l.push(fi); else edges.set(k, [fi]); } }));
  const touched = new Set<number>(); for (const l of edges.values()) if (l.length >= 2) l.forEach(fi => touched.add(fi));
  if (touched.size < 2) return { error: 'The line must cut all the way across the kecamatan.' };
  const areas = faces.map(fc => areaKm2([fc], grid));
  // untouched faces (separate islands of the same kecamatan) travel with the biggest touched piece
  const pieceOfFace = new Array<number>(faces.length).fill(-1);
  const touchedList = [...touched].sort((a, b) => areas[b] - areas[a]);
  touchedList.forEach((fi, j) => (pieceOfFace[fi] = j));
  faces.forEach((_, fi) => { if (pieceOfFace[fi] < 0) pieceOfFace[fi] = 0; });
  const nPieces = touchedList.length;
  if (nPieces > rules.maxPieces) return { error: `At most ${rules.maxPieces} pieces are allowed per split.` };
  const pieces: SplitPiece[] = Array.from({ length: nPieces }, () => ({ polys: [], areaKm2: 0 }));
  faces.forEach((fc, fi) => { const p = pieces[pieceOfFace[fi]]; p.polys.push(fc); p.areaKm2 += areas[fi]; });
  const total = pieces.reduce((s, p) => s + p.areaKm2, 0);
  const original = areaKm2(parts, grid);
  for (const p of pieces) if (p.areaKm2 < rules.minSliverKm2 || p.areaKm2 < rules.minPieceFraction * total) return { error: `A piece would be a sliver (${p.areaKm2.toFixed(2)} km²). Move the line.` };
  const errPct = Math.abs(total - original) / original * 100;
  if (errPct > 0.5) return { error: `Area changed by ${errPct.toFixed(2)}% after the cut; shift the line slightly.` };

  // ---- arc surgery ----
  const origVerts = new Set<string>(); for (const a of inp.arcs) for (let i = 0; i < a.pts.length; i += 2) origVerts.add(`${a.pts[i]},${a.pts[i + 1]}`);
  const extras: Pt[] = []; const seenExtra = new Set<string>();
  for (const fc of faces) for (const ring of fc) for (const v of ring) { const k = ptKey(v); if (!origVerts.has(k) && !seenExtra.has(k)) { seenExtra.add(k); extras.push(v); } }

  // assign every inserted node to the one original segment it lies on (closest segment wins)
  const onSeg = new Map<string, Array<{ t: number; v: Pt }>>();
  for (const e of extras) {
    let best = Infinity, bk = '', bt = 0;
    inp.arcs.forEach((arc, ai) => {
      for (let i = 0; i < arc.pts.length / 2 - 1; i++) {
        const px = arc.pts[i * 2], py = arc.pts[i * 2 + 1], dx = arc.pts[i * 2 + 2] - px, dy = arc.pts[i * 2 + 3] - py, len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((e[0] - px) * dx + (e[1] - py) * dy) / len2)); const cx = px + t * dx - e[0], cy = py + t * dy - e[1], d = cx * cx + cy * cy;
        if (d < best) { best = d; bk = `${ai}:${i}`; bt = t; }
      }
    });
    if (best <= 4 && bk) { const l = onSeg.get(bk); if (l) l.push({ t: bt, v: e }); else onSeg.set(bk, [{ t: bt, v: e }]); }
  }
  const add: ArcSpec[] = [];
  for (let ai = 0; ai < inp.arcs.length; ai++) {
    const arc = inp.arcs[ai];
    const other = arc.a === face ? arc.b : arc.a; const n = arc.pts.length / 2;
    const nodes: Pt[] = []; const owners: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const p: Pt = [arc.pts[i * 2], arc.pts[i * 2 + 1]], q: Pt = [arc.pts[i * 2 + 2], arc.pts[i * 2 + 3]]; if (i === 0) nodes.push(p);
      const on = (onSeg.get(`${ai}:${i}`) ?? []).sort((x, y) => x.t - y.t); const chain: Pt[] = [p, ...on.map(o => o.v), q];
      for (let c = 0; c < chain.length - 1; c++) {
        if (chain[c][0] === chain[c + 1][0] && chain[c][1] === chain[c + 1][1]) continue;
        const l = edges.get(edgeKey(chain[c], chain[c + 1]));
        if (!l || l.length !== 1) return { error: 'Cut crosses the outline at an awkward spot; shift the line slightly.' };
        nodes.push(chain[c + 1]); owners.push(pieceOfFace[l[0]]);
      }
    }
    // runs of equal owner become separate arcs, oriented like the original arc
    let start = 0;
    for (let e = 1; e <= owners.length; e++) {
      if (e === owners.length || owners[e] !== owners[start]) {
        const seg = nodes.slice(start, e + 1); const pts = new Int32Array(seg.length * 2); seg.forEach((v, i) => { pts[i * 2] = v[0]; pts[i * 2 + 1] = v[1]; });
        add.push({ pts, a: pieceOwner(owners[start]), b: other }); start = e;
      }
    }
  }
  // cut arcs between pieces
  for (const fi of touchedList) {
    for (const ring of faces[fi]) {
      const m = ring.length - 1; const nb: number[] = new Array(m); // neighbour face per edge, -1 for outer edges
      for (let i = 0; i < m; i++) { const l = edges.get(edgeKey(ring[i], ring[i + 1])) as number[]; nb[i] = l.length >= 2 ? (l[0] === fi ? l[1] : l[0]) : -1; }
      let s0 = 0; for (let i = 0; i < m; i++) if (nb[i] !== nb[(i + m - 1) % m]) { s0 = i; break; }
      let i = 0;
      while (i < m) {
        const e0 = (s0 + i) % m, who = nb[e0]; let j = i; while (j < m && nb[(s0 + j) % m] === who) j++;
        if (who >= 0 && fi < who) {
          const seg: Pt[] = []; for (let t = i; t < j; t++) seg.push(ring[(s0 + t) % m]); seg.push(ring[(s0 + j) % m]);
          const pts = new Int32Array(seg.length * 2); seg.forEach((v, q) => { pts[q * 2] = v[0]; pts[q * 2 + 1] = v[1]; });
          add.push({ pts, a: pieceOwner(pieceOfFace[fi]), b: pieceOwner(pieceOfFace[who]) });
        }
        i = j;
      }
    }
  }
  return { pieces, kill: inp.arcs.map(a => a.k), add, originalAreaKm2: original, areaErrorPct: errPct };
}
