import type { SimClient } from '../sim/client';
import type { Game } from '../game';
import type { World } from '../world';
import { AUTO_SLOTS, writeSlot } from './store';
import { makeMeta } from './restore';
import { dateText } from '../ui/topbar';

/** Rolling three-slot autosave, written after a game month but no more often than `minSeconds` of real time (the worker builds the compressed save, so the UI never stalls). */
export class Autosaver {
  enabled = true; minSeconds = 8; private last = performance.now(); private counter = 0; private busy = false; lastSavedMonth = -1; lastOk = true;
  constructor(private sim: SimClient, private game: Game, private world: World) {}
  async now(slot: string, label: string, kind: 'auto' | 'manual'): Promise<boolean> {
    const bytes = await this.sim.save(makeMeta(this.world, this.game, label)); const g = this.game;
    return writeSlot(slot, bytes, { label, month: g.month, date: dateText(g.month), gdppc: g.nation.agg.gdppc, kind });
  }
  async tick(): Promise<void> {
    if (!this.enabled || this.busy || this.game.month === this.lastSavedMonth || (performance.now() - this.last) / 1000 < this.minSeconds) return;
    this.busy = true;
    try { this.lastOk = await this.now(AUTO_SLOTS[this.counter++ % AUTO_SLOTS.length], `Autosave · ${dateText(this.game.month)}`, 'auto'); this.lastSavedMonth = this.game.month; } finally { this.busy = false; this.last = performance.now(); }
  }
}
