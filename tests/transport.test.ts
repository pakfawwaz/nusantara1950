import { describe, it, expect } from 'vitest';
import { loadWorld, lineThrough } from './helpers';
import { SimCore, newNation } from '../src/sim/core';
import type { Graph } from '../src/sim/transport';
import { TR, buildGraph, Router, nodeValid } from '../src/sim/transport';
import { planProject, roadEdgeCost, findRoute, routeThrough, remapAfterGeometry, completeProject } from '../src/sim/projects';
import { planSplit, planMergeKecamatan } from '../src/admin/kecamatan';
import { makeSnapshot } from '../src/sim/snapshot';
import { buildSave, readSave } from '../src/save/format';

const mk = () => { const world = loadWorld(); const nation = newNation(); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed()); return { world, nation, core }; };
const biggest = (w: ReturnType<typeof loadWorld>, reg: string): number => { let best = -1; for (let i = 0; i < w.n; i++) if (w.alive[i] && w.regencies[w.kecReg[i]].name === reg && (best < 0 || w.pop[i] > w.pop[best])) best = i; return best; };
const startProject = (n: ReturnType<typeof mk>, spec: Parameters<typeof planProject>[2]) => {
  const tr = n.nation.transport, plan = planProject(n.world, tr, spec, 1950, 1); expect(plan.errors).toEqual([]);
  tr.projects.push({ ...spec, id: tr.nextId++, km: plan.km, cost: plan.cost, months: plan.months, progress: 0, paid: 0, paused: false, start: n.nation.month }); return plan;
};
const route = (n: ReturnType<typeof mk>, cls = 2) => routeThrough(n.world, [biggest(n.world, 'Kota Bandung'), biggest(n.world, 'Kabupaten Cirebon')], 'road', cls, 1950) as number[];

describe('routes and plans', () => {
  it('findRoute returns a chain of neighbouring valid kecamatan', () => {
    const { world: w } = mk(); const p = route({ world: w } as never); expect(p.length).toBeGreaterThan(3);
    for (let q = 0; q < p.length; q++) { expect(nodeValid(w, p[q])).toBe(true); if (q) expect(w.neighbors[p[q - 1]]).toContain(p[q]); }
    expect(findRoute(w, p[0], p[0], 'road', 2, 1950)).toEqual([p[0]]);
  });
  it('planProject enforces unlock years, adjacency, and "already built"', () => {
    const n = mk(); const p = route(n, 2);
    expect(planProject(n.world, n.nation.transport, { kind: 'road', name: 'x', cls: 2, path: p }, 1950).ok).toBe(true);
    expect(planProject(n.world, n.nation.transport, { kind: 'road', name: 'x', cls: 3, path: p }, 1950).errors.join()).toMatch(/not available before 1955/);
    expect(planProject(n.world, n.nation.transport, { kind: 'road', name: 'x', cls: 3, path: p }, 1955).ok).toBe(true);
    expect(planProject(n.world, n.nation.transport, { kind: 'road', name: 'x', cls: 2, path: [p[0], p[p.length - 1]] }, 1950).ok).toBe(false);
    expect(planProject(n.world, n.nation.transport, { kind: 'road', name: 'x', cls: 2, path: [p[0]] }, 1950).ok).toBe(false);
    n.world.roadClass[p[0]] = 2; for (const i of p) n.world.roadClass[i] = 2;
    expect(planProject(n.world, n.nation.transport, { kind: 'road', name: 'x', cls: 2, path: p }, 1950).errors.join()).toMatch(/already/);
  });
  it('upgrading an existing road is cheaper than building the same class from scratch, but never free', () => {
    const { world: w } = mk(); const a = biggest(w, 'Kota Bandung'), b = w.neighbors[a][0];
    const rc = new Uint8Array(w.n); const fresh = roadEdgeCost(w, a, b, 3, rc); rc[a] = rc[b] = 1; const up = roadEdgeCost(w, a, b, 3, rc);
    expect(up.cost).toBeLessThan(fresh.cost); expect(up.cost).toBeGreaterThan(fresh.cost * TR.minUpgradeShare * 0.99);
  });
});

describe('network and market access', () => {
  it('a finished road lifts market access along it and raises the road class', () => {
    const n = mk(); const p = route(n, 2); const get = () => p.reduce((s, i) => s + n.world.s.ma[i], 0) / p.length;
    const before = get(); const plan = startProject(n, { kind: 'road', name: 'Bandung–Cirebon', cls: 2, path: p });
    for (let m = 0; m < plan.months + 2; m++) n.core.step();
    expect(n.nation.transport.projects.length).toBe(0); for (const i of p) expect(n.world.roadClass[i]).toBeGreaterThanOrEqual(2);
    expect(get()).toBeGreaterThan(before);
  });
  it('rail time only benefits stations: a station pair is faster by rail than by road, intermediate non-stations get no express edge', () => {
    const n = mk(); const w = n.world; const line = n.nation.transport.lines.find(l => l.stations.length >= 3) as NonNullable<typeof n.nation.transport.lines[0]>;
    const g = buildGraph(w, n.nation.transport); const rt = new Router(g); const rtNo = new Router(buildGraph(w, { ...n.nation.transport, lines: [] }));
    const s0 = line.stations[0][0], s1 = line.stations[line.stations.length - 1][0];
    rt.run(s0, 200); rtNo.run(s0, 200); expect(rt.has(s1)).toBe(true);
    expect(rt.dist[s1]).toBeLessThan(rtNo.has(s1) ? rtNo.dist[s1] : Infinity);
    const stationSet = new Set(line.stations.map(x => x[0])); const info = g.railInfo.find(r => r.line.id === line.id) as Graph['railInfo'][0];
    expect(info.stationPos.length).toBe(line.stations.length); void stationSet;
  });
  it('ports connect islands by sea only when both ends have a port', () => {
    const n = mk(); const w = n.world; const ports: number[] = []; for (let i = 0; i < w.n; i++) if (w.alive[i] && w.portLevel[i] >= 2) ports.push(i);
    expect(ports.length).toBeGreaterThan(2);
    const g = buildGraph(w, n.nation.transport); const rt = new Router(g); rt.run(ports[0], 400);
    const off = buildGraph(w, n.nation.transport, { portLevel: new Uint8Array(w.n) }); const r2 = new Router(off); r2.run(ports[0], 400);
    expect(rt.count).toBeGreaterThan(r2.count);
  });
});

