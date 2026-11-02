import { TR, costIndex, edgeKm, hav, nodeValid, NROAD, NRAIL } from './transport';
import type { Project, ProjectSpec, RailLine, TW, TransportState } from './transport';

export interface Plan { ok: boolean; errors: string[]; warnings: string[]; km: number; kmNew: number; cost: number; months: number; nodes: number[] }
const terr = (w: TW, a: number, b: number): number => Math.max(w.terrain[a], w.terrain[b]);
const isSwamp = (w: TW, a: number, b: number): boolean => !!(w.swamp[a] || w.swamp[b]);
const adjacent = (w: TW, a: number, b: number): boolean => w.neighbors[a].includes(b);
const empty = (errors: string[]): Plan => ({ ok: false, errors, warnings: [], km: 0, kmNew: 0, cost: 0, months: 0, nodes: [] });

/** Cost of laying road class `cls` on one edge (Rp million, 2026 prices, before the cost index): an upgrade is credited with part of what is already there. */
export function roadEdgeCost(w: TW, a: number, b: number, cls: number, roadClass: ArrayLike<number> = w.roadClass): { km: number; cost: number; work: boolean } {
  const km = edgeKm(w, a, b), t = terr(w, a, b), sw = isSwamp(w, a, b) ? TR.terrainCostFactor.swamp : 1; const c0 = Math.min(roadClass[a], roadClass[b]);
  if (c0 >= cls) return { km, cost: 0, work: false };
  const neu = TR.roads[cls].cost[t] * sw; const credit = c0 > 0 ? TR.upgradeCredit * TR.roads[c0].cost[t] * sw : 0;
  return { km, cost: km * Math.max(TR.minUpgradeShare * neu, neu - credit), work: true };
}
export function railEdgeCost(w: TW, a: number, b: number, cls: number, fromCls = -1): { km: number; cost: number } {
  const km = hav(w.labelLon[a], w.labelLat[a], w.labelLon[b], w.labelLat[b]) * TR.railDetour, t = terr(w, a, b), sw = isSwamp(w, a, b) ? TR.terrainCostFactor.swamp : 1;
  const neu = TR.rail[cls].cost[t] * sw; const credit = fromCls >= 0 ? TR.upgradeCredit * TR.rail[fromCls].cost[t] * sw : 0;
  return { km, cost: km * Math.max(fromCls >= 0 ? TR.minUpgradeShare * neu : neu, neu - credit) };
}
/** Build time grows less than linearly with length (crews work on several fronts at once); normalised so a buildRefKm project takes monthsPerKm × buildRefKm months. */
const monthsFor = (base: number, perKm: number, km: number, terrFactor: number): number => (km <= 0 ? 0 : Math.max(1, Math.round(base + perKm * Math.pow(km, TR.buildExponent) * Math.pow(TR.buildRefKm, 1 - TR.buildExponent) * terrFactor)));

