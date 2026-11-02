import { h } from './dom';
import type { Game } from '../game';
import type { Command, Preview } from '../admin/types';

let toastTimer = 0;
export function toast(msg: string, bad = false): void {
  let el = document.getElementById('toast'); if (!el) { el = h('div', { id: 'toast', role: 'status' }); document.getElementById('app')?.append(el); }
  el.textContent = msg; el.className = bad ? 'bad show' : 'show'; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el?.classList.remove('show'), 4200);
}
export const fmtMoney = (v: number): string => (Math.abs(v) >= 1e12 ? `Rp ${(v / 1e12).toFixed(2)} T` : `Rp ${(v / 1e9).toFixed(1)} B`);

export interface DialogSpec {
  title: string; confirm: string; intro?: string;
  /** Add form controls to `form`; call `changed()` whenever an input changes. */
  build(form: HTMLElement, changed: () => void): void;
  command(): Command | null;
  onPreview?(p: Preview | null): void;
  onClose?(): void;
}
/** Generic "preview → confirm" dialog: every admin action shows rule checks, cost and timing before it is applied. */
export function openCommandDialog(game: Game, spec: DialogSpec): void {
  const back = h('div', { class: 'modal-back' }); const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': spec.title });
  const form = h('div', { class: 'form' }); const out = h('div', { class: 'preview' });
  const ok = h('button', { class: 'btn primary', type: 'button', text: spec.confirm, disabled: true });
  const cancel = h('button', { class: 'btn', type: 'button', text: 'Cancel' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); spec.onPreview?.(null); spec.onClose?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.append(h('h3', { text: spec.title }));
  if (spec.intro) box.append(h('p', { class: 'intro', text: spec.intro }));
  box.append(form, out, h('div', { class: 'actions' }, cancel, ok)); back.append(box);
  document.getElementById('app')?.append(back);
  let seq = 0; let last: Preview | null = null; let timer = 0;
  const run = async () => {
    const my = ++seq; const cmd = spec.command();
    if (!cmd) { out.replaceChildren(h('div', { class: 'dim', text: 'Fill in the form to see the checks.' })); ok.disabled = true; spec.onPreview?.(null); return; }
    const p = await game.preview(cmd); if (my !== seq) return; last = p; spec.onPreview?.(p);
    const rows: Node[] = [];
    for (const m of p.errors) rows.push(h('div', { class: 'chk bad', text: `✗ ${m}` }));
    for (const m of p.warnings) rows.push(h('div', { class: 'chk warn', text: `! ${m}` }));
    for (const m of p.checks) rows.push(h('div', { class: 'chk good', text: `✓ ${m}` }));
    const money: string[] = [`One-off cost ${fmtMoney(p.cost)}`]; if (p.annualCost) money.push(`${p.annualCost > 0 ? 'running cost' : 'saves'} ${fmtMoney(Math.abs(p.annualCost))}/yr`); if (p.months) money.push(`persiapan ${p.months} months before it takes effect`);
    rows.push(h('div', { class: 'cost', text: `${money.join(' · ')}  (cash ${fmtMoney(game.cash)})` }));
    out.replaceChildren(...rows); ok.disabled = !p.ok;
  };
  const changed = () => { clearTimeout(timer); timer = window.setTimeout(() => void run(), 120); };
  spec.build(form, changed);
  cancel.addEventListener('click', close); back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  ok.addEventListener('click', async () => {
    const cmd = spec.command(); if (!cmd || !last?.ok) return; ok.disabled = true;
    const r = await game.exec(cmd); if (r.ok) { toast(r.summary ?? 'Done'); close(); } else { toast(r.error ?? 'Not allowed', true); ok.disabled = false; }
  });
  void run();
}

export const field = (label: string, control: HTMLElement): HTMLElement => h('label', { class: 'fld' }, h('span', { text: label }), control);
export function select(options: Array<{ value: string; label: string }>, value: string | undefined, onChange: () => void): HTMLSelectElement {
  const s = h('select', {}); for (const o of options) s.append(h('option', { value: o.value, text: o.label })); if (value !== undefined) s.value = value; s.addEventListener('change', onChange); return s;
}
export function textInput(value: string, onChange: () => void, placeholder = ''): HTMLInputElement {
  const i = h('input', { type: 'text', value, placeholder }); i.addEventListener('input', onChange); return i;
}
