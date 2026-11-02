import TR from '../../config/transport.json';
import { interp } from './balance';
import type { SimWorld } from './types';

export { TR };
export const costIndex = (year: number): number => interp(TR.costIndex, year);
export const NROAD = TR.roads.length, NRAIL = TR.rail.length;

// ---------------------------------------------------------------- state (lives in Nation, so it is saved and sent to the worker with everything else)
export interface RailLine { id: string; name: string; cls: number; gauge: number; degraded: boolean; cond: number; path: number[]; stations: Array<[number, number]> }
export type ProjectKind = 'road' | 'rail' | 'upgrade' | 'station' | 'port';
/** What the player asks for. `path` is a chain of adjacent kecamatan (road / rail), `node` the kecamatan of a station or port. */
export interface ProjectSpec { kind: ProjectKind; name: string; cls: number; path: number[]; stations?: Array<[number, number]>; lineId?: string; node?: number }
export interface Project extends ProjectSpec { id: number; km: number; cost: number; months: number; progress: number; paid: number; paused: boolean; start: number }
export interface TransportState {
  lines: RailLine[]; projects: Project[]; nextId: number; roadCond: number[];
  /** the network changed (geometry edit): recompute access from scratch on the next sync */
  dirty: boolean; rebase: number[]; lastFull: number;
  kmRoad: number[]; kmRail: number; required: { road: number; rail: number; port: number }; coverage: number;
  lastRail: { revenue: number; ops: number; pkm: number; tkm: number };
}
export const newTransport = (): TransportState => ({
  lines: [], projects: [], nextId: 1, roadCond: [...TR.roadCondition.start], dirty: true, rebase: [], lastFull: -1e9, kmRoad: new Array(NROAD).fill(0), kmRail: 0,
  required: { road: 0, rail: 0, port: 0 }, coverage: 1, lastRail: { revenue: 0, ops: 0, pkm: 0, tkm: 0 }
});

