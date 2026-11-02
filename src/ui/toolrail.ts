import { h, $ } from './dom';
import { t } from './i18n';
import type { Selection, Tool } from '../map/selection';

const ICONS: Record<Tool, string> = {
  select: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6.2 1.6L10 19z"/></svg>',
  box: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2.5"/><path d="M9 12h6M12 9v6"/></svg>',
  split: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 16 L20 8" stroke-dasharray="2.5 2"/><path d="M16 4l4 4M4 20l4-4"/></svg>',
  road: '<svg viewBox="0 0 24 24"><path d="M8 3L5 21M16 3l3 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/></svg>',
  rail: '<svg viewBox="0 0 24 24"><path d="M7 3l-2.500 18M17 3l2.500 18"/><path d="M6.200 8h11.600M5.500 13h13M4.800 18h14.400"/></svg>',
  port: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5.500" r="2"/><path d="M12 7.500V20M7 11h10M4 15c1 3.500 4 5 8 5s7-1.500 8-5"/></svg>',
  industry: '<svg viewBox="0 0 24 24"><path d="M3 20V9l5 3V9l5 3V6h3v14z"/><path d="M17 20V3h4v17"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><path d="M12 4c5 0 9 2.4 9 5.5S17 15 12 15c-1.5 0-2.9-.2-4.100-.6M12 4C7 4 3 6.400 3 9.500c0 2.200 1.600 4.100 4 5.100"/><path d="M8 14.900c-.8 1.500-1.600 3.100-.4 4.200 1.300 1.100 3.200-.1 3.200-1.800"/></svg>'
};
export function buildToolrail(sel: Selection): void {
  const rail = $('toolrail'); const tools: Tool[] = ['select', 'box', 'lasso', 'split', 'road', 'rail', 'port', 'industry'];
  const btns = new Map<Tool, HTMLButtonElement>();
  for (const tool of tools) {
    const b = h('button', { type: 'button', title: `${t('tool.' + tool)} — ${t('tool.' + tool + '.tip')}`, 'aria-label': t('tool.' + tool), 'aria-pressed': String(tool === sel.tool), onclick: () => sel.setTool(tool) });
    b.innerHTML = ICONS[tool]; btns.set(tool, b); rail.append(b);
  }
  sel.onTool(cur => btns.forEach((b, tool) => b.setAttribute('aria-pressed', String(tool === cur))));
}
