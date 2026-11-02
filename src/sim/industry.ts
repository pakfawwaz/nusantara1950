import IND from '../../config/industries.json';
import { interp } from './balance';
import { costIndex } from './transport';
import { SECTORS } from './fields';
import type { Nation, SimWorld } from './types';

// ------------------------------------------------------------------ catalog & state types
export interface IndType {
  id: string; name: string; unlock: number; kind: 'process' | 'extract' | 'power' | 'service'; sector: number; cost: number; months: number; va: number; margin: number; fdi: boolean; jobs: number;
  requires: { mys?: number; elec?: number; port?: number; road?: number; station?: number }; needs: string[]; resource?: string[];
  link?: { sector: number; strength: number; hours: number }; power?: { boost: number; hours: number }; tfp?: Array<[number, number]>; peak?: number; decay?: number;
}
export interface Partner { id: string; name: string; bloc: number; from: number; to: number; capGdp: number; rate: number; grace: number; maturity: number; tied: number; conditional: boolean; grant: boolean; width: number }
export type Financing = 'apbn' | 'fdi' | 'aid' | 'legacy' | 'private';
export interface Terms { offer?: string; foreign0: number; divestTo: number; divestYears: number; holiday: number; local: number; partner?: string; loan?: number; tied?: number }
export interface Industry {
  id: number; type: string; name: string; kec: number; lon: number; lat: number; cap: number; status: 'building' | 'running' | 'closed'; paused: boolean;
  state: number; foreign: number; priv: number; financing: Financing; terms: Terms; cost: number; months: number; progress: number; paid: number; start: number; done: number; inBase: boolean; deposit: number; util: number; va: number; profit: number;
}
export interface Deposit { id: number; kec: number; lon: number; lat: number; name: string; type: string; size: number; knownYear: number; progress: number; revealed: boolean; developed: boolean; revealedMonth: number }
export interface Loan { id: number; partner: string; kind: 'legacy' | 'project' | 'program'; committed: number; drawn: number; balance: number; rate: number; graceMonths: number; maturityMonths: number; start: number; ind: number; paidOff: number }
export interface IndState { list: Industry[]; deposits: Deposit[]; nextId: number }
export interface FinState {
  loans: Loan[]; nextLoan: number; align: number; alignTarget: number; climate: number; parts: Record<string, number>; fdiLaw: boolean; used: Record<string, number>; usedYear: number;
  nationHit: number; serviceRatio: number; foreignVaShare: number; repatriated: number; extInterest: number; extRepay: number; soe: number; relief: number; lawYear: number;
}
export interface WorldPrices { oil: number; commodity: number }
export const IC = IND;
export const TYPES = IND.types as unknown as IndType[];
export const TYPE = new Map(TYPES.map(t => [t.id, t] as const));
export const PARTNERS = IND.partners as Partner[];
export const PARTNER = new Map(PARTNERS.map(p => [p.id, p] as const));
export const RES_TYPE = IND.resourceType as Record<string, string>;
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

export const newIndState = (): IndState => ({ list: [], deposits: [], nextId: 1 });
export const newFin = (): FinState => ({ loans: [], nextLoan: 1, align: IND.alignment.start, alignTarget: IND.alignment.start, climate: IND.climate.base, parts: {}, fdiLaw: false, used: {}, usedYear: 0,
  nationHit: 0, serviceRatio: 0, foreignVaShare: 0, repatriated: 0, extInterest: 0, extRepay: 0, soe: 0, relief: 0, lawYear: 0 });
export const newPrices = (): WorldPrices => ({ oil: 1, commodity: 1 });

// ------------------------------------------------------------------ helpers
export const priceOf = (n: Nation, year: number, sector: number): number => (sector === 5 ? interp(n.settings.historical ? IND.price.oil : IND.price.oilTrend, year) * n.prices.oil : sector === 4 ? interp(n.settings.historical ? IND.price.commodity : IND.price.commodityTrend, year) * n.prices.commodity : 1);
const deplFactor = (t: IndType, ageYears: number): number => (t.peak && t.decay && ageYears > t.peak ? Math.exp(-(ageYears - t.peak) / t.decay) : 1);
export const capOfDeposit = (d: Deposit): number => d.size / IND.capacity.sizeDivisor;
const locked = (w: SimWorld, i: number): boolean => { const k = w.kecReg[i]; return k < 0 || (w.provinces[w.regProv[k]]?.locked ?? true); };

