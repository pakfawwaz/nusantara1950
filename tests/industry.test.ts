import { describe, it, expect } from 'vitest';
import { loadWorld, lineThrough } from './helpers';
import { SimCore, newNation } from '../src/sim/core';
import { aidOffers, fdiOffers, planIndustry, remapIndustries, requirements, startIndustry, TYPE, compensationOf } from '../src/sim/industry';
import type { IndSpec } from '../src/sim/industry';
import { overrunFactor } from '../src/sim/projects';
import { climateTarget, loanMonth, totalExternal } from '../src/sim/finance';
import { planSplit } from '../src/admin/kecamatan';
import { makeSnapshot } from '../src/sim/snapshot';
import { buildSave, readSave } from '../src/save/format';
import { yearOf } from '../src/sim/balance';

const mk = () => { const world = loadWorld(); const nation = newNation(); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed()); return { world, nation, core }; };
type M = ReturnType<typeof mk>;
const site = (m: M, type: string): number => { const t = TYPE.get(type)!; for (let i = 0; i < m.world.n; i++) if (m.world.alive[i] && !m.world.isLocked(i) && requirements(m.world as never, m.nation, t, i, 1950).reqs.every(r => r.ok) && !m.nation.ind.list.some(x => x.kec === i && x.type === type)) return i; return -1; };
const plan = (m: M, spec: IndSpec) => planIndustry(m.world as never, m.nation, spec, yearOf(m.nation.month), overrunFactor(m.nation.agg.gov, m.nation.gov0));
const start = (m: M, spec: IndSpec) => { const p = plan(m, spec); expect(p.errors).toEqual([]); return { x: startIndustry(m.world as never, m.nation, spec, p, m.nation.month), p }; };

describe('industry planning and rules', () => {
  it('rules: unlock year, site requirements, one per kind per kecamatan', () => {
    const m = mk(); const i = site(m, 'cement'); expect(i).toBeGreaterThanOrEqual(0);
    expect(plan(m, { type: 'steel_mill', kec: i, financing: 'apbn' }).errors.join()).toMatch(/Available from 1955/);
    expect(plan(m, { type: 'cement', kec: i, financing: 'apbn' }).ok).toBe(true);
    const { x } = start(m, { type: 'cement', kec: i, financing: 'apbn' }); expect(x.status).toBe('building');
    expect(plan(m, { type: 'cement', kec: i, financing: 'apbn' }).errors.join()).toMatch(/already/);
    expect(plan(m, { type: 'oil_field', kec: i, financing: 'apbn' }).errors.join()).toMatch(/discovered oil deposit/);
  });
  it('FDI needs the investment law and a decent climate; offers get better as the climate improves; the Eastern bloc scares investors off', () => {
    const m = mk(); const t = TYPE.get('cement')!; expect(fdiOffers(m.nation, t, 1950)).toEqual([]);
    m.nation.fin.fdiLaw = true; m.nation.fin.climate = 45; const low = fdiOffers(m.nation, t, 1962); m.nation.fin.climate = 80; const high = fdiOffers(m.nation, t, 1962);
    expect(low.length).toBeGreaterThan(0); expect(high.length).toBeGreaterThan(low.length);
    expect(high.find(o => o.id === 'turnkey')!.foreign).toBeLessThanOrEqual(low.find(o => o.id === 'turnkey')!.foreign);
    expect(high.find(o => o.id === 'turnkey')!.holiday).toBeLessThan(low.find(o => o.id === 'turnkey')!.holiday);
    m.nation.fin.align = 0.8; expect(fdiOffers(m.nation, t, 1962)).toEqual([]);
    expect(fdiOffers(m.nation, TYPE.get('aircraft')!, 1980)).toEqual([]);
  });
  it('aid depends on alignment and date: Soviet loans only for a government leaning East, the US the opposite; quotas reset each January', () => {
    const m = mk(); const gdp = m.nation.agg.gdp; const ids = (y: number) => aidOffers(m.nation, y, gdp).map(o => o.partner.id);
    m.nation.fin.align = -0.8; expect(ids(1960)).toContain('us'); expect(ids(1960)).not.toContain('ussr');
    m.nation.fin.align = 0.9; expect(ids(1960)).toContain('ussr'); expect(ids(1960)).not.toContain('us');
    m.nation.fin.align = 0; expect(ids(1950)).not.toContain('iggi'); expect(ids(1968)).toContain('iggi'); expect(ids(1995)).not.toContain('ussr');
  });
});

