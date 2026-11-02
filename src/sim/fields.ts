/** Per-kecamatan simulation arrays (name → values per row). Every one is registered in World.rowFields so splits, merges, undo, snapshots and saves handle them uniformly. */
export const SIM_FIELDS = {
  // state
  out: 10, lab: 10, tfr: 1, eduStock: 1, healthStock: 1, infraStock: 1, agStock: 1, ma: 1,
  // baselines: reference values the production function is normalised to (reset by rebaseline() after splits / merges)
  y0: 10, l0: 10, mys0: 1, kpw0: 1, el0: 1, ma0: 1, ag0: 1,
  // offsets: target = f(drivers) + offset, set so that target == current state at baseline time
  lifeOff: 1, tfrOff: 1, eysOff: 1, elecOff: 1, waterOff: 1, povOff: 1, litK: 1, urbOff: 1,
  // results written each month (for the UI and map modes)
  stab: 1, gov: 1, fund: 1, taxC: 1, taxL: 1, tcap: 1, tprov: 1,
  // industries: extra output (not part of the production function), linkage boosts (added to 1), power added to electrification; recomputed every month
  ind: 10, link: 10, pwr: 1
} as const;
export type SimKey = keyof typeof SIM_FIELDS;
export type SimArrays = Record<SimKey, Float64Array>;
export const SIM_KEYS = Object.keys(SIM_FIELDS) as SimKey[];
export function makeSimArrays(N: number): SimArrays {
  const o = {} as SimArrays; for (const k of SIM_KEYS) o[k] = new Float64Array(N * SIM_FIELDS[k]); return o;
}
export const SECTORS = 10;
export const RESOURCE_SECTORS = [4, 5];
export const isResource = (s: number): boolean => s === 4 || s === 5;