/** Is the input named by a `needs` token available to industries (a running producer exists, or it is part of the 1950 economy)? */
export function needMet(n: Nation, token: string): boolean {
  if (IND.needsAlways.includes(token)) return true; const types = (IND.needsIndustry as Record<string, string[]>)[token] ?? [];
  return n.ind.list.some(x => x.status === 'running' && types.includes(x.type));
}
function portNear(w: SimWorld, i: number, level: number): boolean {
  if (level <= 0 || w.portLevel[i] >= level) return true; let frontier = [i]; const seen = new Set([i]);
  for (let h = 0; h < IND.portHops; h++) { const nx: number[] = []; for (const v of frontier) for (const u of w.neighbors[v]) if (!seen.has(u) && w.alive[u]) { seen.add(u); if (w.portLevel[u] >= level) return true; nx.push(u); } frontier = nx; }
  return false;
}
export interface Req { label: string; ok: boolean }
/** Site requirements of an industry type at kecamatan i (resources, power, port, road/rail access, schooling). */
export function requirements(w: SimWorld, n: Nation, t: IndType, i: number, year: number): { reqs: Req[]; deposit: Deposit | null } {
  const R = t.requires, reqs: Req[] = []; let deposit: Deposit | null = null;
  reqs.push({ label: `Available from ${t.unlock}`, ok: year >= t.unlock });
  reqs.push({ label: 'In a kecamatan you govern', ok: !!w.alive[i] && !locked(w, i) });
  if (t.resource) { deposit = n.ind.deposits.find(d => d.kec === i && d.revealed && !d.developed && t.resource?.includes(d.type)) ?? null; reqs.push({ label: `A discovered ${t.resource.join(' / ')} deposit here`, ok: !!deposit }); }
  if (R.mys) reqs.push({ label: `Skilled labour: mean schooling ≥ ${R.mys} years (here ${w.mys[i].toFixed(1)})`, ok: w.mys[i] >= R.mys });
  if (R.elec) reqs.push({ label: `Electricity reaching ≥ ${Math.round(R.elec * 100)}% of people (here ${Math.round(w.elec[i] * 100)}%)`, ok: w.elec[i] >= R.elec });
  if (R.port) reqs.push({ label: `Port level ≥ ${R.port} here or ≤ ${IND.portHops} kecamatan away`, ok: portNear(w, i, R.port) });
  if (R.road) reqs.push({ label: `Road class ≥ ${R.road} here (or a railway station)`, ok: w.roadClass[i] >= R.road || w.railStation[i] > 0 });
  if (R.station) reqs.push({ label: 'A railway station here', ok: w.railStation[i] >= R.station });
  return { reqs, deposit };
}
export const capFor = (t: IndType, deposit: Deposit | null): number => (t.kind === 'extract' && deposit ? capOfDeposit(deposit) : 1);
const costRp = (t: IndType, cap: number, year: number): number => t.cost * cap * costIndex(year) * 1e6;

// ------------------------------------------------------------------ financing offers
export interface FdiOffer { id: string; name: string; foreign: number; holiday: number; local: number; divestTo: number; divestYears: number }
export function fdiAllowed(n: Nation, t: IndType, year: number): string | null {
  if (!t.fdi) return 'Strategic: foreign ownership is not allowed.';
  const oilgas = t.kind === 'extract' && t.sector === 5;
  if (!n.fin.fdiLaw && !(oilgas && year >= IND.fdi.oilGasOpenYear)) return year < IND.fdi.openLawYear ? `Foreign investment law not yet possible (from ${IND.fdi.openLawYear}).` : 'Enact the foreign investment law first (Finance & Debt window).';
  if (n.fin.align > 0.6) return 'Western and Asian investors stay away from a government this close to the Eastern bloc.';
  return null;
}
export function fdiOffers(n: Nation, t: IndType, year: number): FdiOffer[] {
  if (fdiAllowed(n, t, year)) return []; const c = n.fin.climate, F = IND.fdi, east = Math.max(0, n.fin.align) * 0.2; const out: FdiOffer[] = [];
  for (const o of F.offers) {
    if (c < Math.max(F.minClimate, o.minClimate)) continue; const steps = Math.floor((c - o.minClimate) / F.climateSweetener.per);
    const floor = o.divestYears > 0 ? 0.51 : 0.60; const foreign = clamp(o.foreign - steps * F.climateSweetener.foreignDrop + east, floor, 1);
    out.push({ id: o.id, name: o.name, foreign, holiday: Math.max(0, o.holiday - steps * F.climateSweetener.holidayDrop), local: o.local, divestTo: o.divestTo, divestYears: o.divestYears });
  }
  return out;
}
export interface AidOffer { partner: Partner; remaining: number; factor: number }
export const partnerFactor = (n: Nation, p: Partner, year: number): number => (year < p.from || year > p.to || p.id === 'legacy' ? 0 : Math.max(0, 1 - Math.abs(n.fin.align - p.bloc) / p.width));
export function aidOffers(n: Nation, year: number, gdp: number): AidOffer[] {
  const out: AidOffer[] = []; for (const p of PARTNERS) { const f = partnerFactor(n, p, year); if (f < IND.alignment.commonFloor) continue; const cap = p.capGdp * gdp * f, used = n.fin.usedYear === year ? n.fin.used[p.id] ?? 0 : 0; out.push({ partner: p, factor: f, remaining: Math.max(0, cap - used) }); }
  return out;
}

