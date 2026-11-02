import { TR, NRAIL, buildGraph, capitalTimes, computeCoarse, costIndex, farAccess, localAccess, nodeValid, railSpeedFactor, Router, validPopulation } from './transport';
import type { Coarse, Graph, TW } from './transport';
import { completeProject, overrunFactor, planProject } from './projects';
import type { Plan } from './projects';
import { B } from './balance';
import { Y_REF } from './model';
import { SECTORS } from './fields';
import type { Nation, SimWorld } from './types';
import type { Project, ProjectSpec, RailLine, Overrides } from './transport';
import { MONTH_NAMES, monthOfYear, yearOf } from './balance';

export interface PreviewResult { plan: Plan; nodes: Int32Array; rel: Float32Array; dGdp: number; ms: number }
export interface MonthFlows { outlay: number; railRevenue: number; railOps: number; changed: boolean }

/** Per-run transport engine: owns the graph, the access computation, the construction queue, maintenance condition and the rail service model. */
export class TransportSim {
  g!: Graph; rt!: Router; coarse: Coarse | null = null; far: Float64Array = new Float64Array(0); lastCoarseYear = -1e9; ms = 0;
  constructor(private w: SimWorld, private nation: Nation) { this.rebuild(); }
  private get tr() { return this.nation.transport; }
  private get tw(): TW { return this.w as unknown as TW; }

  rebuild(): void {
    this.g = buildGraph(this.tw, this.tr); this.rt = new Router(this.g); this.tr.kmRoad = this.g.kmRoad.slice(); this.tr.kmRail = this.g.kmRail;
  }
  /** Access of every kecamatan (s.ma) and travel times to the regency / province capital (s.tcap, s.tprov). The long-distance layer is only recomputed when asked. */
  fullAccess(year: number, withCoarse: boolean): void {
    const t0 = performance.now(), w = this.tw, S = this.w.s; const { valid, total } = validPopulation(w);
    const src: number[] = []; for (let i = 0; i < w.n; i++) if (valid[i]) src.push(i);
    const loc = new Float64Array(w.n); localAccess(w, this.rt, src, loc, total);
    if (withCoarse || !this.coarse || this.coarse.R !== w.regencies.length) { this.coarse = computeCoarse(w, this.rt); this.lastCoarseYear = year; }
    this.far = farAccess(w, this.coarse, total);
    for (const i of src) S.ma[i] = loc[i] + this.far[w.kecReg[i]];
    capitalTimes(w, this.rt, S.tcap as Float64Array, S.tprov as Float64Array);
    this.tr.lastFull = this.nation.month; this.ms = performance.now() - t0;
  }
  /** What would this project do to access? Local access (inside the cutoff) is recomputed for every kecamatan the new link can reach, old network against new. */
  previewProject(spec: ProjectSpec, year: number): PreviewResult {
    const w = this.tw, tr = this.tr; const plan = planProject(w, tr, spec, year, overrunFactor(this.nation.agg.gov, this.nation.gov0));
    const empty: PreviewResult = { plan, nodes: new Int32Array(0), rel: new Float32Array(0), dGdp: 0, ms: 0 }; if (!plan.ok || !plan.nodes.length) return empty;
    const t0 = performance.now(); const ov: Overrides = {};
    if (spec.kind === 'road') { const rc = (w.roadClass as Uint8Array).slice(); for (const i of spec.path) rc[i] = Math.max(rc[i], spec.cls); ov.roadClass = rc; }
    else if (spec.kind === 'port') { const pl = (w.portLevel as Uint8Array).slice(); pl[spec.node as number] = Math.max(pl[spec.node as number], spec.cls); ov.portLevel = pl; }
    else {
      const lines: RailLine[] = tr.lines.map(l => ({ ...l, stations: l.stations.map(x => [x[0], x[1]] as [number, number]) }));
      if (spec.kind === 'rail') lines.push({ id: 'preview', name: spec.name, cls: spec.cls, gauge: 1067, degraded: false, cond: 1, path: spec.path, stations: (spec.stations ?? []).map(x => [x[0], x[1]] as [number, number]) });
      else if (spec.kind === 'upgrade') { const l = lines.find(q => q.id === spec.lineId); if (l) { l.cls = spec.cls; l.cond = 1; } }
      else { const l = lines.find(q => q.id === spec.lineId) ?? lines.find(q => q.path.includes(spec.node as number)); if (l) l.stations.push([spec.node as number, spec.cls]); }
      ov.lines = lines;
    }
    const g2 = buildGraph(w, tr, ov); const rt2 = new Router(g2); const { total } = validPopulation(w);
    // sources = everything within the cutoff of a changed node on the new network (access can only improve there)
    const hit = new Set<number>(); for (const nd of plan.nodes) { rt2.run(nd, TR.access.cutoffHours); for (let k = 0; k < rt2.count; k++) hit.add(rt2.order[k]); }
    const src = [...hit].filter(i => nodeValid(w, i)); const a = new Float64Array(w.n), b = new Float64Array(w.n); localAccess(w, this.rt, src, a, total); localAccess(w, rt2, src, b, total);
    const rel = new Float32Array(src.length); let dG = 0; const theta = B.sectors.thetaMA; const S = this.w.s;
    src.forEach((i, q) => { const base = a[i] + (this.far[w.kecReg[i]] || 0); const r = base > 0 ? (b[i] - a[i]) / base : 0; rel[q] = r; if (r > 0) { const l = Math.log1p(r); for (let k = 0; k < SECTORS; k++) dG += S.out[i * SECTORS + k] * theta[k] * l; } });
    return { plan, nodes: Int32Array.from(src), rel, dGdp: dG, ms: performance.now() - t0 };
  }
  /** January: conditions have drifted, populations moved. */
  yearly(year: number): void { this.rebuild(); this.fullAccess(year, year - this.lastCoarseYear >= TR.access.coarseEveryYears); }

