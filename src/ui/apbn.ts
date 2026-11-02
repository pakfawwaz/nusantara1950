import { h } from './dom';
import { openPanel, fmtT, pctf } from './panel';
import { toast } from './modal';
import type { Game } from '../game';
import type { SimClient } from '../sim/client';
import { BUD, BUDGET_KEYS, monthOfYear, yearOf } from '../sim/balance';
import type { BudgetKey } from '../sim/balance';
import type { Rates } from '../sim/types';

const LABEL: Record<BudgetKey, [string, string]> = {
  centralOps: ['Central administration', 'Ministries, civil service, the state apparatus. Below the legal minimum, stability falls.'],
  defense: ['Defence & security', 'Army, police, internal security. Below the minimum stability falls; more buys a little calm.'],
  education: ['Education', 'Builds the education stock: schools, teachers. Raises schooling, literacy, productivity and lowers fertility.'],
  health: ['Health', 'Builds the health stock: clinics, vaccination. Raises life expectancy and the number of people surviving to work.'],
  infra: ['Infrastructure (electricity, water, local roads)', 'Builds the infrastructure stock: electrification and clean water. Roads, rail and ports are built as projects (Road / Rail / Port tools) and kept up by the maintenance line.'],
  subsidies: ['Subsidies (food, fuel, fertiliser)', 'Calms the population; a quarter goes to farm inputs and raises agricultural output.'],
  dak: ['DAK special allocation to regencies', 'Earmarked development money, shared by need; regencies spend it by their development preset.'],
  rnd: ['Research & technology', 'Raises the speed of productivity growth in every sector.'],
  kb: ['Family planning (KB)', 'Available from 1968. Lowers fertility with falling-but-real delay.'],
  transmigration: ['Transmigration', 'Moves people from crowded kecamatan to empty land. Costs about Rp 25 million per person.'],
  exploration: ['Resource exploration', 'Searches for undiscovered oil, gas, coal and minerals. Spending is shared among deposits that could be found now, favouring the larger and the ones nearest their historical discovery date; a found deposit can be developed as an industry project.'],
  maintenance: ['Road, rail & port maintenance', 'Keeps roads, railways and ports in condition. Exactly the required amount holds condition steady; less lets the network wear out (slower trips); more rehabilitates it.']
};
const TAXES: Array<[keyof Rates, string]> = [['pph', 'Income & profit tax (PPh) rate'], ['ppn', 'VAT / sales tax rate'], ['excise', 'Excise rate'], ['customs', 'Customs duty rate']];
const PRESETS = [['balanced', 'Balanced'], ['education', 'Education first'], ['health', 'Health first'], ['infrastructure', 'Infrastructure first'], ['agriculture', 'Agriculture first']];