/** Aid capacity is an annual quota per partner: it resets each January. */
export function useCapacity(n: Nation, partner: string, month: number, amount: number): void {
  const y = yearOfMonth(month); if (n.fin.usedYear !== y) { n.fin.used = {}; n.fin.usedYear = y; } n.fin.used[partner] = (n.fin.used[partner] ?? 0) + amount;
}
const yearOfMonth = (month: number): number => 1950 + Math.floor((7 + month) / 12);

// ------------------------------------------------------------------ planning & starting
export interface IndSpec { type: string; kec: number; financing: Financing; offer?: string; partner?: string; name?: string }
export interface IndPlan { ok: boolean; errors: string[]; warnings: string[]; reqs: Req[]; cost: number; months: number; va: number; cap: number; deposit: Deposit | null; terms: Terms | null; type: IndType | null; needs: Array<{ token: string; ok: boolean }> }
export function planIndustry(w: SimWorld, n: Nation, spec: IndSpec, year: number, overrun: number): IndPlan {
  const t = TYPE.get(spec.type); const bad = (e: string): IndPlan => ({ ok: false, errors: [e], warnings: [], reqs: [], cost: 0, months: 0, va: 0, cap: 0, deposit: null, terms: null, type: t ?? null, needs: [] });
  if (!t) return bad('Pick an industry type.'); if (spec.kec < 0 || spec.kec >= w.n || !w.alive[spec.kec]) return bad('Pick a kecamatan.');
  const { reqs, deposit } = requirements(w, n, t, spec.kec, year); const errors = reqs.filter(r => !r.ok).map(r => `Requires: ${r.label}`), warnings: string[] = [];
  const cap = capFor(t, deposit); let cost = costRp(t, cap, year) * overrun, terms: Terms | null = null;
  if (n.ind.list.some(x => x.kec === spec.kec && x.type === t.id && x.status !== 'closed')) errors.push(`There is already a ${t.name.toLowerCase()} here.`);
  if (spec.financing === 'fdi') {
    const bl = fdiAllowed(n, t, year); const o = fdiOffers(n, t, year).find(x => x.id === spec.offer);
    if (bl) errors.push(bl); else if (!o) errors.push(n.fin.climate < IND.fdi.minClimate ? `Investment climate ${Math.round(n.fin.climate)} is too low for investors (needs ${IND.fdi.minClimate}).` : 'Pick one of the investors\' proposals.');
    else terms = { offer: o.id, foreign0: o.foreign, divestTo: o.divestTo, divestYears: o.divestYears, holiday: o.holiday, local: o.local };
    cost = costRp(t, cap, year);
  } else if (spec.financing === 'aid') {
    const a = aidOffers(n, year, n.agg.gdp).find(x => x.partner.id === spec.partner);
    if (!a) errors.push('That partner offers nothing at your current alignment and date.'); else {
      cost = costRp(t, cap, year) * overrun * (1 + a.partner.tied * IND.aid.tiedCostPremiumScale); terms = { foreign0: 0, divestTo: 0, divestYears: 0, holiday: 0, local: 0, partner: a.partner.id, tied: a.partner.tied };
      if (cost > a.remaining) errors.push(`${a.partner.name} can still lend Rp ${(a.remaining / 1e9).toFixed(0)} B this year; this needs Rp ${(cost / 1e9).toFixed(0)} B.`);
      if (a.partner.conditional) warnings.push('Policy conditions attached: expect some political friction (small stability hit).'); if (a.partner.tied > 0) warnings.push(`Tied aid: partner contractors raise the cost by ${Math.round(a.partner.tied * 100)}%.`);
    }
  } else if (spec.financing === 'apbn') terms = { foreign0: 0, divestTo: 0, divestYears: 0, holiday: 0, local: 0 };
  const needs = t.needs.map(token => ({ token, ok: needMet(n, token) })); for (const q of needs) if (!q.ok) warnings.push(`Needs ${q.token}: no producer is running yet, so output starts at ${Math.round(IND.utilisation.missingInputFactor * 100)}%.`);
  const va = t.va * cap * 1e6 * priceOf(n, year, t.sector);
  return { ok: errors.length === 0, errors, warnings, reqs, cost, months: Math.max(1, Math.round(t.months * (cap > 1 ? Math.sqrt(cap) : 1))), va, cap, deposit, terms, type: t, needs };
}
/** Create the industry (and the aid loan) for a valid plan. Returns the new industry. */
export function startIndustry(w: SimWorld, n: Nation, spec: IndSpec, plan: IndPlan, month: number): Industry {
  const t = plan.type as IndType, terms = plan.terms as Terms, id = n.ind.nextId++; const fdi = spec.financing === 'fdi';
  const ind: Industry = { id, type: t.id, name: spec.name?.trim() || t.name, kec: spec.kec, lon: w.labelLon[spec.kec], lat: w.labelLat[spec.kec], cap: plan.cap, status: 'building', paused: false,
    state: fdi ? 1 - terms.foreign0 : 1, foreign: fdi ? terms.foreign0 : 0, priv: 0, financing: spec.financing, terms, cost: plan.cost, months: plan.months, progress: 0, paid: 0, start: month, done: -1, inBase: false, deposit: plan.deposit?.id ?? -1, util: 0, va: 0, profit: 0 };
  if (plan.deposit) plan.deposit.developed = true;
  if (spec.financing === 'aid') {
    const p = PARTNER.get(spec.partner as string) as Partner; const loanId = n.fin.nextLoan++;
    n.fin.loans.push({ id: loanId, partner: p.id, kind: 'project', committed: plan.cost, drawn: 0, balance: 0, rate: p.rate, graceMonths: p.grace * 12, maturityMonths: p.maturity * 12, start: month, ind: id, paidOff: 0 }); terms.loan = loanId;
    useCapacity(n, p.id, month, plan.cost);
    if (p.conditional) { n.adminHits += IND.aid.conditionStabilityHit; n.fin.nationHit -= IND.aid.conditionClimateBonus / IND.climate.nationalization; }
  }
  n.ind.list.push(ind); return ind;
}