/** Validate a request and price it. `overrun` is the cost multiplier from weak governance (1 = none). */
export function planProject(w: TW, tr: TransportState, spec: ProjectSpec, year: number, overrun = 1): Plan {
  const errors: string[] = [], warnings: string[] = []; const ci = costIndex(year) * overrun * 1e6;
  const unlocked = (u: number, name: string) => { if (year < u) errors.push(`${name} is not available before ${u}.`); };
  if (spec.kind === 'road') {
    const cls = spec.cls, p = spec.path;
    if (cls < 1 || cls >= NROAD) return empty(['Pick a road class.']); unlocked(TR.roads[cls].unlock, TR.roads[cls].name);
    if (p.length < 2) return empty(['Pick a start and an end kecamatan.']);
    let km = 0, kmNew = 0, cost = 0, mAcc = 0;
    for (let q = 0; q < p.length; q++) if (!nodeValid(w, p[q])) return empty(['The route crosses a kecamatan that is not under your control.']);
    for (let q = 0; q + 1 < p.length; q++) {
      if (!adjacent(w, p[q], p[q + 1])) return empty(['The route is not a chain of neighbouring kecamatan.']);
      const e = roadEdgeCost(w, p[q], p[q + 1], cls); km += e.km; if (e.work) { kmNew += e.km; cost += e.cost; mAcc += e.km * TR.terrainCostFactor.monthsByTerrain[terr(w, p[q], p[q + 1])] * (isSwamp(w, p[q], p[q + 1]) ? TR.terrainCostFactor.monthsSwamp : 1); }
    }
    if (kmNew <= 0) errors.push(`Every link on this route is already ${TR.roads[cls].name} or better.`);
    const months = monthsFor(TR.roads[cls].monthsBase, TR.roads[cls].monthsPerKm, kmNew, kmNew > 0 ? mAcc / kmNew : 1);
    return { ok: errors.length === 0, errors, warnings, km, kmNew, cost: cost * ci, months, nodes: p };
  }
  if (spec.kind === 'rail') {
    const cls = spec.cls, p = spec.path;
    if (cls < 0 || cls >= NRAIL) return empty(['Pick a track class.']); unlocked(TR.rail[cls].unlock, TR.rail[cls].name);
    if (p.length < 2) return empty(['Pick a start and an end kecamatan.']);
    for (let q = 0; q < p.length; q++) if (!nodeValid(w, p[q])) return empty(['The route crosses a kecamatan that is not under your control.']);
    let km = 0, cost = 0, mAcc = 0, over = 0;
    for (let q = 0; q + 1 < p.length; q++) {
      if (!adjacent(w, p[q], p[q + 1])) return empty(['The route is not a chain of neighbouring kecamatan.']);
      const e = railEdgeCost(w, p[q], p[q + 1], cls); km += e.km; cost += e.cost; mAcc += e.km * TR.terrainCostFactor.monthsByTerrain[terr(w, p[q], p[q + 1])] * (isSwamp(w, p[q], p[q + 1]) ? TR.terrainCostFactor.monthsSwamp : 1);
      if (w.railPath[p[q]] && w.railPath[p[q + 1]]) over++;
    }
    const st = spec.stations ?? []; const on = new Set(p);
    for (const [nd, lv] of st) { if (!on.has(nd)) errors.push('A station is not on the route.'); if (lv < 1 || lv > 2) errors.push('Station level must be halt (1) or major (2).'); }
    const has = (nd: number) => st.some(([x, lv]) => x === nd && lv > 0);
    if (!has(p[0]) || !has(p[p.length - 1])) errors.push('Both ends of the line need a station (only station kecamatan get rail travel times).');
    if (st.length < 2) errors.push('A line needs at least two stations.');
    if (over > 0) warnings.push(`${over} link(s) already carry track: this lays a second line beside it. To make an existing line faster, use Upgrade.`);
    const months = monthsFor(TR.rail[cls].monthsBase, TR.rail[cls].monthsPerKm, km, mAcc / Math.max(1e-9, km));
    const stCost = st.reduce((s, [, lv]) => s + TR.station.cost[lv] * costIndex(year) * overrun * 1e6, 0);
    return { ok: errors.length === 0, errors, warnings, km, kmNew: km, cost: cost * ci + stCost, months, nodes: p };
  }
  if (spec.kind === 'upgrade') {
    const line = tr.lines.find(l => l.id === spec.lineId); if (!line) return empty(['That line no longer exists.']);
    if (spec.cls <= line.cls || spec.cls >= NRAIL) return empty([`Pick a class better than the present one (${TR.rail[line.cls].name}).`]); unlocked(TR.rail[spec.cls].unlock, TR.rail[spec.cls].name);
    if (tr.projects.some(q => q.kind === 'upgrade' && q.lineId === line.id)) errors.push('This line is already being upgraded.');
    let km = 0, cost = 0, mAcc = 0; const p = line.path;
    for (let q = 0; q + 1 < p.length; q++) { const e = railEdgeCost(w, p[q], p[q + 1], spec.cls, line.cls); km += e.km; cost += e.cost; mAcc += e.km * TR.terrainCostFactor.monthsByTerrain[terr(w, p[q], p[q + 1])]; }
    const months = monthsFor(TR.rail[spec.cls].monthsBase, TR.rail[spec.cls].monthsPerKm * 0.7, km, mAcc / Math.max(1e-9, km));
    return { ok: errors.length === 0, errors, warnings, km, kmNew: km, cost: cost * ci, months, nodes: p };
  }
  if (spec.kind === 'station') {
    const nd = spec.node ?? -1, lv = spec.cls; if (!nodeValid(w, nd)) return empty(['Pick a kecamatan under your control.']);
    if (lv < 1 || lv > 2) return empty(['Pick halt or major station.']); if (!w.railPath[nd]) return empty(['A station can only be added on a kecamatan that a rail line crosses.']);
    if (w.railStation[nd] >= lv) errors.push('There is already a station of this size or bigger here.'); unlocked(TR.station.unlock, 'Stations');
    const line = tr.lines.find(l => l.id === spec.lineId) ?? tr.lines.find(l => l.path.includes(nd)); if (!line) errors.push('No line found through this kecamatan.');
    return { ok: errors.length === 0, errors, warnings, km: 0, kmNew: 0, cost: TR.station.cost[lv] * ci, months: TR.station.months[lv], nodes: [nd] };
  }
  // port
  const nd = spec.node ?? -1, lv = spec.cls; if (!nodeValid(w, nd)) return empty(['Pick a kecamatan under your control.']);
  if (!w.coastal[nd] && !w.portLevel[nd]) return empty(['Ports need a coastal kecamatan (existing river ports can be upgraded).']); if (lv < 1 || lv >= TR.ports.levels.length) return empty(['Pick a port level.']);
  unlocked(TR.ports.levels[lv].unlock, TR.ports.levels[lv].name); const cur = w.portLevel[nd]; if (lv <= cur) errors.push(`Already ${TR.ports.levels[cur].name} or better.`);
  if (tr.projects.some(q => q.kind === 'port' && q.node === nd)) errors.push('A port project is already under way here.');
  const neu = TR.ports.levels[lv].cost, old = cur > 0 ? TR.ports.levels[cur].cost * 0.5 : 0;
  return { ok: errors.length === 0, errors, warnings, km: 0, kmNew: 0, cost: Math.max(0.3 * neu, neu - old) * ci, months: TR.ports.levels[lv].months, nodes: [nd] };
}

