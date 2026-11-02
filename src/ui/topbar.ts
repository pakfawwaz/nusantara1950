import { h, $ } from './dom';
import { t } from './i18n';
import type { World } from '../world';
import type { Game } from '../game';
import { MODES } from '../map/modes';
import { MONTH_NAMES, monthOfYear, yearOf } from '../sim/balance';
import world0 from '../../config/world.json';

export type Panel = 'budget' | 'regions' | 'stats' | 'save' | 'transport' | 'industry' | 'finance' | 'events' | 'settings';
export interface TopbarApi { setMode: (id: string) => void; setUndo: (label: string | null) => void; rebuildIndex: () => void; setSpeed: (s: number) => void; update: () => void; setBadge: (n: number) => void }
export interface SearchHit { label: string; sub: string; kind: 'kec' | 'reg' | 'prov'; idx: number }
export interface TopbarHandlers { onMode: (id: string) => void; onPick: (h: SearchHit) => void; onUndo: () => void; onSpeed: (s: number) => void; onOpen: (p: Panel) => void }

const TARGET = world0.targetGdpPerCapita2026;
const ICON = { pause: '<svg viewBox="0 0 14 14"><rect x="2.5" y="2" width="3" height="10"/><rect x="8.500" y="2" width="3" height="10"/></svg>', play: (n: number) => `<svg viewBox="0 0 14 14" style="width:${8 + n * 3}px">${Array.from({ length: n }, (_, k) => `<path d="M${1 + k * 4} 2l4 5-4 5z"/>`).join('')}</svg>` };
export const dateText = (month: number): string => (month === 0 ? t('app.date') : `${MONTH_NAMES[monthOfYear(month)]} ${yearOf(month)}`);
const fmtRpJt = (v: number): string => `Rp ${(v / 1e6).toFixed(1)} jt`;
const fmtT = (v: number): string => (Math.abs(v) >= 1e12 ? `Rp ${(v / 1e12).toFixed(2)} T` : `Rp ${(v / 1e9).toFixed(1)} B`);

