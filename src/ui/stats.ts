import { h } from './dom';
import { openPanel } from './panel';
import type { Game } from '../game';
import { HIST, interp } from '../sim/balance';
import world0 from '../../config/world.json';

type Line = { label: string; color: string; data: (number | null)[]; dash?: number[]; scale?: string; width?: number };
interface Chart { id: string; label: string; unit: string; note?: string; build(g: Game, t: number[]): Line[]; fmt?: (v: number) => string; y2?: string }
const C = { you: '#8c2f2b', hist: '#8a8a8a', target: '#b8892d', a: '#2d6f68', b: '#3f7cc0', c: '#7a5aa6', d: '#d9893a' };
const s = (g: Game) => g.nation.series;
// the first sample (Aug 1950) is taken before any month has been simulated, so flow ratios are 0 there: leave a gap
const flow = (a: number[], k = 100): (number | null)[] => a.map((v, i) => (i === 0 && v === 0 ? null : v * k));
const START = world0.targetGdpPerCapita2026 * world0.startGdpPerCapitaFraction;
const CHARTS: Chart[] = [
  { id: 'gdppc', label: 'GDP per capita', unit: 'Rp million / person (2026 prices)', note: 'Grey: approximate shape of actual Indonesia (visual guide, not an official series). Gold: win target.',
    build: (g, t) => [{ label: 'You', color: C.you, data: s(g).gdppc.map(v => v / 1e6), width: 2.5 }, { label: 'Historical Indonesia (approx.)', color: C.hist, dash: [6, 4], data: t.map(x => (interp(HIST.gdpPerCapitaIndex, x) * START) / 1e6) }, { label: 'Target', color: C.target, dash: [2, 3], data: t.map(() => world0.targetGdpPerCapita2026 / 1e6) }] },
  { id: 'pop', label: 'Population', unit: 'million people', build: (g) => [{ label: 'Population', color: C.you, data: s(g).pop.map(v => v / 1e6), width: 2.5 }] },
  { id: 'ipm', label: 'IPM (HDI)', unit: 'index 0–1', build: g => [{ label: 'IPM', color: C.a, data: s(g).ipm, width: 2.5 }] },
  { id: 'life', label: 'Life expectancy', unit: 'years', build: g => [{ label: 'Life expectancy at birth', color: C.a, data: s(g).life, width: 2.5 }] },
  { id: 'school', label: 'Schooling', unit: 'years', build: g => [{ label: 'Expected years', color: C.b, data: s(g).eys, width: 2.5 }, { label: 'Mean years', color: C.c, data: s(g).mys, width: 2.5 }] },
  { id: 'poverty', label: 'Poverty & urbanisation', unit: 'share of population', build: g => [{ label: 'Below poverty line', color: C.d, data: s(g).poverty, width: 2.5 }, { label: 'Urban', color: C.b, data: s(g).urban, width: 2.5 }, { label: 'Agriculture share of output', color: C.a, data: s(g).agriShare, dash: [5, 3] }], fmt: v => `${(v * 100).toFixed(0)}%` },
  { id: 'fertility', label: 'Fertility', unit: 'TFR (children per woman)', build: g => [{ label: 'Total fertility rate', color: C.c, data: s(g).tfr, width: 2.5 }] },
  { id: 'macro', label: 'Inflation & stability', unit: 'inflation (%) · stability (0–100)', build: g => [{ label: 'Stability', color: C.a, data: s(g).stability, width: 2.5 }, { label: 'Inflation %', color: C.you, data: s(g).inflation.map((v, i) => (i === 0 && v === 0 ? null : Math.min(100, v * 100))), width: 2 }] },
  { id: 'fiscal', label: 'Public finance', unit: '% of GDP', build: g => [{ label: 'Revenue (incl. regional taxes)', color: C.a, data: flow(s(g).revenueGdp), width: 2.5 }, { label: 'Spending', color: C.you, data: flow(s(g).spendingGdp), width: 2.5 }, { label: 'Deficit (+) / surplus (−)', color: C.d, data: flow(s(g).deficitGdp), dash: [5, 3] }] },
  { id: 'debt', label: 'Debt', unit: '% of GDP', build: g => [{ label: 'Public debt', color: C.you, data: s(g).debtGdp.map(v => v * 100), width: 2.5 }] }
];
const mk = (t: number[], lines: Line[]) => [t, ...lines.map(l => l.data)] as never;

export function openStats(game: Game): void {
  openPanel('Statistics', 'wide', (body) => {
    let cur = CHARTS[0]; let plot: { destroy(): void; setData(d: never): void } | null = null; let ro: ResizeObserver | null = null;
    const unit = h('div', { class: 'dim' }); const pills = h('div', { class: 'pills' }); const legend = h('div', { class: 'legendrow' }); const box = h('div', { class: 'chartbox' }); const note = h('div', { class: 'dim' });
    body.append(pills, unit, legend, box, note);
    const draw = async () => {
      const [{ default: uPlot }] = await Promise.all([import('uplot'), import('uplot/dist/uPlot.min.css')]);
      const ser = game.nation.series; const t = ser.t.slice(); const lines = cur.build(game, t);
      pills.replaceChildren(...CHARTS.map(c => h('button', { class: 'pill', type: 'button', 'aria-pressed': String(c.id === cur.id), text: c.label, onclick: () => { cur = c; void draw(); } })));
      legend.replaceChildren(...lines.map(l => h('span', {}, h('i', { style: `background:${l.color}` }), l.label)));
      unit.textContent = cur.unit; note.textContent = cur.note ?? ''; plot?.destroy(); box.replaceChildren();
      const opts = { width: box.clientWidth || 800, height: 320, legend: { show: false }, cursor: { drag: { x: false, y: false } }, scales: { x: { time: false } },
        axes: [{ stroke: '#5b4d3c', grid: { stroke: '#e3d9c0' }, incrs: [1, 2, 5, 10, 20, 25, 50, 100], values: (_u: unknown, v: number[]) => v.map(x => String(Math.round(x))) }, { stroke: '#5b4d3c', grid: { stroke: '#e3d9c0' }, values: cur.fmt ? (_u: unknown, v: number[]) => v.map(cur.fmt as (x: number) => string) : undefined }],
        series: [{}, ...lines.map(l => ({ label: l.label, stroke: l.color, width: l.width ?? 1.6, dash: l.dash, points: { show: false } }))] };
      plot = new uPlot(opts as never, mk(t, lines), box) as never;
    };
    ro = new ResizeObserver(() => { /* chart is redrawn on the next tab switch; width is read then */ }); ro.observe(box);
    void draw();
    return () => { plot?.destroy(); ro?.disconnect(); };
  });
}