// ------------------------------------------------------------------ state of one running industry
function vaOf(w: SimWorld, n: Nation, ind: Industry, t: IndType, year: number): { util: number; va: number } {
  const U = IND.utilisation, S = w.s, i = ind.kec; if (i >= w.n || !w.alive[i]) return { util: 0, va: 0 };
  const re = t.requires.elec ?? 0; const e = re > 0 ? clamp(w.elec[i] / re, 0, 1) : 1; let util = U.base + (1 - U.base) * e;
  for (const token of t.needs) if (!needMet(n, token)) util *= U.missingInputFactor;
  util *= 1 - U.stabilityPenalty * clamp((U.stabilityBelow - S.stab[i]) / U.stabilityBelow, 0, 1);
  const g = clamp(S.gov[i] / Math.max(1e-6, n.gov0), U.linkRange[0], U.linkRange[1]); util *= Math.pow(g, U.governanceExponent * (0.5 + 0.5 * ind.state));
  const age = ind.done >= 0 ? (n.month - ind.done) / 12 : 0;
  const va = t.va * ind.cap * 1e6 * util * priceOf(n, year, t.sector) * deplFactor(t, age) * n.tfp[t.sector];
  return { util, va };
}
const hopsOf = (hours: number): number => Math.max(1, Math.min(3, Math.ceil(hours / 2)));
/** Neighbourhood by hops with weight 0.5^hop (an approximation of "within a market-access radius"). */
function around(w: SimWorld, i: number, hops: number, f: (j: number, wt: number) => void): void {
  f(i, 1); let frontier = [i]; const seen = new Set([i]);
  for (let h = 1; h <= hops; h++) { const nx: number[] = []; for (const v of frontier) for (const u of w.neighbors[v]) if (!seen.has(u) && w.alive[u]) { seen.add(u); f(u, Math.pow(0.5, h)); nx.push(u); } frontier = nx; }
}
/** Recompute util / value added of every industry and fill the per-kecamatan rows: extra output (ind), linkage boost (link), added electrification (pwr). */
export function industryRows(w: SimWorld, n: Nation, year: number): void {
  const S = w.s; (S.ind as Float64Array).fill(0, 0, w.n * SECTORS); (S.link as Float64Array).fill(0, 0, w.n * SECTORS); (S.pwr as Float64Array).fill(0, 0, w.n);
  let foreignVa = 0;
  for (const x of n.ind.list) {
    if (x.status !== 'running') { x.util = 0; x.va = 0; x.profit = 0; continue; } const t = TYPE.get(x.type) as IndType; const r = vaOf(w, n, x, t, year); x.util = r.util; x.va = r.va; x.profit = r.va * t.margin;
    if (x.kec >= w.n || !w.alive[x.kec]) continue; foreignVa += x.va * x.foreign;
    if (!x.inBase) S.ind[x.kec * SECTORS + t.sector] += r.va;
    const lc = x.financing === 'fdi' ? 1 + x.terms.local * IND.fdi.localContentLinkBoost : 1;
    if (t.link) around(w, x.kec, hopsOf(t.link.hours), (j, wt) => { S.link[j * SECTORS + (t.link as { sector: number }).sector] += (t.link as { strength: number }).strength * lc * wt * x.cap * Math.min(1, r.util * 1.2); });
    if (t.power) around(w, x.kec, hopsOf(t.power.hours), (j, wt) => { S.pwr[j] += (t.power as { boost: number }).boost * wt * r.util; });
  }
  n.fin.foreignVaShare = n.agg.gdp > 0 ? foreignVa / n.agg.gdp : 0;
}
export const foreignShareNow = (ind: Industry, month: number): number => {
  if (ind.status !== 'running' || ind.financing !== 'fdi' || ind.terms.divestYears <= 0 || ind.done < 0) return ind.foreign;
  const f = clamp((month - ind.done) / (ind.terms.divestYears * 12), 0, 1); return Math.min(ind.foreign, ind.terms.foreign0 + (ind.terms.divestTo - ind.terms.foreign0) * f);
};

