import { h } from './dom';
import { openPanel } from './panel';
import type { Game } from '../game';
import { HIST, interp } from '../sim/balance';
import { monthLabel, scoreParts } from '../sim/events';
import { startNewGame } from './settings';
import world0 from '../../config/world.json';

const NS = 'http://www.w3.org/2000/svg';
/** GDP per capita over the run against the target and the approximate history of the real country (inline SVG, no dependency). */
function chart(game: Game): SVGElement {
  const s = game.nation.series, W = 460, H = 220, L = 46, B = 24, T = 8, R = 8; const t0 = 1950, t1 = Math.max(2000, Math.ceil(s.t[s.t.length - 1] + 1)); const ymax = Math.max(world0.targetGdpPerCapita2026 * 1.1, ...s.gdppc) / 1e6;
  const X = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = (v: number) => H - B - (v / ymax) * (H - B - T);
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'GDP per capita over time against the target');
  const add = (tag: string, attrs: Record<string, string>, text?: string) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text) e.textContent = text; svg.append(e); };
  for (let v = 0; v <= ymax; v += 20) { add('line', { x1: String(L), x2: String(W - R), y1: String(Y(v)), y2: String(Y(v)), stroke: '#e3d9c0' }); add('text', { x: String(L - 6), y: String(Y(v) + 4), 'text-anchor': 'end', 'font-size': '10', fill: '#5b4d3c' }, String(v)); }
  for (let y = 1950; y <= t1; y += 25) add('text', { x: String(X(y)), y: String(H - 6), 'text-anchor': X(y) > W - 28 ? 'end' : 'middle', 'font-size': '10', fill: '#5b4d3c' }, String(y));
  const line = (pts: Array<[number, number]>, color: string, w: number, dash = '') => add('polyline', { points: pts.map(([a, b]) => `${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': String(w), ...(dash ? { 'stroke-dasharray': dash } : {}) });
  const start = world0.targetGdpPerCapita2026 * world0.startGdpPerCapitaFraction;
  line(s.t.map(t => [t, (interp(HIST.gdpPerCapitaIndex, t) * start) / 1e6] as [number, number]), '#8a8a8a', 1.5, '5 4');
  line([[t0, world0.targetGdpPerCapita2026 / 1e6], [t1, world0.targetGdpPerCapita2026 / 1e6]], '#b8892d', 1.5, '2 3');
  line(s.t.map((t, i) => [t, s.gdppc[i] / 1e6] as [number, number]), '#8c2f2b', 2.5);
  return svg;
}

/** The result screen shown when the game is won or lost. */
export function openEnding(game: Game, onClosed: () => void): void {
  const n = game.nation, e = n.end, won = e.status === 'won', a = n.agg;
  openPanel(won ? 'Victory' : 'Defeat', 'wide', (body, close) => {
    const parts = won ? scoreParts(n) : [];
    const kv: Array<[string, string]> = [['Date', monthLabel(e.month)], ['Population', `${(a.pop / 1e6).toFixed(0)} million`], ['GDP per capita', `Rp ${(a.gdppc / 1e6).toFixed(1)} million`], ['Human development (IPM)', a.ipm.toFixed(3)], ['Life expectancy', `${a.life.toFixed(1)} years`], ['Poverty', `${(a.poverty * 100).toFixed(0)}%`],
      ['Stability', n.stability.toFixed(0)], ['Public debt', `${(((n.debtDom + n.debtExt) / Math.max(1, a.gdp)) * 100).toFixed(0)}% of GDP`], ['Inflation', `${(n.inflation * 100).toFixed(1)}%`], ['Disaster deaths', Math.round(n.ev.deathsTotal).toLocaleString('en-US')]];
    const decided = Object.entries(n.ev.decided).map(([id, d]) => `${id.replace(/_/g, ' ')} (${monthLabel(d.month)})`);
    const keep = async (keepPlaying: boolean) => { await game.acknowledgeEnd(keepPlaying); close(); };
    body.append(
      h('h2', { class: 'endhead ' + (won ? 'win' : 'lose'), text: won ? 'Indonesia has reached the target' : 'The republic has failed' }), h('p', { class: 'intro', text: e.reason }),
      h('div', { class: 'endgrid' },
        h('div', {}, h('div', { class: 'dim', text: won ? 'Score' : 'Score for progress made' }), h('div', { class: 'scorebig', text: `${e.score} / 1000` }),
          ...parts.map(p => h('div', { style: 'margin:5px 0' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('span', { text: p.label }), h('b', { text: `${Math.round(p.value)} / ${p.max}` })), h('div', { class: 'scorebar' }, h('i', { style: `width:${(p.value / p.max) * 100}%` })))),
          h('table', { class: 'kvt', style: 'margin-top:10px' }, h('tbody', {}, ...kv.map(([k, v]) => h('tr', {}, h('td', { text: k }), h('td', { text: v })))))),
        h('div', {}, h('div', { class: 'dim', text: 'GDP per capita, Rp million (red: you · grey: actual Indonesia, approximate · gold: target)' }), chart(game), h('h4', { text: 'Your decisions' }), h('div', { class: 'chips' }, ...(decided.length ? decided.map(d => h('span', { text: d })) : [h('span', { text: 'none taken' })])))),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', text: won ? 'Keep playing (sandbox)' : 'Keep watching (sandbox)', title: 'The win and lose checks stop; the simulation runs on.', onclick: () => void keep(true) }),
        h('button', { class: 'btn', type: 'button', text: 'Close', onclick: () => void keep(false) }),
        h('button', { class: 'btn primary', type: 'button', text: 'New game', onclick: () => startNewGame({ historical: n.settings.historical, seed: Math.floor(Math.random() * 1e9) + 1, lose: { ...n.settings.lose }, defaultPct: n.settings.defaultPct }) })));
    return () => { if (!game.nation.end.ack) void game.acknowledgeEnd(false); onClosed(); };
  });
}
