/* Automatic players used by the headless calibration harness.
   passive    – does nothing (pending decisions fall to their defaults at the deadline)
   historical – a stand-in for what Indonesia actually did: decisions marked `hist`, a slow rise in social spending, little investment before 1967, more after, an Eastern tilt 1957–65 then Western
   smart      – an efficient planner: spends the fiscal space on education, health and maintenance, builds the best roads, ports and industries by payback, enacts the investment law early
   Both active policies use only commands a human player has (budget lines, projects, industries, decisions, alignment, loans). */
import { yearOf, monthOfYear, interp } from '../src/sim/balance';
import type { SimCore } from '../src/sim/core';
import type { Nation } from '../src/sim/types';
import { DECISION, resolveDecision } from '../src/sim/events';
import { findRoute, overrunFactor, planProject } from '../src/sim/projects';
import type { ProjectSpec, TW } from '../src/sim/transport';
import { TR } from '../src/sim/transport';
import { TYPES, aidOffers, fdiOffers, planIndustry, startIndustry, useCapacity, requirements } from '../src/sim/industry';
import type { IndSpec, IndType } from '../src/sim/industry';
import { addProgramLoan } from '../src/sim/finance';
import { hav } from '../src/sim/transport';
import type { BudgetKey } from '../src/sim/balance';

export type PolicyName = 'passive' | 'historical' | 'smart';
interface Params {
  edu: Array<[number, number]>; health: Array<[number, number]>; infra: Array<[number, number]>; rnd: Array<[number, number]>; kb: number; exploration: Array<[number, number]>; subsidies: number;
  capex: Array<[number, number]>;   // new project starts per year, % of GDP
  payback: number;                  // accept projects that repay their cost within this many years
  align: Array<[number, number]>; lawYear: number; roads: number; ports: number; industries: number; cashReserve: number; loanShare: number;
}
const SMART: Params = {
  edu: [[1950, 1.2], [1965, 2.2], [1990, 3.0], [2020, 3.5]], health: [[1950, 0.5], [1970, 1.0], [2000, 1.4]], infra: [[1950, 1.0], [1970, 1.6]], rnd: [[1950, 0.1], [1970, 0.3], [1990, 0.8], [2005, 1.0]], kb: 0.1, exploration: [[1950, 0.05], [1960, 0.2]], subsidies: 0.3,
  capex: [[1950, 0.8], [1960, 2.5], [1990, 3.5]], payback: 14, align: [[1950, -0.5], [2050, -0.5]], lawYear: 1958, roads: 4, ports: 1, industries: 3, cashReserve: 0.003, loanShare: 0.5
};
const HISTORICAL: Params = {
  edu: [[1950, 0.8], [1970, 1.1], [1990, 1.8], [2009, 3.2]], health: [[1950, 0.4], [1980, 0.5], [2005, 0.8], [2020, 1.4]], infra: [[1950, 1.0], [1970, 1.3]], rnd: [[1950, 0.05], [1975, 0.15], [2000, 0.3]], kb: 0.1, exploration: [[1950, 0.0], [1966, 0.08]], subsidies: 0.8,
  capex: [[1950, 0.1], [1966, 0.2], [1969, 1.6], [1997, 1.6], [1999, 0.4], [2005, 1.2], [2026, 1.5]], payback: 20, align: [[1950, 0], [1956, 0], [1958, 0.4], [1965, 0.4], [1967, -0.6], [2050, -0.4]], lawYear: 1967, roads: 2, ports: 1, industries: 2, cashReserve: 0.003, loanShare: 0.6
};

const hist = (t: Array<[number, number]>, y: number): number => interp(t, y);
const REG = { cap: [] as number[], ready: false };

export class Agent {
  private p: Params | null; private lastYear = 0; log: string[] = []; started = { roads: 0, ports: 0, industries: 0 };
  capexMul = Number(process.env.CAPEX ?? 1); socialMul = Number(process.env.SOCIAL ?? 1);
  constructor(readonly name: PolicyName, private core: SimCore) { this.p = name === 'smart' ? SMART : name === 'historical' ? HISTORICAL : null; }
  private get n(): Nation { return this.core.nation; }

  /** Called before every simulated month. */
  act(): void {
    const n = this.n, year = yearOf(n.month), moy = monthOfYear(n.month);
    if (this.name === 'passive' || !this.p) return;
    for (const pd of [...n.ev.pending]) { const d = DECISION.get(pd.id); if (!d) continue; const k = d.options.findIndex(o => (this.name === 'smart' ? o.smart : o.hist)) ; const alt = d.options.findIndex(o => o.hist); resolveDecision(this.core.w, n, pd.id, k >= 0 ? k : alt >= 0 ? alt : d.default); }
    if (year >= this.p.lawYear && !n.fin.fdiLaw && year >= 1958) { n.fin.fdiLaw = true; n.fin.lawYear = year; }
    if (moy === 0 && year !== this.lastYear) { this.lastYear = year; this.january(year); }
    if (moy === 6) this.cashManagement(year);
  }

