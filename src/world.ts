import type { RawData } from './data/loaders';
import { ipmFrom } from './sim/ipm';
import { SIM_FIELDS, SIM_KEYS, makeSimArrays, SECTORS } from './sim/fields';
import type { SimArrays } from './sim/fields';
import { B } from './sim/balance';
import { ArcStore } from './geo/arcs';
import type { Grid } from './geo/grid';
import adminCfg from '../config/admin.json';
import { newTransport, TR } from './sim/transport';
import { IC, RES_TYPE, TYPE, newIndState } from './sim/industry';
import type { IndState } from './sim/industry';
import type { TransportState } from './sim/transport';

export type UnitStatus = 'preparing' | 'active';
export interface Regency { id: string; name: string; type: 'kabupaten' | 'kota'; prov: string; capital: number; kec: number[]; merged: string[]; status: UnitStatus; activeMonth: number }
export interface Province { id: string; name: string; locked: boolean; capital: number; joinYear: number | null; status: UnitStatus; activeMonth: number }
export interface Agg {
  count: number; pop: number; area: number; density: number; grdp: number; gdppc: number; urban: number; literacy: number; mys: number; eys: number; life: number;
  poverty: number; elec: number; water: number; capitalStock: number; ipm: number;
  laborShare: number[]; outputShare: number[]; age0_14: number; age65: number;
  tax: number; stab: number; fund: number;
}

export const SECTOR_LABELS = ['Food crops', 'Plantation', 'Fisheries', 'Forestry', 'Mining', 'Oil & gas', 'Manufacturing', 'Construction', 'Trade & services', 'Tourism'];
export const RESOURCE_KNOWN_AT_START = (r: { hidden: boolean; knownYear: number | null }) => !r.hidden && (!r.knownYear || r.knownYear <= 1950);

type Num = Float64Array | Float32Array | Uint8Array | Uint16Array | Int32Array;
const cap = <T extends Num>(Ctor: { new (n: number): T; from(a: ArrayLike<number>): T }, src: ArrayLike<number>, n: number, stride = 1): T => { const a = new Ctor(n * stride); a.set(Ctor.from(src) as never); return a; };
const capMap = <T extends Num>(Ctor: { new (n: number): T; from(a: ArrayLike<number>, f?: (v: number) => number): T }, src: ArrayLike<number>, n: number, f: (v: number) => number): T => { const a = new Ctor(n); a.set(Ctor.from(src, f) as never); return a; };

/** Central game model: raw data plus the mutable administrative structure and editable geometry. Slots 0..n-1; dead (merged-away) slots have alive=0. */
export class World {
  n: number; readonly n0: number; readonly capacity: number;
  readonly ids: string[]; readonly idIndex: Map<string, number>;
  readonly names: string[]; readonly modernKab: string[]; readonly modernProv: string[]; readonly codes: string[];
  readonly lineage = new Map<string, string>(); // child id -> parent id (splits)
  readonly alive: Uint8Array;
  readonly area: Float32Array; readonly labelLon: Float32Array; readonly labelLat: Float32Array;
  readonly bbox: Float32Array; // [minx,miny,maxx,maxy] per kecamatan
  neighbors: number[][]; readonly coastal: Uint8Array; readonly island: Int32Array; islandSizes: number[];
  // attributes (start state)
  readonly pop: Float64Array; readonly grdp: Float64Array; readonly urban: Float64Array; readonly lit: Float64Array; readonly mys: Float64Array; readonly eys: Float64Array;
  readonly life: Float64Array; readonly poverty: Float64Array; readonly elec: Float64Array; readonly water: Float64Array; readonly capStock: Float64Array;
  readonly age0: Float64Array; readonly age65: Float64Array;
  readonly terrain: Uint8Array; readonly swamp: Uint8Array; readonly roadClass: Uint8Array; readonly railStation: Uint8Array; readonly railPath: Uint8Array; readonly portLevel: Uint8Array;
  readonly schoolLevel: Uint8Array; readonly healthLevel: Uint8Array; readonly spec1: Uint8Array; readonly spec2: Uint8Array; readonly specMult: Float64Array;
  readonly isCapitalSeed: Uint8Array; readonly culture: Uint8Array; readonly elev: Float32Array;
  readonly s: SimArrays; // simulation state, baselines and monthly results (see sim/fields.ts)
  readonly density: Float64Array; readonly gdppc: Float64Array; readonly ipm: Float64Array;
  /** Every per-kecamatan array with its stride; used to copy / snapshot / restore whole rows. */
  readonly rowFields: Array<{ name: string; a: Num; stride: number }>;
  // administrative structure (mutable)
  provinces: Province[]; regencies: Regency[];
  kecReg: Int32Array; regProv: Int32Array;
  provIndex = new Map<string, number>(); regIndex = new Map<string, number>();
  readonly raw: RawData;
  readonly features: RawData['features']; // current polygon per slot (lon/lat)
  readonly samples: number[][];
  readonly store: ArcStore; readonly grid: Grid;

