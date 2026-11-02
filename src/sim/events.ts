import EV from '../../config/events.json';
import IND from '../../config/industries.json';
import world0 from '../../config/world.json';
import { B, BUD, interp, monthOfYear, yearOf } from './balance';
import type { BudgetKey } from './balance';
import { SECTORS } from './fields';
import { totalExternal } from './finance';
import { IC, TYPE } from './industry';
import type { Nation, SimWorld } from './types';

// ------------------------------------------------------------------ types
/** A temporary effect on the economy. Continuous effects (mult, stab, clim, infl, mort, prices) fade out over the last quarter of the duration. */
export interface Shock {
  id: string; name: string; start: number; end: number; sector?: number[]; mult?: number; prov?: string[]; oil?: number; commodity?: number; stab?: number; clim?: number; infl?: number; mort?: number;
}
export interface Disaster { id: number; kind: string; name: string; center: number; lon: number; lat: number; rings: number; sev: number; start: number; recover: number; deaths: number; damage: number; relief: number; shockOnly: boolean }
export interface Pending { id: string; month: number; due: number }
export type LogKind = 'world' | 'disaster' | 'decision' | 'territory' | 'end';
export interface LogEntry { month: number; kind: LogKind; title: string; text: string }
export interface Agg { sector: number[]; stab: number; clim: number; infl: number; mort: number; oil: number; commodity: number }
export interface EventState {
  rng: number; fired: string[]; shocks: Shock[]; disasters: Disaster[]; nextDisaster: number; pending: Pending[]; decided: Record<string, { month: number; option: number }>; lastFired: Record<string, number>;
  join: Record<string, number>; flags: Record<string, number>; log: LogEntry[]; reliefAnn: number; deathsTotal: number; deathsMonth: number; mult: Agg;
}
export interface EndState { status: 'playing' | 'won' | 'lost'; reason: string; month: number; score: number; win: number; hyper: number; def: number; continued: boolean; ack: boolean }
export interface GameSettings { historical: boolean; seed: number; defaultPct: number; lose: { hyper: boolean; collapse: boolean; default: boolean; timeout: boolean } }