export function buildTopbar(world: World, game: Game, hd: TopbarHandlers): TopbarApi {
  const bar = $('topbar'), status = $('statusbar');
  const sel = h('select', { id: 'mode', 'aria-label': 'Map mode', onchange: (e: Event) => hd.onMode((e.target as HTMLSelectElement).value) }, ...MODES.map(m => h('option', { value: m.id, text: m.label })));
  const input = h('input', { id: 'search', type: 'search', placeholder: t('search.placeholder'), autocomplete: 'off', 'aria-label': 'Search' });
  const results = h('div', { id: 'results', hidden: true });
  const index: Array<SearchHit & { key: string }> = [];
  const rebuild = () => {
    index.length = 0;
    world.provinces.forEach((p, i) => index.push({ label: p.name, sub: 'Province', kind: 'prov', idx: i, key: p.name.toLowerCase() }));
    world.regencies.forEach((r, i) => index.push({ label: r.name, sub: `${r.type === 'kota' ? 'Kota' : 'Kabupaten'} · ${world.provinces[world.regProv[i]]?.name ?? ''}`, kind: 'reg', idx: i, key: r.name.toLowerCase() }));
    for (let i = 0; i < world.n; i++) if (world.alive[i]) index.push({ label: world.names[i], sub: `Kecamatan · ${world.regencies[world.kecReg[i]]?.name ?? ''}`, kind: 'kec', idx: i, key: world.names[i].toLowerCase() });
  };
  rebuild();
  let active = -1; let shown: SearchHit[] = [];
  const render = () => { results.replaceChildren(...shown.map((hit, k) => h('button', { class: k === active ? 'active' : '', type: 'button', onclick: () => choose(hit) }, h('span', { text: hit.label }), h('small', { text: hit.sub })))); results.hidden = shown.length === 0; };
  const choose = (hit: SearchHit) => { hd.onPick(hit); input.value = ''; shown = []; render(); input.blur(); };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase(); active = -1;
    if (q.length < 2) { shown = []; render(); return; }
    const starts: SearchHit[] = [], contains: SearchHit[] = [];
    for (const e of index) { if (e.key.startsWith(q)) starts.push(e); else if (e.key.includes(q)) contains.push(e); if (starts.length >= 10) break; }
    const rank = (a: SearchHit) => (a.kind === 'prov' ? 0 : a.kind === 'reg' ? 1 : 2);
    shown = [...starts.sort((a, b) => rank(a) - rank(b)), ...contains].slice(0, 12); render();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && shown.length) choose(shown[Math.max(0, active)]);
    else if (e.key === 'Escape') { shown = []; render(); input.blur(); }
  });
  document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('.field')) { shown = []; render(); } });
  const undo = h('button', { class: 'topbtn', type: 'button', text: '⟲ Undo', disabled: true, onclick: hd.onUndo });
  window.addEventListener('keydown', e => {
    const typing = (e.target as HTMLElement)?.closest?.('input,select,textarea');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); hd.onUndo(); }
    else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === ' ') { e.preventDefault(); hd.onSpeed(-1); } else if (e.key >= '1' && e.key <= '4') hd.onSpeed(Number(e.key)); else if (e.key === '0') hd.onSpeed(0);
    }
  });
  // clock
  const date = h('div', { class: 'datechip', title: 'Game date. Space = pause / resume, 1–4 = speed' });
  const speedBtns = [0, 1, 2, 3, 4].map(s => { const b = h('button', { type: 'button', 'aria-pressed': 'false', title: s === 0 ? 'Pause (Space)' : `Speed ${s} (key ${s})`, 'aria-label': s === 0 ? 'Pause' : `Speed ${s}`, onclick: () => hd.onSpeed(s) }); b.innerHTML = s === 0 ? ICON.pause : ICON.play(s); return b; });
  const speed = h('div', { class: 'speed', role: 'group', 'aria-label': 'Game speed' }, ...speedBtns);
  const btn = (id: Panel, label: string) => h('button', { class: 'topbtn', type: 'button', text: label, onclick: () => hd.onOpen(id) });
  const badge = h('span', { class: 'badge-dot', hidden: true }); const evBtn = h('button', { class: 'topbtn', type: 'button', title: 'Events, decisions and conditions (the Chronicle)', onclick: () => hd.onOpen('events') }, 'Events', badge);
  const setBtn = h('button', { class: 'topbtn', type: 'button', text: '⚙', title: 'Settings: world events mode, ways to lose, new game', 'aria-label': 'Settings', onclick: () => hd.onOpen('settings') });
  bar.append(h('div', { class: 'brand', text: t('app.title') }), date, speed, h('div', { class: 'spacer' }), undo, btn('budget', t('btn.budget')), btn('transport', t('btn.transport')), btn('industry', t('btn.industry')), btn('finance', t('btn.finance')), btn('regions', t('btn.regions')), btn('stats', t('btn.stats')), evBtn, btn('save', t('btn.save')), setBtn,
    h('label', {}, h('span', { text: 'Map ', style: 'color:#5b4d3c' }), sel), h('div', { class: 'field' }, input, results));
  // status strip
  const chip = (title: string) => { const v = h('b', { text: '' }); const el = h('div', { class: 'sb', title }, v); return { el, v, set: (txt: string, cls = '') => { v.textContent = txt; v.className = cls; } }; };
  const lab = (txt: string, c: ReturnType<typeof chip>) => { c.el.prepend(h('span', { class: 'lbl', text: txt })); return c.el; };
  const cash = chip('Treasury (central government cash)'), deficit = chip('Central budget balance last month, annualised, as % of GDP'), debt = chip('Public debt as % of GDP'), infl = chip('Annual inflation'), stab = chip('National stability, 0–100. Below 55 output suffers; below 15 for a year the republic collapses.');
  const progFill = h('i'), progTxt = h('span'); const prog = h('div', { class: 'progress', title: `Real GDP per capita (2026 prices) against the win target of ${fmtRpJt(TARGET)}` }, progFill, progTxt, h('div', { class: 'tgt' }));
  status.append(lab('Cash', cash), lab('Balance', deficit), lab('Debt', debt), prog, lab('Inflation', infl), lab('Stability', stab));
  const update = () => {
    const n = game.nation, a = n.agg, g = a.gdp || 1;
    date.textContent = dateText(n.month); speedBtns.forEach((b, s) => b.setAttribute('aria-pressed', String(s === curSpeed)));
    cash.set(fmtT(n.cash), n.cash < 0 ? 'bad-t' : '');
    const d = -n.last.deficit / g; deficit.set(`${Math.abs(d) < 0.0005 ? '±' : d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(1)}% GDP`, d < -0.04 ? 'bad-t' : d < -0.02 ? 'warn-t' : 'good-t');
    const dg = (n.debtDom + n.debtExt) / g; debt.set(`${(dg * 100).toFixed(0)}%`, dg > 0.6 ? 'bad-t' : dg > 0.4 ? 'warn-t' : '');
    infl.set(`${(n.inflation * 100).toFixed(1)}%`, n.inflation > 0.25 ? 'bad-t' : n.inflation > 0.10 ? 'warn-t' : '');
    stab.set(`${n.stability.toFixed(0)}`, n.stability < 40 ? 'bad-t' : n.stability < 55 ? 'warn-t' : 'good-t');
    const f = Math.min(1, a.gdppc / TARGET); progFill.style.width = `${(f * 100).toFixed(1)}%`; progTxt.textContent = `GDP/capita ${fmtRpJt(a.gdppc)} / ${(TARGET / 1e6).toFixed(0)} jt · ${(f * 100).toFixed(0)}%`;
  };
  let curSpeed = 0;
  return { setMode: id => { sel.value = id; }, setUndo: label => { undo.disabled = !label; undo.title = label ? `Undo: ${label} (Ctrl+Z)` : 'Nothing to undo'; }, rebuildIndex: rebuild, setBadge: k => { badge.textContent = String(k); badge.hidden = k <= 0; }, setSpeed: s => { curSpeed = s; update(); }, update };
}
