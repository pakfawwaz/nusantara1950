import { h } from './dom';
import { toast, fmtMoney, field, select } from './modal';
import { renderLegend } from './legend';
import { fmtPop } from '../map/modes';
import type { ModeResult } from '../map/modes';
import { RAMPS, LOCKED_COLOR } from '../map/palette';
import type { MapView } from '../map/mapView';
import type { Game } from '../game';
import type { SimClient } from '../sim/client';
import { TR, NRAIL, NROAD } from '../sim/transport';
import type { ProjectSpec } from '../sim/transport';
import { annualRunning, routeThrough } from '../sim/projects';
import type { TW } from '../sim/transport';
import type { PreviewResult } from '../sim/transportSim';
import { yearOf } from '../sim/balance';

export interface BuildCtx { game: Game; sim: SimClient; view: MapView; setHeat: (r: ModeResult | null) => void }
interface Cfg { title: string; intro: string; confirm: string; build(form: HTMLElement, changed: () => void): void; spec(): ProjectSpec | null; draw(): GeoJSON.FeatureCollection | null }

/** Access-gain heat map: the kecamatan a project would help, shaded by relative gain; everything else dimmed. */
function heat(ctx: BuildCtx, r: PreviewResult): ModeResult {
  const w = ctx.game.world; const colors = new Array<string>(w.n); for (let i = 0; i < w.n; i++) if (w.alive[i]) colors[i] = w.isLocked(i) ? LOCKED_COLOR : '#ebe7dc';
  let mx = 0; for (let q = 0; q < r.rel.length; q++) mx = Math.max(mx, r.rel[q]);
  for (let q = 0; q < r.nodes.length; q++) { const v = r.rel[q]; if (v < 1e-4 || mx <= 0) continue; const t = Math.sqrt(Math.min(1, v / mx)); colors[r.nodes[q]] = RAMPS.teal[Math.min(6, Math.floor(t * 6.99))]; }
  return { colors, legend: [{ color: '#ebe7dc', label: 'No change' }, ...[0.15, 0.4, 0.7, 1].map((f, k) => ({ color: RAMPS.teal[[1, 3, 5, 6][k]], label: `up to +${(mx * f * 100).toFixed(mx * f < 0.1 ? 1 : 0)}% access` }))] };
}
const hours = (h0: number): string => (h0 >= 1 ? `${Math.floor(h0)} h ${Math.round((h0 % 1) * 60)} min` : `${Math.round(h0 * 60)} min`);

