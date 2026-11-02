import { h } from './dom';
import { toast, fmtMoney } from './modal';
import { openPanel, fmtT, pctf } from './panel';
import type { Game } from '../game';
import { aidOffers, IC, PARTNERS, partnerFactor, PARTNER } from '../sim/industry';
import { alignmentLabel, debtByCreditor } from '../sim/finance';
import { yearOf } from '../sim/balance';

const PART_LABEL: Record<string, string> = { base: 'Baseline', governance: 'Governance (state capacity)', stability: 'Political stability', inflation: 'Inflation', fiscalRule: 'Fiscal rule (3% cap)', investmentLaw: 'Foreign investment law', openness: 'Openness (customs rates)', nationalisation: 'Nationalisations (fading)', debtStress: 'Debt-service stress', infrastructure: 'Income level / infrastructure' };

/** Debt by creditor, aid partners and what they offer at your alignment, the investment climate and what drives it. */
export function openFinance(game: Game): void {
  openPanel('Finance & Debt', 'wide', body => {
    const root = h('div'); body.append(root);
    const render = () => {
      const n = game.nation, F = n.fin, year = yearOf(n.month), gdp = Math.max(1, n.agg.gdp); root.replaceChildren();
      const cell = (k: string, v: string, tip = '') => h('div', { class: 'cell', title: tip }, h('small', { text: k }), h('b', { text: v }));
      root.append(h('div', { class: 'kv2' }, cell('Total debt', pctf((n.debtDom + n.debtExt) / gdp, 0) + ' of GDP', `Domestic ${fmtT(n.debtDom)}, external ${fmtT(n.debtExt)}`), cell('Domestic', fmtT(n.debtDom)), cell('External', fmtT(n.debtExt)),
        cell('Debt service', pctf(F.serviceRatio, 0) + ' of revenue', 'Interest on all debt plus external principal repaid, as a share of central revenue. Above ~35% investors worry.'), cell('Investment climate', `${Math.round(F.climate)} / 100`, 'Drives private saving and what investors offer'),
        cell('Alignment', alignmentLabel(F.align)), cell('Foreign share of output', pctf(F.foreignVaShare, 2) + ' of GDP', 'Value added by foreign-owned industry; weighs on stability (nationalism)'), cell('Profits sent abroad', fmtT(F.repatriated) + '/yr')));
      // climate
      const parts = Object.entries(F.parts); const bars = h('div', {});
      for (const [k, v] of parts) { const pct = Math.min(50, Math.abs(v) * 2); bars.append(h('div', { class: 'climbar' }, h('span', { class: 'n', text: PART_LABEL[k] ?? k }), h('div', { class: 'track' }, h('i', { style: `${v >= 0 ? `left:50%;background:#2d6f68` : `right:50%;background:#8c2f2b`};width:${pct}%` })), h('span', { text: `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`, style: 'width:42px;text-align:right' }))); }
      const lawBtn = h('button', { class: 'btn small', type: 'button', text: F.fdiLaw ? 'In force' : `Enact (from ${IC.fdi.openLawYear})`, disabled: F.fdiLaw || year < IC.fdi.openLawYear, title: 'Opens most industries to foreign investors and lifts the investment climate', onclick: async () => { const r = await game.enactInvestmentLaw(); toast(r.ok ? 'Foreign investment law enacted.' : r.error ?? 'Not possible', !r.ok); render(); } });
      root.append(h('h4', { text: 'Investment climate' }), h('p', { class: 'dim', text: 'Climate follows its drivers with a lag. It lifts private saving and decides which foreign-investment proposals you receive (more climate → smaller foreign stake, shorter tax holiday).' }), bars, h('div', { style: 'margin:8px 0' }, h('b', { text: 'Foreign investment law: ' }), lawBtn));
      // alignment
      const sl = h('input', { type: 'range', class: 'slider', min: '-1', max: '1', step: '0.05', value: String(F.alignTarget), 'aria-label': 'Foreign alignment' }) as HTMLInputElement; const lab = h('span', { text: `${alignmentLabel(F.alignTarget)} (${F.alignTarget.toFixed(2)})` });
      sl.addEventListener('input', () => { lab.textContent = `${alignmentLabel(Number(sl.value))} (${Number(sl.value).toFixed(2)})`; }); sl.addEventListener('change', async () => { await game.setAlignment(Number(sl.value)); render(); });
      root.append(h('h4', { text: 'Foreign alignment' }), h('p', { class: 'dim', text: `Western ← → Eastern. It drifts toward your setting by about ${Math.round(IC.alignment.movePerMonth * 12 * 100)} points a year. It decides which partners lend (below), and investors leave a government closer to the Eastern bloc than 0.6. Now at ${F.align.toFixed(2)}.` }), h('div', { style: 'display:flex;gap:10px;align-items:center' }, h('span', { text: 'West' }), sl, h('span', { text: 'East' })), h('div', { text: '' }, lab));
      // partners
      const offers = aidOffers(n, year, gdp); const pt = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Partner', 'Available', 'Rate', 'Grace / term', 'Terms', 'Budget support', ''].map((c, k) => h('th', { class: k === 0 ? 'l' : '', text: c })))));
      const pb = h('tbody'); for (const p of PARTNERS.filter(q => q.id !== 'legacy')) {
        const f = partnerFactor(n, p, year), o = offers.find(q => q.partner.id === p.id); const inp = h('input', { type: 'number', min: '0', step: '10', value: '0', style: 'width:80px', 'aria-label': `Amount from ${p.name} in Rp billion` }) as HTMLInputElement;
        const draw = h('button', { class: 'btn small', type: 'button', text: 'Draw', disabled: !o || o.remaining <= 0, onclick: async () => { const r = await game.takeProgramLoan(p.id, Number(inp.value) * 1e9); toast(r.ok ? r.summary ?? 'Done' : r.error ?? 'Not possible', !r.ok); render(); } });
        pb.append(h('tr', { style: `cursor:default;${o ? '' : 'opacity:.5'}` }, h('td', { class: 'l', text: p.name, title: `${p.from}–${p.to > 2060 ? 'now' : p.to}` }), h('td', { text: o ? `${fmtT(o.remaining)} / yr` : year < p.from ? `from ${p.from}` : year > p.to ? 'ended' : `none at this alignment (${Math.round(f * 100)}%)` }),
          h('td', { text: p.grant ? 'grant' : pctf(p.rate, 1) }), h('td', { text: p.grant ? '—' : `${p.grace} / ${p.maturity} y` }), h('td', { text: [p.tied ? `tied ${Math.round(p.tied * 100)}%` : '', p.conditional ? 'conditional' : ''].filter(Boolean).join(', ') || 'untied' }), h('td', {}, inp, document.createTextNode(' Rp B')), h('td', {}, draw)));
      } pt.append(pb);
      root.append(h('h4', { text: 'Aid partners' }), h('p', { class: 'dim', text: 'Each partner has a yearly lending quota that grows with your economy and shrinks as your alignment moves away from its bloc. Quotas are shared between project loans (Industry tool) and budget support drawn here.' }), h('div', { class: 'tablewrap' }, pt));
      // loans
      const lt = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Creditor', 'Kind', 'Balance', 'Rate', 'Ends', ''].map((c, k) => h('th', { class: k < 2 ? 'l' : '', text: c })))));
      const lb = h('tbody'); for (const l of F.loans.slice().sort((a, b) => b.balance - a.balance)) {
        const endYear = Math.round(1950 + (l.start + l.maturityMonths) / 12); const acts = [h('button', { class: 'btn small', type: 'button', text: 'Repay 10%', onclick: async () => { const r = await game.repayLoanEarly(l.id, l.balance * 0.1); toast(r > 0 ? `Repaid ${fmtMoney(r)}` : 'No cash to repay with', r <= 0); render(); } }), h('button', { class: 'btn small', type: 'button', text: 'Repay all', onclick: async () => { const r = await game.repayLoanEarly(l.id, l.balance); toast(r > 0 ? `Repaid ${fmtMoney(r)}` : 'No cash to repay with', r <= 0); render(); } })];
        lb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: PARTNER.get(l.partner)?.name ?? l.partner }), h('td', { class: 'l', text: l.kind === 'legacy' ? 'legacy' : l.kind === 'program' ? 'budget support' : 'project loan' }), h('td', { text: fmtT(l.balance) }), h('td', { text: pctf(l.rate, 1) }), h('td', { text: String(endYear) }), h('td', {}, ...acts)));
      } lt.append(lb);
      const byC = debtByCreditor(n);
      root.append(h('h4', { text: 'External debt by creditor' }), h('p', { class: 'dim', text: byC.length ? `${byC.map(c => `${c.name.split(' (')[0]} ${fmtT(c.balance)}`).join(' · ')}. Interest ${fmtT(F.extInterest)}/yr, principal ${fmtT(F.extRepay)}/yr.` : 'No external debt.' }), h('div', { class: 'tablewrap' }, lt));
    };
    render(); const id = window.setInterval(() => { if (document.body.contains(root) && !root.contains(document.activeElement)) render(); }, 4000); return () => clearInterval(id);
  });
}