// ---------------------------------------------------------------- geometry helpers
const D2R = Math.PI / 180;
export function hav(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export type TW = Pick<SimWorld, 'n' | 'alive' | 'labelLon' | 'labelLat' | 'neighbors' | 'kecReg' | 'regProv' | 'regencies' | 'provinces' | 'pop' | 'terrain' | 'swamp' | 'roadClass' | 'railStation' | 'railPath' | 'portLevel' | 'coastal'>;
/** Road distance between two adjacent kecamatan (centre to centre, with a winding factor). */
export const edgeKm = (w: TW, a: number, b: number): number => hav(w.labelLon[a], w.labelLat[a], w.labelLon[b], w.labelLat[b]) * TR.access.detour;
export const nodeValid = (w: TW, i: number): boolean => { if (i < 0 || i >= w.n || !w.alive[i]) return false; const k = w.kecReg[i]; if (k < 0) return false; const p = w.provinces[w.regProv[k]]; return !!p && !p.locked; };
export const roadSpeedFactor = (cond: number): number => TR.roadCondition.speedFloor + (1 - TR.roadCondition.speedFloor) * cond;
export const railSpeedFactor = (cond: number): number => TR.railCondition.speedFloor + (1 - TR.railCondition.speedFloor) * cond;

// ---------------------------------------------------------------- graph
export interface Overrides { roadClass?: Uint8Array; portLevel?: Uint8Array; lines?: RailLine[] }
export interface Graph { n: number; start: Int32Array; to: Int32Array; t: Float32Array; kmRoad: number[]; kmRail: number; railInfo: Array<{ line: RailLine; km: number; cum: number[]; stationPos: Array<[number, number]> }>; ports: number[] }

export function buildGraph(w: TW, tr: TransportState, ov: Overrides = {}): Graph {
  const n = w.n, roadClass = ov.roadClass ?? w.roadClass, portLevel = ov.portLevel ?? w.portLevel, lines = ov.lines ?? tr.lines;
  const A: number[] = [], Bn: number[] = [], Tt: number[] = []; const kmRoad = new Array(NROAD).fill(0); let kmRail = 0;
  const push = (a: number, b: number, t: number) => { A.push(a, b); Bn.push(b, a); Tt.push(t, t); };
  const valid = new Uint8Array(n); for (let i = 0; i < n; i++) valid[i] = nodeValid(w, i) ? 1 : 0;
  const speedBy = TR.offroad.speedKmh;
  // land: off-road tracks everywhere, the best road class where both ends carry a road
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    for (const j of w.neighbors[i]) {
      if (j <= i || !valid[j]) continue;
      const km = edgeKm(w, i, j); let trk = (speedBy[w.terrain[i]] + speedBy[w.terrain[j]]) / 2; if (w.swamp[i] || w.swamp[j]) trk *= TR.offroad.swampFactor;
      const c = Math.min(roadClass[i], roadClass[j]); let sp = trk;
      if (c > 0) { sp = Math.max(trk, TR.roads[c].speedKmh * roadSpeedFactor(tr.roadCond[c] ?? 1)); kmRoad[c] += km; }
      push(i, j, km / sp);
    }
  }
  // rail: only between stations (consecutive stations along a line); every stop adds dwell / acceleration time
  const railInfo: Graph['railInfo'] = [];
  for (const line of lines) {
    const path = line.path.filter(i => i >= 0 && i < n); const cum = [0];
    for (let q = 1; q < path.length; q++) cum.push(cum[q - 1] + hav(w.labelLon[path[q - 1]], w.labelLat[path[q - 1]], w.labelLon[path[q]], w.labelLat[path[q]]) * TR.railDetour);
    const km = cum[cum.length - 1]; kmRail += km; const posOf = new Map<number, number>(); path.forEach((nd, q) => { if (!posOf.has(nd)) posOf.set(nd, q); });
    const st: Array<[number, number]> = []; for (const [nd, lvl] of line.stations) { const q = posOf.get(nd); if (q !== undefined && valid[nd] && lvl > 0) st.push([q, lvl]); } st.sort((a, b) => a[0] - b[0]);
    const spd = TR.rail[line.cls].speedKmh * railSpeedFactor(line.cond);
    for (let s = 1; s < st.length; s++) { const [qa] = st[s - 1], [qb, lb] = st[s]; const d = cum[qb] - cum[qa]; push(path[qa], path[qb], d / spd + (TR.railDwellMinutes[lb] ?? 3) / 60); }
    railInfo.push({ line, km, cum, stationPos: st });
  }
  // sea: ports link to their nearest ports within range (the lower level sets speed, range and handling)
  const ports: number[] = []; for (let i = 0; i < n; i++) if (valid[i] && portLevel[i] > 0) ports.push(i);
  const seen = new Set<number>(); const PL = TR.ports.levels;
  for (const p of ports) {
    const cand: Array<[number, number]> = []; for (const q of ports) if (q !== p) cand.push([hav(w.labelLon[p], w.labelLat[p], w.labelLon[q], w.labelLat[q]), q]);
    cand.sort((a, b) => a[0] - b[0]);
    for (let r = 0; r < Math.min(cand.length, TR.ports.nearestLinks); r++) {
      const [d, q] = cand[r]; const lo = Math.min(portLevel[p], portLevel[q]); if (d > PL[lo].rangeKm) continue; const key = Math.min(p, q) * n + Math.max(p, q); if (seen.has(key)) continue; seen.add(key);
      push(p, q, (d * 1.15) / PL[lo].speedKmh + (PL[portLevel[p]].handlingHours + PL[portLevel[q]].handlingHours) / 2);
    }
  }
  // hub-to-hub trunk routes: every pair of national ports / hubs within the range of the lower level
  const big = ports.filter(p => portLevel[p] >= 3);
  for (let a = 0; a < big.length; a++) for (let b = a + 1; b < big.length; b++) {
    const p = big[a], q = big[b], d = hav(w.labelLon[p], w.labelLat[p], w.labelLon[q], w.labelLat[q]), lo = Math.min(portLevel[p], portLevel[q]); const key = Math.min(p, q) * n + Math.max(p, q);
    if (d > PL[lo].rangeKm || seen.has(key)) continue; seen.add(key); push(p, q, (d * 1.15) / PL[lo].speedKmh + (PL[portLevel[p]].handlingHours + PL[portLevel[q]].handlingHours) / 2);
  }
  // CSR
  const deg = new Int32Array(n + 1); for (const a of A) deg[a + 1]++; for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const start = deg.slice(); const fill = deg.slice(0, n); const to = new Int32Array(A.length), t = new Float32Array(A.length);
  for (let e = 0; e < A.length; e++) { const a = A[e], k = fill[a]++; to[k] = Bn[e]; t[k] = Tt[e]; }
  return { n, start, to, t, kmRoad, kmRail, railInfo, ports };
}