/** Generic preview → confirm dialog for transport projects: rule checks, cost, build time, running costs, access gain and payback before anything is committed. */
function projectDialog(ctx: BuildCtx, cfg: Cfg): void {
  const { game, sim, view } = ctx; const back = h('div', { class: 'modal-back' }); const box = h('div', { class: 'modal mid', role: 'dialog', 'aria-modal': 'true', 'aria-label': cfg.title });
  const form = h('div', { class: 'form' }); const out = h('div', { class: 'preview' });
  const ok = h('button', { class: 'btn primary', type: 'button', text: cfg.confirm, disabled: true }), cancel = h('button', { class: 'btn', type: 'button', text: 'Cancel' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); view.setPreview(null); ctx.setHeat(null); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }; document.addEventListener('keydown', onKey, true);
  box.append(h('h3', { text: cfg.title }), h('p', { class: 'intro', text: cfg.intro }), form, out, h('div', { class: 'actions' }, cancel, ok)); back.append(box); document.getElementById('app')?.append(back);
  let seq = 0, timer = 0, okSpec: ProjectSpec | null = null;
  const run = async () => {
    const my = ++seq; const spec = cfg.spec(); view.setPreview(cfg.draw());
    if (!spec) { out.replaceChildren(h('div', { class: 'dim', text: 'Fill in the form to see the checks.' })); ok.disabled = true; ctx.setHeat(null); return; }
    const plan = game.planProject(spec), n = game.nation, year = yearOf(n.month); const rows: Node[] = [];
    for (const m of plan.errors) rows.push(h('div', { class: 'chk bad', text: `✗ ${m}` })); for (const m of plan.warnings) rows.push(h('div', { class: 'chk warn', text: `! ${m}` }));
    if (plan.ok) {
      const run0 = annualRunning(spec, plan, year); const lenTxt = plan.km > 0 ? `${plan.km.toFixed(0)} km${plan.kmNew < plan.km - 0.5 ? ` (${plan.kmNew.toFixed(0)} km of work)` : ''} · ` : '';
      rows.push(h('div', { class: 'chk good', text: `✓ ${lenTxt}${plan.months} months to build` }));
      rows.push(h('div', { class: 'cost', text: `Cost ${fmtMoney(plan.cost)} (includes the ${((game.planProject(spec, true).cost / Math.max(1, game.planProject(spec, false).cost) - 1) * 100).toFixed(0)}% overrun today's governance causes), paid month by month — cash ${fmtMoney(game.cash)}. After completion: maintenance +${fmtMoney(run0.maintenance)}/yr${run0.operations ? `, operations ${fmtMoney(run0.operations)}/yr` : ''}.` }));
      const eff = h('div', { class: 'dim', text: 'Computing access…' }); rows.push(eff); out.replaceChildren(...rows); okSpec = spec; ok.disabled = false;
      const r = await sim.preview(spec); if (my !== seq) return;
      const gdp = n.agg.gdp || 1, revShare = Math.max(0.02, (n.last.revenue + n.last.pad) / gdp), cnt = r.rel.filter(v => v > 1e-4).length; let mx = 0; r.rel.forEach(v => { mx = Math.max(mx, v); });
      if (cnt === 0 || r.dGdp <= 0) eff.textContent = 'Little change to market access within reach of this project (access is measured out to ten hours of travel).';
      else eff.textContent = `Improves access for ${cnt.toLocaleString('en-US')} kecamatan (best +${(mx * 100).toFixed(0)}%). Estimated output gain ≈ ${fmtMoney(r.dGdp)}/yr (${(r.dGdp / gdp * 100).toFixed(2)}% of GDP) → economic payback ≈ ${(plan.cost / r.dGdp).toFixed(0)} years, fiscal payback ≈ ${(plan.cost / (r.dGdp * revShare)).toFixed(0)} years.`;
      ctx.setHeat(cnt ? heat(ctx, r) : null); if (cnt) renderLegend('Access gain', heat(ctx, r));
      return;
    }
    out.replaceChildren(...rows); ok.disabled = true; okSpec = null; ctx.setHeat(null);
  };
  const changed = () => { clearTimeout(timer); timer = window.setTimeout(() => void run(), 140); };
  cfg.build(form, changed); cancel.addEventListener('click', close); back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  ok.addEventListener('click', async () => { if (!okSpec) return; ok.disabled = true; const r = await game.startProject(okSpec); if (r.ok) { toast(r.summary ?? 'Started'); close(); } else { toast(r.error ?? 'Not allowed', true); ok.disabled = false; } });
  void run();
}

const classOptions = (kind: 'road' | 'rail', year: number, min = 0): Array<{ value: string; label: string }> => {
  const list = kind === 'road' ? TR.roads : TR.rail; const out: Array<{ value: string; label: string }> = [];
  list.forEach((c, k) => { if (k < min || (kind === 'road' && k === 0)) return; out.push({ value: String(k), label: `${c.name} — ${c.speedKmh} km/h${year < c.unlock ? ` (from ${c.unlock})` : ''}` }); });
  return out;
};
const lineFC = (ctx: BuildCtx, path: number[], extra: Array<[number, string]> = []): GeoJSON.FeatureCollection | null => {
  if (path.length < 2) return null; const w = ctx.game.world;
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'route', stroke: '#e08a1e', color: '#e08a1e' }, geometry: { type: 'LineString', coordinates: path.map(i => [w.labelLon[i], w.labelLat[i]]) } },
    ...extra.map(([i, color]) => ({ type: 'Feature' as const, properties: { kind: 'pt', color, stroke: color }, geometry: { type: 'Point' as const, coordinates: [w.labelLon[i], w.labelLat[i]] } }))] };
};

