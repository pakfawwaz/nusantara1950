import { describe, it, expect } from 'vitest';
import { loadWorld } from './helpers';
import { Game } from '../src/game';
import { Demands } from '../src/demands';
import { SimCore, newNation } from '../src/sim/core';

describe('regional petitions', { timeout: 300000 }, () => {
  it('petitions appear, can be granted (through the normal command rules) or declined with a cooldown', async () => {
    const w = loadWorld(), g = new Game(w); const seen: string[] = []; const d = new Demands(g, p => seen.push(p.kind));
    g.nation.stability = 20; g.cash = 1e18; let guard = 0; const kinds = new Set<string>();
    while (guard++ < 30 && g.nation.petitions.list.length < 3) { g.nation.month = 12 * 20 + 6 * guard + (3 - ((12 * 20 + 6 * guard) % 6)); await d.tick(); g.nation.petitions.list.forEach(p => kinds.add(p.kind)); g.nation.month += 0; if (g.nation.petitions.list.length) break; }
    const list = g.nation.petitions.list; expect(list.length).toBeGreaterThan(0); const p = list[0];
    expect(p.title.length).toBeGreaterThan(5); expect(p.support).toBeGreaterThanOrEqual(0.5); expect(p.cost).toBeGreaterThanOrEqual(0); expect(p.due).toBeGreaterThan(p.month);
    const before = { regs: w.regencies.length, provs: w.provinces.length, kec: w.alive.reduce((s: number, a: number) => s + a, 0) };
    if (list.length > 1) { const q = list[1]; const h0 = g.nation.adminHits; d.refuse(q.id); expect(g.nation.adminHits).toBeGreaterThan(h0); expect(g.nation.petitions.refused[q.key]).toBeDefined(); expect(g.nation.petitions.list.some(x => x.id === q.id)).toBe(false); }
    const r = await d.grant(p.id); expect(r.ok, r.error).toBe(true); expect(g.nation.petitions.list.some(x => x.id === p.id)).toBe(false);
    const after = { regs: w.regencies.length, provs: w.provinces.length, kec: w.alive.reduce((s: number, a: number) => s + a, 0) };
    expect(JSON.stringify(after) !== JSON.stringify(before) || p.kind === 'switchProvince').toBe(true);
  });
  it('a petition left unanswered expires with a stability cost', async () => {
    const w = loadWorld(), g = new Game(w); const d = new Demands(g, () => {}); g.nation.stability = 20; g.cash = 1e18;
    for (let k = 0; k < 30 && !g.nation.petitions.list.length; k++) { g.nation.month = 12 * 20 + 6 * k + 3 - ((12 * 20 + 6 * k) % 6) + 6; await d.tick(); }
    const p = g.nation.petitions.list[0]; expect(p).toBeDefined(); g.nation.month = p.due + 1; const h0 = g.nation.adminHits; await d.tick(); expect(g.nation.petitions.list.some(x => x.id === p.id)).toBe(false); expect(g.nation.adminHits).toBeGreaterThan(h0);
  });
});

describe('migration follows access', { timeout: 120000 }, () => {
  it('people move towards places with power, water and roads at equal income, and the total is conserved', () => {
    const world = loadWorld(); const nation = newNation(1); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed());
    const w = world as never as { n: number; alive: Uint8Array; pop: Float64Array; elec: Float64Array; water: Float64Array; roadClass: Uint8Array; neighbors: number[][]; grdp: Float64Array };
    let a = -1, b = -1; for (let i = 0; i < w.n && a < 0; i++) if (w.alive[i] && w.pop[i] > 5000) for (const j of w.neighbors[i]) if (w.alive[j] && w.pop[j] > 5000) { a = i; b = j; break; }
    const pcA = w.grdp[a] / w.pop[a]; w.grdp[b] = pcA * w.pop[b]; w.elec[a] = 0.02; w.water[a] = 0.05; w.roadClass[a] = 0; w.elec[b] = 0.95; w.water[b] = 0.9; w.roadClass[b] = 4;
    let tot0 = 0; for (let i = 0; i < w.n; i++) if (w.alive[i]) tot0 += w.pop[i]; const pa0 = w.pop[a], pb0 = w.pop[b];
    for (let t = 0; t < 12; t++) core.migrate(1 / 12);
    let tot1 = 0; for (let i = 0; i < w.n; i++) if (w.alive[i]) tot1 += w.pop[i];
    expect(Math.abs(tot1 - tot0) / tot0).toBeLessThan(1e-9); expect(w.pop[a]).toBeLessThan(pa0); expect(w.pop[b]).toBeGreaterThan(pb0 - 1);
  });
});
