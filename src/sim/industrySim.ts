import IND from '../../config/industries.json';
import { costIndex } from './transport';
import { TYPE, PARTNER, foreignShareNow, industryRows } from './industry';
import type { Deposit, Industry } from './industry';
import type { Nation, SimWorld } from './types';

export interface IndMonth { outlay: number; soe: number; relief: number; foreignProfit: number; completed: Industry[]; revealed: Deposit[] }

/** Exploration: spending (annualised Rp) is shared among deposits that could plausibly be found now, weighted by size and closeness to their historical discovery date. */
function explore(n: Nation, year: number, dt: number, expAnn: number): Deposit[] {
  const out: Deposit[] = []; const E = IND.exploration;
  const open = n.ind.deposits.filter(d => !d.revealed && year >= d.knownYear - E.windowYears);
  for (const d of open) if (n.settings.historical && year >= d.knownYear) { d.revealed = true; d.revealedMonth = n.month; out.push(d); }
  const pool = open.filter(d => !d.revealed); const spend = expAnn * dt;
  if (spend > 0 && pool.length) {
    const wts = pool.map(d => d.size * Math.exp(-Math.max(0, d.knownYear - year) / 20)); const tot = wts.reduce((a, b) => a + b, 0) || 1;
    pool.forEach((d, k) => { d.progress += (spend * wts[k] / tot) / (E.costPerSizeRp * d.size * costIndex(year)); if (d.progress >= 1) { d.revealed = true; d.revealedMonth = n.month; out.push(d); } });
  }
  return out;
}

/** One month of industry projects, profits and exploration. All money flows are annualised like the rest of the fiscal step. */
export function industryMonth(w: SimWorld, n: Nation, year: number, dt: number, expAnn: number): IndMonth {
  const res: IndMonth = { outlay: 0, soe: 0, relief: 0, foreignProfit: 0, completed: [], revealed: [] };
  for (const x of n.ind.list) {
    const t = TYPE.get(x.type); if (!t) continue;
    if (x.status === 'building' && !x.paused) {
      const step = x.cost / x.months; x.progress += 1; x.paid += step;
      if (x.financing === 'apbn') res.outlay += step / dt;
      else if (x.financing === 'aid') { const l = n.fin.loans.find(q => q.id === x.terms.loan); if (l) { l.drawn += step; l.balance += step; } }
      if (x.progress >= x.months) {
        x.status = 'running'; x.done = n.month + 1; res.completed.push(x);
        const boost = x.financing === 'fdi' ? 1 + 2 * x.terms.local : 1; for (const [s, b] of t.tfp ?? []) n.tfp[s] *= 1 + b * boost;
      }
    } else if (x.status === 'running') {
      const f = foreignShareNow(x, n.month); if (f !== x.foreign) { x.priv += 0; x.state = 1 - f - x.priv; x.foreign = f; }
      res.soe += x.profit * x.state * IND.state.profitToBudget; res.foreignProfit += x.profit * x.foreign;
      if (x.financing === 'fdi' && n.month < x.done + x.terms.holiday * 12) res.relief += x.va * x.foreign * IND.state.holidayTaxRate;
    }
  }
  // loans of finished aid projects stop drawing (the cost was fixed in advance)
  for (const l of n.fin.loans) if (l.kind === 'project') { const x = n.ind.list.find(q => q.id === l.ind); if (x && x.status === 'running' && l.committed !== l.drawn) l.committed = l.drawn; if (!x && l.committed !== l.drawn) l.committed = l.drawn; }
  res.revealed = explore(n, year, dt, expAnn);
  void PARTNER; void industryRows; void w; return res;
}
/** Cancel a project that is still being built: what was spent is lost; the deposit becomes available again. */
export function cancelIndustry(n: Nation, id: number): boolean {
  const x = n.ind.list.find(q => q.id === id); if (!x || x.status !== 'building') return false;
  const d = n.ind.deposits.find(q => q.id === x.deposit); if (d) d.developed = false; const l = n.fin.loans.find(q => q.id === x.terms.loan); if (l) l.committed = l.drawn;
  n.ind.list = n.ind.list.filter(q => q.id !== id); return true;
}
