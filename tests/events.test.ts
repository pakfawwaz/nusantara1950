import { describe, it, expect } from 'vitest';
import { loadWorld } from './helpers';
import { SimCore, newNation } from '../src/sim/core';
import { DECISION, evaluateEnd, eventsMonth, fireDecision, monthIndex, resolveDecision, scoreParts, triggerDisaster, computeScore } from '../src/sim/events';
import { priceOf } from '../src/sim/industry';
import { yearOf } from '../src/sim/balance';
import type { Nation } from '../src/sim/types';
import { SECTORS } from '../src/sim/fields';
import world0 from '../config/world.json';

const mk = (seed = 1, historical = true) => { const world = loadWorld(); const nation = newNation(seed); nation.settings.historical = historical; const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed()); return { world, nation, core }; };
/** Advance the calendar and the event driver only (no economy), so a whole century runs in a second. */
function runEvents(m: ReturnType<typeof mk>, toYear: number, hook?: (n: Nation) => void): void {
  const loc = new Float64Array(m.world.n).fill(1), pm = new Float64Array(m.world.provinces.length).fill(1);
  while (yearOf(m.nation.month) < toYear) { eventsMonth(m.world as never, m.nation, loc, pm); hook?.(m.nation); m.nation.month++; }
}

describe('world timeline and random events', { timeout: 120000 }, () => {
  it('historical mode: dated events fire, prices respond, and decisions open on their dates', () => {
    const m = mk(); const seenPending = new Set<string>(); runEvents(m, 2025, n => n.ev.pending.forEach(p => seenPending.add(p.id)));
    const titles = m.nation.ev.log.map(e => e.title);
    for (const t of ['Korean War commodity boom', 'Regional rebellions (PRRI / Permesta)', 'Asian financial crisis', 'Global financial crisis', 'Pandemic', 'Aceh earthquake and Indian Ocean tsunami']) expect(titles).toContain(t);
    for (const id of ['dutch_enterprises', 'irian_barat', 'transmigration', 'investment_law', 'family_planning', 'autonomy', 'fuel_subsidy']) expect(seenPending.has(id), id).toBe(true);
    expect(m.nation.ev.pending).toEqual([]); // every decision resolved by its default at the deadline
  });
  it('shocks move prices, stability, climate and output while active, then fade', () => {
    const m = mk(); const n = m.nation; n.month = monthIndex(1950, 11) - 0; const loc = new Float64Array(m.world.n).fill(1), pm = new Float64Array(m.world.provinces.length).fill(1);
    eventsMonth(m.world as never, n, loc, pm); expect(n.prices.commodity).toBeGreaterThan(1.1); expect(priceOf(n, 1950, 4)).toBeGreaterThan(0.8 * 1.1);
    n.month += 40; eventsMonth(m.world as never, n, loc, pm); expect(n.ev.shocks.find(s => s.id === 'korea_boom')).toBeUndefined(); expect(n.prices.commodity).toBeLessThan(1.001 * 1.0001);
    // a national shock lowers the sector multipliers in the economy
    const n2 = mk().nation; n2.month = monthIndex(1997, 7); const m2 = mk(); m2.nation.month = monthIndex(1997, 7); const l2 = new Float64Array(m2.world.n).fill(1); eventsMonth(m2.world as never, m2.nation, l2, new Float64Array(m2.world.provinces.length).fill(1));
    expect(m2.nation.ev.mult.stab).toBeLessThan(0); expect(m2.nation.ev.mult.clim).toBeLessThan(0); expect(m2.nation.ev.mult.sector.slice(6, 10).every(x => x < 1)).toBe(true); expect(m2.nation.ev.mult.sector[0]).toBe(1);
  });
  it('randomized mode: the same seed replays the same world, another seed differs, and prices follow the smooth trend', () => {
    const a = mk(7, false), b = mk(7, false), c = mk(8, false); runEvents(a, 2030); runEvents(b, 2030); runEvents(c, 2030);
    const key = (m: ReturnType<typeof mk>) => JSON.stringify(m.nation.ev.log.map(e => [e.month, e.title]));
    expect(key(a)).toBe(key(b)); expect(key(a)).not.toBe(key(c)); expect(a.nation.ev.log.some(e => e.kind === 'world')).toBe(true);
    expect(a.nation.ev.log.some(e => e.title === 'Korean War commodity boom')).toBe(false);
    const n = a.nation; n.ev.shocks = []; n.prices.oil = 1; expect(priceOf(n, 1974, 5)).toBeCloseTo(0.5 + (1.3 - 0.5) * (24 / 76), 2);
  });
});

