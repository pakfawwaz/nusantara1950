import { h } from './dom';
import { openPanel, fmtT, pctf } from './panel';
import type { Game } from '../game';
import type { SimClient } from '../sim/client';
import { TR } from '../sim/transport';
import { yearOf, MONTH_NAMES, monthOfYear } from '../sim/balance';

const condWord = (c: number): string => (c >= 0.9 ? 'good' : c >= 0.7 ? 'fair' : c >= 0.5 ? 'poor' : 'ruined');
const when = (m: number): string => `${MONTH_NAMES[monthOfYear(m)]} ${yearOf(m)}`;

/** Network overview, maintenance, rail finances and the construction queue. */
export function openTransport(game: Game, sim: SimClient, onUpgrade: (lineId: string) => void): void {
  openPanel('Transport', 'wide', body => {
    const root = h('div'); body.append(root);
    const render = () => {
      const n = game.nation, tr = n.transport, w = game.world, gdp = n.agg.gdp || 1; root.replaceChildren();
      const sum = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', { class: 'l', text: 'Network' }), h('th', { text: 'Length' }), h('th', { text: 'Condition' }))));
      const sb = h('tbody'); for (let c = 1; c < TR.roads.length; c++) if (tr.kmRoad[c] > 0 || yearOf(n.month) >= TR.roads[c].unlock) sb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: TR.roads[c].name }), h('td', { text: `${Math.round(tr.kmRoad[c]).toLocaleString('en-US')} km` }), h('td', { text: tr.kmRoad[c] > 0 ? `${condWord(tr.roadCond[c])} (${Math.round(tr.roadCond[c] * 100)}%)` : '—' })));
      const ports = [0, 0, 0, 0, 0]; for (let i = 0; i < w.n; i++) if (w.alive[i] && w.portLevel[i] > 0) ports[w.portLevel[i]]++;
      sb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: `Railways (${tr.lines.length} lines)` }), h('td', { text: `${Math.round(tr.kmRail).toLocaleString('en-US')} km` }), h('td', { text: tr.lines.length ? `${Math.round((tr.lines.reduce((s, l) => s + l.cond, 0) / tr.lines.length) * 100)}% average` : '—' })));
      sb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: 'Ports (small / regional / national / hub)' }), h('td', { text: `${ports[1]} / ${ports[2]} / ${ports[3]} / ${ports[4]}` }), h('td', { text: '' })));
      sum.append(sb);
      const req = tr.required.road + tr.required.rail + tr.required.port, funded = (n.policy.budget.maintenance / 100) * gdp;
      const maint = h('div', { class: tr.coverage < 0.97 ? 'cost bad-t' : 'cost', text: `Maintenance needed ${fmtT(req)}/yr · budgeted ${fmtT(funded)}/yr (${pctf(n.policy.budget.maintenance / 100, 2)} of GDP) → coverage ${pctf(tr.coverage, 0)}. ${tr.coverage < 0.97 ? 'Below 100% the network is wearing out and trips get slower.' : tr.coverage > 1.03 ? 'Above 100% the network is being rehabilitated.' : 'Condition is being held steady.'} Change it in the Budget window.` });
      const r = tr.lastRail; const fin = h('div', { class: 'cost', text: `Railways: fares and freight ${fmtT(r.revenue)}/yr (${(r.pkm / 1e6).toFixed(0)} million passenger-km) against operating costs ${fmtT(r.ops)}/yr → ${r.revenue >= r.ops ? 'surplus' : 'subsidy'} ${fmtT(Math.abs(r.revenue - r.ops))}/yr.` });
      // projects
      const pt = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', { class: 'l', text: 'Project' }), h('th', { text: 'Progress' }), h('th', { text: 'Paid so far' }), h('th', { text: 'Finish' }), h('th', { text: '' }))));
      const pb = h('tbody');
      for (const p of tr.projects) {
        const left = Math.ceil((1 - p.progress) * p.months);
        pb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: p.name + (p.paused ? ' (paused)' : '') }), h('td', {}, h('div', { class: 'fundbar', style: 'width:110px;display:inline-block' }, h('i', { style: `width:${(p.progress * 100).toFixed(0)}%;background:${p.paused ? '#7a7f86' : '#e08a1e'}` })), h('span', { text: ` ${(p.progress * 100).toFixed(0)}%` })), h('td', { text: `${fmtT(p.paid)} of ~${fmtT(p.cost)}` }), h('td', { text: p.paused ? '—' : when(n.month + left) }),
          h('td', {}, h('button', { class: 'btn small', type: 'button', text: p.paused ? 'Resume' : 'Pause', onclick: () => void game.setProjectPaused(p.id, !p.paused).then(render) }), ' ', h('button', { class: 'btn small', type: 'button', text: 'Cancel', title: 'Stops the work; money already spent is lost', onclick: () => { if (confirm(`Cancel "${p.name}"? Money already spent (${fmtT(p.paid)}) is lost.`)) void game.cancelProject(p.id).then(render); } }))));
      }
      if (!tr.projects.length) pb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l dim', text: 'Nothing under construction. Use the Road, Railway and Port tools in the tool rail (left).' }), h('td'), h('td'), h('td'), h('td')));
      pt.append(pb);
      // lines
      const lt = h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', { class: 'l', text: 'Railway line' }), h('th', { text: 'Class' }), h('th', { text: 'Stations' }), h('th', { text: 'Condition' }), h('th', { text: '' }))));
      const lb = h('tbody'); for (const l of tr.lines) lb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: l.name }), h('td', { class: 'l', text: TR.rail[l.cls].name, style: 'text-align:right' }), h('td', { text: String(l.stations.length) }), h('td', { text: `${Math.round(l.cond * 100)}%` }), h('td', {}, h('button', { class: 'btn small', type: 'button', text: 'Upgrade…', onclick: () => onUpgrade(l.id) }))));
      lt.append(lb);
      root.append(h('p', { class: 'intro', text: 'Roads, railways and ports are built as projects: the cost is paid month by month while they are under construction, and weak governance causes overruns. Everything built has to be maintained.' }),
        h('div', { class: 'cols2' }, h('div', {}, h('div', { class: 'tablewrap' }, sum), maint, fin), h('div', {}, h('h4', { text: 'Under construction' }), h('div', { class: 'tablewrap' }, pt), h('h4', { text: 'Railway lines' }), h('div', { class: 'tablewrap' }, lt))));
    };
    render(); const f = () => render(); sim.tickListeners.push(f);
    return () => { const q = sim.tickListeners.indexOf(f); if (q >= 0) sim.tickListeners.splice(q, 1); };
  });
}
