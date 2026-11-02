import type { World } from '../world';
import { SIM_KEYS } from './fields';
import type { Nation, SimWorld, UnitStats } from './types';

export type TA = Float64Array | Float32Array | Uint8Array | Uint16Array | Int32Array;
export interface UnitSnap { id: string; name: string; type: 'kabupaten' | 'kota'; prov: string; capital: number; kec: number[]; merged: string[]; status: 'preparing' | 'active'; activeMonth: number }
export interface ProvSnap { id: string; name: string; locked: boolean; capital: number; joinYear: number | null; status: 'preparing' | 'active'; activeMonth: number }
/** Everything the simulation worker needs: all per-kecamatan rows plus the administrative structure and the nation state. */
export interface Snapshot { n: number; rows: Record<string, TA>; neighbors: number[][]; kecReg: Int32Array; regProv: Int32Array; regencies: UnitSnap[]; provinces: ProvSnap[]; nation: Nation }
export interface StepResult { month: number; rows: Record<string, TA>; nation: Nation; stats: UnitStats; regStatus: Array<'preparing' | 'active'>; provStatus: Array<'preparing' | 'active'>; provLocked: boolean[] }

/** Arrays the simulation changes every month (everything else is static between edits). */
export const DYN_BASE = ['pop', 'grdp', 'urban', 'lit', 'mys', 'eys', 'life', 'poverty', 'elec', 'water', 'capStock', 'age0', 'age65', 'density', 'gdppc', 'ipm', 'roadClass', 'railStation', 'railPath', 'portLevel'] as const;
export const DYN_NAMES: string[] = [...DYN_BASE, ...SIM_KEYS.map(k => `s.${k}`)];

export function makeSnapshot(w: World, nation: Nation): Snapshot {
  const n = w.n, rows: Record<string, TA> = {};
  for (const f of w.rowFields) rows[f.name] = (f.a as TA).slice(0, n * f.stride) as TA;
  rows.alive = w.alive.slice(0, n);
  return { n, rows, neighbors: w.neighbors.slice(0, n), kecReg: w.kecReg.slice(0, n), regProv: w.regProv.slice(), nation: structuredClone(nation),
    regencies: w.regencies.map(r => ({ id: r.id, name: r.name, type: r.type, prov: r.prov, capital: r.capital, kec: [...r.kec], merged: [...r.merged], status: r.status, activeMonth: r.activeMonth })),
    provinces: w.provinces.map(p => ({ id: p.id, name: p.name, locked: p.locked, capital: p.capital, joinYear: p.joinYear, status: p.status, activeMonth: p.activeMonth })) };
}
export const transferList = (s: Snapshot): ArrayBuffer[] => [...Object.values(s.rows).map(a => a.buffer as ArrayBuffer), s.kecReg.buffer as ArrayBuffer, s.regProv.buffer as ArrayBuffer];

/** Plain object with the field names SimCore reads (what World provides on the main thread). */
export function simWorldFrom(s: Snapshot): SimWorld {
  const r = s.rows as Record<string, never>; const sim: Record<string, unknown> = {};
  for (const k of SIM_KEYS) sim[k] = s.rows[`s.${k}`];
  const o = { n: s.n, alive: r.alive, area: r.area, pop: r.pop, grdp: r.grdp, urban: r.urban, lit: r.lit, mys: r.mys, eys: r.eys, life: r.life, poverty: r.poverty, elec: r.elec, water: r.water, capStock: r.capStock, age0: r.age0, age65: r.age65,
    labelLon: r.labelLon, labelLat: r.labelLat, density: r.density, gdppc: r.gdppc, ipm: r.ipm, coastal: r.coastal, terrain: r.terrain, swamp: r.swamp, roadClass: r.roadClass, railStation: r.railStation, railPath: r.railPath, portLevel: r.portLevel, neighbors: s.neighbors, kecReg: s.kecReg, regProv: s.regProv, regencies: s.regencies, provinces: s.provinces, s: sim };
  return o as unknown as SimWorld;
}

/** Copy a step result back into the main-thread world. */
export function applyResult(w: World, res: StepResult): void {
  const by = new Map(w.rowFields.map(f => [f.name, f] as const));
  for (const name of DYN_NAMES) { const f = by.get(name), src = res.rows[name]; if (f && src) (f.a as TA).set(src.subarray(0, Math.min(src.length, w.n * f.stride))); }
  w.regencies.forEach((r, k) => { if (res.regStatus[k]) r.status = res.regStatus[k]; });
  w.provinces.forEach((p, k) => { if (res.provStatus[k]) p.status = res.provStatus[k]; if (res.provLocked && res.provLocked[k] !== undefined) p.locked = res.provLocked[k]; });
}
export function resultRows(w: SimWorld & { n: number }, names: string[]): { rows: Record<string, TA>; buffers: ArrayBuffer[] } {
  const rows: Record<string, TA> = {}, buffers: ArrayBuffer[] = []; const flat: Record<string, TA> = {};
  for (const nm of DYN_BASE) flat[nm] = (w as unknown as Record<string, TA>)[nm];
  for (const k of SIM_KEYS) flat[`s.${k}`] = (w.s as unknown as Record<string, TA>)[k];
  for (const nm of names) { const c = flat[nm].slice(); rows[nm] = c; buffers.push(c.buffer as ArrayBuffer); }
  return { rows, buffers };
}