describe('industry money and output', { timeout: 180000 }, () => {
  it('a budget-financed project is paid month by month and the budget identity holds; when finished, output adds to the kecamatan', () => {
    const a = mk(), b = mk(); const i = site(a, 'cement'); const { x, p } = start(a, { type: 'cement', kec: i, financing: 'apbn' }); let paid = 0;
    for (let k = 0; k < p.months + 1; k++) { const before = a.nation.cash; a.core.step(); b.core.step(); const l = a.nation.last; paid += l.spending.industry / 12;
      expect(a.nation.cash - before).toBeCloseTo(-l.deficit / 12 + (l.borrowDom + l.monetized - l.repay - l.extRepay) / 12, -2); }
    expect(x.status).toBe('running'); expect(paid).toBeCloseTo(p.cost, -3);
    for (let k = 0; k < 12; k++) { a.core.step(); b.core.step(); }
    expect(x.va).toBeGreaterThan(0); const gain = a.world.grdp[i] - b.world.grdp[i]; expect(gain).toBeGreaterThan(x.va * 0.9); expect(gain).toBeLessThan(x.va * 1.5);
  });
  it('FDI costs the budget nothing, pays profits abroad, and a tax holiday cuts tax revenue', () => {
    const m = mk(); m.nation.fin.fdiLaw = true; m.nation.fin.climate = 80; const i = site(m, 'cement'); const o = fdiOffers(m.nation, TYPE.get('cement')!, 1962).find(q => q.id === 'turnkey')!;
    const { x, p } = start(m, { type: 'cement', kec: i, financing: 'fdi', offer: 'turnkey' }); expect(x.foreign).toBeCloseTo(o.foreign, 6);
    for (let k = 0; k < p.months + 14; k++) { m.core.step(); if (k < p.months - 1) expect(m.nation.last.spending.industry).toBe(0); }
    expect(x.status).toBe('running'); expect(m.nation.fin.relief).toBeGreaterThan(0); // tax holiday: revenue is given up while it lasts
    expect(m.nation.fin.repatriated).toBeGreaterThan(0);
  });
  it('aid is a loan: debt rises as the project is built, tied aid costs more, repayment starts after the grace period, and total external debt = sum of loans', () => {
    const m = mk(); m.nation.fin.align = -0.8; const i = site(m, 'cement'); const d0 = m.nation.debtExt;
    const cheap = plan(m, { type: 'cement', kec: i, financing: 'apbn' }).cost, tied = plan(m, { type: 'cement', kec: i, financing: 'aid', partner: 'us' }).cost; expect(tied).toBeCloseTo(cheap * 1.15, -3);
    const { x, p } = start(m, { type: 'cement', kec: i, financing: 'aid', partner: 'us' }); const loan = m.nation.fin.loans.find(l => l.ind === x.id)!;
    for (let k = 0; k < p.months + 1; k++) m.core.step();
    expect(loan.balance).toBeCloseTo(p.cost, -3); expect(m.nation.debtExt).toBeCloseTo(totalExternal(m.nation), 0); expect(m.nation.debtExt).toBeCloseTo(m.nation.fin.loans.reduce((q, l) => q + l.balance, 0), 0); void d0;
    expect(m.nation.last.spending.industry).toBe(0); const bal = loan.balance; for (let k = 0; k < 6; k++) m.core.step(); expect(loan.balance).toBe(bal); // inside the 5-year grace period
    const legacy = m.nation.fin.loans.find(l => l.kind === 'legacy')!; const lb = legacy.balance; m.core.step(); expect(legacy.balance).toBeLessThan(lb); expect(m.nation.last.extRepay).toBeGreaterThan(0);
  });
  it('quota: an aid project larger than the partner\'s yearly capacity is refused', () => {
    const m = mk(); m.nation.fin.align = -0.8; const i = site(m, 'cement'); m.nation.fin.used = { us: 1e18 }; m.nation.fin.usedYear = 1950;
    expect(plan(m, { type: 'cement', kec: i, financing: 'aid', partner: 'us' }).errors.join()).toMatch(/can still lend/);
  });
  it('nationalising a foreign-owned industry costs cash and hurts the investment climate', () => {
    const m = mk(); for (let k = 0; k < 2; k++) m.core.step(); const x = m.nation.ind.list.find(q => q.foreign > 0 && q.va > 0)!; expect(x).toBeTruthy();
    const c = compensationOf(x); expect(c).toBeGreaterThan(0); const base = climateTarget(m.nation, 1950).value; m.nation.fin.nationHit = 1; expect(climateTarget(m.nation, 1950).value).toBeLessThan(base - 5);
  });
});