// ---------------------------------------------------------------- shortest paths
/** Reusable Dijkstra: generation-stamped distances, so thousands of bounded searches cost only what they touch. */
export class Router {
  readonly dist: Float64Array; private seen: Int32Array; private gen = 0; readonly order: Int32Array; count = 0;
  private hk: Float64Array; private hv: Int32Array; private hn = 0;
  constructor(readonly g: Graph) { this.dist = new Float64Array(g.n); this.seen = new Int32Array(g.n); this.order = new Int32Array(g.n); this.hk = new Float64Array(g.to.length + g.n + 16); this.hv = new Int32Array(g.to.length + g.n + 16); }
  private push(k: number, v: number): void { let i = this.hn++; const hk = this.hk, hv = this.hv; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; }
  private pop(): void { const hk = this.hk, hv = this.hv; const k = hk[--this.hn], v = hv[this.hn]; let i = 0; const n = this.hn; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hk[c + 1] < hk[c]) c++; if (hk[c] >= k) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = k; hv[i] = v; }
  /** Settle every node within `cutoff` hours of `src`, optionally confined to nodes with mask[node] === label. Results: `order[0..count)` (settle order), `dist[node]`. */
  run(src: number, cutoff: number, mask?: Int32Array, label = 0): number {
    const g = this.g, gen = ++this.gen; this.hn = 0; this.count = 0; this.dist[src] = 0; this.seen[src] = gen; this.push(0, src);
    while (this.hn > 0) {
      const k = this.hk[0], v = this.hv[0]; this.pop(); if (k > this.dist[v]) continue; this.order[this.count++] = v;
      for (let e = g.start[v]; e < g.start[v + 1]; e++) {
        const u = g.to[e]; if (mask && mask[u] !== label) continue; const nd = k + g.t[e]; if (nd > cutoff) continue;
        if (this.seen[u] !== gen) { this.seen[u] = gen; this.dist[u] = nd; this.push(nd, u); } else if (nd < this.dist[u]) { this.dist[u] = nd; this.push(nd, u); }
      }
    }
    return this.count;
  }
  has(v: number): boolean { return this.seen[v] === this.gen; }
}

// ---------------------------------------------------------------- market access
export interface Coarse { hubs: Int32Array; T: Float32Array; R: number }
const B_ = TR.access;
const pops = (w: TW): { valid: Uint8Array; total: number } => { const valid = new Uint8Array(w.n); let total = 0; for (let i = 0; i < w.n; i++) if (nodeValid(w, i)) { valid[i] = 1; total += w.pop[i]; } return { valid, total }; };

