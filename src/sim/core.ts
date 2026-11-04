import { newPetitions } from './petitions';
import { laneProximity, laneRows } from './lanes';
import { ZC, newZones, zoneRows, organicIndustry } from './zones';
import { B, BUD, BUDGET_KEYS, HIST, interp, monthOfYear, yearOf } from './balance';
import type { BudgetKey } from './balance';
import { SECTORS, isResource } from './fields';
import { clamp, derive, eysDrivers, accessDrivers, lifeDrivers, literacyOf, normCdf, povertyOf, rebaseline, sigm, softCap, stockSat, tfrDrivers, urbanDrivers, workersOf, Y_REF, fillMult, incomeOf, agriLabour } from './model';
import { ipmFrom } from './ipm';
import type { Flows, Nation, Policy, Series, SimWorld, UnitStats } from './types';
import { newTransport, TR } from './transport';
import type { TransportState } from './transport';
import { TransportSim } from './transportSim';
import IND from '../../config/industries.json';
import { industryRows, newFin, newIndState, newPrices } from './industry';
import type { IndState } from './industry';
import { industryMonth } from './industrySim';
import { defaultSettings, eventsMonth, evaluateEnd, newEnd, newEvents } from './events';
import { climateTarget, financeMonth, loanMonth, savingsClimateFactor, seedLegacyDebt, totalExternal } from './finance';

const NR = [0, 1, 2, 3, 6, 7, 8, 9]; // sectors whose labour can move (resource sectors are capacity driven)
const emptyFlows = (): Flows => ({ gdp: 0, revenue: 0, taxes: {}, pad: 0, spending: {}, interest: 0, transfers: { dau: 0, dbh: 0, dak: 0 }, deficit: 0, borrowDom: 0, monetized: 0, repay: 0, dCash: 0, admin: 0, localFund: 0, extRepay: 0, extInterest: 0, soe: 0 });
const emptySeries = (): Series => ({ t: [], pop: [], gdp: [], gdppc: [], ipm: [], life: [], mys: [], eys: [], literacy: [], poverty: [], urban: [], agriShare: [], inflation: [], stability: [], cash: [], debtGdp: [], revenueGdp: [], spendingGdp: [], deficitGdp: [], tfr: [], births: [], deaths: [] });
export const defaultPolicy = (): Policy => ({
  rates: { ...BUD.tax.refRates }, budget: { ...BUD.defaultBudgetPctGdp }, budgetNext: { ...BUD.defaultBudgetPctGdp }, revisionYear: 0, devPreset: 'balanced', provPreset: {}, deficitRule: false
});
/** Bring a nation from an older save up to date (new budget lines, transport state). */
export function migrateNation(n: Nation, seed: () => TransportState): Nation {
  const d = defaultPolicy(); for (const k of BUDGET_KEYS) { if (n.policy.budget[k] === undefined) n.policy.budget[k] = d.budget[k]; if (n.policy.budgetNext[k] === undefined) n.policy.budgetNext[k] = d.budgetNext[k]; }
  if (!n.transport) { n.transport = seed(); n.transport.dirty = true; }
  n.zones ??= newZones(); n.petitions ??= newPetitions(); n.ind ??= newIndState(); n.fin ??= newFin(); n.prices ??= newPrices(); n.settings = { ...defaultSettings(), ...(n.settings ?? {}), lose: { ...defaultSettings().lose, ...(n.settings?.lose ?? {}) } }; n.ev ??= newEvents(n.settings.seed); n.end ??= newEnd();
  if (!n.fin.loans.length && n.debtExt > 0) seedLegacyDebt(n, n.debtExt);
  return n;
}
export function newNation(seed = 1): Nation {
  return {
    month: 0, cash: B.nation.startCashRp, debtDom: 0, debtExt: 0, inflation: B.nation.startInflation, priceIndex: 1, stability: B.stability.base, adminHits: 0, kbCov: 0, gov0: 1,
    tfp: new Array(SECTORS).fill(1), policy: defaultPolicy(),
    agg: { pop: 0, gdp: 0, gdppc: 0, eduSat: 0, mys: 0, life: 0, ipm: 0, gov: 1, fund: 1, ineq: 0.4, poverty: 0, urban: 0, tfr: 0, eys: 0, lit: 0 },
    ipmPrev: 0, dIpm: 0.005,
    last: emptyFlows(), series: emptySeries(), flags: { hyper: false, collapse: false }, births: 0, deaths: 0, notices: [], transport: { ...newTransport(), dirty: false },
    ind: newIndState(), fin: newFin(), prices: newPrices(), settings: defaultSettings(seed), ev: newEvents(seed), end: newEnd(), zones: newZones(), petitions: newPetitions()
  };
}

