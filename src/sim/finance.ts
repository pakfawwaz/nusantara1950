import IND from '../../config/industries.json';
import { BUD, interp } from './balance';
import { B } from './balance';
import { PARTNER, partnerFactor, PARTNERS } from './industry';
import type { Loan } from './industry';
import type { Nation } from './types';

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** The opening external debt is a single legacy loan (Round Table Conference settlement). */
export function seedLegacyDebt(n: Nation, amount: number): void {
  const p = PARTNER.get('legacy');
  n.fin.loans = [{ id: n.fin.nextLoan++, partner: 'legacy', kind: 'legacy', committed: amount, drawn: amount, balance: amount, rate: p?.rate ?? B.nation.interestExternal, graceMonths: 0, maturityMonths: (p?.maturity ?? 50) * 12, start: 0, ind: -1, paidOff: 0 }];
  n.debtExt = amount;
}
/** Add a program (budget-support) loan: the cash arrives immediately. */
export function addProgramLoan(n: Nation, partnerId: string, amount: number): Loan | null {
  const p = PARTNER.get(partnerId); if (!p || amount <= 0) return null;
  const loan: Loan = { id: n.fin.nextLoan++, partner: p.id, kind: 'program', committed: amount, drawn: amount, balance: p.grant ? 0 : amount, rate: p.rate, graceMonths: p.grace * 12, maturityMonths: p.maturity * 12, start: n.month, ind: -1, paidOff: 0 };
  if (!p.grant) n.fin.loans.push(loan); n.cash += amount; n.debtExt = totalExternal(n); return loan;
}
export const totalExternal = (n: Nation): number => n.fin.loans.reduce((s, l) => s + l.balance, 0);
export const debtByCreditor = (n: Nation): Array<{ partner: string; name: string; balance: number; interest: number }> => {
  const m = new Map<string, { balance: number; interest: number }>(); for (const l of n.fin.loans) { const e = m.get(l.partner) ?? { balance: 0, interest: 0 }; e.balance += l.balance; e.interest += l.balance * l.rate; m.set(l.partner, e); }
  return [...m].map(([id, v]) => ({ partner: id, name: PARTNER.get(id)?.name ?? id, ...v })).sort((a, b) => b.balance - a.balance);
};
/** Repay part of a loan early out of cash. Returns the amount actually repaid. */
export function repayLoan(n: Nation, loanId: number, amount: number): number {
  const l = n.fin.loans.find(x => x.id === loanId); if (!l) return 0; const a = Math.min(amount, l.balance, Math.max(0, n.cash)); if (a <= 0) return 0;
  l.balance -= a; l.paidOff += a; n.cash -= a; n.debtExt = totalExternal(n); n.fin.loans = n.fin.loans.filter(x => x.balance > 1 || x.drawn < x.committed); return a;
}
/** One month of external debt service. Returns annualised interest and the principal repaid this month (money). */
export function loanMonth(n: Nation, dt: number): { interest: number; repay: number } {
  let interest = 0, repay = 0;
  for (const l of n.fin.loans) {
    interest += l.balance * l.rate; const age = n.month - l.start; if (age < l.graceMonths || l.balance <= 0) continue;
    const full = l.kind === 'project' && l.drawn < l.committed - 1; if (full) continue; // still being drawn down
    const r = Math.min(l.balance, l.drawn / Math.max(1, l.maturityMonths - l.graceMonths)); l.balance -= r; l.paidOff += r; repay += r;
  }
  void dt; n.fin.loans = n.fin.loans.filter(l => l.balance > 1 || l.drawn < l.committed || l.kind === 'legacy'); n.debtExt = totalExternal(n); return { interest, repay };
}

// ------------------------------------------------------------------ investment climate
export interface ClimateParts { [k: string]: number }
export function climateTarget(n: Nation, year: number): { value: number; parts: ClimateParts } {
  const C = IND.climate, ag = n.agg; const parts: ClimateParts = { base: C.base };
  parts.governance = C.governance * clamp(ag.gov / Math.max(1e-6, n.gov0) - 1, -0.5, 0.5) * 2;
  parts.stability = C.stability * clamp((n.stability - 60) / 40, -1, 1);
  parts.inflation = -C.inflation * clamp(n.inflation / C.inflationScale, 0, 1);
  parts.fiscalRule = n.policy.deficitRule ? C.deficitRule : 0;
  parts.investmentLaw = n.fin.fdiLaw ? C.law : 0;
  parts.openness = C.openness * (1 - n.policy.rates.customs / BUD.tax.limits.customs[1] - 0.5) * 2;
  parts.nationalisation = -C.nationalization * clamp(n.fin.nationHit, -0.2, 1.5);
  parts.debtStress = -C.debtStress * clamp((n.fin.serviceRatio - IND.debt.stressServiceOverRevenue) / IND.debt.stressServiceOverRevenue, 0, 1.5);
  parts.infrastructure = C.infrastructure * clamp(Math.log(Math.max(0.2, ag.gdppc / 1e7)) / 3, -0.5, 1);
  void year; let v = 0; for (const k of Object.keys(parts)) v += parts[k]; return { value: clamp(v, 0, 100), parts };
}
/** Monthly: alignment drifts to its target, the climate follows its target, nationalisation shocks fade. */
export function financeMonth(n: Nation, year: number, dt: number): void {
  const F = n.fin, A = IND.alignment; const d = F.alignTarget - F.align; F.align += clamp(d, -A.movePerMonth, A.movePerMonth);
  F.nationHit *= Math.pow(0.5, dt / IND.climate.nationalizationHalfLifeYears);
  const t = climateTarget(n, year); F.parts = t.parts; if (n.ev.mult.clim) F.parts = { ...t.parts, world: n.ev.mult.clim }; F.climate += (clamp(t.value + n.ev.mult.clim, 0, 100) - F.climate) * IND.climate.adjustPerMonth;
}
export const savingsClimateFactor = (n: Nation): number => 1 + IND.climate.savingsEffect * ((n.fin.climate - 50) / 50);
export const alignmentLabel = (a: number): string => (a < -0.6 ? 'Western bloc' : a < -0.2 ? 'Leaning West' : a <= 0.2 ? 'Non-aligned' : a <= 0.6 ? 'Leaning East' : 'Eastern bloc');
void interp; void partnerFactor; void PARTNERS;