/** Reach-weighted population within the time cutoff of each source, as a share of national population: sum_j pop_j · exp(−β T_ij) / P. */
export function localAccess(w: TW, rt: Router, sources: ArrayLike<number>, out: Float64Array, total: number): void {
  const beta = B_.betaPerHour;
  for (let q = 0; q < sources.length; q++) {
    const i = sources[q]; rt.run(i, B_.cutoffHours); let s = 0; for (let k = 0; k < rt.count; k++) { const j = rt.order[k]; s += w.pop[j] * Math.exp(-beta * rt.dist[j]); }
    out[i] = s / Math.max(1, total);
  }
}
/** Regency-to-regency travel times (hub = capital) for the long-distance part of access. */
export function computeCoarse(w: TW, rt: Router): Coarse {
  const R = w.regencies.length; const hubs = new Int32Array(R).fill(-1);
  for (let k = 0; k < R; k++) { const r = w.regencies[k]; let best = -1, bp = -1; const c = r.capital; if (c >= 0 && nodeValid(w, c) && w.kecReg[c] === k) best = c; else for (const i of r.kec) if (nodeValid(w, i) && w.pop[i] > bp) { bp = w.pop[i]; best = i; } hubs[k] = best; }
  const T = new Float32Array(R * R).fill(1e9);
  for (let a = 0; a < R; a++) { if (hubs[a] < 0) continue; rt.run(hubs[a], B_.coarseCutoffHours); for (let b = 0; b < R; b++) if (hubs[b] >= 0 && rt.has(hubs[b])) T[a * R + b] = rt.dist[hubs[b]]; }
  return { hubs, T, R };
}
/** Access of every regency to the people that are further away than the local cutoff, from the coarse layer. */
export function farAccess(w: TW, co: Coarse, total: number): Float64Array {
  const R = co.R, beta = B_.betaPerHour, out = new Float64Array(R); const rp = new Float64Array(R);
  for (let k = 0; k < R; k++) { let s = 0; for (const i of w.regencies[k].kec) if (nodeValid(w, i)) s += w.pop[i]; rp[k] = s; }
  for (let a = 0; a < R; a++) { if (co.hubs[a] < 0) continue; let s = 0; for (let b = 0; b < R; b++) { const t = co.T[a * R + b]; if (b === a || co.hubs[b] < 0 || t <= B_.coarseMinHours || t >= 1e8) continue; s += rp[b] * Math.exp(-beta * t); } out[a] = s / Math.max(1, total); }
  return out;
}
/** No scheduled link: informal boats and tracks at ~10 km/h over the straight-line distance, capped. */
const boat = (w: TW, a: number, b: number, cap: number): number => Math.min(cap, (hav(w.labelLon[a], w.labelLat[a], w.labelLon[b], w.labelLat[b]) * TR.access.detour) / 10);
/** Travel time (hours) from every kecamatan to its regency capital and its province capital, inside the regency / province. */
export function capitalTimes(w: TW, rt: Router, tcap: Float64Array, tprov: Float64Array): void {
  const n = w.n; const mask = new Int32Array(n).fill(-1);
  const hub = (c: number, cands: number[]): number => { if (c >= 0 && nodeValid(w, c)) return c; let best = -1, bp = -1; for (const i of cands) if (nodeValid(w, i) && w.pop[i] > bp) { bp = w.pop[i]; best = i; } return best; };
  mask.fill(-1); w.regencies.forEach((r, k) => { for (const i of r.kec) mask[i] = k; });
  w.regencies.forEach((r, k) => { const c = hub(r.capital, r.kec); if (c < 0 || mask[c] !== k) { for (const i of r.kec) tcap[i] = 0; return; } rt.run(c, 1e9, mask, k); for (const i of r.kec) tcap[i] = rt.has(i) ? rt.dist[i] : boat(w, i, c, 48); });
  mask.fill(-1); const provOf = new Int32Array(n).fill(-1); w.regencies.forEach((r, k) => { for (const i of r.kec) provOf[i] = w.regProv[k]; });
  w.provinces.forEach((p, pi) => {
    if (p.locked) return; const cands: number[] = []; for (let i = 0; i < n; i++) if (provOf[i] === pi) cands.push(i);
    const c = hub(p.capital, cands); if (c < 0) { for (const i of cands) tprov[i] = 0; return; } for (const i of cands) mask[i] = pi;
    rt.run(c, 1e9, mask, pi); for (const i of cands) tprov[i] = rt.has(i) ? rt.dist[i] : boat(w, i, c, 96); for (const i of cands) mask[i] = -1;
  });
}
export { pops as validPopulation };