const kmPerDegLat = 110.57;
export class SimCore {
  readonly R: number; readonly P: number; stats: UnitStats;
  tr: TransportSim; private isCap: Uint8Array; private span: Float64Array; private mult = new Float64Array(SECTORS); private delta: Float64Array; polNow = 1; private lowStabMonths = 0; collapseMonths = 0; private ev!: { sector: number[] }; private loc: Float64Array; private amenity: Float64Array; private zCut: Float64Array; private laneP: Float64Array; private laneM: Float64Array; private zEase: Float64Array; private provMult: Float64Array;
  constructor(readonly w: SimWorld, public nation: Nation) {
    this.R = w.regencies.length; this.P = w.provinces.length; const R = this.R, P = this.P;
    this.stats = { regFund: new Float64Array(R), regOp: new Float64Array(R), regPad: new Float64Array(R), regDbh: new Float64Array(R), regDau: new Float64Array(R), regDak: new Float64Array(R), regGov: new Float64Array(R).fill(1), regStab: new Float64Array(R).fill(B.stability.base), regPop: new Float64Array(R),
      provFund: new Float64Array(P), provOp: new Float64Array(P), provDau: new Float64Array(P), provPad: new Float64Array(P), provPop: new Float64Array(P), provGov: new Float64Array(P).fill(1) };
    this.loc = new Float64Array(w.n).fill(1); this.zCut = new Float64Array(w.n); this.amenity = new Float64Array(w.n); this.laneP = new Float64Array(w.n); this.laneM = new Float64Array(w.n); laneProximity(w, this.laneP); this.zEase = new Float64Array(w.n); this.provMult = new Float64Array(this.P).fill(1); this.isCap = new Uint8Array(w.n); this.span = new Float64Array(R); this.delta = new Float64Array(w.n);
    w.regencies.forEach(r => { if (r.capital >= 0) this.isCap[r.capital] = 1; });
    this.tr = new TransportSim(w, nation);
    if (nation.transport.dirty) { // an administrative edit changed the network: recompute access, and make the new rows' access their baseline so output does not jump
      this.tr.fullAccess(yearOf(nation.month), true);
      for (const i of nation.transport.rebase) if (i < w.n && w.alive[i]) w.s.ma0[i] = w.s.ma[i];
      nation.transport.dirty = false; nation.transport.rebase = [];
    }
    this.refreshSpan();
  }
  /** Span of control per regency: population-weighted travel time to the capital (hours), expressed in "equivalent km" so one governance scale fits all eras. */
  private refreshSpan(): void {
    const w = this.w; const kmh = TR.access.spanKmPerHour;
    w.regencies.forEach((r, k) => { let sw = 0, sd = 0; for (const i of r.kec) { sd += w.pop[i] * (w.s.tcap[i] || 0); sw += w.pop[i]; } this.span[k] = sw > 0 ? (sd / sw) * kmh : 0; });
  }
  private locked(k: number): boolean { return this.w.provinces[this.w.regProv[k]]?.locked ?? true; }
  private year(): number { return yearOf(this.nation.month); }

  /** One-time start-of-game setup: governance reference, baselines for every kecamatan, debts, first aggregates. */
  bootstrap(seed?: TransportState, indSeed?: IndState): void {
    const w = this.w, n = this.nation, S = w.s;
    if (seed) n.transport = seed; if (indSeed) n.ind = indSeed; this.tr.rebuild(); this.tr.fullAccess(1950, true); this.refreshSpan(); n.transport.dirty = false; n.transport.rebase = [];
    for (let i = 0; i < w.n; i++) if (w.alive[i]) { S.fund[i] = 1; S.stab[i] = B.stability.base; }
    this.aggregate(false); this.governance(1950); let sw = 0, sg = 0;
    for (let i = 0; i < w.n; i++) if (w.alive[i] && !this.locked(w.kecReg[i])) { sw += w.pop[i]; sg += this.stats.regGov[w.kecReg[i]] * w.pop[i]; }
    n.gov0 = sg / (sw || 1);
    for (let i = 0; i < w.n; i++) if (w.alive[i]) S.gov[i] = this.stats.regGov[w.kecReg[i]] || n.gov0;
    for (const x of n.ind.list) x.done = x.status === 'running' ? -1 : x.done; industryRows(w, n, 1950); // seeded industries are part of the 1950 economy: they set the linkage baseline
    for (let i = 0; i < w.n; i++) if (w.alive[i]) { rebaseline(w, i, n.tfp, 1950, n.gov0, 0); derive(w, i, true); }
    this.aggregate(true); { const c = climateTarget(n, 1950); n.fin.parts = c.parts; n.fin.climate = c.value; }
    n.debtDom = B.nation.startDebtDomesticOverGdp * n.agg.gdp; seedLegacyDebt(n, B.nation.startDebtExternalOverGdp * n.agg.gdp);
    this.record();
  }

  /** Advance one month. */
  step(): void {
    const n = this.nation, dt = 1 / 12, year = this.year(), moy = monthOfYear(n.month);
    if (moy === 0) { n.policy.budget = { ...n.policy.budgetNext }; n.policy.revisionYear = 0; }
    for (const r of this.w.regencies) if (r.status === 'preparing' && r.activeMonth <= n.month) r.status = 'active';
    for (const p of this.w.provinces) if (p.status === 'preparing' && p.activeMonth <= n.month) p.status = 'active';
    if (moy === 0 && n.month > 0) { this.tr.yearly(year); this.refreshSpan(); }
    zoneRows(this.w, n, this.zCut, this.zEase); if (!n.zones.gdp0 && n.agg.gdp > 0) n.zones.gdp0 = n.agg.gdp; if (n.month % 12 === 1 || n.month === 0) laneRows(this.w, n, this.laneP, this.laneM); if (n.month > 0 && n.month % 12 === 1) organicIndustry(this.w, n, this.year(), this.zCut);
    eventsMonth(this.w, n, this.loc, this.provMult);
    this.demography(year, dt); this.social(year, dt); this.economy(year, dt); this.fiscal(year, dt);
    this.aggregate(moy === 0); this.macro(year, dt, moy === 0); evaluateEnd(n);
    n.month++;
    if (monthOfYear(n.month) === 0) this.record();
  }