describe('decisions', { timeout: 120000 }, () => {
  it('Dutch enterprises: seizing moves Dutch shares to the state at no cost; compensating adds the bill to the legacy debt; the default applies at the deadline', () => {
    const none = mk(), pay = mk(), def = mk(); const foreign0 = none.nation.ind.list.reduce((s, x) => s + x.foreign, 0); expect(foreign0).toBeGreaterThan(0);
    for (const [m, opt] of [[none, 0], [pay, 1]] as const) { m.nation.month = monthIndex(1957, 12); expect(fireDecision(m.nation, 'dutch_enterprises')).toBe(true); expect(resolveDecision(m.world as never, m.nation, 'dutch_enterprises', opt)).toBeTruthy(); }
    const f1 = none.nation.ind.list.reduce((s, x) => s + x.foreign, 0); expect(f1).toBeLessThan(foreign0); expect(f1).toBeGreaterThan(0); // foreign oil majors stay (partly)
    expect(none.nation.ind.list.reduce((s, x) => s + x.state, 0)).toBeGreaterThan(0);
    expect(none.nation.fin.nationHit).toBeGreaterThan(pay.nation.fin.nationHit); expect(none.nation.fin.alignTarget).toBeGreaterThan(pay.nation.fin.alignTarget);
    const debt0 = def.nation.debtExt; expect(pay.nation.debtExt).toBeGreaterThan(debt0); expect(none.nation.debtExt).toBeCloseTo(debt0, 0);
    expect(none.nation.ev.shocks.some(s => s.id === 'dutch_exodus')).toBe(true);
    def.nation.month = monthIndex(1957, 12); fireDecision(def.nation, 'dutch_enterprises'); const due = def.nation.ev.pending[0].due; def.nation.month = due;
    const loc = new Float64Array(def.world.n).fill(1); eventsMonth(def.world as never, def.nation, loc, new Float64Array(def.world.provinces.length).fill(1));
    expect(def.nation.ev.pending).toEqual([]); expect(def.nation.ev.decided.dutch_enterprises.option).toBe(DECISION.get('dutch_enterprises')!.default);
    // a decision cannot be taken twice
    expect(resolveDecision(none.world as never, none.nation, 'dutch_enterprises', 0)).toBeNull();
  });
  it('Irian Barat joins on the date the chosen option sets, and not before', () => {
    for (const [opt, y, mo] of [[1, 1963, 1], [0, 1963, 5], [2, 1969, 8]] as const) {
      const m = mk(); const n = m.nation; n.month = monthIndex(1962, 1); fireDecision(n, 'irian_barat'); resolveDecision(m.world as never, n, 'irian_barat', opt);
      const p = m.world.provinces.find(q => q.id === 'IRIANBARAT')!; expect(p.locked).toBe(true); const loc = new Float64Array(m.world.n).fill(1), pm = new Float64Array(m.world.provinces.length).fill(1);
      n.month = monthIndex(y, mo) - 1; eventsMonth(m.world as never, n, loc, pm); expect(p.locked, `before ${y}-${mo}`).toBe(true);
      n.month++; eventsMonth(m.world as never, n, loc, pm); expect(p.locked, `at ${y}-${mo}`).toBe(false); expect(n.ev.log.some(e => e.kind === 'territory')).toBe(true);
    }
  });
  it('budget effects set next year\'s draft and the autonomy flag changes the transfer pool', () => {
    const m = mk(); const n = m.nation; n.month = monthIndex(1968, 6); fireDecision(n, 'family_planning'); resolveDecision(m.world as never, n, 'family_planning', 0); expect(n.policy.budgetNext.kb).toBeCloseTo(0.1, 5);
    n.month = monthIndex(1999, 5); fireDecision(n, 'autonomy'); resolveDecision(m.world as never, n, 'autonomy', 0); expect(n.ev.flags.dauMult).toBeCloseTo(1.35, 5);
    n.policy.budget.subsidies = 1.0; n.month = monthIndex(2008, 6); fireDecision(n, 'fuel_subsidy'); resolveDecision(m.world as never, n, 'fuel_subsidy', 0); expect(n.policy.budgetNext.subsidies).toBeCloseTo(0.4, 5); expect(n.ev.shocks.some(s => s.id === 'fuel_price_jump')).toBe(true);
  });
});

