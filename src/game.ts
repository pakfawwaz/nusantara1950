import { createZone, editZone, removeZone, remapZones, type ZoneSpec } from './sim/zones';
import type { World } from './world';
import type { Applied, Change, Command, Plan, Preview } from './admin/types';
import { planCreateProvince, planCreateRegency, planMergeProvinces, planMergeRegencies, planMoveKecamatan, planMoveRegency, planRename, planSetCapital } from './admin/units';
import cfg from '../config/admin.json';
import { newNation } from './sim/core';
import type { Nation, UnitStats } from './sim/types';
import { rebaseline, derive } from './sim/model';
import { yearOf } from './sim/balance';
import { overrunFactor, planProject, remapAfterGeometry } from './sim/projects';
import type { Plan as TPlan } from './sim/projects';
import { aidOffers, useCapacity, compensationOf, IC, planIndustry, privatizationPrice, remapIndustries, startIndustry, industryRows } from './sim/industry';
import type { IndPlan, IndSpec, IndState } from './sim/industry';
import { cancelIndustry } from './sim/industrySim';
import { addProgramLoan, repayLoan } from './sim/finance';
import type { SimWorld } from './sim/types';
import { resolveDecision } from './sim/events';
import type { GameSettings } from './sim/events';
import type { ProjectSpec, TW, TransportState } from './sim/transport';

export interface HistoryEntry { month: number; summary: string; cost: number; stability: number }
interface UndoEntry { applied: Applied; month: number; until: number; entry: HistoryEntry; geo: boolean; tbefore?: Pick<TransportState, 'lines' | 'projects'> & { ind?: IndState } }

/** Owns the mutable world, the treasury and the undo stack. All edits go through `preview` / `exec` (commands), never by mutating the world directly. */
export class Game {
  nation: Nation = newNation(); stats: UnitStats | null = null; readonly history: HistoryEntry[] = []; geoLog: Command[] = [];
  /** Set by the app: resolves when the simulation worker has no step in flight, so edits never race a monthly tick. */
  gate: () => Promise<void> = async () => {}; version = 0;
  get cash(): number { return this.nation.cash; } set cash(v: number) { this.nation.cash = v; }
  get month(): number { return this.nation.month; }
  private undoStack: UndoEntry[] = []; private redoStack: Array<{ cmd: Command; label: string }> = [];
  private listeners: Array<(c: Change) => void> = [];
  constructor(readonly world: World) {}
  onChange(f: (c: Change) => void): void { this.listeners.push(f); }
  private emit(c: Change): void { this.listeners.forEach(f => f(c)); }

