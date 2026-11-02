import * as Comlink from 'comlink';
import type { World } from '../world';
import type { Game } from '../game';
import { applyResult, makeSnapshot, transferList } from './snapshot';
import type { SimApi } from './worker';
import type { SaveMeta } from '../save/format';
import type { ProjectSpec } from './transport';
import type { PreviewResult } from './transportSim';

/** Main-thread handle to the simulation worker. All calls are serialised, so edits and ticks never interleave. */
export class SimClient {
  private worker: Worker; private api: Comlink.Remote<SimApi>; private chain: Promise<unknown> = Promise.resolve(); private inflight = 0;
  lastTickMs = 0; tickListeners: Array<() => void> = [];
  constructor(private world: World, private game: Game) {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.api = Comlink.wrap<SimApi>(this.worker);
    game.gate = () => this.drain();
  }
  private enqueue<T>(f: () => Promise<T>): Promise<T> { this.inflight++; const p = this.chain.then(f, f); this.chain = p.then(() => { this.inflight--; }, () => { this.inflight--; }); return p; }
  /** Resolves when everything queued so far has finished. */
  drain(): Promise<void> { return this.chain.then(() => undefined, () => undefined); }
  get busy(): boolean { return this.inflight > 0; }
  /** Send the current world (after construction, an administrative edit or a load). The snapshot is taken now, the transfer happens in order. */
  push(): Promise<void> {
    const snap = makeSnapshot(this.world, this.game.nation);
    return this.enqueue(async () => { await this.api.sync(Comlink.transfer(snap, transferList(snap))); });
  }
  step(months = 1): Promise<void> {
    return this.enqueue(async () => {
      const t0 = performance.now(); const sig = () => this.world.regencies.map(r => r.status[0]).join('') + this.world.provinces.map(p => p.status[0] + (p.locked ? 'L' : '')).join(''); const before = sig(); const res = await this.api.step(months);
      applyResult(this.world, res); this.game.nation = res.nation; this.game.stats = res.stats;
      const changed = sig() !== before;
      this.lastTickMs = performance.now() - t0; this.game.afterTick(changed); this.tickListeners.forEach(f => f());
    });
  }
  /** Preview of a transport project (runs in the worker; queued behind any tick in flight). */
  preview(spec: ProjectSpec): Promise<PreviewResult> { return this.enqueue(async () => await this.api.preview(spec)); }
  save(meta: SaveMeta): Promise<Uint8Array> { return this.enqueue(async () => await this.api.save(meta)); }
}