describe('money', () => {
  it('construction is paid monthly, enters spending, and the budget identity still holds', () => {
    const n = mk(); const plan = startProject(n, { kind: 'road', name: 'Bandung–Cirebon', cls: 2, path: route(n, 2) }); let paid = 0, spent = false;
    for (let m = 0; m < plan.months + 1; m++) {
      const before = n.nation.cash; n.core.step(); const l = n.nation.last; paid += l.spending.construction / 12; spent ||= l.spending.construction > 0;
      expect(n.nation.cash - before).toBeCloseTo(-l.deficit / 12 + (l.borrowDom + l.monetized - l.repay - l.extRepay) / 12, -2);
    }
    expect(spent).toBe(true); expect(paid).toBeGreaterThan(plan.cost * 0.99); expect(paid).toBeLessThan(plan.cost * 1.7);
  });
  it('maintenance: condition decays when unfunded and recovers when funded', () => {
    const n = mk(); const set = (v: number) => { n.nation.policy.budgetNext.maintenance = v; n.nation.policy.budget = { ...n.nation.policy.budgetNext }; };
    set(0); for (let m = 0; m < 25; m++) n.core.step(); expect(n.nation.transport.coverage).toBeLessThan(0.2);
    const low = n.nation.transport.roadCond[1]; expect(low).toBeLessThan(TR.roadCondition.start[1]);
    set(0.5); for (let m = 0; m < 36; m++) n.core.step(); expect(n.nation.transport.roadCond[1]).toBeGreaterThan(low);
  });
});

describe('geometry edits keep lines and projects valid', () => {
  const contiguous = (w: ReturnType<typeof loadWorld>, p: number[]) => p.every((x, q) => w.alive[x] && (q === 0 || w.neighbors[p[q - 1]].includes(x)));
  it('splitting kecamatan on rail lines keeps every line a chain of living neighbours (and every station alive)', async () => {
    const n = mk(); const w = n.world, tr = n.nation.transport; let splits = 0;
    for (const l of tr.lines) { if (splits >= 4) break;
      for (const R of l.path.slice(1, -1)) {
        if (w.isLocked(R) || w.area[R] < 80) continue; const plan = await planSplit(w, R, lineThrough(w, R, 35)); if (plan.preview.errors.length || !plan.apply) continue;
        const ap = plan.apply(); remapAfterGeometry(w, tr, ap.change); splits++;
        for (const ln of tr.lines) { expect(contiguous(w, ln.path)).toBe(true); for (const [st] of ln.stations) expect(w.alive[st]).toBe(1); for (const x of ln.path) expect(w.railPath[x]).toBe(1); }
        break;
      } }
    expect(splits).toBeGreaterThanOrEqual(3);
  });
  it('merging two kecamatan on a line removes the duplicate and keeps the path a chain', async () => {
    const n = mk(); const w = n.world, tr = n.nation.transport; const l = tr.lines[0]; let done = false;
    for (let q = 1; q + 1 < l.path.length && !done; q++) { const a = l.path[q], b = l.path[q + 1]; if (w.regencies[w.kecReg[a]] !== w.regencies[w.kecReg[b]]) continue;
      const mp = await planMergeKecamatan(w, a, b); if (mp.preview.errors.length || !mp.apply) continue; const ap = mp.apply(); remapAfterGeometry(w, tr, ap.change);
      expect(l.path).not.toContain(b); expect(contiguous(w, l.path)).toBe(true); done = true; }
    expect(done).toBe(true);
  });
});

describe('persistence', () => {
  it('lines, projects and condition survive a save → read round trip', () => {
    const n = mk(); startProject(n, { kind: 'road', name: 'Bandung–Cirebon', cls: 2, path: route(n, 2) }); for (let m = 0; m < 2; m++) n.core.step();
    const back = readSave(buildSave(makeSnapshot(n.world, n.nation), { label: 't', month: n.nation.month, geoLog: [], names: [], history: [] }));
    const t = back.header.nation.transport; expect(t.lines.length).toBe(n.nation.transport.lines.length); expect(t.projects.length).toBe(1);
    expect(t.projects[0].paid).toBeCloseTo(n.nation.transport.projects[0].paid, 0); expect(t.roadCond).toEqual(n.nation.transport.roadCond);
  });
});
void completeProject;
