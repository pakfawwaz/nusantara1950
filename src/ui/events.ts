import { h } from './dom';
import { openPanel } from './panel';
import { toast } from './modal';
import type { Game } from '../game';
import type { Clock } from '../sim/clock';
import { DECISION, monthLabel } from '../sim/events';
import type { LogEntry, Shock } from '../sim/events';

const KIND_LABEL: Record<string, string> = { world: 'World', disaster: 'Disasters', decision: 'Decisions', territory: 'Territory', end: 'Result' };

/** The decision dialog. Closing it ("Decide later") leaves the decision open until its deadline, when the default is applied. */
export function openDecision(game: Game, id: string, onClose: () => void): void {
  const d = DECISION.get(id), n = game.nation, pend = n.ev.pending.find(p => p.id === id); if (!d || !pend) { onClose(); return; }
  const deadline = monthLabel(pend.due); const def = d.options[d.default];
  let done = false; const panel = openPanel(d.title, 'mid', (body, close) => {
    body.append(h('div', { class: 'when', text: `${monthLabel(pend.month)} · decide by ${deadline}` }), h('p', { class: 'intro', text: d.text }));
    d.options.forEach((o, k) => body.append(h('button', { class: 'optcard' + (k === d.default ? ' dflt' : ''), type: 'button', onclick: async () => { const r = await game.decide(id, k); done = true; close(); toast(r.ok ? `${d.title}: ${r.summary}` : (r.error ?? 'Not possible'), !r.ok); } }, h('b', { text: o.label }), h('span', { text: o.text }))));
    body.append(h('div', { class: 'actions' }, h('span', { class: 'dim', style: 'flex:1;align-self:center', text: `If you do nothing, "${def.label}" happens on ${deadline}.` }), h('button', { class: 'btn', type: 'button', text: 'Decide later', onclick: () => close() })));
    return () => { if (!done) { /* closed without choosing */ } onClose(); };
  });
  void panel;
}

const effectText = (s: Shock): string => {
  const bits: string[] = [];
  if (s.mult !== undefined) bits.push(`output ${s.mult >= 1 ? '+' : '−'}${Math.abs((s.mult - 1) * 100).toFixed(0)}%${s.prov ? ` in ${s.prov.length} province(s)` : ''}`);
  if (s.oil) bits.push(`oil price ×${s.oil}`); if (s.commodity) bits.push(`commodity prices ×${s.commodity}`);
  if (s.stab) bits.push(`stability ${s.stab > 0 ? '+' : '−'}${Math.abs(s.stab)}`); if (s.clim) bits.push(`investment climate ${s.clim > 0 ? '+' : '−'}${Math.abs(s.clim)}`);
  if (s.infl) bits.push(`inflation +${(s.infl * 100).toFixed(1)} pts`); if (s.mort) bits.push(`mortality +${(s.mort * 100).toFixed(0)}%`);
  return bits.join(', ');
};

/** Event log, open decisions and the conditions currently acting on the economy. */
export function openChronicle(game: Game, decide: (id: string) => void): void {
  openPanel('Chronicle', 'mid', body => {
    const filt = { v: 'all' }; const root = h('div'); body.append(root);
    const render = () => {
      const n = game.nation, ev = n.ev; root.replaceChildren();
      if (ev.pending.length) root.append(h('h4', { text: 'Awaiting your decision' }), ...ev.pending.map(p => { const d = DECISION.get(p.id); return h('div', { class: 'pending' }, h('div', { class: 'grow' }, h('b', { text: d?.title ?? p.id }), h('div', { class: 'dim', text: `decide by ${monthLabel(p.due)}` })), h('button', { class: 'btn small', type: 'button', text: 'Decide…', onclick: () => decide(p.id) })); }));
      const act = ev.shocks.filter(s => s.end > n.month && effectText(s));
      if (act.length) root.append(h('h4', { text: 'Conditions now acting on the economy' }), ...act.map(s => h('div', { class: 'logrow' }, h('b', { text: s.name }), h('small', { text: `${effectText(s)} · ends ${monthLabel(s.end)}` }))));
      const rec = ev.disasters.filter(d => n.month - d.start < d.recover);
      if (rec.length) root.append(h('h4', { text: 'Recovering from disaster' }), ...rec.map(d => h('div', { class: 'logrow' }, h('b', { text: d.name }), h('small', { text: `${Math.round((1 - (n.month - d.start) / d.recover) * 100)}% of the output loss remains · relief paid ${Math.min(100, Math.round(((n.month - d.start) / 12) * 100))}%` }))));
      const kinds = ['all', 'world', 'disaster', 'decision', 'territory']; root.append(h('h4', { text: 'History' }), h('div', { class: 'pills' }, ...kinds.map(k => h('button', { class: 'pill', type: 'button', 'aria-pressed': String(filt.v === k), text: k === 'all' ? 'All' : KIND_LABEL[k], onclick: () => { filt.v = k; render(); } }))));
      const rows: LogEntry[] = ev.log.filter(e => filt.v === 'all' || e.kind === filt.v || (filt.v === 'territory' && e.kind === 'end')).slice().reverse();
      root.append(...(rows.length ? rows.map(e => h('div', { class: `logrow ${e.kind}` }, h('b', { text: e.title }), h('small', { text: monthLabel(e.month) }), h('p', { text: e.text }))) : [h('p', { class: 'dim', text: 'Nothing has happened yet.' })]));
    };
    render(); const f = () => render(); game.onChange(() => { /* refreshed on ticks below */ }); const sim = (window as unknown as { __game?: { sim: { tickListeners: Array<() => void> } } }).__game?.sim; sim?.tickListeners.push(f);
    return () => { const q = sim?.tickListeners.indexOf(f) ?? -1; if (q >= 0) sim?.tickListeners.splice(q, 1); };
  });
}

/** Watches the nation after each tick: opens decisions, shows toasts for new events, shows the end screen. Pauses the clock while a dialog is open. */
export class EventWatcher {
  private logSeen: number; private opening = false; private shownEnd = false; private deferred = new Set<string>();
  constructor(private game: Game, private clock: Clock, private onBadge: (n: number) => void, private openEnd: () => void) { this.logSeen = game.nation.ev.log.length; this.onBadge(this.pendingCount()); }
  private pendingCount(): number { return this.game.nation.ev.pending.length; }
  /** Open the dialog for a decision now (from the Chronicle or when it first appears). */
  open(id: string): void {
    if (this.opening) return; this.opening = true; this.clock.blocked = true; this.clock.set(0);
    openDecision(this.game, id, () => { this.opening = false; this.clock.blocked = false; this.deferred.add(id); this.onBadge(this.pendingCount()); });
  }
  check(): void {
    const n = this.game.nation, ev = n.ev;
    const fresh = ev.log.slice(this.logSeen); this.logSeen = ev.log.length;
    const shown = fresh.filter(e => e.kind !== 'end'); if (shown.length) { const last = shown[shown.length - 1]; toast(`${monthLabel(last.month)} · ${last.title}${shown.length > 1 ? ` (+${shown.length - 1} more, see Events)` : ''}`, last.kind === 'disaster'); }
    this.onBadge(this.pendingCount());
    if (n.end.status !== 'playing' && !n.end.ack && !this.shownEnd && !this.opening) { this.shownEnd = true; this.clock.set(0); this.openEnd(); return; }
    if (!this.opening) { const p = ev.pending.find(q => !this.deferred.has(q.id)); if (p) this.open(p.id); }
  }
  /** After a fresh decision shows (or the player re-opens it) it can be deferred again. */
  reset(): void { this.deferred.clear(); }
  endClosed(): void { this.shownEnd = false; }
}