  private january(year: number): void {
    const n = this.n, p = this.p as Params, B = n.policy.budgetNext, gdp = Math.max(1, n.agg.gdp);
    n.fin.alignTarget = hist(p.align, year);
    B.education = hist(p.edu, year) * this.socialMul + (1 - this.socialMul) * 0.8; B.health = hist(p.health, year); B.infra = hist(p.infra, year); B.rnd = hist(p.rnd, year); B.exploration = hist(p.exploration, year); B.subsidies = p.subsidies;
    if (year >= 1968) B.kb = p.kb;
    // maintenance: fund what the network needs, with a margin
    const req = n.transport.required; B.maintenance = Math.max(0.09, ((req.road + req.rail + req.port) / gdp) * 100 * 1.05);
    // spend the fiscal space: tax rates stay at their reference values, the deficit is kept small
    const capex = (hist(p.capex, year) / 100) * gdp * this.capexMul; const t0 = performance.now(); this.invest(year, capex); if (process.env.AGENT_TIMING) console.error(`  [${this.name}] ${year}: invest ${(performance.now() - t0).toFixed(0)} ms, capex ${(capex / 1e12).toFixed(2)} T, started ${JSON.stringify(this.started)}`);
  }
  /** Mid-year: if the treasury is thin, borrow from aid partners; if it overflows, nothing (surpluses already repay domestic debt). */
  private cashManagement(year: number): void {
    const n = this.n, p = this.p as Params; const need = p.cashReserve * n.agg.gdp * 3; if (n.cash >= need) return;
    for (const o of aidOffers(n, year, n.agg.gdp)) { if (o.partner.grant) continue; const a = Math.min(o.remaining * p.loanShare, need * 2); if (a > 0) { useCapacity(n, o.partner.id, n.month, a); addProgramLoan(n, o.partner.id, a); if (n.cash >= need) break; } }
  }