describe('disasters', { timeout: 120000 }, () => {
  it('a strike kills people, destroys capital, lowers local output, costs relief money and recovers', () => {
    const m = mk(); const n = m.nation, w = m.world; let c = 0; for (let i = 0; i < w.n; i++) if (w.alive[i] && !w.isLocked(i) && w.pop[i] > w.pop[c]) c = i; // the biggest kecamatan
    const pop0 = w.pop[c], cap0 = w.capStock[c]; triggerDisaster(w as never, n, 'earthquake', c, 0.2);
    const d = n.ev.disasters[0]; expect(d.deaths).toBeGreaterThan(0); expect(w.pop[c]).toBeLessThan(pop0); expect(w.capStock[c]).toBeLessThan(cap0 * 0.9); expect(d.relief).toBeGreaterThan(0);
    const g0 = w.grdp[c]; m.core.step(); const l = n.last; expect((l.spending as Record<string, number>).disaster).toBeGreaterThan(0); expect(w.grdp[c]).toBeLessThan(g0 * 0.95);
    // budget identity still holds with relief spending
    const before = n.cash; m.core.step(); const l2 = n.last; expect(n.cash - before).toBeCloseTo((-l2.deficit + l2.borrowDom + l2.monetized - l2.repay - l2.extRepay) / 12, -2);
    // after the recovery period nothing is left
    const loc = new Float64Array(w.n).fill(1); n.month += d.recover + 2; eventsMonth(w as never, n, loc, new Float64Array(w.provinces.length).fill(1)); expect(loc[c]).toBe(1);
  });
  it('random disasters follow province weights and respect locked provinces; historical ones hit the right places', () => {
    const m = mk(3, true); runEvents(m, 2020); const ds = m.nation.ev.disasters; expect(ds.length).toBeGreaterThan(20);
    const prov = (c: number) => m.world.provinces[m.world.regProv[m.world.kecReg[c]]];
    expect(ds.every(d => !(prov(d.center).locked && d.start < monthIndex(1963, 5)))).toBe(true);
    const aceh = ds.find(d => d.name.startsWith('Aceh earthquake')); expect(aceh).toBeTruthy(); expect(Math.abs(aceh!.lon - 95.3)).toBeLessThan(1.5);
    expect(ds.filter(d => d.kind === 'volcano').every(d => prov(d.center).id !== 'KALIMANTAN')).toBe(true);
  });
});

describe('win and lose conditions', { timeout: 120000 }, () => {
  const fresh = () => mk().nation;
  it('winning needs the target for three months in a row', () => {
    const n = fresh(); n.agg.gdppc = world0.targetGdpPerCapita2026; evaluateEnd(n); evaluateEnd(n); expect(n.end.status).toBe('playing'); n.agg.gdppc *= 0.9; evaluateEnd(n); n.agg.gdppc = world0.targetGdpPerCapita2026 * 1.01; evaluateEnd(n); evaluateEnd(n); expect(n.end.status).toBe('playing'); evaluateEnd(n); expect(n.end.status).toBe('won'); expect(n.end.score).toBeGreaterThan(0);
  });
  it('each way to lose triggers, and each can be switched off', () => {
    const cases: Array<[string, (n: Nation) => void, number]> = [['hyper', n => { n.inflation = 6; }, 3], ['collapse', n => { n.flags.collapse = true; }, 1], ['default', n => { n.fin.serviceRatio = 0.9; }, 24], ['timeout', n => { n.month = monthIndex(2051, 1); }, 1]];
    for (const [k, set, months] of cases) {
      const on = fresh(); for (let i = 0; i < months; i++) { set(on); evaluateEnd(on); if (i < months - 1) expect(on.end.status, `${k} too early`).toBe('playing'); } expect(on.end.status, k).toBe('lost'); expect(on.end.reason.length).toBeGreaterThan(10);
      const off = fresh(); (off.settings.lose as Record<string, boolean>)[k] = false; for (let i = 0; i < months + 3; i++) { set(off); evaluateEnd(off); } expect(off.end.status, `${k} off`).toBe('playing');
    }
    const q = fresh(); q.fin.serviceRatio = 0.7; q.settings.defaultPct = 0.8; for (let i = 0; i < 30; i++) evaluateEnd(q); expect(q.end.status).toBe('playing'); // the default threshold is a setting
  });
  it('after the end screen the player can continue as a sandbox, and scoring rewards speed and a healthy nation', () => {
    const n = fresh(); n.end.continued = true; n.inflation = 9; for (let i = 0; i < 5; i++) evaluateEnd(n); expect(n.end.status).toBe('playing');
    const a = fresh(), b = fresh(); a.month = monthIndex(2000, 1); b.month = monthIndex(2040, 1); a.agg.gdppc = b.agg.gdppc = world0.targetGdpPerCapita2026; a.agg.ipm = b.agg.ipm = 0.8; expect(computeScore(a, true)).toBeGreaterThan(computeScore(b, true));
    expect(computeScore(a, true)).toBeLessThanOrEqual(1000); expect(scoreParts(a).reduce((s, p) => s + p.value, 0)).toBeCloseTo(computeScore(a, true), 0);
    const lost = fresh(); lost.agg.gdppc = world0.targetGdpPerCapita2026 * 0.5; expect(computeScore(lost, false)).toBeLessThan(400);
  });
});
void SECTORS;
