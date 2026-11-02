import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { World } from '../world';
import type { TransportState } from '../sim/transport';
import type { IndState } from '../sim/industry';
import { nodeValid } from '../sim/transport';
import type { TW } from '../sim/transport';

const pt = (w: World, i: number): [number, number] => [w.labelLon[i], w.labelLat[i]];
const f = (t: string, props: Record<string, unknown>, geometry: Geometry): Feature => ({ type: 'Feature', properties: { t, ...props }, geometry });

/** Roads (one MultiLineString per class), railway lines, stations, ports and works in progress, drawn centre-to-centre of the kecamatan they pass through. */
export function infraFeatures(w: World, tr: TransportState, ind?: IndState): FeatureCollection {
  const out: Feature[] = []; const byClass: Array<Array<[number, number][]>> = [[], [], [], [], [], []];
  for (let i = 0; i < w.n; i++) {
    if (!w.alive[i] || !nodeValid(w as unknown as TW, i)) continue;
    for (const j of w.neighbors[i]) { if (j <= i || !nodeValid(w as unknown as TW, j)) continue; const c = Math.min(w.roadClass[i], w.roadClass[j]); if (c > 0) byClass[c].push([pt(w, i), pt(w, j)]); }
  }
  byClass.forEach((segs, c) => { if (segs.length) out.push(f('road', { c }, { type: 'MultiLineString', coordinates: segs })); });
  for (const l of tr.lines) {
    const coords = l.path.filter(i => i < w.n && w.alive[i]).map(i => pt(w, i)); if (coords.length >= 2) out.push(f('rail', { c: l.cls }, { type: 'LineString', coordinates: coords }));
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