export function openBudget(game: Game, sim: SimClient): void {
  openPanel('APBN — national budget', 'wide', (body, close) => {
    const n = game.nation, pol = n.policy, year = yearOf(n.month), moy = monthOfYear(n.month);
    const draft = { budget: { ...pol.budgetNext }, rates: { ...pol.rates }, devPreset: pol.devPreset, provPreset: { ...pol.provPreset }, deficitRule: pol.deficitRule };
    const L = n.last, gdp = n.agg.gdp || 1;
    const canRevise = moy >= 5 && moy <= 8 && pol.revisionYear !== year;
    body.append(h('p', { class: 'intro', text: `Fiscal year = calendar year. The budget you set takes effect on 1 January ${year + 1}. One mid-year revision (APBN-P) is allowed each year between June and September. Tax rates and the development preset change immediately when you adopt them. All money is in 2026 prices.` }));
    const nums: Array<() => void> = []; const summary = h('div', { class: 'cost' });
    const refresh = () => { nums.forEach(f => f()); };
    // revenue column
    const rev = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', { class: 'l', text: 'Revenue (annualised, last month)' }), h('th', { text: 'Rp / yr' }), h('th', { text: '% GDP' }))));
    const rb = h('tbody'); const row = (a: string, v: number) => rb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: a }), h('td', { text: fmtT(v) }), h('td', { text: pctf(v / gdp) })));
    const T = L.taxes as Record<string, number>;
    row('Income & profit tax (PPh)', T.pph ?? 0); row(game.month >= (BUD.tax.vatUnlockYear - 1950) * 12 ? 'VAT (PPN)' : 'Sales tax', T.ppn ?? 0); row('Excise', T.excise ?? 0); row('Customs', T.customs ?? 0); row('Oil & gas share', T.oilgas ?? 0); row('Mining & forestry royalties', T.royalties ?? 0); row('Railway fares & freight', T.rail ?? 0);
    rb.append(h('tr', { class: 'tot' }, h('td', { class: 'l', text: 'Central revenue' }), h('td', { text: fmtT(L.revenue) }), h('td', { text: pctf(L.revenue / gdp) })));
    rb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: 'Regional taxes (PAD), kept locally' }), h('td', { text: fmtT(L.pad) }), h('td', { text: pctf(L.pad / gdp) })));
    rev.append(rb);
    const taxForm = h('div', { class: 'form' });
    for (const [k, label] of TAXES) {
      const [lo, hi] = BUD.tax.limits[k]; const inp = h('input', { class: 'numin', type: 'number', min: String(lo * 100), max: String(hi * 100), step: '0.5', value: (draft.rates[k] * 100).toFixed(1) });
      const mark = () => inp.classList.toggle('changed', Math.abs(draft.rates[k] - pol.rates[k]) > 1e-9);
      inp.addEventListener('input', () => { draft.rates[k] = Math.min(hi, Math.max(lo, Number(inp.value) / 100 || 0)); mark(); });
      taxForm.append(h('label', { class: 'fld', style: 'grid-template-columns:1fr auto;align-items:center' }, h('span', { text: `${label} (%)` }), inp));
    }
    taxForm.append(h('div', { class: 'dim', text: `Higher rates raise revenue per unit but invite avoidance (reference ${Object.entries(BUD.tax.refRates).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(', ')}) and discourage saving when total burden passes 20% of GDP.` }));
    // spending
    const sp = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', { class: 'l', text: 'Spending line' }), h('th', { text: 'In force' }), h('th', { text: 'Next FY, %GDP' }), h('th', { text: 'Rp / yr' }))));
    const sb = h('tbody');
    for (const key of BUDGET_KEYS) {
      const [label, tip0] = LABEL[key]; const tip = key === 'maintenance' ? `${tip0} Needed now: ${fmtT(n.transport.required.road + n.transport.required.rail + n.transport.required.port)}/yr (${pctf((n.transport.required.road + n.transport.required.rail + n.transport.required.port) / gdp, 2)} of GDP).` : tip0; const locked = key === 'kb' && year < BUD.categoryUnlockYear.kb; const inp = h('input', { class: 'numin', type: 'number', min: '0', max: '12', step: '0.05', value: draft.budget[key].toFixed(2), disabled: locked });
      const amt = h('td', { text: '' }); const mark = () => inp.classList.toggle('changed', Math.abs(draft.budget[key] - pol.budgetNext[key]) > 1e-9);
      const upd = () => { amt.textContent = fmtT((draft.budget[key] / 100) * gdp); }; nums.push(upd); upd();
      inp.addEventListener('input', () => { draft.budget[key] = Math.min(12, Math.max(0, Number(inp.value) || 0)); mark(); refresh(); sum(); });
      sb.append(h('tr', { title: tip, style: 'cursor:help' }, h('td', { class: 'l', text: label + (locked ? ` (from ${BUD.categoryUnlockYear.kb})` : '') }), h('td', { text: `${pol.budget[key].toFixed(2)}%` }), h('td', {}, inp), amt));
    }
    const fixedRow = (a: string, v: number) => sb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: a }), h('td', { text: pctf(v / gdp, 2) }), h('td', { class: 'dim', text: 'automatic' }), h('td', { text: fmtT(v) })));
    fixedRow('Transfers to regions (DAU + DBH)', L.transfers.dau + L.transfers.dbh); fixedRow('Debt service', L.interest); fixedRow('Construction projects (under way)', (L.spending as Record<string, number>).construction ?? 0); fixedRow('Railway operations', (L.spending as Record<string, number>).railOps ?? 0); fixedRow('Industry projects (under way)', (L.spending as Record<string, number>).industry ?? 0); fixedRow('Disaster relief', (L.spending as Record<string, number>).disaster ?? 0);
    sp.append(sb);
    const sum = () => {
      const sp = L.spending as Record<string, number>; const plan = BUDGET_KEYS.reduce((s, k) => s + (draft.budget[k] / 100) * gdp, 0) + L.transfers.dau + L.transfers.dbh + L.interest + (sp.construction ?? 0) + (sp.railOps ?? 0) + (sp.industry ?? 0) + (sp.disaster ?? 0); const bal = L.revenue - plan;
      summary.textContent = `Next-year plan at today's GDP: spending ${fmtT(plan)} (${pctf(plan / gdp)}) vs revenue ${fmtT(L.revenue)} (${pctf(L.revenue / gdp)}) → ${bal >= 0 ? 'surplus' : 'deficit'} ${fmtT(Math.abs(bal))} (${pctf(Math.abs(bal) / gdp)} of GDP). ${bal < -0.01 * gdp ? 'A deficit is financed by domestic bonds first, then by printing money (inflation).' : ''}`;
      summary.className = `cost ${bal < -0.03 * gdp ? 'bad-t' : ''}`;
    };
    sum();
    // development presets
    const presetSel = (value: string, on: (v: string) => void, withDefault = false) => { const s = h('select', {}); if (withDefault) s.append(h('option', { value: '', text: 'Use national default' })); for (const [v, l] of PRESETS) s.append(h('option', { value: v, text: l })); s.value = value; s.addEventListener('change', () => on(s.value)); return s; };
    const nat = presetSel(draft.devPreset, v => { draft.devPreset = v; });
    const provs = h('details', {}, h('summary', { text: 'Override per province' }), ...game.world.provinces.filter(p => !p.locked).map(p => h('label', { class: 'fld', style: 'grid-template-columns:1fr 1fr;align-items:center;margin:4px 0' }, h('span', { text: p.name }), presetSel(draft.provPreset[p.id] ?? '', v => { if (v) draft.provPreset[p.id] = v; else delete draft.provPreset[p.id]; }, true))));
    const rule = h('input', { type: 'checkbox' }); rule.checked = draft.deficitRule; rule.addEventListener('change', () => { draft.deficitRule = rule.checked; });
    const adopt = async (immediate: boolean) => {
      await game.gate(); const p = game.nation.policy;
      p.rates = { ...draft.rates }; p.budgetNext = { ...draft.budget }; p.devPreset = draft.devPreset; p.provPreset = { ...draft.provPreset }; p.deficitRule = draft.deficitRule;
      if (immediate) { p.budget = { ...draft.budget }; p.revisionYear = year; }
      await sim.push(); toast(immediate ? 'APBN-P adopted: the revised budget is in force now.' : `Budget adopted for ${year + 1}; rates and presets apply now.`); close();
    };
    body.append(h('div', { class: 'cols2' }, h('div', {}, h('div', { class: 'tablewrap' }, sp), summary), h('div', {}, h('div', { class: 'tablewrap' }, rev), h('h4', { text: 'Taxes' }), taxForm,
      h('h4', { text: 'Local development money' }), h('p', { class: 'dim', style: 'margin:0 0 6px', text: 'What regencies and provinces spend after paying their own running costs (plus DAK) is split by this preset.' }), h('label', { class: 'fld' }, h('span', { text: 'National preset' }), nat), provs,
      h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px', title: 'Automatically scales discretionary lines down when the deficit would pass 3% of GDP' }, rule, h('span', { text: 'Fiscal rule: cap the deficit at 3% of GDP' })))));
    body.append(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: close }),
      h('button', { class: 'btn', type: 'button', text: 'Apply revision now (APBN-P)', disabled: !canRevise, title: canRevise ? 'One per year, June–September' : pol.revisionYear === year ? 'Already used this year' : 'Only June to September', onclick: () => void adopt(true) }),
      h('button', { class: 'btn primary', type: 'button', text: `Adopt for ${year + 1}`, onclick: () => void adopt(false) })));
  });
}