  constructor(raw: RawData) {
    this.raw = raw; const { geo, attrs, features } = raw; const n0 = geo.ids.length; this.n = n0; this.n0 = n0; const N = (this.capacity = n0 + adminCfg.maxNewKecamatan);
    this.ids = [...geo.ids]; this.idIndex = new Map(geo.ids.map((id, i) => [id, i]));
    this.names = features.map(f => f.properties.name); this.modernKab = features.map(f => f.properties.kab_name); this.modernProv = features.map(f => f.properties.prov_name);
    this.codes = features.map(f => f.properties.id);
    this.features = [...features]; this.samples = [...raw.popSamples];
    this.store = new ArcStore(raw.topo, raw.kecObj); this.grid = this.store.grid;
    this.alive = new Uint8Array(N).fill(0, n0); this.alive.fill(1, 0, n0);
    this.area = cap(Float32Array, geo.area_km2, N); this.labelLon = cap(Float32Array, geo.label[0], N); this.labelLat = cap(Float32Array, geo.label[1], N);
    this.neighbors = [...geo.neighbors]; this.coastal = cap(Uint8Array, this.store.coastal(n0, TR.ports.minCoastKm), N); this.island = cap(Int32Array, geo.island, N); this.islandSizes = [...geo.islandSizes];
    this.bbox = new Float32Array(N * 4);
    features.forEach((f, i) => {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      this.bbox.set([x0, y0, x1, y1], i * 4);
    });
    this.pop = cap(Float64Array, attrs.population, N); this.grdp = capMap(Float64Array, attrs.grdp_rp_million, N, v => v * 1e6);
    this.urban = cap(Float64Array, attrs.urban, N); this.lit = cap(Float64Array, attrs.literacy, N); this.mys = cap(Float64Array, attrs.meanYearsSchooling, N);
    this.eys = cap(Float64Array, attrs.expectedYearsSchooling, N); this.life = cap(Float64Array, attrs.lifeExpectancy, N); this.poverty = cap(Float64Array, attrs.poverty, N);
    this.elec = cap(Float64Array, attrs.electrification, N); this.water = cap(Float64Array, attrs.cleanWater, N); this.capStock = capMap(Float64Array, attrs.capital_rp_million, N, v => v * 1e6);
    this.age0 = cap(Float64Array, attrs.age0_14, N); this.age65 = cap(Float64Array, attrs.age65, N);
    this.terrain = cap(Uint8Array, attrs.terrain, N); this.swamp = cap(Uint8Array, attrs.swamp, N); this.roadClass = cap(Uint8Array, attrs.roadClass, N);
    this.railStation = cap(Uint8Array, attrs.railStation, N); this.railPath = cap(Uint8Array, attrs.railPath, N); this.portLevel = cap(Uint8Array, attrs.portLevel, N);
    this.schoolLevel = cap(Uint8Array, attrs.schoolLevel, N); this.healthLevel = cap(Uint8Array, attrs.healthLevel, N);
    this.spec1 = cap(Uint8Array, attrs.specialty1, N); this.spec2 = cap(Uint8Array, attrs.specialty2, N); this.specMult = cap(Float64Array, attrs.specialtyMult, N);
    this.isCapitalSeed = cap(Uint8Array, attrs.isCapital, N); this.culture = cap(Uint8Array, attrs.culture, N); this.elev = cap(Float32Array, attrs.elevProxy_m, N);
    this.s = makeSimArrays(N);
    this.density = new Float64Array(N); this.gdppc = new Float64Array(N); this.ipm = new Float64Array(N);
    this.kecReg = new Int32Array(N).fill(-1);
    const named: Record<string, Num> = { area: this.area, labelLon: this.labelLon, labelLat: this.labelLat, coastal: this.coastal, island: this.island, pop: this.pop, grdp: this.grdp, urban: this.urban, lit: this.lit, mys: this.mys, eys: this.eys,
      life: this.life, poverty: this.poverty, elec: this.elec, water: this.water, capStock: this.capStock, age0: this.age0, age65: this.age65, terrain: this.terrain, swamp: this.swamp, roadClass: this.roadClass,
      railStation: this.railStation, railPath: this.railPath, portLevel: this.portLevel, schoolLevel: this.schoolLevel, healthLevel: this.healthLevel, spec1: this.spec1, spec2: this.spec2, specMult: this.specMult,
      isCapitalSeed: this.isCapitalSeed, culture: this.culture, elev: this.elev, density: this.density, gdppc: this.gdppc, ipm: this.ipm };
    this.rowFields = Object.entries(named).map(([name, a]) => ({ name, a, stride: 1 }));
    this.rowFields.push({ name: 'bbox', a: this.bbox, stride: 4 });
    for (const k of SIM_KEYS) this.rowFields.push({ name: `s.${k}`, a: this.s[k], stride: SIM_FIELDS[k] });
    this.initSim(attrs.laborShare, attrs.outputShare);
    // admin
    this.provinces = raw.admin.provinces.map(p => ({ id: p.id, name: p.name, locked: p.locked, capital: this.idIndex.get(p.capital) ?? -1, joinYear: p.joinYear, status: 'active' as const, activeMonth: 0 }));
    this.regencies = raw.admin.regencies.map(r => ({ id: r.id, name: r.name, type: r.type, prov: r.prov, capital: this.idIndex.get(r.capital) ?? -1, kec: r.kec.map(id => this.idIndex.get(id) as number), merged: r.merged, status: 'active' as const, activeMonth: 0 }));
    this.regProv = new Int32Array(this.regencies.length);
    this.rebuildIndex();
  }

