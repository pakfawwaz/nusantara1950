import { h } from './dom';
import { openPanel, fmtT, pctf } from './panel';
import type { Game } from '../game';
import type { World } from '../world';
import { fmtPop } from '../map/modes';

interface Row { k: number; name: string; prov: string; kec: number; pop: number; gdppc: number; ipm: number; fund: number; stab: number; op: number; dau: number; tax: number; status: string }
const COLS: Array<{ key: keyof Row; label: string; l?: boolean; fmt: (r: Row) => string }> = [
  { key: 'name', label: 'Regency', l: true, fmt: r => r.name }, { key: 'prov', label: 'Province', l: true, fmt: r => r.prov }, { key: 'kec', label: 'Kec.', fmt: r => String(r.kec) },
  { key: 'pop', label: 'Population', fmt: r => fmtPop(r.pop) }, { key: 'gdppc', label: 'GRDP / cap', fmt: r => `${(r.gdppc / 1e6).toFixed(1)} jt` }, { key: 'ipm', label: 'IPM', fmt: r => r.ipm.toFixed(3) },
  { key: 'fund', label: 'Funding', fmt: r => pctf(r.fund, 0) }, { key: 'stab', label: 'Stability', fmt: r => r.stab.toFixed(0) }, { key: 'op', label: 'Running cost', fmt: r => fmtT(r.op) }, { key: 'dau', label: 'DAU received', fmt: r => fmtT(r.dau) }, { key: 'tax', label: 'Taxes raised', fmt: r => fmtT(r.tax) }
];
/** Sortable table of every regency, with the live budget numbers. Clicking a row selects it on the map. */
export function openRegions(game: Game, world: World, onPick: (k: number) => void): void {
  openPanel('Regions', 'wide', (body, close) => {
    const st = game.stats; let sortKey: keyof Row = 'pop', dir = -1, filter = '';
    const rows: Row[] = [];
    world.regencies.forEach((r, k) => {
      const p = world.provinces[world.regProv[k]]; if (!p || p.locked) return; let pop = 0, g = 0, ipm = 0, tax = 0;
      for (const i of r.kec) { pop += world.pop[i]; g += world.grdp[i]; ipm += world.ipm[i] * world.pop[i]; tax += world.s.taxC[i] + world.s.taxL[i]; }
      rows.push({ k, name: r.name, prov: p.name, kec: r.kec.length, pop, gdppc: g / Math.max(1, pop), ipm: ipm / Math.max(1, pop), fund: st?.regFund[k] ?? 1, stab: st?.regStab[k] ?? 66, op: st?.regOp[k] ?? 0, dau: st?.regDau[k] ?? 0, tax, status: r.status });
    });
    const input = h('input', { type: 'search', placeholder: 'Filter by regency or province…', style: 'height:30px;width:280px;border:1px solid var(--line);border-radius:6px;padding:0 10px;font:inherit' });
    const head = h('tr'); const tb = h('tbody'); const count = h('span', { class: 'dim' });
    const draw = () => {
      const f = filter.toLowerCase(); const list = rows.filter(r => !f || r.name.toLowerCase().includes(f) || r.prov.toLowerCase().includes(f)).sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * dir; });
      tb.replaceChildren(...list.map(r => { const tr = h('tr', { title: r.status === 'preparing' ? 'In persiapan (preparation period)' : 'Click to select on the map' }, ...COLS.map(c => h('td', { class: c.l ? 'l' : '', text: c.fmt(r) + (c.key === 'name' && r.status === 'preparing' ? ' (persiapan)' : '') }))); const fund = tr.children[6] as HTMLElement; if (r.fund < 0.85) fund.className = r.fund < 0.6 ? 'bad-t' : 'warn-t'; tr.addEventListener('click', () => { onPick(r.k); close(); }); return tr; }));
      count.textContent = `${list.length} of ${rows.length} regencies`;
    };
    COLS.forEach(c => head.append(h('th', { class: c.l ? 'l' : '', text: c.label, onclick: () => { if (sortKey === c.key) dir = -dir; else { sortKey = c.key; dir = c.l ? 1 : -1; } draw(); } })));
    input.addEventListener('input', () => { filter = input.value; draw(); });
    body.append(h('div', { style: 'display:flex;gap:12px;align-items:center;margin:6px 0' }, input, count), h('div', { class: 'tablewrap' }, h('table', { class: 't' }, h('thead', {}, head), tb)));
    draw(); input.focus();
  });
}