/** Governance-driven cost overrun multiplier (1 + base + max · shortfall). */
export const overrunFactor = (gov: number, gov0: number): number => 1 + TR.governance.overrunBase + TR.governance.overrunMax * Math.min(1, Math.max(0, 1 - gov / Math.max(1e-6, gov0)));

/** Put a finished project into the world. Returns the kecamatan whose access changed. */
export function completeProject(w: TW, tr: TransportState, p: Project): number[] {
  switch (p.kind) {
    case 'road': for (const i of p.path) if (w.roadClass[i] < p.cls) w.roadClass[i] = p.cls; return p.path;
    case 'rail': {
      const line: RailLine = { id: `L${p.id}`, name: p.name, cls: p.cls, gauge: p.cls === NRAIL - 1 ? 1435 : 1067, degraded: false, cond: 1, path: [...p.path], stations: (p.stations ?? []).map(([a, b]) => [a, b] as [number, number]) };
      tr.lines.push(line); for (const i of line.path) w.railPath[i] = 1; for (const [i, lv] of line.stations) w.railStation[i] = Math.max(w.railStation[i], lv); return line.path;
    }
    case 'upgrade': { const line = tr.lines.find(l => l.id === p.lineId); if (!line) return []; line.cls = p.cls; line.cond = 1; line.degraded = false; return line.path; }
    case 'station': {
      const line = tr.lines.find(l => l.id === p.lineId) ?? tr.lines.find(l => l.path.includes(p.node as number)); const nd = p.node as number; if (!line) return [];
      const ex = line.stations.find(s => s[0] === nd); if (ex) ex[1] = Math.max(ex[1], p.cls); else line.stations.push([nd, p.cls]); w.railStation[nd] = Math.max(w.railStation[nd], p.cls); return [nd];
    }
    case 'port': w.portLevel[p.node as number] = Math.max(w.portLevel[p.node as number], p.cls); return [p.node as number];
  }
}