  // ---------------------------------------------------------------- investment
  private committed(): number { const n = this.n; return n.transport.projects.reduce((s, q) => s + (q.cost - q.paid), 0) + n.ind.list.filter(x => x.status === 'building').reduce((s, x) => s + (x.cost - x.paid), 0); }
  private invest(year: number, budget: number): void {
    const n = this.n, p = this.p as Params; let left = budget - 0.5 * this.committed(); if (left <= 0) return;
    // industries first (they carry their own financing), then roads and ports
    left = this.industries(year, left, p.industries);
    left = this.roads(year, left, p.roads);
    this.ports(year, left, p.ports); void n;
  }
  private industries(year: number, budget: number, maxStarts: number): number {
    const n = this.n, w = this.core.w; const cands: Array<{ spec: IndSpec; score: number; cost: number }> = [];
    const kecs = this.topKecs(250);
    for (const t of TYPES) {
      if (year < t.unlock) continue; const sites = t.kind === 'extract' ? n.ind.deposits.filter(d => d.revealed && !d.developed).map(d => d.kec) : kecs;
      for (const i of sites) {
        if (n.ind.list.some(x => x.kec === i && x.type === t.id && x.status !== 'closed')) continue;
        if (!requirements(w, n, t, i, year).reqs.every(r => r.ok)) continue;
        const spec: IndSpec = { type: t.id, kec: i, financing: 'apbn' }; const pl = planIndustry(w, n, spec, year, overrunFactor(n.agg.gov, n.gov0)); if (!pl.ok || pl.cost <= 0) continue;
        const payback = pl.cost / Math.max(1, pl.va * t.margin); if (payback > (this.p as Params).payback) continue; cands.push({ spec, score: 1 / payback, cost: pl.cost });
      }
    }
    cands.sort((a, b) => b.score - a.score); let started = 0; const perType = new Map<string, number>();
    for (const c of cands) {
      if (started >= maxStarts) break; if ((perType.get(c.spec.type) ?? 0) >= 1) continue;
      let spec = c.spec; let cost = c.cost;
      if (cost > budget) { // cannot pay from the budget: try aid, then foreign investment
        const aid = aidOffers(n, year, n.agg.gdp).find(o => !o.partner.grant && planIndustry(w, n, { ...spec, financing: 'aid', partner: o.partner.id }, year, 1).ok);
        if (aid) spec = { ...spec, financing: 'aid', partner: aid.partner.id };
        else { const t = TYPES.find(x => x.id === spec.type) as IndType; const o = fdiOffers(n, t, year)[0]; if (!o) continue; spec = { ...spec, financing: 'fdi', offer: o.id }; }
        const pl = planIndustry(w, n, spec, year, overrunFactor(n.agg.gov, n.gov0)); if (!pl.ok) continue; startIndustry(w, n, spec, pl, n.month); started++; perType.set(spec.type, 1); this.started.industries++; continue;
      }
      const pl = planIndustry(w, n, spec, year, overrunFactor(n.agg.gov, n.gov0)); if (!pl.ok) continue; startIndustry(w, n, spec, pl, n.month); budget -= pl.cost; started++; perType.set(spec.type, 1); this.started.industries++;
    }
    return budget;
  }
  private topKecs(k: number): number[] {
    const w = this.core.w, n = this.n; const ids: number[] = []; for (let i = 0; i < w.n; i++) if (w.alive[i] && !(w.provinces[w.regProv[w.kecReg[i]]]?.locked ?? true)) ids.push(i); ids.sort((a, b) => w.pop[b] - w.pop[a]); void n; return ids.slice(0, k);
  }
  private roads(year: number, budget: number, maxStarts: number): number {
    const n = this.n, w = this.core.w as unknown as TW; if (!REG.ready) { REG.ready = true; }
    const caps: number[] = []; for (const r of this.core.w.regencies) if (r.capital >= 0 && this.core.w.alive[r.capital] && !(this.core.w.provinces[this.core.w.regProv[this.core.w.kecReg[r.capital]]]?.locked ?? true)) caps.push(r.capital);
    const regPop = (i: number): number => { let s = 0; for (const j of this.core.w.regencies[this.core.w.kecReg[i]].kec) s += this.core.w.pop[j]; return s; };
    const pops = new Map(caps.map(c => [c, regPop(c)] as const)); const pairs: Array<{ a: number; b: number; s: number }> = [];
    for (const a of caps) { let best = -1, bs = 0; for (const b of caps) { if (a === b || pops.get(b)! < pops.get(a)! * 0.8) continue; const d = hav(w.labelLon[a], w.labelLat[a], w.labelLon[b], w.labelLat[b]); if (d > 220 || d < 8) continue; const s = (pops.get(a)! * pops.get(b)!) / (d * d); if (s > bs) { bs = s; best = b; } } if (best >= 0) pairs.push({ a, b: best, s: bs }); }
    pairs.sort((x, y) => y.s - x.s); const classes = [2, 3, 4, 5].filter(c => year >= TR.roads[c].unlock); const cands: Array<{ spec: ProjectSpec; ratio: number; cost: number }> = [];
    let tried = 0;
    for (const { a, b } of pairs) {
      if (tried >= 22) break;
      for (const cls of classes) {
        const path = findRoute(w, a, b, 'road', cls, year); if (!path) continue; const spec: ProjectSpec = { kind: 'road', name: `${a}-${b}`, cls, path }; const pl = planProject(w, n.transport, spec, year, 1); if (!pl.ok) continue;
        if (n.transport.projects.some(q => q.path.some(x => path.includes(x)) && q.kind === 'road')) continue; tried++;
        const pv = this.core.tr.previewProject(spec, year); const gain = pv.dGdp; if (gain <= 0) continue; const payback = pl.cost / gain; if (payback > (this.p as Params).payback) continue; cands.push({ spec, ratio: gain / pl.cost, cost: pl.cost });
      }
    }
    cands.sort((x, y) => y.ratio - x.ratio); let started = 0;
    for (const c of cands) {
      if (started >= maxStarts || c.cost > budget) continue; if (n.transport.projects.some(q => q.kind === 'road' && q.path.some(x => c.spec.path.includes(x)))) continue;
      const pl = planProject(w, n.transport, c.spec, year, overrunFactor(n.agg.gov, n.gov0)); if (!pl.ok) continue; const tr = n.transport;
      tr.projects.push({ ...c.spec, path: [...c.spec.path], id: tr.nextId++, km: pl.km, cost: pl.cost, months: pl.months, progress: 0, paid: 0, paused: false, start: n.month }); budget -= pl.cost; started++; this.started.roads++;
    }
    return budget;
  }
  private ports(year: number, budget: number, maxStarts: number): number {
    const n = this.n, w = this.core.w; let started = 0; const kecs = this.topKecs(120).filter(i => w.coastal[i] || w.portLevel[i] > 0);
    for (const i of kecs) {
      if (started >= maxStarts) break; const lv = w.portLevel[i] + 1; if (lv >= TR.ports.levels.length || year < TR.ports.levels[lv].unlock) continue; if (lv > 3 && w.pop[i] < 1e6) continue; if (lv > 2 && w.pop[i] < 2e5) continue;
      if (n.transport.projects.some(q => q.kind === 'port' && q.node === i)) continue;
      const spec: ProjectSpec = { kind: 'port', name: `port ${i}`, cls: lv, path: [], node: i }; const pl = planProject(w as unknown as TW, n.transport, spec, year, overrunFactor(n.agg.gov, n.gov0)); if (!pl.ok || pl.cost > budget) continue;
      const tr = n.transport; tr.projects.push({ ...spec, id: tr.nextId++, km: pl.km, cost: pl.cost, months: pl.months, progress: 0, paid: 0, paused: false, start: n.month }); budget -= pl.cost; started++; this.started.ports++;
    }
    return budget;
  }
}
export type { BudgetKey };