// ------------------------------------------------------------------ commands on existing industries
export const compensationOf = (ind: Industry): number => ind.va * ind.foreign * IND.nationalize.compensationYears;
export const privatizationPrice = (n: Nation, ind: Industry): number => ind.profit * ind.state * IND.privatize.profitMultiple * (1 - IND.privatize.climateFactor + IND.privatize.climateFactor * (n.fin.climate / 50));

// ------------------------------------------------------------------ keeping industries valid when kecamatan are split or merged
export function remapIndustries(w: SimWorld, n: Nation, ch: { removed: number[]; upserted: number[] }): void {
  const near = (x: { lon: number; lat: number }, cand: number[]): number => { let best = cand[0], bd = Infinity; for (const c of cand) { const d = (w.labelLon[c] - x.lon) ** 2 + (w.labelLat[c] - x.lat) ** 2; if (d < bd) { bd = d; best = c; } } return best; };
  if (ch.removed.length) { const gone = new Set(ch.removed), keep = ch.upserted[0]; for (const x of n.ind.list) if (gone.has(x.kec)) x.kec = keep; for (const d of n.ind.deposits) if (gone.has(d.kec)) d.kec = keep; return; }
  if (ch.upserted.length < 2) return; const R = ch.upserted[0], pieces = ch.upserted.filter(i => w.alive[i]);
  for (const x of n.ind.list) if (x.kec === R) x.kec = near(x, pieces);
  for (const d of n.ind.deposits) if (d.kec === R) d.kec = near(d, pieces);
}
