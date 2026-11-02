import ipmCfg from '../../config/ipm.json';

/** BPS "new method" IPM (HDI): geometric mean of health, education and adjusted-expenditure indices. */
export interface IpmInputs { lifeExpectancy: number; meanYearsSchooling: number; expectedYearsSchooling: number; gdpPerCapita: number }
export interface IpmResult { health: number; education: number; income: number; ipm: number }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export function ipmFrom(i: IpmInputs, cfg = ipmCfg): IpmResult {
  const g = cfg.goalposts;
  const health = clamp01((i.lifeExpectancy - g.lifeExpectancy[0]) / (g.lifeExpectancy[1] - g.lifeExpectancy[0]));
  const mys = clamp01((i.meanYearsSchooling - g.meanYearsSchooling[0]) / (g.meanYearsSchooling[1] - g.meanYearsSchooling[0]));
  const eys = clamp01((i.expectedYearsSchooling - g.expectedYearsSchooling[0]) / (g.expectedYearsSchooling[1] - g.expectedYearsSchooling[0]));
  const education = (mys + eys) / 2;
  const spend = Math.max(1, i.gdpPerCapita * cfg.spendRatio);
  const [lo, hi] = g.expenditure_rp_per_year;
  const income = clamp01((Math.log(spend) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
  const ipm = Math.cbrt(health * education * income);
  return { health, education, income, ipm };
}
