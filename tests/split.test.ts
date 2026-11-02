import { describe, it, expect } from 'vitest';
import { loadWorld, lineThrough } from './helpers';
import { planSplit, planMergeKecamatan } from '../src/admin/kecamatan';

const sumArr = (a: Float64Array, i: number) => { let t = 0; for (let s = 0; s < 10; s++) t += a[i * 10 + s]; return t; };
const sum = (w: ReturnType<typeof loadWorld>, arr: Float64Array | Float32Array, ids: number[]) => ids.reduce((s, i) => s + arr[i], 0);

describe('split kecamatan', () => {
  it('cuts a large kecamatan, conserves area within 0.5%, people and output exactly', async () => {
    const w = loadWorld();
    // pick a mid-sized inland kecamatan with population
    let R = -1; for (let i = 0; i < w.n; i++) if (w.area[i] > 150 && w.area[i] < 400 && w.pop[i] > 20000 && !w.coastal[i] && !w.isLocked(i)) { R = i; break; }
    expect(R).toBeGreaterThanOrEqual(0);
    const lab0 = sumArr(w.s.lab, R); const pop0 = w.pop[R], grdp0 = w.grdp[R], cap0 = w.capStock[R], area0 = w.area[R], urb0 = w.urban[R] * w.pop[R];
    const nb0 = [...w.neighbors[R]];
    const plan = await planSplit(w, R, lineThrough(w, R, 35));
    expect(plan.preview.errors).toEqual([]); expect(plan.apply).toBeDefined();
    const nBefore = w.n; const ap = (plan.apply as () => ReturnType<NonNullable<typeof plan.apply>>)();
    const ids = [R, ...ap.change.upserted.filter(x => x !== R)];
    expect(ids.length).toBeGreaterThanOrEqual(2); expect(w.n).toBe(nBefore + ids.length - 1);
    expect(sum(w, w.area, ids)).toBeCloseTo(area0, 3);
    expect(Math.abs(sum(w, w.pop, ids) - pop0)).toBeLessThan(1e-6);
    expect(Math.abs(sum(w, w.grdp, ids) - grdp0) / grdp0).toBeLessThan(1e-9);
    expect(Math.abs(sum(w, w.capStock, ids) - cap0) / cap0).toBeLessThan(1e-9);
    expect(Math.abs(ids.reduce((s, i) => s + w.urban[i] * w.pop[i], 0) - urb0)).toBeLessThan(1e-3);
    for (const i of ids) { let t = 0; for (let s = 0; s < 10; s++) t += w.s.out[i * 10 + s]; expect(Math.abs(t - w.grdp[i]) / Math.max(1, w.grdp[i])).toBeLessThan(1e-9); }
    expect(Math.abs(ids.reduce((q, i) => q + sumArr(w.s.lab, i), 0) - lab0) / lab0).toBeLessThan(1e-9);
    // adjacency: pieces touch each other, every old neighbour still touches some piece, and nobody still points at a stale slot
    for (const a of ids) expect(w.neighbors[a].some(b => ids.includes(b))).toBe(true);
    for (const nb of nb0) expect(w.neighbors[nb].some(b => ids.includes(b))).toBe(true);
    for (let i = 0; i < w.n; i++) if (w.alive[i]) for (const j of w.neighbors[i]) { expect(w.alive[j]).toBe(1); expect(w.neighbors[j]).toContain(i); }
    // regency membership
    const reg = w.regencies[w.kecReg[R]]; for (const i of ids) expect(reg.kec).toContain(i);
    // undo restores everything
    const ch = ap.undo(); expect(ch.removed.length).toBe(ids.length - 1);
    expect(w.n).toBe(nBefore); expect(w.pop[R]).toBe(pop0); expect(w.grdp[R]).toBe(grdp0); expect(w.area[R]).toBeCloseTo(area0, 4);
    expect(w.neighbors[R]).toEqual(nb0); expect(w.regencies[w.kecReg[R]].kec).not.toContain(nBefore);
  });

  it('works at many angles and rejects slivers / non-crossing lines', async () => {
    const w = loadWorld(); let R = -1; for (let i = 0; i < w.n; i++) if (w.area[i] > 300 && w.pop[i] > 5000 && !w.isLocked(i)) { R = i; break; }
    let okCount = 0;
    for (const deg of [0, 20, 45, 70, 90, 115, 140, 160]) {
      const plan = await planSplit(w, R, lineThrough(w, R, deg)); if (plan.apply) { const ap = plan.apply(); okCount++; const ids = ap.change.upserted; expect(Math.abs(sum(w, w.area, ids) - w.area[R] - ids.slice(1).reduce((s, i) => s + w.area[i], 0))).toBeLessThan(1); ap.undo(); }
    }
    expect(okCount).toBeGreaterThanOrEqual(6);
    const short = lineThrough(w, R, 10, 0.05); const bad = await planSplit(w, R, short); expect(bad.apply).toBeUndefined(); expect(bad.preview.errors.length).toBeGreaterThan(0);
    // a line grazing the very edge produces a sliver
    const bb = w.bbox; const lon = bb[R * 4] + (bb[R * 4 + 2] - bb[R * 4]) * 0.001; const sl = await planSplit(w, R, [[lon, bb[R * 4 + 1] - 1], [lon, bb[R * 4 + 3] + 1]]); expect(sl.apply).toBeUndefined();
  });

  it('merge after split restores area and undo restores state', async () => {
    const w = loadWorld(); let R = -1; for (let i = 0; i < w.n; i++) if (w.area[i] > 120 && w.pop[i] > 10000 && !w.isLocked(i)) { R = i; break; }
    const area0 = w.area[R], pop0 = w.pop[R], grdp0 = w.grdp[R];
    const sp = await planSplit(w, R, lineThrough(w, R, 60)); const a1 = (sp.apply as () => ReturnType<NonNullable<typeof sp.apply>>)();
    const other = a1.change.upserted.find(x => x !== R) as number;
    const mp = await planMergeKecamatan(w, R, other); expect(mp.preview.errors).toEqual([]);
    const a2 = (mp.apply as () => ReturnType<NonNullable<typeof mp.apply>>)();
    expect(w.alive[other]).toBe(0); expect(Math.abs(w.area[R] - area0)).toBeLessThan(1e-3); expect(Math.abs(w.pop[R] - pop0)).toBeLessThan(1e-6); expect(Math.abs(w.grdp[R] - grdp0) / grdp0).toBeLessThan(1e-9);
    for (let i = 0; i < w.n; i++) if (w.alive[i]) for (const j of w.neighbors[i]) expect(w.alive[j]).toBe(1);
    a2.undo(); expect(w.alive[other]).toBe(1); expect(w.area[R] + w.area[other]).toBeCloseTo(area0, 3);
    a1.undo(); expect(w.pop[R]).toBe(pop0);
  });
});