  async plan(cmd: Command): Promise<Plan> {
    const w = this.world;
    switch (cmd.type) {
      case 'createRegency': return planCreateRegency(w, this.month, cmd);
      case 'moveKecamatan': return planMoveKecamatan(w, cmd);
      case 'mergeRegencies': return planMergeRegencies(w, cmd);
      case 'createProvince': return planCreateProvince(w, this.month, cmd);
      case 'moveRegency': return planMoveRegency(w, cmd);
      case 'mergeProvinces': return planMergeProvinces(w, cmd);
      case 'rename': return planRename(w, cmd);
      case 'setCapital': return planSetCapital(w, cmd);
      case 'splitKecamatan': return (await import('./admin/kecamatan')).planSplit(w, cmd.kec, cmd.line, cmd.names);
      case 'mergeKecamatan': return (await import('./admin/kecamatan')).planMergeKecamatan(w, cmd.keep, cmd.absorb, cmd.name);
    }
  }
  async preview(cmd: Command): Promise<Preview> {
    const p = (await this.plan(cmd)).preview;
    if (p.ok && p.cost > this.cash) return { ...p, ok: false, errors: [...p.errors, `Not enough cash: needs Rp ${(p.cost / 1e9).toFixed(1)} B, you have Rp ${(this.cash / 1e9).toFixed(1)} B.`] };
    return p;
  }
  async exec(cmd: Command): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate();
    let plan = await this.plan(cmd); const v = this.version; await this.gate(); if (v !== this.version) plan = await this.plan(cmd); // a tick landed while planning: plan again on fresh numbers
    if (!plan.preview.ok || !plan.apply) return { ok: false, error: plan.preview.errors[0] ?? 'Not allowed.' };
    if (plan.preview.cost > this.cash) return { ok: false, error: 'Not enough cash.' };
    const geoCmd = cmd.type === 'splitKecamatan' || cmd.type === 'mergeKecamatan'; const tbefore = geoCmd ? structuredClone({ lines: this.nation.transport.lines, projects: this.nation.transport.projects, ind: this.nation.ind }) : undefined;
    const applied = plan.apply(); this.cash -= applied.cost; this.rebase(applied.change); this.nation.adminHits += Math.abs(applied.stability);
    const geo = cmd.type === 'splitKecamatan' || cmd.type === 'mergeKecamatan'; if (geo) this.geoLog.push(cmd);
    const entry: HistoryEntry = { month: this.month, summary: applied.summary, cost: applied.cost, stability: applied.stability }; this.history.push(entry);
    this.undoStack.push({ applied, month: this.month, until: this.month + applied.undoMonths, entry, geo, tbefore });
    if (this.undoStack.length > cfg.undo.maxEntries) this.undoStack.shift(); this.redoStack.length = 0;
    this.emit(applied.change); return { ok: true, summary: applied.summary };
  }
  /** After a split / merge the new rows become the reference state of the production function and of every target offset. */
  private rebase(ch: Change): void {
    if (!ch.geometry) return; const w = this.world, n = this.nation;
    remapAfterGeometry(w as unknown as TW, n.transport, ch); remapIndustries(w as unknown as SimWorld, n, ch); remapZones(w as unknown as SimWorld, n, ch); n.transport.dirty = true; n.transport.rebase.push(...ch.upserted);
    industryRows(w as unknown as SimWorld, n, yearOf(n.month)); // refresh per-kecamatan industry rows before the new pieces are rebaselined
    for (const i of ch.upserted) if (w.alive[i]) { w.grdp[i] = sumOut(w, i); rebaseline(w as never, i, n.tfp, yearOf(n.month), n.gov0, n.kbCov); derive(w as never, i, true); }
  }
  // ---- transport projects (paid for month by month as they are built, so starting one costs no cash up front)
  planProject(spec: ProjectSpec, withOverrun = true): TPlan {
    const n = this.nation; return planProject(this.world as unknown as TW, n.transport, spec, yearOf(n.month), withOverrun ? overrunFactor(n.agg.gov, n.gov0) : 1);
  }
  async startProject(spec: ProjectSpec): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const plan = this.planProject(spec, false); if (!plan.ok) return { ok: false, error: plan.errors[0] ?? 'Not allowed.' };
    const tr = this.nation.transport; tr.projects.push({ ...spec, path: [...spec.path], stations: spec.stations?.map(x => [x[0], x[1]] as [number, number]), id: tr.nextId++, km: plan.km, cost: plan.cost, months: plan.months, progress: 0, paid: 0, paused: false, start: this.month });
    this.emit({ removed: [], removedIds: [], upserted: [], admin: true, geometry: false }); return { ok: true, summary: `Started: ${spec.name} (${plan.months} months).` };
  }
  async setProjectPaused(id: number, paused: boolean): Promise<void> { await this.gate(); const p = this.nation.transport.projects.find(q => q.id === id); if (!p) return; p.paused = paused; this.emit({ removed: [], removedIds: [], upserted: [], admin: true, geometry: false }); }
  async cancelProject(id: number): Promise<void> { await this.gate(); const tr = this.nation.transport; tr.projects = tr.projects.filter(q => q.id !== id); this.emit({ removed: [], removedIds: [], upserted: [], admin: true, geometry: false }); }

  // ---- industries (the plan is checked again when the command runs; costs are paid month by month as built)
  planIndustry(spec: IndSpec): IndPlan { const n = this.nation; return planIndustry(this.world as unknown as SimWorld, n, spec, yearOf(n.month), overrunFactor(n.agg.gov, n.gov0)); }
  private poke(): void { this.emit({ removed: [], removedIds: [], upserted: [], admin: true, geometry: false }); }
  async startIndustry(spec: IndSpec): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const plan = this.planIndustry(spec); if (!plan.ok) return { ok: false, error: plan.errors[0] ?? 'Not allowed.' };
    const x = startIndustry(this.world as unknown as SimWorld, this.nation, spec, plan, this.month); this.poke(); return { ok: true, summary: `Started: ${x.name} (${plan.months} months).` };
  }
  async setIndustryPaused(id: number, paused: boolean): Promise<void> { await this.gate(); const x = this.nation.ind.list.find(q => q.id === id); if (x) { x.paused = paused; this.poke(); } }
  async cancelIndustry(id: number): Promise<void> { await this.gate(); if (cancelIndustry(this.nation, id)) this.poke(); }
  /** Take over the foreign share of an industry for compensation. Frightens investors for years. */
  async nationalize(id: number): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const n = this.nation, x = n.ind.list.find(q => q.id === id); if (!x || x.status !== 'running' || x.foreign <= 0) return { ok: false, error: 'Nothing foreign-owned to take over.' };
    const cost = compensationOf(x); if (cost > n.cash) return { ok: false, error: `Compensation of Rp ${(cost / 1e9).toFixed(1)} B exceeds your cash.` };
    n.cash -= cost; x.state += x.foreign; n.fin.nationHit += IC.nationalize.minClimateDrop * (0.3 + 0.7 * Math.min(1, cost / Math.max(1, 0.01 * n.agg.gdp))); n.adminHits = Math.max(0, n.adminHits - IC.nationalize.stabilityGain); x.foreign = 0; x.terms.divestYears = 0; x.terms.foreign0 = 0; this.poke();
    return { ok: true, summary: `Nationalised ${x.name} (compensation Rp ${(cost / 1e9).toFixed(1)} B).` };
  }
  async privatize(id: number): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const n = this.nation, x = n.ind.list.find(q => q.id === id); if (!x || x.status !== 'running' || x.state <= 0) return { ok: false, error: 'Nothing state-owned to sell.' };
    const price = privatizationPrice(n, x); n.cash += price; x.priv += x.state; x.state = 0; this.poke(); return { ok: true, summary: `Sold ${x.name} for Rp ${(price / 1e9).toFixed(1)} B.` };
  }
  async setAlignment(v: number): Promise<void> { await this.gate(); this.nation.fin.alignTarget = Math.max(-1, Math.min(1, v)); this.poke(); }
  async enactInvestmentLaw(): Promise<{ ok: boolean; error?: string }> {
    await this.gate(); const n = this.nation; if (n.fin.fdiLaw) return { ok: false, error: 'Already in force.' }; if (yearOf(n.month) < IC.fdi.openLawYear) return { ok: false, error: `Not possible before ${IC.fdi.openLawYear}.` };
    n.fin.fdiLaw = true; n.fin.lawYear = yearOf(n.month); this.poke(); return { ok: true };
  }
  async takeProgramLoan(partner: string, amount: number): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const n = this.nation, year = yearOf(n.month); const offer = aidOffers(n, year, n.agg.gdp).find(o => o.partner.id === partner);
    if (!offer) return { ok: false, error: 'That partner offers nothing now.' }; if (amount <= 0 || amount > offer.remaining) return { ok: false, error: `You can draw up to Rp ${(offer.remaining / 1e9).toFixed(0)} B this year.` };
    useCapacity(n, partner, n.month, amount); addProgramLoan(n, partner, amount); if (offer.partner.conditional) n.adminHits += IC.aid.conditionStabilityHit; this.poke();
    return { ok: true, summary: `Budget support of Rp ${(amount / 1e9).toFixed(0)} B from ${offer.partner.name}.` };
  }
  // ---- events, settings, ending
  /** Take a pending decision. The effects are applied to the nation here and travel to the worker with the next push. */
  async decide(id: string, option: number): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const r = resolveDecision(this.world as unknown as SimWorld, this.nation, id, option, false); if (r === null) return { ok: false, error: 'That decision is no longer open.' };
    this.poke(); return { ok: true, summary: r };
  }
  async zoneCreate(spec: ZoneSpec): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const e = createZone(this.world as unknown as SimWorld, this.nation, spec); if (e) return { ok: false, error: e }; this.poke(); return { ok: true, summary: `Special area "${spec.name.trim()}" created.` };
  }
  async zoneEdit(id: number, patch: { pphCut?: number; ease?: number }): Promise<{ ok: boolean; error?: string; summary?: string }> {
    await this.gate(); const e = editZone(this.world as unknown as SimWorld, this.nation, id, patch); if (e) return { ok: false, error: e }; this.poke(); return { ok: true, summary: 'Special area updated.' };
  }
  async zoneRemove(id: number): Promise<void> { await this.gate(); removeZone(this.nation, id); this.poke(); }
  /** Called by the petition engine after it changed the petition list: pushes the new nation state to the worker and refreshes the UI. */
  petitionsChanged(): void { this.poke(); }
  async setSettings(patch: Partial<Omit<GameSettings, 'lose'>> & { lose?: Partial<GameSettings['lose']> }): Promise<void> {
    await this.gate(); const s = this.nation.settings; const { lose, ...rest } = patch; Object.assign(s, rest); if (lose) Object.assign(s.lose, lose); this.poke();
  }
  /** Close the end screen. With `keepPlaying` the win / lose checks stop and the simulation runs on as a sandbox. */
  async acknowledgeEnd(keepPlaying: boolean): Promise<void> { await this.gate(); const e = this.nation.end; e.ack = true; if (keepPlaying) e.continued = true; this.poke(); }
  async repayLoanEarly(loanId: number, amount: number): Promise<number> { await this.gate(); const r = repayLoan(this.nation, loanId, amount); if (r > 0) this.poke(); return r; }

  /** The latest edit can be undone while it is not yet effective (same month, or the new unit is still in persiapan). */
  canUndo(): UndoEntry | null { const t = this.undoStack[this.undoStack.length - 1]; return t && t.until > this.month ? t : null; }
  undoLabel(): string | null { return this.canUndo()?.entry.summary ?? null; }
  async undo(): Promise<boolean> {
    await this.gate(); const t = this.canUndo(); if (!t) return false; this.undoStack.pop();
    const ch = t.applied.undo(); if (t.tbefore) { if (t.tbefore.ind) this.nation.ind = t.tbefore.ind; this.nation.transport.lines = t.tbefore.lines; this.nation.transport.projects = t.tbefore.projects; this.nation.transport.dirty = true; this.nation.transport.rebase.push(...ch.upserted); } this.cash += t.applied.cost; this.nation.adminHits = Math.max(0, this.nation.adminHits - Math.abs(t.applied.stability)); if (t.geo) this.geoLog.pop(); const i = this.history.indexOf(t.entry); if (i >= 0) this.history.splice(i, 1); this.emit(ch); return true;
  }
  /** Called after every simulation tick: statuses already flipped in the worker; expire stale undo entries and tell the UI if the structure changed. */
  afterTick(statusChanged: boolean): void {
    // undo is strictly LIFO: once an entry has expired, everything beneath it is locked in as well
    let last = -1; this.undoStack.forEach((u, i) => { if (u.until <= this.month) last = i; });
    if (last >= 0) this.undoStack = this.undoStack.slice(last + 1);
    this.version++; if (statusChanged) this.emit({ removed: [], removedIds: [], upserted: [], admin: true, geometry: false });
  }
}
const sumOut = (w: World, i: number): number => { let t = 0; for (let s = 0; s < 10; s++) t += w.s.out[i * 10 + s]; return t; };