  // ---------------------------------------------------------------- demography
  private demography(year: number, dt: number): void {
    const w = this.w, n = this.nation, D = B.demography, S = w.s;
    let births = 0, deaths = 0;
    // family planning coverage follows spending per woman of reproductive age
    if (year >= D.kb.unlockYear) {
      const women = n.agg.pop * (1 - 0.44) * D.womenShareOfWorkAge * 1.0; const perWoman = women > 0 ? (n.policy.budget.kb / 100 * n.agg.gdp) / women : 0;
      const target = perWoman / (perWoman + D.kb.costPerWomanRp * D.kb.halfSaturationCoverage); n.kbCov += (target - n.kbCov) * D.kb.adjustPerYear * dt;
    }
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue;
      const pop = w.pop[i], a0 = w.age0[i], a65 = w.age65[i], e = w.life[i] - 40;
      const N0 = pop * a0, N2 = pop * a65, N1 = pop - N0 - N2;
      const mm = 1 + n.ev.mult.mort; const m0 = mm * D.mortalityAt40[0] * Math.exp(-D.mortalityDecay[0] * e), m1 = mm * D.mortalityAt40[1] * Math.exp(-D.mortalityDecay[1] * e), m2 = mm * D.mortalityAt40[2] * Math.exp(-D.mortalityDecay[2] * e);
      const b = (S.tfr[i] / D.reproductiveSpanYears) * D.womenShareOfWorkAge * N1;
      const d0 = m0 * N0, d1 = m1 * N1, d2 = m2 * N2, up0 = D.ageOut0 * N0, up1 = D.ageOut1 * N1;
      const M0 = N0 + (b - up0 - d0) * dt, M1 = N1 + (up0 - up1 - d1) * dt, M2 = N2 + (up1 - d2) * dt; const np = M0 + M1 + M2;
      w.pop[i] = np; w.age0[i] = M0 / np; w.age65[i] = M2 / np; births += b * dt; deaths += (d0 + d1 + d2) * dt;
      const floor = D.tfrFloor, tgt = Math.max(floor, (tfrDrivers(w, i) + S.tfrOff[i]) * (1 - D.kb.maxTfrCut * n.kbCov));
      S.tfr[i] += (tgt - S.tfr[i]) * D.tfrAdjustPerYear * dt;
    }
    n.births = births * 12; n.deaths = (deaths + n.ev.deathsMonth) * 12; n.ev.deathsMonth = 0; // disaster deaths of this month are part of the national death count
    this.migrate(dt); this.transmigrate(dt);
  }

  /** Net migration between neighbouring kecamatan: people move up the income gradient. Moves people only (births / deaths untouched), so national population is conserved. */
  migrate(dt: number): void {
    const w = this.w, M = B.demography.migration, d = this.delta; d.fill(0, 0, w.n); const am = this.amenity, AW = M.amenityWeights;
    // amenity: what a place offers beyond income (power, water, roads, schools) — people move towards it and away from places that lack it
    for (let i = 0; i < w.n; i++) am[i] = w.alive[i] ? AW.elec * w.elec[i] + AW.water * w.water[i] + AW.road * Math.min(1, w.roadClass[i] / 4) + AW.school * Math.min(1, w.mys[i] / 9) : 0;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue; const k = w.kecReg[i]; if (k < 0 || this.locked(k)) continue; const yi = Math.max(1e5, w.grdp[i] / Math.max(1, w.pop[i]));
      let tot = 0; const nb = w.neighbors[i]; const want: number[] = [];
      for (let q = 0; q < nb.length; q++) {
        const j = nb[q], kj = w.kecReg[j]; if (kj < 0 || this.locked(kj)) { want.push(0); continue; }
        const yj = Math.max(1e5, w.grdp[j] / Math.max(1, w.pop[j])) * (this.isCap[j] ? 1 + M.capitalPull : 1);
        let g = Math.log(yj / yi) + M.accessWeight * (am[j] - am[i]) - M.friction; if (g <= 0) { want.push(0); continue; }
        g *= M.ratePerYear * (w.urban[j] > 0.5 && w.urban[i] < 0.3 ? M.ruralUrbanBoost : 1); want.push(g); tot += g;
      }
      if (tot <= 0) continue; const share = Math.min(M.maxShareMonthly, tot * dt), scale = share / tot;
      for (let q = 0; q < nb.length; q++) if (want[q] > 0) { const m = w.pop[i] * want[q] * scale; d[i] -= m; d[nb[q]] += m; }
    }
    for (let i = 0; i < w.n; i++) if (w.alive[i] && d[i] !== 0) w.pop[i] += d[i];
  }

  /** State programme: move people from dense to empty land, paid out of the APBN line. */
  transmigrate(dt: number): void {
    const w = this.w, n = this.nation, T = B.demography.transmigration; const pct = n.policy.budget.transmigration; if (pct <= 0) return;
    const people = ((pct / 100) * n.agg.gdp * dt) / T.costPerPersonRp; if (people < 1) return;
    let sw = 0, dw = 0; const src: number[] = [], dst: number[] = [];
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || this.locked(w.kecReg[i])) continue; const dens = w.pop[i] / w.area[i];
      if (dens > T.sourceMinDensity) { src.push(i); sw += (dens - T.sourceMinDensity) * w.pop[i]; } else if (dens < T.destMaxDensity && w.area[i] > 40) { dst.push(i); dw += w.area[i] * (1 - dens / T.destMaxDensity); }
    }
    if (!src.length || !dst.length) return; const move = Math.min(people, 0.02 * src.reduce((s, i) => s + w.pop[i], 0));
    for (const i of src) w.pop[i] -= (move * (w.pop[i] / w.area[i] - T.sourceMinDensity) * w.pop[i]) / sw;
    for (const j of dst) w.pop[j] += (move * w.area[j] * (1 - w.pop[j] / w.area[j] / T.destMaxDensity)) / dw;
  }

  // ---------------------------------------------------------------- social indicators
  private social(year: number, dt: number): void {
    const w = this.w, S = w.s, L = B.life, E = B.education, A = B.access;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue;
      const lt = softCap(lifeDrivers(w, i, year) + S.lifeOff[i], L.maxLife); w.life[i] += (lt - w.life[i]) * L.adjustPerYear * dt;
      const et = E.eysMax * sigm(S.eysOff[i] + eysDrivers(w, i)); w.eys[i] += (et - w.eys[i]) * E.eysAdjustPerYear * dt;
      w.mys[i] += (E.mysFractionOfEys * w.eys[i] - w.mys[i]) * E.mysAdjustPerYear * dt; w.lit[i] = literacyOf(w, i);
      const el = sigm(S.elecOff[i] + accessDrivers(w, i, A.elecPerLnIncome, A.elecInfraEffect) + IND.powerLogit * S.pwr[i]); w.elec[i] += (el - w.elec[i]) * A.adjustPerYear * dt;
      const wa = sigm(S.waterOff[i] + accessDrivers(w, i, A.waterPerLnIncome, A.waterInfraEffect)); w.water[i] += (wa - w.water[i]) * A.adjustPerYear * dt;
      const ut = clamp(urbanDrivers(w, i) + S.urbOff[i], 0.005, 0.98); w.urban[i] += (ut - w.urban[i]) * B.urban.adjustPerYear * dt;
      w.poverty[i] = povertyOf(w, i);
    }
  }

  // ---------------------------------------------------------------- economy
  private economy(year: number, dt: number): void {
    const w = this.w, n = this.nation, S = w.s, Sx = B.sectors, A = n.tfp, mult = this.mult, ag = n.agg;
    // sector TFP: world frontier × policy
    const FM = B.frontier, pm = FM.policyMultiplier, rates = n.policy.rates;
    const openness = 1 - rates.customs / BUD.tax.limits.customs[1], rndBoost = FM.rndMaxBoost * (1 - Math.exp(-n.policy.budget.rnd / FM.rndSaturationPctGdp));
    const pol = clamp(1 + (FM.polOffset ?? 0) + pm.edu * (ag.eduSat - 0.35) + pm.stability * (n.stability / B.stability.base - 1) + pm.governance * (ag.gov / n.gov0 - 1) + pm.openness * (openness - 0.75) + pm.rnd * rndBoost, FM.multiplierRange[0], FM.multiplierRange[1]);
    const f = interp(FM.growth, year) * Math.max(FM.catchUpFloor ?? 0.15, 1 - ag.gdppc / (FM.catchUpRp ?? 1e12)); this.polNow = pol;
    for (let s = 0; s < SECTORS; s++) A[s] *= 1 + Sx.tfpGrowth[s] * f * pol * dt;
    const burden = ag.gdp > 0 ? (n.last.revenue + n.last.pad) / ag.gdp : 0, C = B.capital;
    const taxF = 1 - C.taxPenalty * Math.max(0, burden - C.taxPenaltyFrom), infF = 1 - C.inflationPenalty * Math.min(n.inflation, 2);
    const stabF = C.stabilityFloor + (1 - C.stabilityFloor) * clamp(n.stability / B.stability.base, 0, 1);
    industryRows(w, n, year); const climF = savingsClimateFactor(n);
    const rea = Sx.reallocation, part = B.demography.participation; this.ev = n.ev.mult;
    const lnw = new Float64Array(SECTORS);
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue; const base = i * SECTORS;
      // labour force follows working-age population; new workers join in proportion to existing employment
      const Wt = part * (1 - w.age0[i] - w.age65[i]) * w.pop[i]; let Ltot = workersOf(w, i);
      if (Ltot <= 0 && Wt > 0) { S.lab[base] = Wt; if (S.l0[base] <= 0) { S.l0[base] = Wt; S.y0[base] = (Wt * Sx.newSettlementOutputPerWorkerRp) / A[0]; } Ltot = Wt; }
      else if (Wt > 0) {
        const r = Wt / Ltot;
        if (r < 1) for (let s = 0; s < SECTORS; s++) S.lab[base + s] *= r;
        else { let nr = 0; for (const s of NR) nr += S.lab[base + s]; if (nr > 0) for (const s of NR) S.lab[base + s] += ((Wt - Ltot) * S.lab[base + s]) / nr; else S.lab[base] += Wt - Ltot; }
      }
      // replicator dynamics on wages (last month's output per worker)
      let sl = 0, sm = 0, nrTot = 0;
      for (const s of NR) { const l = S.lab[base + s], o = S.out[base + s] - S.ind[base + s]; nrTot += l; if (l > 1e-6 && o > 0) { lnw[s] = Math.log(o / l); sl += l; sm += l * lnw[s]; } else lnw[s] = NaN; }
      if (sl > 0) {
        const mean = sm / sl, mob = rea.ratePerYear * (1 - rea.eduWeight + rea.eduWeight * Math.min(1, w.mys[i] / 6)) * dt; let after = 0;
        for (const s of NR) { const l = S.lab[base + s]; if (!Number.isNaN(lnw[s])) S.lab[base + s] = Math.max(0, l + Math.max(-0.5 * l, mob * l * (lnw[s] - mean))); after += S.lab[base + s]; }
        if (after > 0 && Math.abs(after - nrTot) > 1e-9) { const k = nrTot / after; for (const s of NR) S.lab[base + s] *= k; }
      }
      // production
      fillMult(w, i, n.gov0, mult); let g = 0;
      for (let s = 0; s < SECTORS; s++) {
        const y0 = S.y0[base + s]; let Y = 0;
        if (y0 > 0) {
          if (Sx.labourElasticity[s] === 0) Y = y0 * A[s] * mult[s];
          else { const l0 = S.l0[base + s], L = S.lab[base + s]; if (l0 > 0 && L > 0) Y = y0 * A[s] * Math.pow(L / l0, Sx.labourElasticity[s]) * mult[s]; }
        }
        Y = Y * (1 + S.link[base + s]) * this.ev.sector[s] * this.loc[i] * (isResource(s) ? 1 : 1 + this.laneM[i]) + S.ind[base + s] * this.loc[i]; S.out[base + s] = Y; g += Y;
      }
      w.grdp[i] = g;
      // capital accumulation from domestic saving
      const y = g / Math.max(1, w.pop[i]);
      const sav = (C.savingsMin + (C.savingsMax - C.savingsMin) * sigm(Math.log(Math.max(1e5, y) / C.savingsIncomeMidRp) / C.savingsIncomeWidth)) * taxF * infF * stabF * climF;
      w.capStock[i] = Math.max(0, w.capStock[i] + (sav * g - C.depreciation * w.capStock[i]) * dt);
      derive(w, i, false);
    }
  }

  // ---------------------------------------------------------------- fiscal
  private fiscal(year: number, dt: number): void {
    const w = this.w, n = this.nation, S = w.s, T = BUD.tax, pol = n.policy, st = this.stats, R = this.R, P = this.P;
    const ag = n.agg, gdp = ag.gdp, pi = n.inflation; const ero = 1 - B.inflation.taxErosion * (pi / (1 + pi));
    const avoid = (k: keyof typeof T.refRates) => Math.exp(-T.avoidanceElasticity * Math.max(0, (pol.rates[k] - T.refRates[k]) / T.refRates[k]));
    const aPph = avoid('pph'), aPpn = avoid('ppn'), aExc = avoid('excise'), aCus = avoid('customs');
    const oilShare = interp(T.oilGovShare, year), compl = year < T.vatUnlockYear ? T.salesTaxCompliance : T.vatCompliance;
    st.regPad.fill(0); st.regDbh.fill(0); st.regOp.fill(0); st.regDau.fill(0); st.regDak.fill(0); st.regPop.fill(0); st.provPad.fill(0); st.provOp.fill(0); st.provDau.fill(0); st.provPop.fill(0);
    const taxes = { pph: 0, ppn: 0, excise: 0, customs: 0, oilgas: 0, royalties: 0 }; let padTot = 0, dbhTot = 0;
    const wageIdx = Math.pow(Math.max(0.5, ag.gdppc / Y_REF), BUD.opCost.wageIndexExponent);
    const rem = (d: number) => interp(BUD.opCost.kecamatanRemoteness, d);
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue; const k = w.kecReg[i]; if (k < 0 || this.locked(k)) { S.taxC[i] = 0; S.taxL[i] = 0; continue; }
      const p = w.regProv[k], base = i * SECTORS, pop = w.pop[i], y = Math.max(1e5, w.grdp[i] / Math.max(1, pop));
      const comp = Math.min(0.98, T.complianceBase * Math.pow(S.gov[i] / n.gov0, 0.5)), lf = T.formalizationPerLnIncome * Math.max(0, Math.log(y / Y_REF));
      let formal = 0; for (let s = 0; s < SECTORS; s++) if (!isResource(s)) formal += S.out[base + s] * Math.min(T.formalMax, B.sectors.formalShare[s] + lf);
      const pph = pol.rates.pph * (1 - this.zCut[i]) * aPph * formal * comp * ero, ppn = pol.rates.ppn * aPpn * formal * T.ppnBaseShare * compl * comp * ero;
      const exc = pol.rates.excise * aExc * S.out[base + 6] * Math.min(T.formalMax, B.sectors.formalShare[6] + lf) * comp * ero, cus = pol.rates.customs * aCus * T.importOverGdp * w.grdp[i] * comp * ero;
      const oil = oilShare * S.out[base + 5], roy = T.royaltyRate * (S.out[base + 3] + S.out[base + 4]);
      const dbh = oil * BUD.transfers.dbhOil + roy * BUD.transfers.dbhMining; const pad = T.pad * w.grdp[i] * comp * ero;
      S.taxC[i] = pph + ppn + exc + cus + oil + roy; S.taxL[i] = pad + dbh;
      taxes.pph += pph; taxes.ppn += ppn; taxes.excise += exc; taxes.customs += cus; taxes.oilgas += oil; taxes.royalties += roy; padTot += pad; dbhTot += dbh;
      st.regPad[k] += pad * (1 - T.padSplitProvince); st.provPad[p] += pad * T.padSplitProvince; st.regDbh[k] += dbh; st.regPop[k] += pop; st.provPop[p] += pop;
      st.regOp[k] += (BUD.opCost.kecamatanFixed + BUD.opCost.kecamatanPerCapita * pop + BUD.opCost.kecamatanPerKm2 * w.area[i] * rem(pop / w.area[i])) * wageIdx;
    }
    const central = taxes.pph + taxes.ppn + taxes.excise + taxes.customs + taxes.oilgas + taxes.royalties;
    for (let k = 0; k < R; k++) if (st.regPop[k] > 0) st.regOp[k] += (BUD.opCost.regencyFixed + BUD.opCost.regencyPerCapita * st.regPop[k]) * wageIdx;
    for (let p = 0; p < P; p++) if (st.provPop[p] > 0) st.provOp[p] = (BUD.opCost.provinceFixed + BUD.opCost.provincePerCapita * st.provPop[p]) * wageIdx;
    // DAU: equalisation pool, first to cover operating-cost gaps, then a service basket
    const pool = BUD.transfers.dauShareOfDomesticRevenue * (n.ev.flags.dauMult ?? 1) * (central - dbhTot); const poolReg = pool * (1 - BUD.transfers.dauProvinceShare), poolProv = pool * BUD.transfers.dauProvinceShare;
    this.dau(st.regOp, st.regPad, st.regDbh, st.regPop, st.regDau, poolReg, BUD.transfers.basketPerCapitaOverIncome * ag.gdppc, R);
    const zero = new Float64Array(Math.max(R, P)); this.dau(st.provOp, st.provPad, zero, st.provPop, st.provDau, poolProv, BUD.transfers.basketProvincePerCapitaOverIncome * ag.gdppc, P);
    let dauTot = 0; for (let k = 0; k < R; k++) dauTot += st.regDau[k]; for (let p = 0; p < P; p++) dauTot += st.provDau[p];
    // central lines (with optional deficit rule), debt service
    const lines = {} as Record<BudgetKey, number>; for (const key of BUDGET_KEYS) lines[key] = (pol.budget[key] / 100) * gdp;
    if (BUD.categoryUnlockYear.kb > year) lines.kb = 0;
    const rate = B.nation.interestDomestic + B.nation.inflationPremium * Math.min(1, Math.max(0, pi)); const lm = loanMonth(n, dt), interest = rate * n.debtDom + lm.interest;
    let spend = interest + dauTot + dbhTot + n.ev.reliefAnn; for (const key of BUDGET_KEYS) spend += lines[key];
    if (pol.deficitRule) {
      const allowed = central + BUD.deficitRule.cap * gdp; const over = spend - allowed; const disc = BUD.discretionary.reduce((s, k) => s + lines[k as BudgetKey], 0);
      if (over > 0 && disc > 0) { const f = Math.max(0, 1 - over / disc); for (const k of BUD.discretionary) { spend -= lines[k as BudgetKey] * (1 - f); lines[k as BudgetKey] *= f; } }
    }
    // transport: construction outlays, rail operations and fares (maintenance is the budget line, which wears or rehabilitates the network)
    const trm = this.tr.month(year, lines.maintenance); spend += trm.outlay + trm.railOps; const im = industryMonth(w, n, year, dt, lines.exploration); spend += im.outlay; n.debtExt = totalExternal(n);
    const rev = central + trm.railRevenue + im.soe - im.relief; (taxes as Record<string, number>).rail = trm.railRevenue; (taxes as Record<string, number>).soe = im.soe - im.relief;
    n.fin.repatriated = im.foreignProfit * IND.fdi.repatriationShare; n.fin.relief = im.relief; n.fin.soe = im.soe; n.fin.extInterest = lm.interest; n.fin.extRepay = lm.repay / dt; n.fin.serviceRatio = rev > 0 ? (interest + lm.repay / dt) / rev : 0;
    for (const d of im.revealed) this.note(n, `Month ${n.month}: exploration found ${d.name} (${d.type}) — it can now be developed`);
    if (trm.changed) this.refreshSpan();
    // financing
    let cash = n.cash + (rev - spend) * dt - lm.repay, borrow = 0, monetized = 0, repay = 0; const cashMin = B.nation.cashMinOverGdp * gdp * 1, cashMax = B.nation.cashMaxOverGdp * gdp;
    if (cash < cashMin) {
      const need = cashMin - cash, capacity = Math.max(0, interp(B.nation.domesticBondCapacityOverGdp, year) * gdp - n.debtDom); borrow = Math.min(need, capacity); monetized = need - borrow; cash += need;
      if (monetized > 0) this.note(n, `Month ${n.month}: treasury empty — ${borrow > 0 ? 'domestic bonds and ' : ''}central-bank money financed the gap`);
    } else if (cash > cashMax && n.debtDom > 0) { repay = Math.min(n.debtDom, cash - cashMax); cash -= repay; }
    n.cash = cash; n.debtDom = Math.max(0, n.debtDom * (1 - B.nation.domesticDebtErosion * (pi / (1 + pi)) * dt) + borrow - repay);
    // local budgets → development money, public-service stocks
    this.localSpending(dt, lines);
    n.last = { gdp, revenue: rev, taxes, pad: padTot, spending: { ...lines, interest, dau: st.regDau.reduce((a, b) => a + b, 0) + st.provDau.reduce((a, b) => a + b, 0), dbh: dbhTot, construction: trm.outlay, railOps: trm.railOps, industry: im.outlay, disaster: n.ev.reliefAnn }, interest, transfers: { dau: dauTot, dbh: dbhTot, dak: lines.dak },
      deficit: spend - rev, borrowDom: borrow / dt, monetized: monetized / dt, repay: repay / dt, dCash: 0, admin: st.regOp.reduce((a, b) => a + b, 0) + st.provOp.reduce((a, b) => a + b, 0), localFund: 0, extRepay: lm.repay / dt, extInterest: lm.interest, soe: im.soe - im.relief };
    n.last.dCash = (rev - spend) + (borrow + monetized - repay - lm.repay) / dt; // annualised; identity: dCash·dt = revenue·dt − spending·dt + borrow + monetized − repay
  }
  private note(n: Nation, msg: string): void { if (n.notices.length < 40 && !n.notices.includes(msg)) n.notices.push(msg); }

  private dau(op: Float64Array, own: Float64Array, extra: Float64Array, pop: Float64Array, out: Float64Array, pool: number, basketPerCap: number, count: number): void {
    let g1 = 0; const gap1 = new Float64Array(count); for (let k = 0; k < count; k++) { if (pop[k] <= 0) continue; gap1[k] = Math.max(0, op[k] - own[k] - extra[k]); g1 += gap1[k]; }
    const f1 = g1 > 0 ? Math.min(1, pool / g1) : 0; let used = 0; for (let k = 0; k < count; k++) { out[k] = gap1[k] * f1; used += out[k]; }
    const rest = pool - used; if (rest <= 0) return; let g2 = 0; const gap2 = new Float64Array(count);
    for (let k = 0; k < count; k++) { if (pop[k] <= 0) continue; gap2[k] = Math.max(0, basketPerCap * pop[k] - Math.max(0, own[k] + extra[k] + out[k] - op[k])); g2 += gap2[k]; }
    if (g2 > 0) { const f2 = Math.min(1, rest / g2); for (let k = 0; k < count; k++) out[k] += gap2[k] * f2; }
  }

  /** Regency / province budgets: operating costs first, the rest (plus DAK) becomes development money split by preset; central lines are spread by need. */
  private localSpending(dt: number, lines: Record<BudgetKey, number>): void {
    const w = this.w, n = this.nation, S = w.s, st = this.stats, pol = n.policy, ag = n.agg, R = this.R, P = this.P, Z = B.stocks;
    const preset = (provId: string) => BUD.devPresets[(pol.provPreset[provId] ?? pol.devPreset) as keyof typeof BUD.devPresets] ?? BUD.devPresets.balanced;
    // DAK pool → regencies by need
    let wsum = 0; const need = new Float64Array(R);
    for (let k = 0; k < R; k++) { if (st.regPop[k] <= 0) continue; const yk = Math.max(1e5, regGrdp(w, k) / st.regPop[k]); need[k] = Math.pow(Math.max(0.2, ag.gdppc / yk), B.allocation.needExponent); wsum += st.regPop[k] * need[k]; }
    for (let k = 0; k < R; k++) st.regDak[k] = wsum > 0 ? (lines.dak * st.regPop[k] * need[k]) / wsum : 0;
    const perCapReg = new Float64Array(R * 4), perCapProv = new Float64Array(P * 4);
    for (let k = 0; k < R; k++) {
      const op = st.regOp[k]; if (st.regPop[k] <= 0 || op <= 0) { st.regFund[k] = 1; continue; }
      const own = st.regPad[k] + st.regDbh[k] + st.regDau[k]; st.regFund[k] = own / op; const D = Math.max(0, own - op) + st.regDak[k]; const pr = preset(w.regencies[k].prov);
      for (let c = 0; c < 4; c++) perCapReg[k * 4 + c] = (D * pr[c]) / st.regPop[k];
    }
    for (let p = 0; p < P; p++) {
      const op = st.provOp[p]; if (st.provPop[p] <= 0 || op <= 0) { st.provFund[p] = 1; continue; }
      const own = st.provPad[p] + st.provDau[p]; st.provFund[p] = own / op; const D = Math.max(0, own - op); const pr = preset(w.provinces[p].id);
      for (let c = 0; c < 4; c++) perCapProv[p * 4 + c] = (D * pr[c]) / st.provPop[p];
    }
    // central education / health / infrastructure: per-capita spread weighted by need; subsidy share to agriculture by farm labour
    let wn = 0, wl = 0; const nd = (i: number) => Math.pow(Math.max(0.2, ag.gdppc / Math.max(1e5, w.grdp[i] / Math.max(1, w.pop[i]))), B.allocation.needExponent);
    for (let i = 0; i < w.n; i++) { if (!w.alive[i] || this.locked(w.kecReg[i])) continue; wn += w.pop[i] * nd(i); wl += agriLabour(w, i); }
    const agLine = lines.subsidies * BUD.central.agriShareOfSubsidy; const [e0, e1] = Z.effectivenessRange;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i]) continue; const k = w.kecReg[i]; if (k < 0 || this.locked(k)) continue; const p = w.regProv[k];
      const nn = wn > 0 ? nd(i) / wn : 0; const eff = clamp(S.gov[i] / n.gov0, e0, e1);
      const edu = lines.education * nn + perCapReg[k * 4] + perCapProv[p * 4], hea = lines.health * nn + perCapReg[k * 4 + 1] + perCapProv[p * 4 + 1], inf = lines.infra * nn + perCapReg[k * 4 + 2] + perCapProv[p * 4 + 2];
      const agr = (wl > 0 ? (agLine * agriLabour(w, i)) / wl / Math.max(1, w.pop[i]) : 0) + perCapReg[k * 4 + 3] + perCapProv[p * 4 + 3];
      S.eduStock[i] += (edu * eff - Z.depreciation.edu * S.eduStock[i]) * dt; S.healthStock[i] += (hea * eff - Z.depreciation.health * S.healthStock[i]) * dt;
      S.infraStock[i] += (inf * eff - Z.depreciation.infra * S.infraStock[i]) * dt; S.agStock[i] += (agr * eff - Z.depreciation.ag * S.agStock[i]) * dt;
    }
    this.governance(this.year());
    for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; const k = w.kecReg[i]; if (k < 0) continue; S.gov[i] = st.regGov[k] * (1 + this.zEase[i] * ZC.easeGovBoost); S.fund[i] = st.regFund[k]; }
  }

  /** Governance quality per regency: funding, span of control (distance, population band), national staff pool, persiapan status, province funding. */
  governance(year: number): void {
    const w = this.w, n = this.nation, st = this.stats, G = B.governance, ag = n.agg;
    const base = G.base0 + G.baseEduGain * Math.min(1, ag.mys / 9);
    let units = 0; for (let k = 0; k < this.R; k++) { const r = w.regencies[k]; if (!this.locked(k) && r.kec.length) units += r.kec.length * G.staff.perKec + G.staff.perRegency; }
    units += this.P * G.staff.perProvince; const pool = ag.pop * (G.staff.poolBase + G.staff.poolPerMys * ag.mys); const staffF = units > 0 ? Math.min(1, pool / units) : 1;
    for (let k = 0; k < this.R; k++) {
      const r = w.regencies[k]; const pop = st.regPop[k] || r.kec.reduce((s, i) => s + w.pop[i], 0); const p = w.regProv[k];
      const spanD = Math.min(1, Math.max(0, (this.span[k] - G.idealKm) / G.idealKm)) * 0.7;
      const band = pop > G.popBand[1] ? Math.min(1, Math.log(pop / G.popBand[1]) / Math.log(4)) : pop > 0 && pop < G.popBand[0] ? 0.5 * Math.min(1, Math.log(G.popBand[0] / pop) / Math.log(4)) : 0;
      const fund = Math.min(1, st.regFund[k] || 1), pf = Math.min(1, st.provFund[p] || 1);
      st.regGov[k] = base * (1 - G.fundingWeight * (1 - fund)) * (1 - G.spanWeight * spanD - G.popPenalty * band) * (1 - G.staffWeight * (1 - staffF)) * (r.status === 'preparing' ? G.preparingFactor : 1) * (1 - G.provinceWeight * (1 - pf));
    }
    for (let p = 0; p < this.P; p++) st.provGov[p] = base * (1 - G.fundingWeight * (1 - Math.min(1, st.provFund[p] || 1))) * (1 - G.staffWeight * (1 - staffF));
  }

  // ---------------------------------------------------------------- aggregates, macro, history
  aggregate(withIpm: boolean): void {
    const w = this.w, n = this.nation; let pop = 0, gdp = 0, edu = 0, mys = 0, life = 0, gov = 0, fund = 0, pov = 0, urb = 0, tfr = 0, eys = 0, lit = 0;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || this.locked(w.kecReg[i])) continue; const p = w.pop[i]; pop += p; gdp += w.grdp[i]; mys += w.mys[i] * p; eys += w.eys[i] * p; life += w.life[i] * p; pov += w.poverty[i] * p; urb += w.urban[i] * p; lit += w.lit[i] * p;
      edu += stockSat(w.s.eduStock[i], incomeOf(w, i), B.stocks.r50.edu) * p; gov += w.s.gov[i] * p; fund += Math.min(1.5, w.s.fund[i]) * p; tfr += w.s.tfr[i] * p;
      if (withIpm) derive(w, i, true);
    }
    const P = pop || 1; const a = n.agg;
    // inequality: population-weighted std-dev of ln(income) across regencies
    let m = 0, m2 = 0, wt = 0; for (let k = 0; k < this.R; k++) { if (this.locked(k)) continue; let kp = 0, kg = 0; for (const i of w.regencies[k].kec) { kp += w.pop[i]; kg += w.grdp[i]; } if (kp <= 0 || kg <= 0) continue; const l = Math.log(kg / kp); m += l * kp; m2 += l * l * kp; wt += kp; }
    const ineq = wt > 0 ? Math.sqrt(Math.max(0, m2 / wt - (m / wt) ** 2)) : a.ineq;
    const ipm = ipmFrom({ lifeExpectancy: life / P, meanYearsSchooling: mys / P, expectedYearsSchooling: eys / P, gdpPerCapita: gdp / P }).ipm;
    n.agg = { pop, gdp, gdppc: gdp / P, eduSat: edu / P, mys: mys / P, life: life / P, ipm: withIpm || !a.ipm ? ipm : a.ipm, gov: gov / P, fund: fund / P, ineq, poverty: pov / P, urban: urb / P, tfr: tfr / P, eys: eys / P, lit: lit / P };
  }

  private macro(year: number, dt: number, yearly: boolean): void {
    const n = this.nation, pol = n.policy, ag = n.agg, W = B.stability, I = B.inflation;
    // inflation: money-financed deficits with falling money demand (quantity-theory feedback, explosive above ~7.5 % of GDP)
    const m = ag.gdp > 0 ? n.last.monetized / ag.gdp : 0; const a = m / I.moneyOverGdp;
    const tgt = Math.min(I.cap, I.base + n.ev.mult.infl + a * (1 + I.moneyDemandSlope * n.inflation)); n.inflation = Math.max(0, n.inflation + (tgt - n.inflation) * I.adjustPerMonth);
    n.priceIndex *= 1 + n.inflation * dt;
    // stability
    if (yearly) { n.dIpm = n.ipmPrev > 0 ? ag.ipm - n.ipmPrev : 0.005; n.ipmPrev = ag.ipm; }
    const dIpm = n.dIpm;
    const defMin = BUD.minimumRequiredPctGdp.defense, opsMin = BUD.minimumRequiredPctGdp.centralOps;
    const sTarget = W.base + W.fundingWeight * clamp(ag.fund - 1, -1, 0.2) - W.inequalityWeight * (ag.ineq - W.inequalityRef) - W.inflationWeight * Math.max(0, n.inflation - W.inflationFree)
      + W.subsidyWeight * (pol.budget.subsidies / 100) + W.defenseWeight * (pol.budget.defense / 100) + W.ipmTrendWeight * dIpm - n.adminHits - (pol.budget.defense < defMin ? W.defenseMinPenalty : 0) - (pol.budget.centralOps < opsMin ? W.defenseMinPenalty : 0) - IND.fdi.nationalismStabilityPerGdp * n.fin.foreignVaShare + n.ev.mult.stab;
    n.stability = clamp(n.stability + (clamp(sTarget, 0, 100) - n.stability) * W.adjustPerMonth, 0, 100); financeMonth(n, year, dt);
    n.adminHits = Math.max(0, n.adminHits - (W.adminHitDecayPerYear * dt) * Math.max(1, n.adminHits / 2));
    this.collapseMonths = n.stability < W.collapseBelow ? this.collapseMonths + 1 : 0; n.flags.collapse = this.collapseMonths >= W.collapseMonths; n.flags.hyper = n.inflation > I.hyper;
    // regional stability from funding and relative poverty
    const st = this.stats, w = this.w, S = w.s;
    for (let k = 0; k < this.R; k++) {
      let pp = 0, pv = 0; for (const i of w.regencies[k].kec) { pp += w.pop[i]; pv += w.poverty[i] * w.pop[i]; }
      st.regStab[k] = clamp(n.stability + W.regionalFundingWeight * (clamp(st.regFund[k] || 1, 0, 1.2) - 1) - W.regionalPovertyWeight * (pp > 0 ? pv / pp - ag.poverty : 0), 0, 100);
    }
    for (let i = 0; i < w.n; i++) if (w.alive[i] && w.kecReg[i] >= 0) S.stab[i] = st.regStab[w.kecReg[i]];
  }

  record(): void {
    const n = this.nation, s = n.series, a = n.agg, l = n.last, g = a.gdp || 1;
    let agri = 0, tot = 0; const w = this.w; for (let i = 0; i < w.n; i++) if (w.alive[i] && !this.locked(w.kecReg[i])) for (let q = 0; q < SECTORS; q++) { const o = w.s.out[i * SECTORS + q]; tot += o; if (q <= 3) agri += o; }
    s.t.push(yearOf(n.month) + (n.month === 0 ? 0.63 : 0)); s.pop.push(a.pop); s.gdp.push(a.gdp); s.gdppc.push(a.gdppc); s.ipm.push(a.ipm); s.life.push(a.life); s.mys.push(a.mys); s.eys.push(a.eys); s.literacy.push(a.lit); s.poverty.push(a.poverty); s.urban.push(a.urban);
    s.agriShare.push(tot > 0 ? agri / tot : 0); s.inflation.push(n.inflation); s.stability.push(n.stability); s.cash.push(n.cash); s.debtGdp.push((n.debtDom + n.debtExt) / g);
    s.revenueGdp.push((l.revenue + l.pad) / g); s.spendingGdp.push(((l.revenue + l.deficit) + l.pad) / g); s.deficitGdp.push(l.deficit / g); s.tfr.push(a.tfr); s.births.push(n.births / (a.pop || 1)); s.deaths.push(n.deaths / (a.pop || 1));
  }
}
function regGrdp(w: SimWorld, k: number): number { let g = 0; for (const i of w.regencies[k].kec) g += w.grdp[i]; return g; }
void HIST; void normCdf; void yearOf;
