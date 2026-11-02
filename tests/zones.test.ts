import { describe, it, expect } from 'vitest';
import { loadWorld } from './helpers';
import { SimCore, newNation } from '../src/sim/core';
import { checkZone, createZone, editZone, removeZone, remapZones, zoneRows, zoneCost, organicIndustry } from '../src/sim/zones';
import { laneProximity, laneRows } from '../src/sim/lanes';
import type { SimWorld } from '../src/sim/types';

const mk = () => { const world = loadWorld(); const nation = newNation(1); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed()); return { world: world as unknown as SimWorld, nation, core }; };

describe('special areas, organic industry, shipping lanes', { timeout: 120000 }, () => {
  it('creates, validates, edits and dissolves a special area; cost is charged', () => {
    const { world: w, nation: n } = mk(); const alive = [...Array(w.n).keys()].filter(i => w.alive[i]); const kecs = alive.slice(0, 3);
    expect(checkZone(w, n, { name: '', kecs, pphCut: 0.3, ease: 0.3 })).toMatch(/name/); expect(checkZone(w, n, { name: 'x', kecs: [], pphCut: 0.3, ease: 0.3 })).toMatch(/Select/); expect(checkZone(w, n, { name: 'x', kecs, pphCut: 0.99, ease: 0.3 })).toMatch(/range/);
    n.cash = 1e18; const c0 = n.cash, cost = zoneCost(n, 3); expect(cost).toBeGreaterThan(0);
    expect(createZone(w, n, { name: 'Otorita A', kecs, pphCut: 0.5, ease: 0.4 })).toBe(''); expect(n.cash).toBeCloseTo(c0 - cost, -3);
    expect(createZone(w, n, { name: 'Overlap', kecs: [kecs[0]], pphCut: 0.1, ease: 0 })).toMatch(/already belongs/);
    const cut = new Float64Array(w.n), ease = new Float64Array(w.n); zoneRows(w, n, cut, ease); expect(cut[kecs[1]]).toBe(0.5); expect(ease[kecs[2]]).toBe(0.4); expect(cut[alive[10]]).toBe(0);
    expect(editZone(w, n, n.zones.list[0].id, { pphCut: 0.2 })).toBe(''); expect(n.zones.list[0].pphCut).toBe(0.2);
    n.cash = 0; expect(createZone(w, n, { name: 'Poor', kecs: [alive[20]], pphCut: 0.1, ease: 0 })).toMatch(/cash/);
    expect(removeZone(n, n.zones.list[0].id)).toBe(true); expect(n.zones.list).toHaveLength(0);
  });
  it('a zone loses revenue from the tax cut but keeps its kecamatan after a merge', () => {
    const { world: w, nation: n } = mk(); const alive = [...Array(w.n).keys()].filter(i => w.alive[i]); n.cash = 1e18; createZone(w, n, { name: 'Z', kecs: [alive[0], alive[1]], pphCut: 0.5, ease: 0 });
    remapZones(w, n, { removed: [alive[1]], upserted: [alive[0]] }); expect(n.zones.list[0].kecs).toEqual([alive[0]]);
    remapZones(w, n, { removed: [alive[0]], upserted: [alive[5]] }); expect(n.zones.list[0].kecs).toContain(alive[5]);
  });
  it('organic industry: private plants appear, are privately owned, and a tax cut raises their number', () => {
    const run = (cutAll: number) => {
      const { world: w, nation: n, core } = mk(); n.month = 12 * 45 + 1; n.agg.gdp = Math.max(n.agg.gdp, 1); n.zones.gdp0 = n.agg.gdp; n.fin.climate = 70; n.stability = 75; n.policy.rates.pph = 0.34;
      for (let i = 0; i < w.n; i++) if (w.alive[i]) { w.elec[i] = 0.9; w.mys[i] = Math.max(w.mys[i], 6); }
      const cut = new Float64Array(w.n).fill(cutAll); let made = 0; for (let y = 0; y < 8; y++) { n.month += 12; made += organicIndustry(w, n, 1950 + Math.floor(n.month / 12), cut); } void core;
      return { made, n };
    };
    const low = run(0), high = run(0.7); expect(low.made).toBeGreaterThan(0); expect(high.made).toBeGreaterThanOrEqual(low.made);
    for (const x of low.n.ind.list) { expect(x.financing).toBe('private'); expect(x.state).toBe(0); expect(x.priv).toBe(1); }
  });
  it('shipping lanes: places near a lane with a port get a bonus, far ones do not', () => {
    const { world: w, nation: n } = mk(); const prox = new Float64Array(w.n), out = new Float64Array(w.n); laneProximity(w, prox);
    expect(prox.some(v => v > 0.5)).toBe(true); expect(prox.some(v => v === 0)).toBe(true);
    let near = -1, far = -1; for (let i = 0; i < w.n; i++) if (w.alive[i]) { if (near < 0 && prox[i] > 0.7) near = i; if (far < 0 && prox[i] === 0) far = i; }
    w.portLevel[near] = 3; w.portLevel[far] = 3; laneRows(w, n, prox, out); expect(out[near]).toBeGreaterThan(0.03); expect(out[near]).toBeLessThanOrEqual(0.12 + 1e-9); expect(out[far]).toBe(0);
    w.portLevel[near] = 0; laneRows(w, n, prox, out); expect(out[near]).toBe(0);
  });
});
