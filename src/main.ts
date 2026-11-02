import './ui/styles.css';
import { loadAll } from './data/loaders';
import { World } from './world';
import { MapView } from './map/mapView';
import { Selection } from './map/selection';
import { Labels } from './map/labels';
import { MODES, fmtPop } from './map/modes';
import type { MapMode } from './map/modes';
import { buildTopbar } from './ui/topbar';
import { buildToolrail } from './ui/toolrail';
import { renderLegend } from './ui/legend';
import { Inspector } from './ui/inspector';
import { $, esc } from './ui/dom';
import { Game } from './game';
import { AdminPanel } from './ui/adminPanel';
import { SplitTool } from './map/splitTool';
import { RouteTool } from './map/routeTool';
import { infraFeatures, infraSignature } from './map/infraLayer';
import type { ModeResult } from './map/modes';
import { toast } from './ui/modal';
import { SimCore, newNation } from './sim/core';
import { EventWatcher } from './ui/events';
import * as eventsApi from './sim/events';
import { takeNewGame } from './ui/settings';
import { startTutorial, tutorialSeen } from './ui/tutorial';
import { SimClient } from './sim/client';
import { Clock } from './sim/clock';
import { Autosaver } from './save/autosave';
import { PENDING_LOAD, readSlot } from './save/store';
import { readSave } from './save/format';
import { restoreSave } from './save/restore';

