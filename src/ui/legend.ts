import { h, $ } from './dom';
import type { ModeResult } from '../map/modes';
export function renderLegend(title: string, res: ModeResult): void {
  $('legend').replaceChildren(h('div', { class: 'lt', text: title }), ...res.legend.map(i => h('div', { class: 'li' }, h('span', { class: 'sw', style: `background:${i.color}` }), h('span', { text: i.label }))));
}
