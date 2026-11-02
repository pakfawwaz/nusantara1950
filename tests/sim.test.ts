import { describe, it, expect } from 'vitest';
import { loadWorld } from './helpers';
import { SimCore, newNation } from '../src/sim/core';
import { B } from '../src/sim/balance';

const totalPop = (w: { n: number; alive: ArrayLike<number>; pop: Float64Array }): number => { let s = 0; for (let i = 0; i < w.n; i++) if (w.alive[i]) s += w.pop[i]; return s; };
const mk = () => { const world = loadWorld(); const nation = newNation(); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed()); return { world, nation, core }; };

describe('simulation accounting identities', () => {
  it('budget identity: Δcash = revenue − spending + borrowing + money creation − repayment, every month', () => {
    const { nation, core } = mk();
    nation.policy.budgetNext.defense = 6; nation.policy.budgetNext.infra = 5; nation.policy.budget = { ...nation.policy.budgetNext }; // force deficits → bonds, then money
    let sawBorrow = false, sawMoney = false;
    for (let m = 0; m < 36; m++) {
      const before = nation.cash; core.step(); const l = nation.last;
      const expected = (l.revenue - (l.revenue + l.deficit)) / 12 + (l.borrowDom + l.monetized - l.repay - l.extRepay) / 12; // = −deficit/12 + financing/12 (external principal is repaid out of cash)
      expect(nation.cash - before).toBeCloseTo(expected, -2); // within Rp 100
      expect(l.dCash / 12).toBeCloseTo(nation.cash - before, -2);
      sawBorrow ||= l.borrowDom > 0; sawMoney ||= l.monetized > 0;
    }
    expect(sawBorrow || sawMoney).toBe(true);
  });

  it('debt identity: Δdomestic debt = borrowing − repayment − inflation erosion', () => {
    const { nation, core } = mk();
    nation.policy.budgetNext.defense = 5; nation.policy.budget = { ...nation.policy.budgetNext };
    for (let m = 0; m < 30; m++) {
      const d0 = nation.debtDom, pi = nation.inflation; core.step(); const l = nation.last;
      const expected = -B.nation.domesticDebtErosion * (pi / (1 + pi)) * d0 / 12 + (l.borrowDom - l.repay) / 12;
      const got = nation.debtDom - d0;
      if (nation.debtDom > 0) expect(Math.abs(got - expected)).toBeLessThan(Math.max(1e3, Math.abs(d0) * 1e-9));
    }
  });

  it('surplus repays debt: with a lean budget debt falls, and cash only piles up above its cap once the debt is gone', () => {
    const { nation, core } = mk();
    for (const k of Object.keys(nation.policy.budgetNext) as Array<keyof typeof nation.policy.budgetNext>) nation.policy.budgetNext[k] = 0.1;
    nation.policy.budget = { ...nation.policy.budgetNext };
    const d0 = nation.debtDom; for (let m = 0; m < 24; m++) core.step();
    expect(nation.debtDom).toBeLessThanOrEqual(d0 + 1);
    expect(nation.debtDom).toBeLessThan(d0);
    if (nation.debtDom > 0) expect(nation.cash).toBeLessThanOrEqual(B.nation.cashMaxOverGdp * nation.agg.gdp * 1.02);
  });

  it('migration conserves population exactly (moves people only)', () => {
    const { world, core } = mk();
    for (let r = 0; r < 5; r++) {
      const before = totalPop(world); core.migrate(1 / 12); const after = totalPop(world);
      expect(Math.abs(after - before)).toBeLessThan(before * 1e-12);
    }
  });

  it('transmigration conserves population', () => {
    const { world, nation, core } = mk();
    nation.policy.budget.transmigration = 1.5; const before = totalPop(world); core.transmigrate(1); const after = totalPop(world);
    expect(Math.abs(after - before)).toBeLessThan(before * 1e-9);
  });

  it('population change over a month equals births − deaths (migration is net zero)', () => {
    const { world, nation, core } = mk();
    for (let m = 0; m < 6; m++) { const before = totalPop(world); core.step(); const after = totalPop(world); expect(after - before).toBeCloseTo((nation.births - nation.deaths) / 12, -1); }
  });
});