/** Road or railway along the waypoints the player clicked. */
export function openRouteDialog(ctx: BuildCtx, kind: 'road' | 'rail', via: number[]): void {
  const w = ctx.game.world, year = yearOf(ctx.game.month); let cls = kind === 'road' ? Math.min(NROAD - 1, [5, 4, 3, 2].find(c => year >= TR.roads[c].unlock && c <= 3) ?? 2) : 0;
  if (kind === 'rail') for (let c = 0; c < NRAIL; c++) if (year >= TR.rail[c].unlock && c < 3) cls = c;
  let path: number[] = routeThrough(w as unknown as TW, via, kind, cls, year) ?? []; const stations = new Map<number, number>();
  const defaults = () => { stations.clear(); path.forEach((i, q) => { const end = q === 0 || q === path.length - 1; const cap = w.regencies[w.kecReg[i]]?.capital === i; if (end) stations.set(i, 2); else if (w.railStation[i] > 0) stations.set(i, w.railStation[i]); else if (cap) stations.set(i, 1); }); };
  defaults(); const nameIn = h('input', { type: 'text', value: `${w.names[via[0]]} – ${w.names[via[via.length - 1]]}` }); const list = h('div', { style: 'max-height:190px;overflow:auto;border:1px solid var(--line);border-radius:6px;background:#fffdf7;padding:4px 6px' }); const info = h('div', { class: 'dim' });
  let redo = () => {};
  projectDialog(ctx, {
    title: kind === 'road' ? 'Build or upgrade a road' : 'Build a railway', confirm: 'Start construction',
    intro: kind === 'road' ? 'The cheapest route over the waypoints you clicked (existing roads are reused). Links that already have this class or better cost nothing; weaker ones are upgraded at a discount.' : 'Trains run only between station kecamatan: every extra stop adds dwell and acceleration time to through trips, but crossed kecamatan without a station get nothing.',
    build(form, changed) {
      redo = changed; const sel = select(classOptions(kind, year), String(cls), () => { cls = Number(sel.value); path = routeThrough(w as unknown as TW, via, kind, cls, year) ?? []; defaults(); drawList(); changed(); });
      nameIn.addEventListener('input', changed); form.append(field('Class', sel), field('Name', nameIn));
      if (kind === 'rail') { form.append(h('div', { class: 'dim', text: 'Stations (ends need one):' }), list, info); drawList(); }
    },
    spec: () => (path.length < 2 ? null : { kind, name: nameIn.value.trim() || 'New project', cls, path: [...path], stations: kind === 'rail' ? [...stations].map(([i, l]) => [i, l] as [number, number]) : undefined }),
    draw: () => lineFC(ctx, path, via.map((i, q) => [i, q === 0 || q === via.length - 1 ? '#8c2f2b' : '#3f7cc0'] as [number, string]))
  });
  function drawList(): void {
    list.replaceChildren(...path.map((i, q) => { const end = q === 0 || q === path.length - 1;
      const s = h('select', { style: 'height:24px;font-size:12px' }, h('option', { value: '0', text: '—', disabled: end }), h('option', { value: '1', text: 'Halt' }), h('option', { value: '2', text: 'Major' })); s.value = String(stations.get(i) ?? 0);
      s.addEventListener('change', () => { const v = Number(s.value); if (v > 0) stations.set(i, v); else stations.delete(i); stat(); redo(); });
      return h('div', { style: 'display:flex;align-items:center;gap:8px;padding:1px 0' }, h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: `${w.names[i]}${w.railPath[i] ? ' ·rail' : ''}` }), h('span', { class: 'dim', style: 'font-size:11px', text: fmtPop(w.pop[i]) }), s); }));
    stat();
  }
  function stat(): void {
    if (kind !== 'rail') return; const n = stations.size, dwell = [...stations.values()].reduce((s, l) => s + (TR.railDwellMinutes[l] ?? 3), 0);
    info.textContent = `${n} stations · about ${hours(dwell / 60)} of stopping time end to end. Cities and regency capitals are suggested.`;
  }
}