  /** Annual maintenance bill of the whole network at today's cost level (Rp / yr). */
  required(year: number): { road: number; rail: number; port: number; total: number } {
    const ci = costIndex(year) * 1e6; let road = 0; for (let c = 1; c < TR.roads.length; c++) road += this.tr.kmRoad[c] * TR.roads[c].maintPerKm;
    let rail = 0; for (const l of this.tr.lines) { const info = this.g.railInfo.find(r => r.line === l); rail += (info?.km ?? 0) * TR.rail[l.cls].maintPerKm; }
    let port = 0; for (const p of this.g.ports) port += TR.ports.levels[this.w.portLevel[p]].maint;
    return { road: road * ci, rail: rail * ci, port: port * ci, total: (road + rail + port) * ci };
  }

  /** Advance construction, wear and the rail service by one month. `funded` = this year's maintenance budget (Rp / yr). Annualised flows are returned. */
  month(year: number, funded: number): MonthFlows {
    const tr = this.tr, n = this.nation; const req = this.required(year); tr.required = { road: req.road, rail: req.rail, port: req.port }; const dt = 1 / 12;
    // construction
    const over = overrunFactor(n.agg.gov, n.gov0); let outlay = 0; const done: number[] = []; const finished: Project[] = [];
    for (const p of tr.projects) {
      if (p.paused) continue; const step = Math.min(1 - p.progress, 1 / p.months); const pay = (p.cost * over * step); p.progress += step; p.paid += pay; outlay += pay;
      if (p.progress >= 1 - 1e-9) finished.push(p);
    }
    for (const p of finished) { done.push(...completeProject(this.tw, tr, p)); n.notices.push(`${yearName(n.month)}: ${p.name} completed.`); if (n.notices.length > 40) n.notices.shift(); }
    if (finished.length) tr.projects = tr.projects.filter(p => !finished.includes(p));
    // wear and rehabilitation: stable at exactly the required budget, decays below it, improves above it
    const cov = req.total > 0 ? funded / req.total : 1; tr.coverage = cov; const C = TR.roadCondition, RC = TR.railCondition;
    const down = (1 - Math.min(1, cov)) * dt, up = Math.min(1, Math.max(0, cov - 1)) * dt;
    for (let c = 1; c < tr.roadCond.length; c++) tr.roadCond[c] = Math.min(1, Math.max(0.05, tr.roadCond[c] - C.decayPerYearUnfunded * down + C.recoverPerYearFunded * up));
    for (const l of tr.lines) l.cond = Math.min(1, Math.max(0.05, l.cond - C.decayPerYearUnfunded * down + C.recoverPerYearFunded * up));
    void RC;
    if (finished.length) { this.rebuild(); this.fullAccess(year, true); }
    const rail = this.railService(year); tr.lastRail = rail;
    return { outlay: outlay / dt, railRevenue: rail.revenue, railOps: rail.ops, changed: finished.length > 0 };
  }

  /** Passenger gravity model between the stations of each line plus a freight bonus from output next to stations; returns annual Rp. */
  railService(year: number): { revenue: number; ops: number; pkm: number; tkm: number } {
    const w = this.tw, S = this.w.s, RS = TR.railService, n = this.nation; let revenue = 0, ops = 0, pkm = 0, freight = 0;
    const inc = Math.pow(Math.max(0.3, n.agg.gdppc / Y_REF), RS.incomeElasticity); const ci = costIndex(year);
    for (const info of this.g.railInfo) {
      const l = info.line, st = info.stationPos; const spd = TR.rail[l.cls].speedKmh * railSpeedFactor(l.cond); const speedF = Math.pow(spd / RS.refSpeedKmh, RS.speedElasticity);
      const nodes = st.map(([q]) => l.path[q]), cum = st.map(([q]) => info.cum[q]), catchment = st.map(([q, lv], k) => (nodeValid(w, nodes[k]) ? w.pop[nodes[k]] * RS.catchmentMult[lv] : 0 * q));
      for (let a = 0; a < st.length; a++) {
        let norm = 0; for (let b = 0; b < st.length; b++) if (b !== a) norm += catchment[b] / (Math.abs(cum[b] - cum[a]) + RS.distanceOffsetKm); if (norm <= 0) continue;
        const gen = catchment[a] * RS.tripsPerCapitaYear * inc * speedF;
        for (let b = 0; b < st.length; b++) if (b !== a) { const d = Math.abs(cum[b] - cum[a]); pkm += (gen * (catchment[b] / (d + RS.distanceOffsetKm))) / norm * d; }
      }
      for (const nd of nodes) { if (!nodeValid(w, nd)) continue; for (const s of RS.freightSectors) freight += S.out[nd * SECTORS + s] * RS.freightPerOutput * speedF; }
      ops += info.km * TR.rail[l.cls].opPerKm * 1e6 * ci;
    }
    revenue = pkm * RS.farePerPkmRp + freight; return { revenue, ops, pkm, tkm: freight };
  }
}
const yearName = (month: number): string => `${MONTH_NAMES[monthOfYear(month)]} ${yearOf(month)}`;
void NRAIL;