async function boot(): Promise<void> {
  const setLoad = (msg: string, f: number) => { $('loadmsg').textContent = msg; $('loadfill').style.width = `${Math.round(f * 100)}%`; };
  const raw = await loadAll(import.meta.env.BASE_URL, setLoad);
  setLoad('Building world…', 0.82);
  const world = new World(raw);
  const game = new Game(world);
  let pending: string | null = null; try { pending = sessionStorage.getItem(PENDING_LOAD); sessionStorage.removeItem(PENDING_LOAD); } catch { /* storage unavailable */ }
  let loadedNote = '';
  if (pending) {
    setLoad('Restoring saved game…', 0.86);
    try { const bytes = await readSlot(pending); if (!bytes) throw new Error('save not found'); await restoreSave(world, game, readSave(bytes)); loadedNote = 'Game loaded.'; }
    catch (e) { console.error(e); loadedNote = `Could not load the save (${e instanceof Error ? e.message : String(e)}). Started a new game.`; location.hash = ''; }
  }
  if (!loadedNote.startsWith('Game loaded')) {
    const ng = takeNewGame(); if (ng) { game.nation = newNation(ng.seed); Object.assign(game.nation.settings, { historical: ng.historical, seed: ng.seed, defaultPct: ng.defaultPct }); Object.assign(game.nation.settings.lose, ng.lose); loadedNote = 'New game started.'; }
    setLoad('Starting the economy…', 0.88); new SimCore(world, game.nation).bootstrap(world.transportSeed(), world.industrySeed()); }
  setLoad('Starting map…', 0.94);
  const view = new MapView($('map'), world);
  view.onForeign = name => toast(`${name} is a sovereign country — outside your jurisdiction.`, true);
  await view.ready();
  const labels = new Labels($<HTMLCanvasElement>('labels'), view, world);
  const sel = new Selection(view, world, $<HTMLCanvasElement>('draw'));
  let mode: MapMode = MODES[0];
  let heatOn: ModeResult | null = null;
  const applyMode = (id: string) => { mode = MODES.find(m => m.id === id) ?? MODES[0]; const res = mode.compute(world); view.applyMode(res); renderLegend(mode.label, res); heatOn = null; };
  /** Temporary overlay used by the build dialogs (access gain); `null` restores the selected map mode. */
  const setHeat = (r: ModeResult | null) => { heatOn = r; if (r) view.applyMode(r); else applyMode(mode.id); };
  let infraSig = '';
  const refreshInfra = () => { const sig = infraSignature(world, game.nation.transport, game.nation.ind); if (sig !== infraSig) { infraSig = sig; view.setInfra(infraFeatures(world, game.nation.transport, game.nation.ind)); } };
  const sim = new SimClient(world, game);
  void sim.push();
  const clock = new Clock(sim);
  const autosave = new Autosaver(sim, game, world);
  const fitKecs = (kecs: number[]) => view.fitTo(world.bboxOf(kecs), kecs.length > 1 ? 10 : 11);
  const inspector = new Inspector(world, game, sel, (kecs, prim) => sel.set(kecs, prim), fitKecs);
  const pickKec = (i: number) => { sel.set([i]); fitKecs([i]); };
  const pickRegency = (k: number) => { const ks = world.regencies[k].kec; sel.set(ks, world.regencies[k].capital); fitKecs(ks); };
  const top = buildTopbar(world, game, {
    onMode: id => applyMode(id),
    onPick: hit => {
      if (hit.kind === 'kec') { sel.set([hit.idx]); fitKecs([hit.idx]); } else if (hit.kind === 'reg') pickRegency(hit.idx);
      else { const ks = world.provinceKec(hit.idx); sel.set(ks, world.provinces[hit.idx].capital); fitKecs(ks); }
    },
    onUndo: () => { void game.undo().then(ok => toast(ok ? 'Undone' : 'Nothing to undo', !ok)); },
    onSpeed: s => { if (s < 0) clock.toggle(); else clock.set(s); },
    onOpen: async p => {
      if (p === 'budget') (await import('./ui/apbn')).openBudget(game, sim);
      else if (p === 'regions') (await import('./ui/regions')).openRegions(game, world, pickRegency);
      else if (p === 'stats') (await import('./ui/stats')).openStats(game);
      else if (p === 'industry') (await import('./ui/industry')).openIndustry(game, pickKec);
      else if (p === 'finance') (await import('./ui/finance')).openFinance(game);
      else if (p === 'events') (await import('./ui/events')).openChronicle(game, id => watcher.open(id));
      else if (p === 'settings') (await import('./ui/settings')).openSettings(game);
      else if (p === 'transport') (await import('./ui/transport')).openTransport(game, sim, id => { void import('./ui/build').then(m => m.openUpgradeDialog(bctx, id)); });
      else (await import('./ui/saveload')).openSaveLoad(game, sim, autosave);
    }
  });
  clock.onSpeed(s => top.setSpeed(s));
  const watcher = new EventWatcher(game, clock, k => top.setBadge(k), () => { void import('./ui/ending').then(m => m.openEnding(game, () => watcher.endClosed())); });
  const admin = new AdminPanel(game, () => { sel.setTool('split'); }, fc => view.setPreview(fc));
  inspector.setAdmin(admin);
  new SplitTool(view, sel, game, (kec, line) => { inspector.showTab('admin'); admin.openSplit(kec, line, () => view.setPreview(null)); });
  const bctx = { game, sim, view, setHeat };
  new RouteTool(view, sel, game, (kind, via) => { void import('./ui/build').then(m => m.openRouteDialog(bctx, kind, via)); }, kec => { void import('./ui/build').then(m => m.openPortDialog(bctx, kec)); }, kec => { void import('./ui/industry').then(m => m.openIndustryDialog(game, kec)); });
  inspector.actions = (act, kec) => { void import('./ui/build').then(m => { if (act === 'port') m.openPortDialog(bctx, kec); else if (act === 'station') m.openStationDialog(bctx, kec); else if (act === 'industry') void import('./ui/industry').then(q => q.openIndustryDialog(game, kec)); }); };
  buildToolrail(sel);
  sel.onChange(() => labels.setSelected(sel.sel));
  top.setMode(mode.id); applyMode(mode.id);
  const refreshChrome = () => { top.setUndo(game.undoLabel()); top.update(); };
  refreshChrome(); refreshInfra();
  if (loadedNote) toast(loadedNote, loadedNote.startsWith('Could not'));
  // every admin / geometry change funnels through here
  game.onChange(async ch => {
    view.setZones(game.nation.zones.list);
    const t0 = performance.now();
    if (!ch.tick) void sim.push(); // the worker needs the new structure (taken now, sent in order)
    if (ch.geometry) await view.syncFeatures(ch.removedIds, ch.upserted);
    view.rebuildBoundaries(ch.geometry ? { kec: true, reg: true, prov: true } : { reg: true, prov: true });
    sel.prune(); view.prune(); labels.refreshAnchors(); if (!heatOn) applyMode(mode.id); refreshInfra(); top.rebuildIndex(); inspector.refresh(); refreshChrome();
    (window as unknown as { __lastEditMs: number }).__lastEditMs = performance.now() - t0;
  });
  // monthly tick: refresh the chrome, recolour dynamic map modes (throttled at high speed), keep the inspector live, autosave
  let ticks = 0;
  sim.tickListeners.push(() => {
    ticks++; view.setZones(game.nation.zones.list); refreshChrome(); watcher.check(); const every = clock.speed >= 3 ? 3 : 1;
    refreshInfra();
    if (ticks % every === 0) { if (!mode.static && !heatOn) applyMode(mode.id); inspector.refresh(); }
    void autosave.tick();
  });

  // hover tooltip
  const tip = $('tooltip'); let lastHover = -1;
  view.map.on('mousemove', e => {
    if (sel.tool !== 'select') return;
    const i = view.pick(e.point.x, e.point.y); view.setHover(i);
    if (i < 0) { tip.hidden = true; lastHover = -1; return; }
    if (i !== lastHover) {
      const reg = world.regencies[world.kecReg[i]], prov = world.provinces[world.regProv[world.kecReg[i]]];
      tip.innerHTML = `<b>${esc(world.names[i])}</b><br><span class="dim">${esc(reg.name)} · ${esc(prov.name)}</span><br>Pop ${fmtPop(world.pop[i])} · ${esc(mode.value ? mode.value(world, i) : '')}`;
      lastHover = i;
    }
    tip.hidden = false; const r = $('app').getBoundingClientRect(); tip.style.left = `${Math.min(e.point.x + 16, r.width - 280)}px`; tip.style.top = `${Math.min(e.point.y + 16, r.height - 90)}px`;
  });
  view.map.on('mouseout', () => { tip.hidden = true; view.setHover(-1); });

  $('loading').remove();
  if (!pending && !tutorialSeen()) window.setTimeout(() => startTutorial(), 400);
  // Debug hook used by the headless browser checks; harmless in production.
  (window as unknown as { __game: unknown }).__game = { world, view, sel, labels, inspector, applyMode, game, admin, sim, clock, autosave, bctx, watcher, events: eventsApi };
}
boot().catch(err => { console.error(err); $('loadmsg').textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`; });