// ---------------------------------------------------------------- routing
interface HeapItem { k: number; v: number }
/** Cheapest chain of neighbouring kecamatan from a to b (Dijkstra; existing infrastructure is nearly free to reuse). */
export function findRoute(w: TW, a: number, b: number, kind: 'road' | 'rail', cls: number, year: number): number[] | null {
  if (!nodeValid(w, a) || !nodeValid(w, b)) return null; if (a === b) return [a];
  const n = w.n, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1); const heap: HeapItem[] = []; void year;
  const push = (it: HeapItem) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].k <= heap[i].k) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = (): HeapItem => { const top = heap[0], last = heap.pop() as HeapItem; if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1].k < heap[c].k) c++; if (heap[c].k >= heap[i].k) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
  dist[a] = 0; push({ k: 0, v: a });
  while (heap.length) {
    const { k, v } = pop(); if (k > dist[v]) continue; if (v === b) break;
    for (const u of w.neighbors[v]) {
      if (!nodeValid(w, u)) continue; let c: number;
      if (kind === 'road') { const e = roadEdgeCost(w, v, u, cls); c = e.work ? e.cost + 1e-3 * e.km : TR.routing.reuseFactor * e.km; }
      else { const e = railEdgeCost(w, v, u, cls); const reuse = w.railPath[v] && w.railPath[u]; c = reuse ? TR.routing.reuseFactor * e.cost + 1e-3 * e.km : e.cost; }
      const nd = k + c; if (nd < dist[u]) { dist[u] = nd; prev[u] = v; push({ k: nd, v: u }); }
    }
  }
  if (!isFinite(dist[b])) return null; const out: number[] = []; for (let v = b; v >= 0; v = prev[v]) out.push(v); return out.reverse();
}
/** Route through waypoints in order (start, via…, end). */
export function routeThrough(w: TW, via: number[], kind: 'road' | 'rail', cls: number, year: number): number[] | null {
  const out: number[] = []; for (let q = 0; q + 1 < via.length; q++) { const seg = findRoute(w, via[q], via[q + 1], kind, cls, year); if (!seg) return null; if (out.length) seg.shift(); out.push(...seg); }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- keeping lines and projects valid when kecamatan are split or merged
const dedupe = (p: number[]): number[] => p.filter((v, i) => i === 0 || v !== p[i - 1]);
const mergeStations = (st: Array<[number, number]>): Array<[number, number]> => { const m = new Map<number, number>(); for (const [i, l] of st) m.set(i, Math.max(m.get(i) ?? 0, l)); return [...m].map(([i, l]) => [i, l] as [number, number]); };
interface PathHolder { path: number[]; stations?: Array<[number, number]>; node?: number }
/**
 * After a split (`upserted` = [parent, ...new pieces]) or a merge (`removed` = [absorbed], `upserted` = [kept]):
 * re-thread every rail line and queued project through the new kecamatan, so paths stay chains of neighbours.
 */
export function remapAfterGeometry(w: TW, tr: TransportState, ch: { removed: number[]; upserted: number[] }): void {
  const holders: PathHolder[] = [...tr.lines, ...tr.projects];
  if (ch.removed.length) {
    const gone = new Set(ch.removed), keep = ch.upserted[0]; const fix = (i: number) => (gone.has(i) ? keep : i);
    for (const o of holders) { o.path = dedupe(o.path.map(fix)); if (o.stations) o.stations = mergeStations(o.stations.map(([i, l]) => [fix(i), l] as [number, number])); if (o.node !== undefined) o.node = fix(o.node); }
    return;
  }
  if (ch.upserted.length < 2) return;
  const R = ch.upserted[0], pieces = ch.upserted.filter(i => w.alive[i]), set = new Set(pieces);
  for (const o of holders) {
    const q = o.path.indexOf(R); if (q < 0) continue; const prev = q > 0 ? o.path[q - 1] : -1, next = q + 1 < o.path.length ? o.path[q + 1] : -1;
    const starts = pieces.filter(p => prev < 0 || w.neighbors[p].includes(prev)), goal = (p: number) => next < 0 || w.neighbors[p].includes(next);
    // shortest chain of pieces from a piece touching prev to a piece touching next
    let chain: number[] = [R]; const par = new Map<number, number>(); const queue = [...starts]; starts.forEach(s => par.set(s, -1)); let hit = -1;
    for (let h = 0; h < queue.length && hit < 0; h++) { const v = queue[h]; if (goal(v)) { hit = v; break; } for (const u of w.neighbors[v]) if (set.has(u) && !par.has(u)) { par.set(u, v); queue.push(u); } }
    if (hit >= 0) { chain = []; for (let v = hit; v >= 0; v = par.get(v) as number) chain.push(v); chain.reverse(); }
    o.path = [...o.path.slice(0, q), ...chain, ...o.path.slice(q + 1)];
    if (o.stations) {
      const lvl = o.stations.filter(([i]) => i === R).reduce((m, [, l]) => Math.max(m, l), 0); o.stations = o.stations.filter(([i]) => i !== R);
      if (lvl > 0) { const own = chain.filter(p => w.railStation[p] > 0); if (own.length) for (const p of own) o.stations.push([p, w.railStation[p]]); else o.stations.push([chain[0], lvl]); }
      o.stations = mergeStations(o.stations);
    }
  }
  for (const p of pieces) w.railPath[p] = tr.lines.some(l => l.path.includes(p)) ? 1 : 0;
}

/** Running costs a finished project adds each year (Rp): maintenance of what it builds, plus rail operations. */
export function annualRunning(spec: ProjectSpec, plan: Plan, year: number): { maintenance: number; operations: number } {
  const ci = costIndex(year) * 1e6;
  if (spec.kind === 'road') return { maintenance: plan.kmNew * TR.roads[spec.cls].maintPerKm * ci, operations: 0 };
  if (spec.kind === 'rail' || spec.kind === 'upgrade') return { maintenance: plan.km * TR.rail[spec.cls].maintPerKm * ci, operations: plan.km * TR.rail[spec.cls].opPerKm * ci };
  if (spec.kind === 'port') return { maintenance: TR.ports.levels[spec.cls].maint * ci, operations: 0 };
  return { maintenance: 0, operations: 0 };
}
