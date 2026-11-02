import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { World } from '../world';
import type { TransportState } from '../sim/transport';
import type { IndState } from '../sim/industry';
import { nodeValid } from '../sim/transport';
import type { TW } from '../sim/transport';

const pt = (w: World, i: number): [number, number] => [w.labelLon[i], w.labelLat[i]];
const f = (t: string, props: Record<string, unknown>, geometry: Geometry): Feature => ({ type: 'Feature', properties: { t, ...props }, geometry });

/** Roads (one MultiLineString per class), railway lines, stations, ports and works in progress, drawn centre-to-centre of the kecamatan they pass through. */

type P2 = [number, number];
const unit = (a: P2, b: P2): P2 => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
/** Cubic Hermite curve from a to b with unit tangents ta, tb (so adjacent segments join smoothly); returns n+1 points. */
function hermite(a: P2, b: P2, ta: P2, tb: P2, n = 6): P2[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.9; const out: P2[] = [];
  for (let k = 0; k <= n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t, h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2; out.push([h00 * a[0] + h10 * L * ta[0] + h01 * b[0] + h11 * L * tb[0], h00 * a[1] + h10 * L * ta[1] + h01 * b[1] + h11 * L * tb[1]]); }
  return out;
}
/** Smooth a polyline through its vertices (Catmull-Rom tangents). */
function smoothPath(c: P2[]): P2[] {
  if (c.length < 3) return c; const out: P2[] = [];
  for (let q = 0; q + 1 < c.length; q++) { const ta = q === 0 ? unit(c[0], c[1]) : unit(c[q - 1], c[q + 1]), tb = q + 2 >= c.length ? unit(c[q], c[q + 1]) : unit(c[q], c[q + 2]); const seg = hermite(c[q], c[q + 1], ta, tb); out.push(...(q === 0 ? seg : seg.slice(1))); }
  return out;
}
export function infraFeatures(w: World, tr: TransportState, ind?: IndState): FeatureCollection {
  const out: Feature[] = []; const byClass: Array<Array<[number, number][]>> = [[], [], [], [], [], []];
  const rd = (i: number): number[] => w.neighbors[i].filter(j => nodeValid(w as unknown as TW, j) && Math.min(w.roadClass[i], w.roadClass[j]) > 0);
  const tan = (i: number, j: number, cls: number): P2 => { const nb = rd(i).filter(k => Math.min(w.roadClass[i], w.roadClass[k]) === cls); const o = nb.length === 2 ? nb.find(k => k !== j) : undefined; return o === undefined ? unit(pt(w, i), pt(w, j)) : unit(pt(w, o), pt(w, j)); };
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || !nodeValid(w as unknown as TW, i)) continue;
    for (const j of w.neighbors[i]) { if (j <= i || !nodeValid(w as unknown as TW, j)) continue; const c = Math.min(w.roadClass[i], w.roadClass[j]); if (c > 0) { const a = pt(w, i), b = pt(w, j); byClass[c].push(hermite(a, b, tan(i, j, c), tan(j, i, c))); } }
  }
  byClass.forEach((segs, c) => { if (segs.length) out.push(f('road', { c }, { type: 'MultiLineString', coordinates: segs })); });
  for (const l of tr.lines) {
    const coords = smoothPath(l.path.filter(i => i < w.n && w.alive[i]).map(i => pt(w, i))); if (coords.length >= 2) out.push(f('rail', { c: l.cls }, { type: 'LineString', coordinates: coords }));
    for (const [i, lv] of l.stations) if (i < w.n && w.alive[i]) out.push(f('station', { l: lv }, { type: 'Point', coordinates: pt(w, i) }));
  }
  for (let i = 0; i < w.n; i++) if (w.alive[i] && w.portLevel[i] > 0 && nodeValid(w as unknown as TW, i)) out.push(f('port', { l: w.portLevel[i] }, { type: 'Point', coordinates: pt(w, i) }));
  for (const p of tr.projects) {
    if (p.kind === 'road' || p.kind === 'rail' || p.kind === 'upgrade') { const path = p.kind === 'upgrade' ? (tr.lines.find(l => l.id === p.lineId)?.path ?? []) : p.path; const coords = path.filter(i => i < w.n && w.alive[i]).map(i => pt(w, i)); if (coords.length >= 2) out.push(f('proj', { paused: p.paused }, { type: 'LineString', coordinates: coords })); }
    else if (p.node !== undefined && p.node < w.n) out.push(f('projpt', { paused: p.paused }, { type: 'Point', coordinates: pt(w, p.node) }));
  }
  if (ind) {
    for (const x of ind.list) if (x.status !== 'closed' && x.kec < w.n && w.alive[x.kec]) out.push(f('ind', { o: x.foreign > 0.5 ? 'f' : x.state > 0.5 ? 's' : 'p', b: x.status === 'building', n: x.name }, { type: 'Point', coordinates: pt(w, x.kec) }));
    for (const d of ind.deposits) if (d.revealed && !d.developed && d.kec < w.n && w.alive[d.kec]) out.push(f('dep', { n: d.name }, { type: 'Point', coordinates: pt(w, d.kec) }));
  }
  return { type: 'FeatureCollection', features: out };
}
/** Cheap fingerprint so the overlay is rebuilt only when something was built, upgraded, started or finished. */
export function infraSignature(w: World, tr: TransportState, ind?: IndState): string {
  let r = 0, p = 0, s = 0; for (let i = 0; i < w.n; i++) { r += w.roadClass[i] * (1 + (i % 7)); p += w.portLevel[i]; s += w.railStation[i] + w.railPath[i]; }
  return `${w.n}|${r}|${p}|${s}|${tr.lines.map(l => `${l.id}:${l.cls}:${l.path.length}`).join(',')}|${tr.projects.map(q => `${q.id}${q.paused ? 'p' : ''}`).join(',')}|${ind ? ind.list.map(x => `${x.id}${x.status[0]}${x.kec}${x.foreign > 0.5 ? 'f' : x.state > 0.5 ? 's' : 'p'}`).join(',') + '|' + ind.deposits.map(d => `${d.revealed ? 1 : 0}${d.developed ? 1 : 0}${d.kec}`).join('') : ''}`;
}
