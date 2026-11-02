import type { SimClient } from './client';

/** Real milliseconds per game month at speeds 1..4 (0 = paused). */
export const SPEED_MS = [Infinity, 3200, 1600, 700, 250];
export class Clock {
  speed = 0; private acc = 0; private last = 0; private listeners: Array<(s: number) => void> = []; blocked = false;
  constructor(private sim: SimClient) { requestAnimationFrame(t => this.loop(t)); }
  onSpeed(f: (s: number) => void): void { this.listeners.push(f); }
  set(s: number): void { if (s === this.speed) return; this.speed = s; this.acc = 0; this.listeners.forEach(f => f(s)); }
  toggle(): void { this.set(this.speed === 0 ? 1 : 0); }
  private loop(t: number): void {
    const dt = Math.min(250, t - this.last); this.last = t;
    if (this.speed > 0 && !this.blocked) {
      this.acc += dt;
      if (this.acc >= SPEED_MS[this.speed] && !this.sim.busy) { this.acc = 0; void this.sim.step(1); }
      else if (this.acc > SPEED_MS[this.speed] * 3) this.acc = SPEED_MS[this.speed]; // the worker is slower than the clock: drop time instead of queueing ticks
    }
    requestAnimationFrame(x => this.loop(x));
  }
}