export const SETTINGS = EV.settings;
export const defaultSettings = (seed = 1): GameSettings => ({ historical: true, seed, defaultPct: EV.settings.defaultServiceOverRevenue, lose: { ...EV.settings.lose } });
const flatAgg = (): Agg => ({ sector: new Array(SECTORS).fill(1), stab: 0, clim: 0, infl: 0, mort: 0, oil: 1, commodity: 1 });
export const newEvents = (seed = 1): EventState => ({ rng: (seed >>> 0) || 1, fired: [], shocks: [], disasters: [], nextDisaster: 1, pending: [], decided: {}, lastFired: {}, join: {}, flags: {}, log: [], reliefAnn: 0, deathsTotal: 0, deathsMonth: 0, mult: flatAgg() });
export const newEnd = (): EndState => ({ status: 'playing', reason: '', month: -1, score: 0, win: 0, hyper: 0, def: 0, continued: false, ack: false });

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
/** Month index of calendar month `moy1` (1–12) of `year`. */
export const monthIndex = (year: number, moy1: number): number => (year - 1950) * 12 + (moy1 - 1) - (B.calendar.startMonth - 1);
export const monthLabel = (m: number): string => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][monthOfYear(m)]} ${yearOf(m)}`;

// ------------------------------------------------------------------ seeded generator (state kept in the save so a seed replays the same world)
export function rand(ev: EventState): number {
  let t = (ev.rng = (ev.rng + 0x6d2b79f5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (ev: EventState, r: ReadonlyArray<number>): number => r[0] + (r[1] - r[0]) * rand(ev);

export function logEvent(n: Nation, kind: LogKind, title: string, text: string): void { n.ev.log.push({ month: n.month, kind, title, text }); if (n.ev.log.length > 500) n.ev.log.splice(0, n.ev.log.length - 500); }

// ------------------------------------------------------------------ shocks
type ShockSpec = Partial<Omit<Shock, 'id' | 'name' | 'start' | 'end'>> & { months: number };
export function addShock(n: Nation, id: string, name: string, spec: ShockSpec): Shock {
  const { months, ...rest } = spec; const s: Shock = { id, name, start: n.month, end: n.month + Math.max(1, Math.round(months)), ...rest }; n.ev.shocks.push(s); return s;
}
const strength = (s: Shock, month: number): number => { const len = s.end - s.start, fade = Math.max(1, 0.25 * len); return clamp((s.end - month) / fade, 0, 1); };
function aggregate(w: SimWorld, n: Nation, provMult: Float64Array): void {
  const a = flatAgg(); const pid = new Map(w.provinces.map((p, k) => [p.id, k] as const)); provMult.fill(1);
  for (const s of n.ev.shocks) {
    const k = strength(s, n.month); if (k <= 0) continue;
    if (s.mult !== undefined) { const f = 1 + (s.mult - 1) * k; if (s.prov) for (const id of s.prov) { const p = pid.get(id); if (p !== undefined) provMult[p] *= f; } else for (let q = 0; q < SECTORS; q++) if (!s.sector || s.sector.includes(q)) a.sector[q] *= f; }
    if (s.stab) a.stab += s.stab * k; if (s.clim) a.clim += s.clim * k; if (s.infl) a.infl += s.infl * k; if (s.mort) a.mort += s.mort * k;
    if (s.oil !== undefined) a.oil *= 1 + (s.oil - 1) * k; if (s.commodity !== undefined) a.commodity *= 1 + (s.commodity - 1) * k;
  }
  n.ev.mult = a; n.prices.oil = a.oil; n.prices.commodity = a.commodity;
}

// ------------------------------------------------------------------ decisions
interface Effect { t: string; v?: number; key?: string; pay?: boolean; id?: string; name?: string; months?: number; sector?: number[]; mult?: number; stab?: number; clim?: number; infl?: number; mort?: number; oil?: number; commodity?: number; prov?: string | string[]; year?: number; month?: number }
export interface DecisionOption { label: string; text: string; hist?: boolean; smart?: boolean; effects: Effect[] }
export interface DecisionDef { id: string; title: string; text: string; year: number; month: number; dueMonths: number; default: number; cond?: string; repeatYears?: number; options: DecisionOption[] }
export const DECISIONS = EV.decisions as unknown as DecisionDef[];
export const DECISION = new Map(DECISIONS.map(d => [d.id, d] as const));

const oilFactor = (n: Nation, year: number): number => (n.settings.historical ? interp(IND.price.oil, year) : interp(IND.price.oilTrend, year)) * n.prices.oil;
function condition(n: Nation, d: DecisionDef, year: number): boolean {
  if (d.cond === 'noFdiLaw') return !n.fin.fdiLaw;
  if (d.cond === 'fuelSqueeze') { const sub = n.policy.budget.subsidies, P = EV.params; return year >= d.year && sub >= P.fuelSubsidyMin && (oilFactor(n, year) >= P.fuelOilTrigger || sub >= P.fuelSubsidyHigh); }
  return true;
}
export function fireDecision(n: Nation, id: string): boolean {
  const d = DECISION.get(id); if (!d) return false; const ev = n.ev;
  if (ev.pending.some(p => p.id === id)) return false;
  if (ev.decided[id] && !d.repeatYears) return false;
  ev.pending.push({ id, month: n.month, due: n.month + d.dueMonths }); ev.lastFired[id] = n.month;
  logEvent(n, 'decision', d.title, `${d.text} A decision is waiting.`); return true;
}
const dutchShare = (typeId: string): number => { const t = TYPE.get(typeId); return t && (t.sector === 5 || t.id === 'refinery' || t.id === 'petrochem') ? EV.params.dutchOilShare : 1; };
/** Take over Dutch-held shares of the 1950 industries. Returns the compensation owed. */
function nationaliseDutch(n: Nation, pay: boolean): number {
  let comp = 0, count = 0;
  for (const x of n.ind.list) {
    if (x.status !== 'running' || x.financing !== 'legacy' || x.foreign <= 0) continue; const take = x.foreign * dutchShare(x.type); if (take <= 0) continue;
    comp += x.va * take * IC.nationalize.compensationYears; x.state += take; x.foreign -= take; x.terms.foreign0 = x.foreign; x.terms.divestTo = Math.min(x.terms.divestTo, x.foreign); count++;
  }
  if (pay && comp > 0) { // the bill is added to the legacy debt
    const l = n.fin.loans.find(q => q.kind === 'legacy');
    if (l) { l.balance += comp; l.drawn += comp; l.committed += comp; } else n.fin.loans.push({ id: n.fin.nextLoan++, partner: 'legacy', kind: 'legacy', committed: comp, drawn: comp, balance: comp, rate: B.nation.interestExternal, graceMonths: 0, maturityMonths: 30 * 12, start: n.month, ind: -1, paidOff: 0 });
    n.debtExt = totalExternal(n);
  }
  n.ev.flags.dutchTaken = count; return pay ? comp : 0;
}
function applyEffect(w: SimWorld, n: Nation, e: Effect, title: string): void {
  const ev = n.ev;
  switch (e.t) {
    case 'nationaliseDutch': nationaliseDutch(n, e.pay === true); break;
    case 'nationHit': n.fin.nationHit += e.v ?? 0; break;
    case 'align': n.fin.alignTarget = clamp(n.fin.alignTarget + (e.v ?? 0), -1, 1); break;
    case 'shock': addShock(n, e.id ?? title, e.name ?? title, { months: e.months ?? 12, sector: e.sector, mult: e.mult, stab: e.stab, clim: e.clim, infl: e.infl, mort: e.mort, oil: e.oil, commodity: e.commodity }); break;
    case 'budget': { const k = e.key as BudgetKey; if (k in n.policy.budgetNext) n.policy.budgetNext[k] = e.v ?? 0; break; }
    case 'budgetFactor': { const k = e.key as BudgetKey; if (k in n.policy.budgetNext) n.policy.budgetNext[k] = Math.max(0, n.policy.budget[k] * (e.v ?? 1)); break; }
    case 'costPctGdp': n.cash -= ((e.v ?? 0) / 100) * Math.max(0, n.agg.gdp); break;
    case 'fdiLaw': if (!n.fin.fdiLaw) { n.fin.fdiLaw = true; n.fin.lawYear = yearOf(n.month); } break;
    case 'flag': ev.flags[e.key as string] = e.v ?? 1; break;
    case 'join': { const ids = Array.isArray(e.prov) ? e.prov : [e.prov as string]; for (const id of ids) ev.join[id] = monthIndex(e.year ?? 1963, e.month ?? 5); break; }
    default: break;
  }
  void w;
}
/** Resolve a pending decision. Used by the player's choice and by the automatic default when the deadline passes. */
export function resolveDecision(w: SimWorld, n: Nation, id: string, option: number, auto = false): string | null {
  const d = DECISION.get(id); const ev = n.ev; const pi = ev.pending.findIndex(p => p.id === id); if (!d || pi < 0) return null; const o = d.options[option]; if (!o) return null;
  ev.pending.splice(pi, 1); ev.decided[id] = { month: n.month, option };
  for (const e of o.effects) applyEffect(w, n, e, d.title);
  logEvent(n, 'decision', d.title, `${auto ? 'No decision was taken in time; the default followed: ' : 'Decided: '}${o.label}. ${o.text}`); return o.label;
}

// ------------------------------------------------------------------ timeline, random events, disasters
const inWindow = (moy1: number, win: ReadonlyArray<number>): boolean => (win[0] <= win[1] ? moy1 >= win[0] && moy1 <= win[1] : moy1 >= win[0] || moy1 <= win[1]);
const windowLen = (win: ReadonlyArray<number>): number => (win[0] <= win[1] ? win[1] - win[0] + 1 : 12 - win[0] + 1 + win[1]);

function fireTimeline(n: Nation, year: number, moy1: number): void {
  const ev = n.ev;
  for (const e of EV.timeline as Array<{ id: string; year: number; month: number; name: string; text: string; kind: string; decision?: string; shock?: ShockSpec }>) {
    if (e.year !== year || e.month !== moy1 || ev.fired.includes(e.id)) continue;
    if (e.kind === 'decision') { ev.fired.push(e.id); const d = DECISION.get(e.decision as string); if (d && condition(n, d, year)) fireDecision(n, d.id); continue; }
    if (!n.settings.historical) continue; ev.fired.push(e.id);
    if (e.shock) addShock(n, e.id, e.name, e.shock); logEvent(n, 'world', e.name, e.text);
  }
}
function fireRandom(w: SimWorld, n: Nation, year: number): void {
  const ev = n.ev;
  for (const r of EV.random.events as Array<Record<string, unknown> & { id: string; name: string; text: string; rate: number; from: number; to: number; months: number[]; region?: boolean }>) {
    if (year < r.from || year > r.to || rand(ev) >= r.rate / 12) continue;
    const g = (k: string): number | undefined => { const v = r[k] as number[] | undefined; return v ? between(ev, v) : undefined; };
    const spec: ShockSpec = { months: Math.round(between(ev, r.months)), mult: g('mult'), commodity: g('commodity'), oil: g('oil'), clim: g('clim'), stab: g('stab'), infl: g('infl'), mort: g('mort') };
    if (r.sector) spec.sector = r.sector as number[]; let where = '';
    if (r.region) { const open = w.provinces.filter(p => !p.locked); const p = open[Math.floor(rand(ev) * open.length)]; if (p) { spec.prov = [p.id]; where = ` in ${p.name}`; } }
    addShock(n, `${r.id}_${n.month}`, r.name + where, spec);
    const fx = g('fx'); if (fx) revalue(n, fx);
    logEvent(n, 'world', r.name + where, r.text);
  }
}
/** One-off real depreciation: dollar debts weigh more in rupiah. */
function revalue(n: Nation, fx: number): void { for (const l of n.fin.loans) { l.balance *= 1 + fx; l.drawn *= 1 + fx; l.committed *= 1 + fx; } n.debtExt = totalExternal(n); }

type DKind = (typeof EV.disasters.kinds)[number] & { agri?: boolean; coastOnly?: boolean };
function vulnerability(w: SimWorld, i: number): number { const y = Math.max(1e6, w.grdp[i] / Math.max(1, w.pop[i])); return clamp(Math.pow(EV.disasters.vulnerabilityIncomeRef / y, EV.disasters.vulnerabilityExp), 0.5, 2); }
function neighbourRings(w: SimWorld, center: number, rings: number): Array<{ i: number; r: number }> {
  const out = [{ i: center, r: 0 }]; const seen = new Set([center]); let frontier = [center];
  for (let r = 1; r <= rings; r++) { const nx: number[] = []; for (const v of frontier) for (const u of w.neighbors[v]) if (!seen.has(u) && w.alive[u]) { seen.add(u); nx.push(u); out.push({ i: u, r }); } frontier = nx; }
  return out;
}
const nearestKec = (w: SimWorld, lon: number, lat: number): number => { let best = -1, bd = Infinity; for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; const dx = (w.labelLon[i] - lon) * Math.cos((lat * Math.PI) / 180), dy = w.labelLat[i] - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } } return best; };
function strike(w: SimWorld, n: Nation, kind: DKind, name: string, center: number, sev: number, rings: number, recover: number): void {
  const ev = n.ev, D = EV.disasters; const d: Disaster = { id: ev.nextDisaster++, kind: kind.id, name, center, lon: w.labelLon[center], lat: w.labelLat[center], rings, sev, start: n.month, recover, deaths: 0, damage: 0, relief: 0, shockOnly: !!kind.agri };
  if (kind.agri) { // drought: an output shock on food, plantation and fishing in the province, no rings and no capital loss
    const p = w.provinces[w.regProv[w.kecReg[center]]]; if (p) addShock(n, `dis${d.id}`, name, { months: recover, prov: [p.id], mult: 1 - Math.min(0.15, sev * 2) });
  } else {
    for (const { i, r } of neighbourRings(w, center, rings)) {
      const f = Math.pow(D.ringDecay, r); const dead = w.pop[i] * clamp(sev * f * kind.deathPerSev * vulnerability(w, i), 0, 0.2);
      w.pop[i] -= dead; d.deaths += dead; const lost = w.capStock[i] * clamp(sev * f, 0, 0.9); w.capStock[i] -= lost; d.damage += lost;
    }
    d.relief = d.damage * D.reliefShare;
  }
  ev.deathsTotal += d.deaths; ev.deathsMonth += d.deaths; ev.disasters.push(d); if (ev.disasters.length > 60) ev.disasters.shift();
  const where = `${w.provinces[w.regProv[w.kecReg[center]]]?.name ?? ''}`;
  logEvent(n, 'disaster', name, `${kind.name} near ${where}. ${d.deaths >= 1 ? `About ${Math.round(d.deaths / 10) * 10 > 0 ? (Math.round(d.deaths / 10) * 10).toLocaleString('en-US') : Math.round(d.deaths)} people died. ` : ''}${d.damage > 0 ? `Capital worth Rp ${(d.damage / 1e9).toFixed(0)} B was destroyed; the state will pay Rp ${(d.relief / 1e9).toFixed(0)} B in relief over ${D.reliefMonths} months. ` : ''}Local output is down and recovers over about ${recover} months.`);
}
/** Cause a disaster of a given kind at kecamatan `center` (used by tests and the debug hook). */
export function triggerDisaster(w: SimWorld, n: Nation, kindId: string, center: number, sev: number, rings = 2): void {
  const kind = (EV.disasters.kinds as DKind[]).find(k => k.id === kindId); if (!kind) return; strike(w, n, kind, `${kind.name} near ${kecName(w, center)}`, center, sev, rings, Math.round((kind.recover[0] + kind.recover[1]) / 2));
}
function randomDisasters(w: SimWorld, n: Nation, moy1: number): void {
  const ev = n.ev;
  for (const k of EV.disasters.kinds as DKind[]) {
    const win = k.months as number[]; if (!inWindow(moy1, win)) continue; if (rand(ev) >= (k.rate / 12) * (12 / windowLen(win))) continue;
    // province, then kecamatan inside it, weighted
    const weights = k.weights as Record<string, number>; let tot = 0; const ps: Array<[number, number]> = [];
    w.provinces.forEach((p, q) => { const wt = p.locked ? 0 : weights[p.id] ?? 0; if (wt > 0) { ps.push([q, wt]); tot += wt; } }); if (tot <= 0) continue;
    let u = rand(ev) * tot, prov = ps[0][0]; for (const [q, wt] of ps) { u -= wt; if (u <= 0) { prov = q; break; } }
    const cands: number[] = [], cw: number[] = []; let cs = 0;
    for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; const kr = w.kecReg[i]; if (kr < 0 || w.regProv[kr] !== prov) continue; if (k.coastOnly && !w.coastal[i]) continue; const wt = Math.sqrt(w.pop[i] + 1) * (w.coastal[i] ? k.coastal : 1); cands.push(i); cw.push(wt); cs += wt; }
    if (!cands.length) continue; let v = rand(ev) * cs, c = cands[0]; for (let q = 0; q < cands.length; q++) { v -= cw[q]; if (v <= 0) { c = cands[q]; break; } }
    const lo = k.sev[0], hi = k.sev[1], sev = lo * Math.pow(hi / lo, Math.pow(rand(ev), 2)); const rings = Math.round(between(ev, k.rings)), rec = Math.round(between(ev, k.recover));
    const names: Record<string, string> = { earthquake: 'Earthquake', volcano: 'Eruption', flood: 'Flooding', drought: 'Drought', fire: 'Forest fires', tsunami: 'Tsunami' };
    strike(w, n, k, `${names[k.id] ?? k.name} near ${kecName(w, c)}`, c, sev, rings, rec);
  }
}
const kecName = (w: SimWorld, i: number): string => w.regencies[w.kecReg[i]]?.name ?? `kecamatan ${i}`;
function historicalDisasters(w: SimWorld, n: Nation, year: number, moy1: number): void {
  for (const h of EV.disasters.historical) {
    if (h.year !== year || h.month !== moy1) continue; const id = `dis_${h.year}_${h.kind}`; if (n.ev.fired.includes(id)) continue; n.ev.fired.push(id);
    const kind = (EV.disasters.kinds as DKind[]).find(k => k.id === h.kind); if (!kind) continue; const c = nearestKec(w, h.lon, h.lat); if (c < 0 || (w.provinces[w.regProv[w.kecReg[c]]]?.locked ?? true)) continue;
    strike(w, n, kind, h.name, c, h.sev, h.rings, Math.round((kind.recover[0] + kind.recover[1]) / 2));
  }
}

// ------------------------------------------------------------------ monthly driver
/** Runs at the start of each month (after the budget year rolls over). Fills `loc` with per-kecamatan output multipliers for the economy step. */
export function eventsMonth(w: SimWorld, n: Nation, loc: Float64Array, provMult: Float64Array): void {
  const ev = n.ev, year = yearOf(n.month), moy1 = monthOfYear(n.month) + 1;
  ev.shocks = ev.shocks.filter(s => s.end > n.month);
  // provinces that join the republic
  w.provinces.forEach(p => { if (!p.locked) return; const jm = ev.join[p.id] ?? (p.joinYear ? monthIndex(p.joinYear, 5) : Infinity); if (n.month >= jm) { p.locked = false; logEvent(n, 'territory', `${p.name} joins the republic`, `${p.name} comes under your administration; its people and output now count in the national accounts.`); } });
  fireTimeline(n, year, moy1);
  if (!n.settings.historical) fireRandom(w, n, year);
  if (n.settings.historical) historicalDisasters(w, n, year, moy1);
  randomDisasters(w, n, moy1);
  // standing decisions (fuel subsidy): check each January
  if (moy1 === 1) for (const d of DECISIONS) if (d.cond === 'fuelSqueeze' && year >= d.year && (!ev.lastFired[d.id] || n.month - ev.lastFired[d.id] >= (d.repeatYears ?? 99) * 12) && condition(n, d, year)) fireDecision(n, d.id);
  for (const p of [...ev.pending]) if (p.due <= n.month) resolveDecision(w, n, p.id, DECISION.get(p.id)?.default ?? 0, true);
  // disaster relief (paid by the treasury) and recovery of the affected area
  let relief = 0; const D = EV.disasters; loc.fill(1);
  for (const d of ev.disasters) {
    const age = n.month - d.start; if (age >= D.reliefMonths && age >= d.recover) continue;
    if (age < D.reliefMonths && d.relief > 0) relief += d.relief / D.reliefMonths;
    if (d.shockOnly || age >= d.recover) continue; const left = 1 - age / d.recover;
    for (const { i, r } of neighbourRings(w, d.center, d.rings)) loc[i] *= 1 - Math.min(0.6, d.sev * D.outputPerSev * Math.pow(D.ringDecay, r) * left);
  }
  ev.reliefAnn = relief * 12; aggregate(w, n, provMult);
  for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; const k = w.kecReg[i]; if (k >= 0) loc[i] *= provMult[w.regProv[k]]; }
}

// ------------------------------------------------------------------ ending
export function computeScore(n: Nation, won: boolean): number {
  const S = EV.score, a = n.agg, W = S.weights; const target = world0.targetGdpPerCapita2026;
  if (!won) return Math.round(S.lossScale * Math.min(S.lossCap, a.gdppc / target));
  const y = yearOf(n.month) + monthOfYear(n.month) / 12; const early = clamp((S.latestYear - y) / (S.latestYear - S.earliestYear), 0, 1);
  const debt = (n.debtDom + n.debtExt) / Math.max(1, a.gdp);
  return Math.round(W.earliness * early + W.ipm * clamp((a.ipm - 0.4) / 0.5, 0, 1) + W.poverty * clamp(1 - a.poverty / 0.5, 0, 1) + W.stability * clamp(n.stability / 100, 0, 1)
    + W.equality * clamp((S.ineqWorst - a.ineq) / (S.ineqWorst - S.ineqBest), 0, 1) + W.debt * clamp((S.debtBad - debt) / (S.debtBad - S.debtGood), 0, 1));
}
export function scoreParts(n: Nation): Array<{ label: string; value: number; max: number }> {
  const S = EV.score, a = n.agg, W = S.weights; const y = yearOf(n.month) + monthOfYear(n.month) / 12; const early = clamp((S.latestYear - y) / (S.latestYear - S.earliestYear), 0, 1);
  const debt = (n.debtDom + n.debtExt) / Math.max(1, a.gdp);
  return [{ label: 'Speed (earlier is better)', value: W.earliness * early, max: W.earliness }, { label: 'Human development (IPM)', value: W.ipm * clamp((a.ipm - 0.4) / 0.5, 0, 1), max: W.ipm },
    { label: 'Low poverty', value: W.poverty * clamp(1 - a.poverty / 0.5, 0, 1), max: W.poverty }, { label: 'Stability', value: W.stability * clamp(n.stability / 100, 0, 1), max: W.stability },
    { label: 'Equality', value: W.equality * clamp((S.ineqWorst - a.ineq) / (S.ineqWorst - S.ineqBest), 0, 1), max: W.equality }, { label: 'Moderate debt', value: W.debt * clamp((S.debtBad - debt) / (S.debtBad - S.debtGood), 0, 1), max: W.debt }];
}
/** Checks the win and lose conditions after each month. */
export function evaluateEnd(n: Nation): void {
  const E = n.end, S = EV.settings, L = n.settings.lose; if (E.status !== 'playing' || E.continued) return;
  const finish = (status: 'won' | 'lost', reason: string) => { E.status = status; E.reason = reason; E.month = n.month; E.score = computeScore(n, status === 'won'); logEvent(n, 'end', status === 'won' ? 'The target is reached' : 'The republic has failed', reason); };
  E.win = n.agg.gdppc >= world0.targetGdpPerCapita2026 ? E.win + 1 : 0; if (E.win >= S.winSustainMonths) { finish('won', `Real GDP per capita reached Rp ${(n.agg.gdppc / 1e6).toFixed(1)} million (2026 prices) in ${monthLabel(n.month)}.`); return; }
  E.hyper = n.inflation > S.hyperInflationPerYear ? E.hyper + 1 : 0; if (L.hyper && E.hyper >= S.hyperMonths) { finish('lost', `Hyperinflation: prices rose faster than ${Math.round(S.hyperInflationPerYear * 100)}% a year for ${S.hyperMonths} months.`); return; }
  if (L.collapse && n.flags.collapse) { finish('lost', `Political collapse: national stability stayed below ${B.stability.collapseBelow} for ${B.stability.collapseMonths} months.`); return; }
  E.def = n.fin.serviceRatio > n.settings.defaultPct ? E.def + 1 : 0; if (L.default && E.def >= S.defaultMonths) { finish('lost', `Sovereign default: debt service exceeded ${Math.round(n.settings.defaultPct * 100)}% of revenue for ${S.defaultMonths / 12} years.`); return; }
  if (L.timeout && yearOf(n.month) > S.endYear) finish('lost', `${S.endYear} came and Indonesia had not reached Rp ${(world0.targetGdpPerCapita2026 / 1e6).toFixed(0)} million per person (it stood at Rp ${(n.agg.gdppc / 1e6).toFixed(1)} million).`);
}
export const unlockedDecisions = (): DecisionDef[] => DECISIONS;
void BUD;