/** Build or upgrade the port of one coastal kecamatan. */
export function openPortDialog(ctx: BuildCtx, node: number): void {
  const w = ctx.game.world, year = yearOf(ctx.game.month), cur = w.portLevel[node], PL = TR.ports.levels;
  if (!w.coastal[node] && !w.portLevel[node]) { toast('Ports need a coastal kecamatan.', true); return; }
  let lv = Math.min(PL.length - 1, cur + 1);
  projectDialog(ctx, {
    title: `${cur ? 'Upgrade' : 'Build'} port — ${w.names[node]}`, confirm: 'Start construction', intro: 'A port links to its nearest ports by sea. The lower level of the two ends sets the ship speed, range and handling time, so a big port needs big partners.',
    build(form, changed) { const s = select(PL.map((p, k) => ({ value: String(k), label: `${p.name}${year < p.unlock ? ` (from ${p.unlock})` : ''}` })).slice(1), String(lv), () => { lv = Number(s.value); changed(); }); form.append(field(`Now: ${PL[cur].name}`, s)); },
    spec: () => ({ kind: 'port', name: `${w.names[node]}: ${PL[lv].name}`, cls: lv, path: [], node }), draw: () => lineFC(ctx, [], [])
  });
}
/** Upgrade the track class of an existing railway. */
export function openUpgradeDialog(ctx: BuildCtx, lineId?: string): void {
  const tr = ctx.game.nation.transport, year = yearOf(ctx.game.month); if (!tr.lines.length) { toast('There is no railway to upgrade.', true); return; }
  let id = lineId ?? tr.lines[0].id; let line = tr.lines.find(l => l.id === id)!; let cls = Math.min(NRAIL - 1, line.cls + 1);
  projectDialog(ctx, {
    title: 'Upgrade a railway', confirm: 'Start construction', intro: 'Raises the track class of a whole line (faster trains, more capacity) at a discount against new construction. Service continues during the works.',
    build(form, changed) {
      const ls = select(tr.lines.map(l => ({ value: l.id, label: `${l.name} — ${TR.rail[l.cls].name}` })), id, () => { id = ls.value; line = tr.lines.find(l => l.id === id) ?? line; cls = Math.min(NRAIL - 1, line.cls + 1); cs.value = String(cls); changed(); });
      const cs = select(classOptions('rail', year, 1), String(cls), () => { cls = Number(cs.value); changed(); }); form.append(field('Line', ls), field('New class', cs));
    },
    spec: () => ({ kind: 'upgrade', name: `${line.name}: ${TR.rail[cls].name}`, cls, path: [...line.path], lineId: id }), draw: () => lineFC(ctx, line.path)
  });
}
/** Add a halt or a major station where a railway already passes. */
export function openStationDialog(ctx: BuildCtx, node: number): void {
  const w = ctx.game.world, tr = ctx.game.nation.transport; if (!w.railPath[node]) { toast('No railway crosses this kecamatan.', true); return; }
  let lv = Math.max(1, w.railStation[node] + 1); lv = Math.min(2, lv); const line = tr.lines.find(l => l.path.includes(node));
  projectDialog(ctx, {
    title: `New station — ${w.names[node]}`, confirm: 'Start construction', intro: `A station lets this kecamatan use the railway${line ? ` (${line.name})` : ''}, and adds dwell time for through trips.`,
    build(form, changed) { const s = select([{ value: '1', label: 'Halt' }, { value: '2', label: 'Major station' }], String(lv), () => { lv = Number(s.value); changed(); }); form.append(field('Size', s)); },
    spec: () => ({ kind: 'station', name: `${w.names[node]} station`, cls: lv, path: [node], node, lineId: line?.id }), draw: () => null
  });
}
