import type { World } from '../world';
import type { BudgetKey } from './balance';
import type { TransportState } from './transport';
import type { FinState, IndState, WorldPrices } from './industry';
import type { EndState, EventState, GameSettings } from './events';

/** The slice of World the simulation touches. World satisfies it; the worker builds a plain object with the same fields. */
export type SimWorld = Pick<World, 'n' | 'alive' | 'area' | 'pop' | 'grdp' | 'urban' | 'lit' | 'mys' | 'eys' | 'life' | 'poverty' | 'elec' | 'water' | 'capStock' | 'age0' | 'age65'
  | 'labelLon' | 'labelLat' | 'density' | 'gdppc' | 'ipm' | 'coastal' | 'terrain' | 'swamp' | 'roadClass' | 'railStation' | 'railPath' | 'portLevel' | 'neighbors' | 'kecReg' | 'regProv' | 'regencies' | 'provinces' | 's'>;

export type Rates = { pph: number; ppn: number; excise: number; customs: number };
export interface Policy {
  rates: Rates;
  budget: Record<BudgetKey, number>;      // % of GDP, in force this fiscal year
  budgetNext: Record<BudgetKey, number>;  // draft for the next fiscal year (opens in October)
  revisionYear: number;                   // year of the one mid-year APBN-P (0 = unused)
  devPreset: string;                      // default allocation of local development money
  provPreset: Record<string, string>;     // per-province override
  deficitRule: boolean;
}
export interface Flows {
  gdp: number; revenue: number; taxes: Record<string, number>; pad: number; spending: Record<string, number>; interest: number; transfers: { dau: number; dbh: number; dak: number };
  deficit: number; borrowDom: number; monetized: number; repay: number; dCash: number; admin: number; localFund: number; extRepay: number; extInterest: number; soe: number;
}
export interface Series {
  t: number[]; pop: number[]; gdp: number[]; gdppc: number[]; ipm: number[]; life: number[]; mys: number[]; eys: number[]; literacy: number[]; poverty: number[]; urban: number[]; agriShare: number[];
  inflation: number[]; stability: number[]; cash: number[]; debtGdp: number[]; revenueGdp: number[]; spendingGdp: number[]; deficitGdp: number[]; tfr: number[]; births: number[]; deaths: number[];
}
export interface Nation {
  month: number; cash: number; debtDom: number; debtExt: number;
  inflation: number; priceIndex: number; stability: number; adminHits: number; kbCov: number; gov0: number;
  tfp: number[];                 // sector productivity indices A_s(t)
  policy: Policy;
  agg: { pop: number; gdp: number; gdppc: number; eduSat: number; mys: number; life: number; ipm: number; gov: number; fund: number; ineq: number; poverty: number; urban: number; tfr: number; eys: number; lit: number };
  ipmPrev: number; dIpm: number;
  last: Flows;
  series: Series;
  flags: { hyper: boolean; collapse: boolean };
  births: number; deaths: number; // last 12 months running (annualised from the last month)
  notices: string[];
  transport: TransportState;
  ind: IndState; fin: FinState; prices: WorldPrices; settings: GameSettings; ev: EventState; end: EndState;
}
/** Per-regency / per-province results of the latest month (index = array index in world.regencies / world.provinces). */
export interface UnitStats { regFund: Float64Array; regOp: Float64Array; regPad: Float64Array; regDbh: Float64Array; regDau: Float64Array; regDak: Float64Array; regGov: Float64Array; regStab: Float64Array; regPop: Float64Array;
  provFund: Float64Array; provOp: Float64Array; provDau: Float64Array; provPad: Float64Array; provPop: Float64Array; provGov: Float64Array }
