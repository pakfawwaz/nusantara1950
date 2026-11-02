import { h } from './dom';

const KEY = 'nusantara1950.tutorialDone';
interface Step { target: string | null; title: string; text: string; place?: 'right' | 'left' | 'below' | 'above' | 'center' }
const STEPS: Step[] = [
  { target: null, place: 'center', title: 'Welcome, 17 August 1950', text: 'Indonesia is five years old. You are its central government. Your goal: raise real GDP per person from about Rp 10 million to Rp 89 million (2026 prices) before 2050, without letting the country go bankrupt, collapse or drown in inflation. This tour takes a minute.' },
  { target: '#map', place: 'center', title: 'The map', text: 'The atomic unit is the kecamatan (sub-district). Click one to inspect it; drag a box or lasso to select several. Regencies and provinces are made of kecamatan, and you can reorganise them (Admin tab, split and merge tools) at a price.' },
  { target: '#inspector', place: 'left', title: 'Inspector', text: 'Tabs show people, economy, budget, infrastructure and admin options for the selection, at kecamatan, regency or province level. The map mode selector above recolours the map: poverty, market access, income, schooling and more.' },
  { target: '#toolrail', place: 'right', title: 'Tools', text: 'Select, box, lasso and split sit at the top; below them are the road, railway, port and industry builders. Click points on the map to lay a route, press Enter, and read the cost, build time and payback before you commit.' },
  { target: '#topbar .speed', place: 'below', title: 'Time', text: 'Press Space to pause or resume, 1–4 to change speed. Decisions and disasters pause the game for you. One tick is one month.' },
  { target: '#topbar', place: 'below', title: 'Windows', text: 'Budget (APBN) sets taxes and spending lines for next year. Transport shows the network and maintenance. Industry and Finance cover plants, foreign investment, aid and debt. Events keeps the Chronicle and your pending decisions. Stats shows charts against the real history.' },
  { target: '#statusbar', place: 'below', title: 'Vital signs', text: 'Cash, the budget balance, debt, progress towards the target, inflation and stability. Stability below 55 hurts output, below 15 for a year ends the republic. A treasury that runs dry is financed by money printing, which feeds inflation.' },
  { target: null, place: 'center', title: 'A few first moves', text: 'Raise education and health spending in the Budget window; keep maintenance funded; build roads and ports between the biggest towns; develop industries where the site checklist is green; use aid (and, from 1958, foreign investment) when the budget is thin. Save often (Save button). Good luck.' }
];

export const tutorialSeen = (): boolean => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } };

/** Spotlight tour. Shown once on a first visit (not when a save is loaded); can be replayed from Settings. */
export function startTutorial(onDone?: () => void): void {
  const app = document.getElementById('app'); if (!app || document.getElementById('tour')) return;
  let k = 0; const shade = h('div', { class: 'tour-shade' }); const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-label': 'Tutorial' }); const root = h('div', { id: 'tour' }, shade, card); app.append(root);
  const end = () => { root.remove(); window.removeEventListener('resize', draw); document.removeEventListener('keydown', onKey, true); markSeen(); onDone?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); end(); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.stopPropagation(); next(); } else if (e.key === 'ArrowLeft') { e.stopPropagation(); k = Math.max(0, k - 1); draw(); } };
  document.addEventListener('keydown', onKey, true);
  const next = () => { if (k >= STEPS.length - 1) end(); else { k++; draw(); } };
  function draw(): void {
    const s = STEPS[k]; const el = s.target ? (document.querySelector(s.target) as HTMLElement | null) : null; const ar = app!.getBoundingClientRect(); const r = el?.getBoundingClientRect();
    if (r && s.target !== '#map') { const pad = 6; Object.assign(shade.style, { left: `${r.left - ar.left - pad}px`, top: `${r.top - ar.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px`, boxShadow: '0 0 0 9999px rgba(42,33,24,.55)', display: 'block' }); }
    else Object.assign(shade.style, { left: '0', top: '0', width: '100%', height: '100%', boxShadow: 'none', background: 'rgba(42,33,24,.35)', display: 'block' });
    card.replaceChildren(h('div', { class: 'dim', text: `${k + 1} / ${STEPS.length}` }), h('h3', { text: s.title }), h('p', { text: s.text }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', text: 'Skip', onclick: end }), k > 0 ? h('button', { class: 'btn', type: 'button', text: 'Back', onclick: () => { k--; draw(); } }) : null, h('button', { class: 'btn primary', type: 'button', text: k === STEPS.length - 1 ? 'Start playing' : 'Next', onclick: next })));
    const cw = 360; let left = (ar.width - cw) / 2, top = ar.height / 2 - 110;
    if (r && s.target !== '#map' && s.place !== 'center') {
      if (s.place === 'right') { left = r.right - ar.left + 16; top = Math.max(60, r.top - ar.top); }
      else if (s.place === 'left') { left = r.left - ar.left - cw - 16; top = Math.max(60, r.top - ar.top + 20); }
      else if (s.place === 'below') { top = r.bottom - ar.top + 16; left = Math.min(Math.max(12, r.left - ar.left), ar.width - cw - 12); }
    }
    Object.assign(card.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, top)}px`, width: `${cw}px` });
  }
  window.addEventListener('resize', draw); draw();
}
