import { describe, expect, it } from 'vitest';
import { ipmFrom } from '../src/sim/ipm';

describe('IPM formula', () => {
  it('is the geometric mean of the three indices', () => {
    const r = ipmFrom({ lifeExpectancy: 52.5, meanYearsSchooling: 7.5, expectedYearsSchooling: 9, gdpPerCapita: 1 });
    expect(r.health).toBeCloseTo(0.5, 6);
    expect(r.education).toBeCloseTo(0.5, 6);
    expect(r.ipm).toBeCloseTo(Math.cbrt(r.health * r.education * r.income), 10);
  });
  it('hits 1 at all upper goalposts and 0 when any component is at its floor', () => {
    const top = ipmFrom({ lifeExpectancy: 85, meanYearsSchooling: 15, expectedYearsSchooling: 18, gdpPerCapita: 26572352 / 0.55 });
    expect(top.ipm).toBeCloseTo(1, 6);
    expect(ipmFrom({ lifeExpectancy: 20, meanYearsSchooling: 10, expectedYearsSchooling: 12, gdpPerCapita: 5e7 }).ipm).toBe(0);
  });
  it('clamps out-of-range inputs and increases monotonically in each input', () => {
    const base = { lifeExpectancy: 60, meanYearsSchooling: 5, expectedYearsSchooling: 10, gdpPerCapita: 2e7 };
    const b = ipmFrom(base).ipm;
    expect(ipmFrom({ ...base, lifeExpectancy: 70 }).ipm).toBeGreaterThan(b);
    expect(ipmFrom({ ...base, meanYearsSchooling: 8 }).ipm).toBeGreaterThan(b);
    expect(ipmFrom({ ...base, gdpPerCapita: 4e7 }).ipm).toBeGreaterThan(b);
    expect(ipmFrom({ ...base, lifeExpectancy: 200 }).health).toBe(1);
  });
  it('gives a 1950-like national value in a plausible range', () => {
    const r = ipmFrom({ lifeExpectancy: 40, meanYearsSchooling: 1.0, expectedYearsSchooling: 6.5, gdpPerCapita: 9.89e6 });
    expect(r.ipm).toBeGreaterThan(0.2); expect(r.ipm).toBeLessThan(0.4);
  });
});