describe('exploration, climate, geometry, saves', { timeout: 300000 }, () => {
  it('known-date discoveries appear in historical mode; exploration spending finds them earlier in the other mode', () => {
    const h = mk(); h.core.step(); expect(h.nation.ind.deposits.filter(d => d.revealed).every(d => d.knownYear <= 1950)).toBe(true); expect(h.nation.ind.deposits.some(d => d.revealed)).toBe(true);
    const target = (m: M) => m.nation.ind.deposits.find(d => d.knownYear >= 1960 && d.knownYear <= 1975 && !d.revealed)!;
    const a = mk(), b = mk(); a.nation.settings.historical = false; b.nation.settings.historical = false; for (const mm of [a, b]) { mm.core.step(); }
    b.nation.policy.budget.exploration = 0.4; b.nation.policy.budgetNext.exploration = 0.4;
    for (let k = 0; k < 120; k++) { a.core.step(); b.core.step(); }
    expect(a.nation.ind.deposits.filter(d => d.revealed && d.knownYear > 1950).length).toBe(0);
    expect(b.nation.ind.deposits.filter(d => d.revealed && d.knownYear > 1950).length).toBeGreaterThan(0); void target;
  });
  it('investment climate rises with a fiscal rule and the investment law, and falls with inflation and nationalisation', () => {
    const m = mk(); m.core.step(); const base = climateTarget(m.nation, 1960).value;
    m.nation.policy.deficitRule = true; const withRule = climateTarget(m.nation, 1960).value; expect(withRule).toBeGreaterThan(base);
    m.nation.fin.fdiLaw = true; expect(climateTarget(m.nation, 1960).value).toBeGreaterThan(withRule); const v = climateTarget(m.nation, 1960).value;
    m.nation.inflation = 1.5; expect(climateTarget(m.nation, 1960).value).toBeLessThan(v);
  });
  it('splitting or merging the kecamatan of an industry keeps it on a live kecamatan', async () => {
    const m = mk(); const x = m.nation.ind.list[0]; const R = x.kec; const plan0 = await planSplit(m.world, R, lineThrough(m.world, R, 40));
    if (plan0.apply) { const ap = plan0.apply(); remapIndustries(m.world as never, m.nation, ap.change); expect(m.world.alive[x.kec]).toBe(1); expect(ap.change.upserted).toContain(x.kec); }
    const d = m.nation.ind.deposits[0]; const gone = d.kec; remapIndustries(m.world as never, m.nation, { removed: [gone], upserted: [x.kec] }); expect(d.kec).toBe(x.kec);
  });
  it('industries, deposits and loans survive a save → read round trip', () => {
    const m = mk(); m.nation.fin.align = -0.8; const i = site(m, 'cement'); start(m, { type: 'cement', kec: i, financing: 'aid', partner: 'us' }); for (let k = 0; k < 3; k++) m.core.step();
    const back = readSave(buildSave(makeSnapshot(m.world, m.nation), { label: 't', month: m.nation.month, geoLog: [], names: [], history: [] })).header.nation;
    expect(back.ind.list.length).toBe(m.nation.ind.list.length); expect(back.fin.loans.length).toBe(m.nation.fin.loans.length); expect(back.ind.deposits.length).toBe(m.nation.ind.deposits.length);
    expect(back.fin.loans.find(l => l.kind === 'project')!.balance).toBeCloseTo(m.nation.fin.loans.find(l => l.kind === 'project')!.balance, 0);
  });
});
void loanMonth;
