import * as Comlink from 'comlink';
import { SimCore } from './core';
import { DYN_NAMES, resultRows, simWorldFrom } from './snapshot';
import type { Snapshot, StepResult } from './snapshot';
import { buildSave } from '../save/format';
import type { SaveMeta } from '../save/format';
import type { ProjectSpec } from './transport';
import type { PreviewResult } from './transportSim';
import { yearOf } from './balance';

let core: SimCore | null = null; let snap: Snapshot | null = null;
const api = {
  /** (Re)load the world after an administrative edit or a load; the nation state travels with it. */
  sync(s: Snapshot): void { snap = s; core = new SimCore(simWorldFrom(s), s.nation); },
  step(months: number): StepResult {
    if (!core || !snap) throw new Error('simulation not initialised');
    for (let m = 0; m < months; m++) core.step();
    const { rows, buffers } = resultRows(core.w as never, DYN_NAMES);
    const stats = Object.fromEntries(Object.entries(core.stats).map(([k, v]) => [k, (v as Float64Array).slice()])) as unknown as StepResult['stats'];
    const res: StepResult = { month: core.nation.month, rows, nation: core.nation, stats, regStatus: core.w.regencies.map(r => r.status), provStatus: core.w.provinces.map(p => p.status), provLocked: core.w.provinces.map(p => p.locked) };
    return Comlink.transfer(res, [...buffers, ...Object.values(stats).map(a => (a as Float64Array).buffer as ArrayBuffer)]);
  },
  /** Effect of a planned transport project on access and output (read-only). */
  preview(spec: ProjectSpec): PreviewResult {
    if (!core) throw new Error('simulation not initialised'); const r = core.tr.previewProject(spec, yearOf(core.nation.month));
    return Comlink.transfer(r, [r.nodes.buffer as ArrayBuffer, r.rel.buffer as ArrayBuffer]);
  },
  /** Compressed save of the live state (built here so the main thread never stalls). */
  save(meta: SaveMeta): Uint8Array {
    if (!core || !snap) throw new Error('simulation not initialised');
    const live = { ...snap, nation: core.nation, regencies: core.w.regencies as never, provinces: core.w.provinces as never };
    const bytes = buildSave(live, meta); return Comlink.transfer(bytes, [bytes.buffer]);
  }
};
export type SimApi = typeof api;
Comlink.expose(api);