  /** Absolute workers and output by sector from the 1950 shares. Baselines and offsets are set later by SimCore.init (needs the nation's TFP and governance). */
  private initSim(laborShare: number[][], outputShare: number[][]): void {
    const S = this.s, D = B.demography;
    for (let i = 0; i < this.n0; i++) {
      const lt = laborShare[i].reduce((a, b) => a + b, 0) || 1, ot = outputShare[i].reduce((a, b) => a + b, 0) || 1; const workers = D.participation * (1 - this.age0[i] - this.age65[i]) * this.pop[i];
      for (let q = 0; q < SECTORS; q++) { S.lab[i * SECTORS + q] = (laborShare[i][q] / lt) * workers; S.out[i * SECTORS + q] = (outputShare[i][q] / ot) * this.grdp[i]; }
      S.tfr[i] = Math.max(2, D.tfrStart - D.tfrStartUrbanOffset * this.urban[i]);
      S.ma[i] = 1; S.gov[i] = 1; S.fund[i] = 1; S.stab[i] = B.stability.base;
      this.recomputeDerived(i);
    }
  }
  recomputeDerived(i: number): void {
    this.density[i] = this.pop[i] / this.area[i]; this.gdppc[i] = this.grdp[i] / Math.max(1, this.pop[i]);
    this.ipm[i] = ipmFrom({ lifeExpectancy: this.life[i], meanYearsSchooling: this.mys[i], expectedYearsSchooling: this.eys[i], gdpPerCapita: this.gdppc[i] }).ipm;
  }
  snapRow(i: number): number[] { const out: number[] = []; for (const { a, stride } of this.rowFields) for (let k = 0; k < stride; k++) out.push(a[i * stride + k]); return out; }
  restoreRow(i: number, snap: number[]): void { let q = 0; for (const { a, stride } of this.rowFields) for (let k = 0; k < stride; k++) a[i * stride + k] = snap[q++]; }
  copyRow(from: number, to: number): void { for (const { a, stride } of this.rowFields) for (let k = 0; k < stride; k++) a[to * stride + k] = a[from * stride + k]; }
  /** Rebuild neighbour lists, coastal flags and island ids from the boundary store. */
  rebuildTopology(): void {
    const adj = this.store.adjacency(this.n), coast = this.store.coastal(this.n, TR.ports.minCoastKm);
    this.neighbors = adj.map((s, i) => (this.alive[i] ? [...s].filter(j => this.alive[j]).sort((a, b) => a - b) : []));
    for (let i = 0; i < this.n; i++) this.coastal[i] = this.alive[i] ? coast[i] : 0;
    this.island.fill(-1, 0, this.n); const sizes: number[] = [];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.island[i] >= 0) continue; const id = sizes.length; let cnt = 0; const st = [i]; this.island[i] = id;
      while (st.length) { const q = st.pop() as number; cnt++; for (const j of this.neighbors[q]) if (this.island[j] < 0) { this.island[j] = id; st.push(j); } }
      sizes.push(cnt);
    }
    this.islandSizes = sizes;
  }

  /** Recompute lookup tables after any administrative change. */
  rebuildIndex(): void {
    this.provIndex = new Map(this.provinces.map((p, i) => [p.id, i])); this.regIndex = new Map(this.regencies.map((r, i) => [r.id, i]));
    if (this.regProv.length !== this.regencies.length) this.regProv = new Int32Array(this.regencies.length);
    this.kecReg.fill(-1);
    this.regencies.forEach((r, k) => { this.regProv[k] = this.provIndex.get(r.prov) ?? -1; for (const i of r.kec) this.kecReg[i] = k; });
  }
  provOfKec(i: number): number { return this.regProv[this.kecReg[i]]; }
  isLocked(i: number): boolean { return this.provinces[this.provOfKec(i)]?.locked ?? false; }
  regencyKec(k: number): number[] { return this.regencies[k].kec; }
  provinceKec(p: number): number[] { const out: number[] = []; this.regencies.forEach((r, k) => { if (this.regProv[k] === p) out.push(...r.kec); }); return out; }
  fullName(i: number): string { return `${this.names[i]}`; }

  aggregate(kecs: ArrayLike<number>): Agg {
    let tax = 0, stab = 0, fund = 0, pop = 0, area = 0, grdp = 0, urb = 0, lit = 0, mys = 0, eys = 0, life = 0, pov = 0, elec = 0, water = 0, ks = 0, a0 = 0, a65 = 0;
    const L = new Array<number>(10).fill(0), O = new Array<number>(10).fill(0);
    for (let q = 0; q < kecs.length; q++) {
      const i = kecs[q], p = this.pop[i];
      pop += p; area += this.area[i]; grdp += this.grdp[i]; urb += this.urban[i] * p; lit += this.lit[i] * p; mys += this.mys[i] * p; eys += this.eys[i] * p; life += this.life[i] * p;
      pov += this.poverty[i] * p; elec += this.elec[i] * p; water += this.water[i] * p; ks += this.capStock[i]; a0 += this.age0[i] * p; a65 += this.age65[i] * p;
      for (let s = 0; s < 10; s++) { L[s] += this.s.lab[i * 10 + s]; O[s] += this.s.out[i * 10 + s]; }
      tax += this.s.taxC[i] + this.s.taxL[i]; stab += this.s.stab[i] * p; fund += this.s.fund[i] * p;
    }
    const P = pop || 1;
    const gdppc = grdp / P;
    const a: Agg = { count: kecs.length, pop, area, density: pop / (area || 1), grdp, gdppc, urban: urb / P, literacy: lit / P, mys: mys / P, eys: eys / P, life: life / P, poverty: pov / P, elec: elec / P, water: water / P,
      capitalStock: ks, ipm: 0, laborShare: L.map(v => v / (L.reduce((x, y) => x + y, 0) || 1)), outputShare: O.map(v => v / (grdp || 1)), age0_14: a0 / P, age65: a65 / P, tax, stab: stab / P, fund: fund / P };
    a.ipm = ipmFrom({ lifeExpectancy: a.life, meanYearsSchooling: a.mys, expectedYearsSchooling: a.eys, gdpPerCapita: a.gdppc }).ipm;
    return a;
  }

  /** Label anchor for a group of kecamatan: kecamatan closest to the area-weighted centre of the biggest island part. */
  anchorOf(kecs: number[]): number {
    const byIsland = new Map<number, number>();
    for (const i of kecs) byIsland.set(this.island[i], (byIsland.get(this.island[i]) ?? 0) + this.area[i]);
    let bestIsl = -1, bestA = -1; for (const [k, a] of byIsland) if (a > bestA) { bestA = a; bestIsl = k; }
    let cx = 0, cy = 0, tw = 0; const part = kecs.filter(i => this.island[i] === bestIsl);
    for (const i of part) { const w = this.area[i]; cx += this.labelLon[i] * w; cy += this.labelLat[i] * w; tw += w; }
    cx /= tw; cy /= tw;
    let best = part[0], bd = 1e18; for (const i of part) { const d = (this.labelLon[i] - cx) ** 2 + (this.labelLat[i] - cy) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }

  bboxOf(kecs: ArrayLike<number>): [number, number, number, number] {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let q = 0; q < kecs.length; q++) { const b = kecs[q] * 4; x0 = Math.min(x0, this.bbox[b]); y0 = Math.min(y0, this.bbox[b + 1]); x1 = Math.max(x1, this.bbox[b + 2]); y1 = Math.max(y1, this.bbox[b + 3]); }
    return [x0, y0, x1, y1];
  }
  /** The 1950 railway network (lines, stations, wear) from the seed data; roads / ports / station flags are already in the per-kecamatan arrays. */
  transportSeed(): TransportState {
    const tr = newTransport(), idx = this.idIndex;
    for (const r of this.raw.seeds.rail) {
      const path = r.path.map(id => idx.get(id)).filter((v): v is number => v !== undefined); const on = new Set(path);
      const stations: Array<[number, number]> = []; for (const st of r.stations) { const i = idx.get(st.kec); if (i !== undefined && on.has(i) && st.level > 0) stations.push([i, st.level]); }
      if (path.length < 2 || stations.length < 2) continue;
      tr.lines.push({ id: r.id, name: r.name, cls: 0, gauge: r.gauge, degraded: r.degraded, cond: r.degraded ? TR.railCondition.startDegraded : TR.railCondition.start, path, stations });
    }
    return tr;
  }
  /** Industries that already exist in 1950 (part of the baseline economy, possibly foreign-owned) and the deposits that are still undiscovered. */
  industrySeed(): IndState {
    const st = newIndState(), idx = this.idIndex;
    for (const r of this.raw.seeds.industries) {
      const i = idx.get(r.kec); const t = TYPE.get(r.type); if (i === undefined || !t) continue;
      const own = r.owner === 'foreign' ? { state: 0, foreign: 1, priv: 0 } : r.owner === 'state' ? { state: 1, foreign: 0, priv: 0 } : { state: 0, foreign: 0, priv: 1 };
      const cap = (IC.capacity.seededScale as Record<string, number>)[String(r.capacity)] ?? 0.5;
      st.list.push({ id: st.nextId++, type: t.id, name: r.name, kec: i, lon: r.lonlat[0], lat: r.lonlat[1], cap, status: 'running', paused: false, ...own, financing: 'legacy', terms: { foreign0: own.foreign, divestTo: own.foreign, divestYears: 0, holiday: 0, local: 0 }, cost: 0, months: 0, progress: 0, paid: 0, start: 0, done: -1, inBase: true, deposit: -1, util: 0, va: 0, profit: 0 });
    }
    for (const r of this.raw.seeds.resources) {
      if (RESOURCE_KNOWN_AT_START(r) || !RES_TYPE[r.type]) continue; const i = idx.get(r.kec); if (i === undefined) continue;
      st.deposits.push({ id: st.nextId++, kec: i, lon: r.lonlat[0], lat: r.lonlat[1], name: r.name, type: r.type, size: r.size, knownYear: r.knownYear ?? 1990, progress: 0, revealed: false, developed: false, revealedMonth: -1 });
    }
    return st;
  }
  knownResources(i: number) { return this.raw.seeds.resources.filter(r => r.kec === this.ids[i] && RESOURCE_KNOWN_AT_START(r)); }
}
