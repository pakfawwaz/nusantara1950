import { h } from './dom';

/** A non-command modal (tables, charts, budget): header with close button, Esc / backdrop closes. */
export function openPanel(title: string, cls: string, build: (body: HTMLElement, close: () => void) => void | (() => void)): { close: () => void } {
  const back = h('div', { class: 'modal-back' }); const box = h('div', { class: `modal ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const body = h('div', {}); let cleanup: void | (() => void);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (typeof cleanup === 'function') cleanup(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  box.append(h('div', { class: 'modal-head' }, h('h3', { text: title }), h('button', { class: 'xbtn', type: 'button', 'aria-label': 'Close', text: '×', onclick: close })), body); back.append(box);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  document.getElementById('app')?.append(back); cleanup = build(body, close); return { close };
}
export const fmtT = (v: number): string => (Math.abs(v) >= 1e12 ? `${(v / 1e12).toFixed(2)} T` : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)} B` : `${(v / 1e6).toFixed(0)} jt`);
export const pctf = (v: number, d = 1): string => `${(v * 100).toFixed(d)}%`;
