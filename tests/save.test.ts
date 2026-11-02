import { describe, it, expect } from 'vitest';
import { loadWorld } from './helpers';
import { SimCore, newNation } from '../src/sim/core';
import { makeSnapshot, simWorldFrom } from '../src/sim/snapshot';
import { buildSave, readSave } from '../src/save/format';

describe('snapshot and save format', () => {
  it('save → read round-trips every array and the nation bit-exactly', () => {
    const world = loadWorld(); const nation = newNation(); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed()); for (let m = 0; m < 14; m++) core.step();
    const snap = makeSnapshot(world, nation);
    const back = readSave(buildSave(snap, { label: 't', month: nation.month, geoLog: [], names: [], history: [] }));
    expect(Object.keys(back.rows).sort()).toEqual(Object.keys(snap.rows).sort());
    for (const [k, a] of Object.entries(snap.rows)) { const b = back.rows[k]; expect(b.length).toBe(a.length); expect(Buffer.from(b.buffer, b.byteOffset, b.byteLength).equals(Buffer.from(a.buffer, a.byteOffset, a.byteLength))).toBe(true); }
    expect(back.header.nation.month).toBe(nation.month); expect(back.header.nation.cash).toBe(nation.cash); expect(back.header.n).toBe(snap.n);
  });

  it('a simulation resumed from a loaded save tracks the uninterrupted one (within 0.1 %; not bit-exact: a resumed run recomputes the long-distance access layer fresh at its first January, the original reuses a cached one, and last month\'s per-unit stats restart)', () => {
    const world = loadWorld(); const nation = newNation(); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed()); for (let m = 0; m < 10; m++) core.step();
    const loaded = readSave(buildSave(makeSnapshot(world, nation), { label: 't', month: nation.month, geoLog: [], names: [], history: [] }));
    const snap2 = { n: loaded.header.n, rows: loaded.rows, neighbors: loaded.header.neighbors, kecReg: loaded.rows.kecReg as Int32Array ?? makeSnapshot(world, nation).kecReg, regProv: makeSnapshot(world, nation).regProv, regencies: loaded.header.regencies, provinces: loaded.header.provinces, nation: loaded.header.nation };
    const core2 = new SimCore(simWorldFrom(snap2 as never), snap2.nation); // resumed copy (no bootstrap)
    for (let m = 0; m < 8; m++) { core.step(); core2.step(); }
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(Math.abs(b) * 1e-3); near(core2.nation.cash, nation.cash); near(core2.nation.agg.gdp, nation.agg.gdp); near(core2.nation.agg.pop, nation.agg.pop); expect(core2.nation.month).toBe(nation.month);
  });
});
