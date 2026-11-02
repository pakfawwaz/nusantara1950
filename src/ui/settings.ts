import { h } from './dom';
import { openPanel } from './panel';
import type { Game } from '../game';
import { SETTINGS } from '../sim/events';
import { startTutorial } from './tutorial';

export const NEWGAME_KEY = 'nusantara1950.newgame';
export interface NewGameOptions { historical: boolean; seed: number; lose: { hyper: boolean; collapse: boolean; default: boolean; timeout: boolean }; defaultPct: number }
/** Reads (and clears) the options of a "new game" requested before the last reload. */
export function takeNewGame(): NewGameOptions | null {
  try { const raw = sessionStorage.getItem(NEWGAME_KEY); sessionStorage.removeItem(NEWGAME_KEY); return raw ? (JSON.parse(raw) as NewGameOptions) : null; } catch { return null; }
}
export function startNewGame(o: NewGameOptions): void { try { sessionStorage.setItem(NEWGAME_KEY, JSON.stringify(o)); } catch { /* ignore */ } location.hash = ''; location.reload(); }

export function openSettings(game: Game): void {
  openPanel('Settings', 'mid', body => {
    const s = game.nation.settings; const locked = game.nation.month > 12;
    let seed = s.seed, hist = s.historical;
    const chk = (label: string, note: string, key: keyof typeof s.lose) => { const c = h('input', { type: 'checkbox' }); c.checked = s.lose[key]; c.addEventListener('change', () => void game.setSettings({ lose: { [key]: c.checked } })); return h('label', { class: 'setrow' }, c, h('span', {}, label, h('small', { text: note }))); };
    const radio = (value: boolean, label: string, note: string) => { const r = h('input', { type: 'radio', name: 'mode', disabled: locked }); r.checked = hist === value; r.addEventListener('change', () => { hist = value; if (!locked) void game.setSettings({ historical: value }); }); return h('label', { class: 'setrow' }, r, h('span', {}, label, h('small', { text: note }))); };
    const seedIn = h('input', { type: 'number', value: String(seed), style: 'width:130px' }); seedIn.addEventListener('input', () => { seed = Math.floor(Number(seedIn.value)) || 1; });
    const pct = h('input', { type: 'number', min: '20', max: '100', step: '5', value: String(Math.round(s.defaultPct * 100)), style: 'width:70px' }); pct.addEventListener('change', () => { const v = Math.min(100, Math.max(20, Number(pct.value) || 60)); pct.value = String(v); void game.setSettings({ defaultPct: v / 100 }); });
    body.append(
      h('h4', { text: 'World events' }),
      radio(true, 'Historical', 'Oil and commodity price paths, wars, crises and the pandemic arrive on (roughly) their real dates. Deposits are also found on their real discovery dates. Natural disasters are random, with a few famous ones fixed.'),
      radio(false, 'Randomized', 'The same kinds of events arrive at random: recessions, oil shocks and gluts, commodity booms, financial crises, pandemics, regional unrest. Prices follow a smooth trend between shocks.'),
      h('p', { class: 'dim', text: locked ? 'The mode can only be changed in the first year; start a new game to change it.' : 'You can still switch during the first year.' }),
      h('div', { class: 'setrow' }, h('span', {}, 'Random seed (for a new game): ', seedIn, h('button', { class: 'btn small', type: 'button', style: 'margin-left:8px', text: 'Random', onclick: () => { seed = Math.floor(Math.random() * 1e9) + 1; seedIn.value = String(seed); } }), h('small', { text: 'The same seed replays the same disasters and (in Randomized mode) the same shocks, given the same decisions.' }))),
      h('h4', { text: 'Ways to lose' }),
      chk('Hyperinflation', `Prices rising faster than ${Math.round(SETTINGS.hyperInflationPerYear * 100)}% a year for ${SETTINGS.hyperMonths} months.`, 'hyper'),
      chk('Political collapse', 'National stability below 15 for twelve months.', 'collapse'),
      h('div', { class: 'setrow' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = s.lose.default; c.addEventListener('change', () => void game.setSettings({ lose: { default: c.checked } })); return c; })(), h('span', {}, 'Sovereign default', h('small', {}, 'Debt service above ', pct, `% of revenue for ${SETTINGS.defaultMonths / 12} years.`))),
      chk('Reaching 2050 without the target', 'If switched off the game carries on after 2050 as a sandbox.', 'timeout'),
      h('p', { class: 'dim', text: 'Ways to lose apply immediately. The win condition is fixed: real GDP per capita of Rp 89 million (2026 prices).' }),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Replay the tutorial', onclick: () => { document.querySelector('.modal-back')?.remove(); startTutorial(); } }), h('button', { class: 'btn', type: 'button', text: 'Start a new game with these settings…', onclick: () => { if (confirm('Start a new game? Your current game is not saved unless you saved it.')) startNewGame({ historical: hist, seed, lose: { ...game.nation.settings.lose }, defaultPct: game.nation.settings.defaultPct }); } }))
    );
  });
}
