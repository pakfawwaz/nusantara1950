import { B, interp } from './balance';
import { SECTORS, isResource } from './fields';
import { ipmFrom } from './ipm';
import type { SimWorld } from './types';

export const Y_REF = B.ref.incomePerCapitaRp;
export const sigm = (x: number): number => 1 / (1 + Math.exp(-x));
export const logit = (p: number): number => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
/** Inverse normal CDF (Acklam). */
export function normInv(p: number): number {
  const q = clamp(p, 1e-6, 1 - 1e-6);
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  if (q > 1 - 0.02425) { const r = Math.sqrt(-2 * Math.log(1 - q)); return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  const r = q - 0.5, s = r * r; return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

/** Public-service stocks are kept in Rp per person; saturation is measured against annual income (stock / income). */
export const stockSat = (stock: number, y: number, r50: number): number => { const r = stock / Math.max(2e6, y); return r / (r + r50); };
export const incomeOf = (w: SimWorld, i: number): number => w.grdp[i] / Math.max(1, w.pop[i]);
export const nonAgriShare = (w: SimWorld, i: number): number => {
  const L = w.s.lab; let t = 0; for (let s = 0; s < SECTORS; s++) t += L[i * SECTORS + s]; if (t <= 0) return 0;
  return 1 - (L[i * SECTORS] + L[i * SECTORS + 1] + L[i * SECTORS + 2] + L[i * SECTORS + 3]) / t;
};
export const workersOf = (w: SimWorld, i: number): number => { let t = 0; for (let s = 0; s < SECTORS; s++) t += w.s.lab[i * SECTORS + s]; return t; };
export const agriLabour = (w: SimWorld, i: number): number => w.s.lab[i * SECTORS] + w.s.lab[i * SECTORS + 1] + w.s.lab[i * SECTORS + 2] + w.s.lab[i * SECTORS + 3];

// ---------- social targets (all of the form f(drivers) + offset) ----------
export function lifeDrivers(w: SimWorld, i: number, year: number): number {
  const L = B.life, y = incomeOf(w, i);
  return interp(L.medicalProgress, year) + L.perLnIncome * Math.log(Math.max(1e5, y) / Y_REF) + L.healthEffect * stockSat(w.s.healthStock[i], y, B.stocks.r50.health) + L.waterEffect * w.water[i] + L.eduEffect * w.mys[i];
}
export function softCap(x: number, max: number): number { const c = max - 8; return x <= c ? x : c + (max - c) * Math.tanh((x - c) / (max - c)); }
export function tfrDrivers(w: SimWorld, i: number): number {
  const D = B.demography, y = incomeOf(w, i);
  return D.tfrBase - D.tfrEduDrop * w.mys[i] - D.tfrUrbanDrop * w.urban[i] - D.tfrIncomeDrop * Math.log(Math.max(1e5, y) / Y_REF) - D.tfrChildMortalityDrop * (w.life[i] - 40) / 10;
}
export function eysDrivers(w: SimWorld, i: number): number {
  const E = B.education, y = incomeOf(w, i); return E.perLnIncome * Math.log(Math.max(1e5, y) / Y_REF) + E.eduStockEffect * stockSat(w.s.eduStock[i], y, B.stocks.r50.edu);
}
export function accessDrivers(w: SimWorld, i: number, perLn: number, infraEff: number): number {
  const y = incomeOf(w, i); return perLn * Math.log(Math.max(1e5, y) / Y_REF) + infraEff * stockSat(w.s.infraStock[i], y, B.stocks.r50.infra);
}
export function urbanDrivers(w: SimWorld, i: number): number { const U = B.urban; return U.targetBase + U.targetNonAgriWeight * Math.pow(nonAgriShare(w, i), U.targetExponent); }
export function povertyOf(w: SimWorld, i: number): number { return normCdf(w.s.povOff[i] - Math.log(Math.max(1e5, incomeOf(w, i)) / Y_REF) / B.poverty.sigma); }
export function literacyOf(w: SimWorld, i: number): number { return 1 - Math.exp(-w.s.litK[i] * Math.pow(Math.max(0.05, w.mys[i]), 1.1)); }

// ---------- production multipliers ----------
/** Everything in the production function except TFP A_s and the labour term. mult[s] is written for s = 0..9. */
export function fillMult(w: SimWorld, i: number, gov0: number, mult: Float64Array): void {
  const Sx = B.sectors, s_ = w.s;
  const stabPen = 1 - B.stability.outputPenaltyMax * clamp((B.stability.outputPenaltyBelow - s_.stab[i]) / B.stability.outputPenaltyBelow, 0, 1);
  const gm = Math.pow(Math.max(0.2, s_.gov[i] / gov0), Sx.governanceElasticity);
  const L = workersOf(w, i); const kpw = w.capStock[i] / Math.max(1, L);
  const kr = Math.pow(Math.max(0.05, kpw / Math.max(1, s_.kpw0[i])), Sx.capitalAlpha);
  const dh = Math.exp(Sx.mincer * (w.mys[i] - s_.mys0[i]));
  const agSat = stockSat(s_.agStock[i], incomeOf(w, i), B.stocks.r50.ag);
  const maR = s_.ma[i] / Math.max(1e-6, s_.ma0[i]);
  for (let s = 0; s < SECTORS; s++) {
    let m = gm * stabPen;
    if (!isResource(s)) {
      m *= Math.pow(dh, Sx.skill[s]) * kr * Math.max(0.5, 1 + Sx.electricElasticity[s] * (w.elec[i] - s_.el0[i])) * Math.pow(maR, Sx.thetaMA[s]);
      if (s <= 3) m *= (1 + Sx.agStockElasticity * agSat) / (1 + Sx.agStockElasticity * s_.ag0[i]);
    }
    mult[s] = m;
  }
}

const tmp = new Float64Array(SECTORS);
/**
 * Make the current state the reference state for kecamatan i (used at game start and after every split / merge):
 * production baselines are normalised so output is unchanged, and every target offset is set so that target == current value.
 */
export function rebaseline(w: SimWorld, i: number, A: ArrayLike<number>, year: number, gov0: number, kbCov: number): void {
  const s_ = w.s, base = i * SECTORS; const y = incomeOf(w, i), L = workersOf(w, i);
  // seed thin non-resource sectors so any kecamatan can grow them (tiny, taken from the biggest sector)
  const minL = B.sectors.reallocation.minSectorShare * L; let big = 0; for (let s = 1; s < SECTORS; s++) if (s_.lab[base + s] > s_.lab[base + big]) big = s;
  for (let s = 0; s < SECTORS; s++) {
    if (isResource(s) || s_.lab[base + s] >= minL || L <= 0) continue;
    const need = minL - s_.lab[base + s]; s_.lab[base + s] += need; s_.lab[base + big] -= need;
    if (s_.out[base + s] <= 0) s_.out[base + s] = need * B.sectors.seedOutputPerWorkerRp[s]; // negligible: only so the sector exists
  }
  s_.mys0[i] = w.mys[i]; s_.kpw0[i] = Math.max(1, w.capStock[i] / Math.max(1, L)); s_.el0[i] = w.elec[i]; s_.ma0[i] = s_.ma[i] || 1; s_.ma[i] = s_.ma0[i];
  s_.ag0[i] = stockSat(s_.agStock[i], y, B.stocks.r50.ag);
  fillMult(w, i, gov0, tmp);
  for (let s = 0; s < SECTORS; s++) { s_.l0[base + s] = s_.lab[base + s]; s_.y0[base + s] = Math.max(0, s_.out[base + s] - s_.ind[base + s]) / Math.max(1e-9, (1 + s_.link[base + s]) * A[s] * tmp[s]); }
  s_.lifeOff[i] = w.life[i] - lifeDrivers(w, i, year);
  s_.tfrOff[i] = s_.tfr[i] / (1 - B.demography.kb.maxTfrCut * kbCov) - tfrDrivers(w, i);
  s_.eysOff[i] = logit(w.eys[i] / B.education.eysMax) - eysDrivers(w, i);
  s_.elecOff[i] = logit(w.elec[i]) - accessDrivers(w, i, B.access.elecPerLnIncome, B.access.elecInfraEffect);
  s_.waterOff[i] = logit(w.water[i]) - accessDrivers(w, i, B.access.waterPerLnIncome, B.access.waterInfraEffect);
  s_.povOff[i] = normInv(w.poverty[i]) + Math.log(Math.max(1e5, y) / Y_REF) / B.poverty.sigma;
  s_.litK[i] = -Math.log(1 - Math.min(0.999, Math.max(0.001, w.lit[i]))) / Math.pow(Math.max(0.05, w.mys[i]), 1.1);
  s_.urbOff[i] = w.urban[i] - urbanDrivers(w, i);
}

/** Recompute the derived arrays (density, income, and optionally IPM) of one kecamatan. */
export function derive(w: SimWorld, i: number, withIpm: boolean): void {
  w.density[i] = w.pop[i] / w.area[i]; w.gdppc[i] = w.grdp[i] / Math.max(1, w.pop[i]);
  if (withIpm) w.ipm[i] = ipmFrom({ lifeExpectancy: w.life[i], meanYearsSchooling: w.mys[i], expectedYearsSchooling: w.eys[i], gdpPerCapita: w.gdppc[i] }).ipm;
}
export { clamp };
