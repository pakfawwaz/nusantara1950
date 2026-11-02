import balanceJson from '../../config/balance.json';
import budgetJson from '../../config/budget.json';
import historicalJson from '../../config/historical.json';

/** All simulation coefficients live in /config (balance.json, budget.json, historical.json); this module is the single typed entry point. */
export const B = balanceJson;
export const BUD = budgetJson;
export const HIST = historicalJson;
export type BudgetKey = keyof typeof budgetJson.defaultBudgetPctGdp;
export const BUDGET_KEYS = Object.keys(budgetJson.defaultBudgetPctGdp) as BudgetKey[];

/** Piecewise-linear interpolation in a [[x, y], …] table (clamped at both ends). */
export function interp(table: ReadonlyArray<ReadonlyArray<number>>, x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) if (x <= table[k][0]) { const [x0, y0] = table[k - 1], [x1, y1] = table[k]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return table[table.length - 1][1];
}
export const yearOf = (month: number): number => 1950 + Math.floor((B.calendar.startMonth - 1 + month) / 12);
/** 0 = January … 11 = December */
export const monthOfYear = (month: number): number => (B.calendar.startMonth - 1 + month) % 12;
export const yearFrac = (month: number): number => 1950 + (B.calendar.startMonth - 1 + month + 0.5) / 12;
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
