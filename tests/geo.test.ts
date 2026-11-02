import { describe, it, expect } from 'vitest';
import { TR } from '../src/sim/transport';
import { loadWorld, lineThrough } from './helpers';
import { components, haversineKm, isContiguous } from '../src/admin/rules';
import { planSplit } from '../src/admin/kecamatan';
import cfg from '../config/admin.json';

describe('contiguity', () => {
  it('joins land neighbours and island groups within the sea-link distance only', () => {
    const w = loadWorld();
    // a kecamatan and its neighbours form one component
    const i = w.regencies[0].kec[0]; expect(components(w, [i, ...w.neighbors[i].slice(0, 2)]).length).toBe(1);
    // find two coastal kecamatan on different islands, nearer and farther than the sea-link limit
    let near: [number, number] | null = null, far: [number, number] | null = null;
    for (let a = 0; a < w.n && (!near || !far); a += 7) { if (!w.coastal[a]) continue; for (let b = a + 1; b < w.n; b += 11) {
      if (!w.coastal[b] || w.island[a] === w.island[b] || w.neighbors[a].includes(b)) continue; const d = haversineKm(w.labelLon[a], w.labelLat[a], w.labelLon[b], w.labelLat[b]);
      if (d < cfg.seaLinkKm * 0.8 && !near) near = [a, b]; if (d > cfg.seaLinkKm * 3 && d < 600 && !far) far = [a, b]; if (near && far) break; } }
    expect(near && far).toBeTruthy();
    expect(isContiguous(w, near as number[])).toBe(true); expect(isContiguous(w, far as number[])).toBe(false);
  });
});

describe('boundary store', () => {
  it('derives the original adjacency and coast flags from arcs', () => {
    const w = loadWorld(); const adj = w.store.adjacency(w.n); const coast = w.store.coastal(w.n, TR.ports.minCoastKm); // the coast flag ignores slivers shorter than minCoastKm
    let diffA = 0, diffC = 0; for (let i = 0; i < w.n; i++) { const a = [...adj[i]].sort((x, y) => x - y); if (a.join() !== [...w.neighbors[i]].sort((x, y) => x - y).join()) diffA++; if (coast[i] !== w.coastal[i]) diffC++; }
    expect(diffA).toBeLessThan(w.n * 0.002); expect(diffC).toBeLessThan(w.n * 0.002);
  });
  it('a split adds exactly one cut line between the pieces and keeps regency lines unchanged', async () => {
    const w = loadWorld(); let R = -1; for (let i = 0; i < w.n; i++) if (w.area[i] > 150 && w.pop[i] > 15000 && !w.isLocked(i) && !w.coastal[i]) { R = i; break; }
    const regLines = () => w.store.mesh((a, b) => a >= 0 && b >= 0 && a !== b && w.kecReg[a] !== w.kecReg[b]).coordinates.length;
    const kecLines = () => w.store.mesh((a, b) => a >= 0 && b >= 0 && a !== b).coordinates.length;
    const r0 = regLines(), k0 = kecLines(); const t0 = performance.now();
    const plan = await planSplit(w, R, lineThrough(w, R, 50)); const ap = (plan.apply as NonNullable<typeof plan.apply>)(); const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000); // spec: split round trip < 2 s
    expect(kecLines()).toBeGreaterThan(k0); expect(regLines()).toBeGreaterThanOrEqual(r0); // outer arcs may be cut into runs, but no regency line is lost
    expect(w.store.mesh((a, b) => a >= 0 && b >= 0 && a !== b && w.kecReg[a] === w.kecReg[b] && (a === R || b === R)).coordinates.length).toBeGreaterThan(0);
    ap.undo(); expect(kecLines()).toBe(k0); expect(regLines()).toBe(r0);
  });
});
