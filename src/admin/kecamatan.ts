import type { World } from '../world';
import type { Applied, Change, Plan, Preview } from './types';
import { K, newCheck, rule } from './rules';
import cfg from '../../config/admin.json';
import type { Poly, Pt } from '../geo/grid';
import { bboxOfPolys, distToRings, fromGrid, geometryFromPolys, pointInPolys, polysFromGeometry, toGrid } from '../geo/grid';

const SPLIT = cfg.split;
/** Per-person / index quantities that a merged kecamatan takes as the population-weighted mean of its parts. */
const INTENSIVE = ['tfr', 'eduStock', 'healthStock', 'infraStock', 'agStock', 'ma', 'stab', 'gov', 'fund'] as const;
const RESOURCE_SECTOR: Record<string, number> = { oil: 5, gas: 5, tin: 4, coal: 4, bauxite: 4, gold: 4, copper: 4, nickel: 4, silver: 4, iron: 4, manganese: 4 };
const empty = (error: string): Plan => ({ preview: { ok: false, errors: [error], warnings: [], checks: [], cost: 0, annualCost: 0, summary: '', months: 0 } });
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

function largestRemainder(weights: number[], total: number): number[] {
  const s = weights.reduce((a, b) => a + b, 0) || 1; const raw = weights.map(v => (v / s) * total); const fl = raw.map(Math.floor); let rest = total - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let q = 0; rest > 0 && q < order.length; q++, rest--) fl[order[q][1]]++; return fl;
}

interface PieceAlloc { pop: number; grdp: number; capStock: number; urban: number; labor: number[]; output: number[]; area: number; label: Pt; samples: number[]; core: boolean; popShare: number }

/** Split the attributes of kecamatan `R` over its geometric pieces. Extensive quantities (people, output, capital, urban people) are conserved exactly. */
function allocate(w: World, R: number, pieces: Array<{ polys: Poly[]; areaKm2: number }>): PieceAlloc[] {
  const g = w.grid, k = pieces.length; const totalArea = pieces.reduce((s, p) => s + p.areaKm2, 0);
  const lab = toGrid(g, w.labelLon[R], w.labelLat[R]);
  // 1. population by synthetic sample points (smoothed with area share so no piece is empty)
  const S = w.samples[R], wj = new Array<number>(k).fill(0), sj: number[][] = Array.from({ length: k }, () => []);
  for (let q = 0; q + 2 < S.length; q += 3) {
    const lon = w.labelLon[R] + S[q] * 0.001, lat = w.labelLat[R] + S[q + 1] * 0.001, pt = toGrid(g, lon, lat);
    let j = pieces.findIndex(p => pointInPolys(p.polys, pt[0], pt[1])); if (j < 0) j = 0;
    wj[j] += S[q + 2]; sj[j].push(lon, lat, S[q + 2]);
  }
  // the urban core is the piece that clearly contains the old label point; if the cut runs through it, the piece holding most sample weight
  let coreJ = pieces.findIndex(p => pointInPolys(p.polys, lab[0], lab[1]) && distToRings(p.polys, lab[0], lab[1]) >= SPLIT.labelMarginGrid);
  if (coreJ < 0) coreJ = wj.indexOf(Math.max(...wj));
  const Wt = wj.reduce((a, b) => a + b, 0) || 1, f = SPLIT.sampleSmoothing;
  const share = pieces.map((p, j) => (wj[j] / Wt + f * (p.areaKm2 / totalArea)) / (1 + f));
  const popTotal = w.pop[R]; const pops = share.map(v => v * popTotal);
  // 2. urban people: core piece first, remainder pro rata (conserved)
  const urbanPeople = w.urban[R] * popTotal; const urb = new Array<number>(k).fill(0); let left = urbanPeople;
  urb[coreJ] = Math.min(left, 0.97 * pops[coreJ]); left -= urb[coreJ];
  const others = pops.map((p, j) => (j === coreJ ? 0 : p)); const os = others.reduce((a, b) => a + b, 0) || 1;
  for (let j = 0; j < k; j++) if (j !== coreJ) { urb[j] = Math.min(pops[j] * 0.97, (others[j] / os) * left); }
  const usedU = urb.reduce((a, b) => a + b, 0); if (Math.abs(usedU - urbanPeople) > 1e-6) urb[coreJ] += urbanPeople - usedU; // capacity spill, keeps conservation
  // 3. sector output by location: urban sectors to the core, resource sectors to pieces holding the resource
  const out0 = Array.from({ length: 10 }, (_, s) => w.s.out[R * 10 + s]);
  const resPieces: number[][] = Array.from({ length: 10 }, () => []);
  for (const r of w.raw.seeds.resources) if (r.kec === w.ids[R] && r.size > 0 && !r.hidden) { const s = RESOURCE_SECTOR[r.type]; if (s === undefined) continue; const p = toGrid(g, r.lonlat[0], r.lonlat[1]); const j = pieces.findIndex(q => pointInPolys(q.polys, p[0], p[1])); if (j >= 0 && !resPieces[s].includes(j)) resPieces[s].push(j); }
  const sw: number[][] = [];
  for (let s = 0; s < 10; s++) {
    let wts = share.map(v => v);
    if (SPLIT.urbanSectorsGoToCore.includes(s)) wts = share.map((v, j) => v * (1 + (j === coreJ ? SPLIT.coreWeight : 0)));
    else if (resPieces[s].length) wts = share.map((_, j) => (resPieces[s].includes(j) ? 1 : 0));
    const t = wts.reduce((a, b) => a + b, 0) || 1; sw.push(wts.map(v => v / t));
  }
  const grdps = new Array<number>(k).fill(0), outs: number[][] = Array.from({ length: k }, () => new Array<number>(10).fill(0));
  for (let s = 0; s < 10; s++) for (let j = 0; j < k; j++) { const v = out0[s] * sw[s][j]; outs[j][s] = v; grdps[j] += v; }
  // 4. labour mix follows output mix, damped; workers are conserved exactly (piece total follows the population share)
  const lab0 = Array.from({ length: 10 }, (_, s) => w.s.lab[R * 10 + s]); const workersTot = lab0.reduce((x, y) => x + y, 0); const labors: number[][] = [];
  for (let j = 0; j < k; j++) { const wt = lab0.map((l, s) => l * Math.pow(Math.max(1e-9, sw[s][j]) / Math.max(1e-9, share[j]), SPLIT.laborDamping)); const ws = wt.reduce((x, y) => x + y, 0) || 1; labors.push(wt.map(v => (v / ws) * workersTot * share[j])); }
  const outShares = outs;
  const capS = w.capStock[R]; const gt = grdps.reduce((a, b) => a + b, 0) || 1;
  return pieces.map((p, j) => {
    const ll = pointOnSurfaceLabel(p.polys, j === coreJ && distToRings(p.polys, lab[0], lab[1]) >= SPLIT.labelMarginGrid && pointInPolys(p.polys, lab[0], lab[1]) ? lab : null);
    return { pop: pops[j], grdp: grdps[j], capStock: (capS * grdps[j]) / gt, urban: pops[j] > 0 ? urb[j] / pops[j] : 0, labor: labors[j], output: outShares[j], area: (w.area[R] * p.areaKm2) / totalArea, label: ll, samples: sj[j].length ? sj[j] : [], core: j === coreJ, popShare: share[j] };
  });
}
import { pointOnSurface } from '../geo/jts';
function pointOnSurfaceLabel(polys: Poly[], prefer: Pt | null): Pt { if (prefer && pointInPolys(polys, prefer[0], prefer[1])) return prefer; return pointOnSurface(polys); }

export async function planSplit(w: World, R: number, line: Pt[], names?: string[]): Promise<Plan> {
  if (!w.alive[R]) return empty('That kecamatan no longer exists.');
  if (w.isLocked(R)) return empty('This kecamatan is in a locked province.');
  const { planSplit: geoSplit } = await import('../geo/split');
  const parts = polysFromGeometry(w.features[R].geometry, w.grid);
  const arcs = w.store.arcsOf(R).map(k => ({ k, pts: w.store.pts[k], a: w.store.oa[k], b: w.store.ob[k] }));
  const gl = line.map(p => toGrid(w.grid, p[0], p[1]));
  const res = geoSplit({ grid: w.grid, parts, arcs, face: R, line: gl, rules: K });
  if ('error' in res) return empty(res.error);
  if (w.n + res.pieces.length - 1 > w.capacity) return empty('Too many new kecamatan (limit in config/admin.json).');
  const alloc = allocate(w, R, res.pieces); const k = res.pieces.length;
  const base = w.names[R];
  const nm = res.pieces.map((_, j) => (names?.[j]?.trim() ? (names[j] as string).trim() : j === 0 ? base : `${base} ${['', 'II', 'III', 'IV', 'V', 'VI'][j]}`));
  const c = newCheck(); const reg = w.regencies[w.kecReg[R]];
  rule(c, true, `Cut into ${k} pieces; area conserved within ${res.areaErrorPct.toFixed(3)}% (limit 0.5%)`, '');
  alloc.forEach((a, j) => c.ok.push(`Piece ${j + 1}: ${a.area.toFixed(1)} km², about ${fmt(a.pop)} people${a.core ? ' (urban core)' : ''}`));
  rule(c, new Set(nm).size === nm.length, 'Piece names are distinct', 'Pieces need distinct names.');
  const cost = K.splitCostRp * (k - 1);
  const preview: Preview = { ok: c.errors.length === 0, errors: c.errors, warnings: c.warnings, checks: c.ok, cost, annualCost: K.annualOverheadRp * (k - 1), months: 0,
    summary: `Split ${base} (${reg.name}) into ${k}`, pieces: res.pieces.map((p, j) => ({ areaKm2: alloc[j].area, pop: alloc[j].pop, polys: geometryFromPolys(p.polys, w.grid), name: nm[j] })) };
  if (!preview.ok) return { preview };
  return { preview, apply: () => applySplit(w, R, res, alloc, nm, preview.summary, cost) };
}

type SplitRes = Exclude<ReturnType<typeof import('../geo/split').planSplit>, { error: string }>;
function applySplit(w: World, R: number, res: SplitRes, alloc: PieceAlloc[], names: string[], summary: string, cost: number): Applied {
  const k = res.pieces.length, g = w.grid;
  const slots = [R]; for (let j = 1; j < k; j++) slots.push(w.n + j - 1);
  const prev = { row: w.snapRow(R), feat: w.features[R], samples: w.samples[R], name: w.names[R], n: w.n, regs: w.regencies.map(r => ({ cap: r.capital })), provCap: w.provinces.map(p => p.capital), seeds: [] as Array<() => void> };
  const reg = w.regencies[w.kecReg[R]]; const regKecBefore = [...reg.kec];
  // arcs
  const add = res.add.map(a => ({ pts: a.pts, a: a.a <= -2 ? slots[-a.a - 2] : a.a, b: a.b <= -2 ? slots[-a.b - 2] : a.b }));
  const arcUndo = w.store.edit(res.kill, [], add);
  // new slots
  for (let j = 1; j < k; j++) {
    const s = slots[j]; w.n = Math.max(w.n, s + 1); let uid = `${w.ids[R]}~${j}`, q = j; while (w.idIndex.has(uid)) uid = `${w.ids[R]}~${++q}`;
    w.ids[s] = uid; w.idIndex.set(uid, s); w.names[s] = names[j]; w.modernKab[s] = w.modernKab[R]; w.modernProv[s] = w.modernProv[R]; w.codes[s] = w.codes[R]; w.lineage.set(uid, w.ids[R]);
    w.alive[s] = 1; w.copyRow(R, s); reg.kec.push(s);
  }
  w.names[R] = names[0];
  const seedsOf = { resources: w.raw.seeds.resources, ports: w.raw.seeds.ports, industries: w.raw.seeds.industries, stations: w.raw.seeds.rail.flatMap(l => l.stations) };
  const rootId = w.ids[R];
  const pieceOf = (lon: number, lat: number) => { const p = toGrid(g, lon, lat); const j = res.pieces.findIndex(q => pointInPolys(q.polys, p[0], p[1])); return j < 0 ? 0 : j; };
  const oldStation = w.railStation[R], oldPort = w.portLevel[R], oldCap = w.isCapitalSeed[R];
  const stationPiece = new Array<number>(k).fill(0), portPiece = new Array<number>(k).fill(0);
  for (const grp of Object.values(seedsOf)) for (const it of grp as Array<{ kec: string; lonlat?: [number, number] }>) {
    if (it.kec !== rootId || !it.lonlat) continue; const j = pieceOf(it.lonlat[0], it.lonlat[1]); if (j > 0) { const old = it.kec; it.kec = w.ids[slots[j]]; prev.seeds.push(() => { it.kec = old; }); }
  }
  for (const st of seedsOf.stations) { if (st.kec === rootId || w.lineage.get(st.kec) === rootId) stationPiece[pieceOf(st.lonlat[0], st.lonlat[1])] = Math.max(stationPiece[pieceOf(st.lonlat[0], st.lonlat[1])], 1); }
  for (const pt of seedsOf.ports) { if (pt.kec === rootId || w.lineage.get(pt.kec) === rootId) { const j = pieceOf(pt.lonlat[0], pt.lonlat[1]); portPiece[j] = Math.max(portPiece[j], pt.level); } }
  for (let j = 0; j < k; j++) {
    const s = slots[j], a = alloc[j];
    w.pop[s] = a.pop; w.grdp[s] = a.grdp; w.capStock[s] = a.capStock; w.urban[s] = a.urban; w.area[s] = a.area;
    for (let q = 0; q < 10; q++) { w.s.lab[s * 10 + q] = a.labor[q]; w.s.out[s * 10 + q] = a.output[q]; }
    const ll = fromGrid(g, a.label[0], a.label[1]); w.labelLon[s] = ll[0]; w.labelLat[s] = ll[1];
    const bb = bboxOfPolys(res.pieces[j].polys, g); w.bbox.set(bb, s * 4);
    w.features[s] = { type: 'Feature', id: w.ids[s], properties: { ...(w.features[R].properties), id: w.ids[s], name: names[j] }, geometry: geometryFromPolys(res.pieces[j].polys, g) };
    // infrastructure points follow where they physically are
    w.railStation[s] = oldStation ? (stationPiece[j] ? oldStation : 0) : 0; w.portLevel[s] = oldPort ? portPiece[j] : 0; w.isCapitalSeed[s] = a.core ? oldCap : 0;
    // re-express samples relative to the new label point
    const smp: number[] = []; for (let q = 0; q + 2 < a.samples.length; q += 3) smp.push(Math.round((a.samples[q] - ll[0]) / 0.001), Math.round((a.samples[q + 1] - ll[1]) / 0.001), a.samples[q + 2]);
    w.samples[s] = smp.length ? smp : [0, 0, 50];
    w.recomputeDerived(s);
  }
  if (oldStation && !stationPiece.some(Boolean)) w.railStation[R] = oldStation; if (oldPort && !portPiece.some(Boolean)) w.portLevel[R] = oldPort;
  w.features[R] = { ...w.features[R], properties: { ...w.features[R].properties, name: names[0] }, geometry: geometryFromPolys(res.pieces[0].polys, g) };
  // capitals follow the urban core
  const coreSlot = slots[alloc.findIndex(a => a.core)];
  w.regencies.forEach(r => { if (r.capital === R) r.capital = coreSlot; }); w.provinces.forEach(p => { if (p.capital === R) p.capital = coreSlot; });
  w.rebuildIndex(); w.rebuildTopology();
  const change: Change = { removed: [], removedIds: [], upserted: slots.slice(), admin: true, geometry: true };
  return {
    summary, cost, stability: 0, undoMonths: 1, change,
    undo: () => {
      w.store.rollback(arcUndo); const goneIds = slots.slice(1).map(s => w.ids[s]);
      for (let j = 1; j < k; j++) { const s = slots[j]; w.lineage.delete(w.ids[s]); w.idIndex.delete(w.ids[s]); w.alive[s] = 0; }
      w.ids.length = prev.n; w.names.length = prev.n; w.modernKab.length = prev.n; w.modernProv.length = prev.n; w.codes.length = prev.n; w.features.length = prev.n; w.samples.length = prev.n; w.n = prev.n;
      for (let j = 1; j < k; j++) { const s = slots[j]; w.kecReg[s] = -1; }
      w.restoreRow(R, prev.row); w.features[R] = prev.feat; w.samples[R] = prev.samples; w.names[R] = prev.name;
      reg.kec = regKecBefore; w.regencies.forEach((r, i) => { r.capital = prev.regs[i].cap; }); w.provinces.forEach((p, i) => { p.capital = prev.provCap[i]; });
      for (const u of prev.seeds) u();
      w.rebuildIndex(); w.rebuildTopology();
      return { removed: slots.slice(1), removedIds: goneIds, upserted: [R], admin: true, geometry: true };
    }
  };
}

export async function planMergeKecamatan(w: World, keep: number, absorb: number, name?: string): Promise<Plan> {
  const c = newCheck();
  if (keep === absorb || !w.alive[keep] || !w.alive[absorb]) return empty('Pick two different existing kecamatan.');
  if (w.isLocked(keep) || w.isLocked(absorb)) return empty('Kecamatan in a locked province cannot be changed.');
  rule(c, w.kecReg[keep] === w.kecReg[absorb], 'Same regency', 'Only kecamatan of the same regency can be merged (move one first).');
  rule(c, w.neighbors[keep].includes(absorb), 'Adjacent', `${w.names[keep]} and ${w.names[absorb]} do not share a border.`);
  const base: Preview = { ok: false, errors: c.errors, warnings: c.warnings, checks: c.ok, cost: K.mergeCostRp, annualCost: -K.annualOverheadRp, months: 0, summary: `Merge ${w.names[absorb]} into ${w.names[keep]}` };
  if (c.errors.length) return { preview: base };
  const { planMerge } = await import('../geo/merge');
  const m = planMerge(w.grid, polysFromGeometry(w.features[keep].geometry, w.grid), polysFromGeometry(w.features[absorb].geometry, w.grid));
  if ('error' in m) return empty(m.error);
  const pop = w.pop[keep] + w.pop[absorb];
  const preview: Preview = { ...base, ok: true, checks: [...c.ok, `Area conserved (${m.areaKm2.toFixed(1)} km²)`], summary: `Merge ${w.names[absorb]} into ${w.names[keep]} (pop ${fmt(pop)})`, pieces: [{ areaKm2: m.areaKm2, pop, polys: geometryFromPolys(m.polys, w.grid), name: name?.trim() || w.names[keep] }] };
  return { preview, apply: () => applyMergeKec(w, keep, absorb, m.polys, name?.trim(), preview.summary) };
}

function applyMergeKec(w: World, A: number, B: number, polys: Poly[], name: string | undefined, summary: string): Applied {
  const g = w.grid; const rowA = w.snapRow(A), rowB = w.snapRow(B); const featA = w.features[A], sA = w.samples[A], sB = w.samples[B], nameA = w.names[A];
  const reg = w.regencies[w.kecReg[A]]; const regKec = [...reg.kec]; const capsR = w.regencies.map(r => r.capital), capsP = w.provinces.map(p => p.capital);
  // arcs: shared arcs vanish, B's remaining arcs now belong to A
  const kill: number[] = [], relabel: Array<[number, number, number]> = [];
  for (let k = 0; k < w.store.count; k++) { if (!w.store.alive[k]) continue; const a = w.store.oa[k], b = w.store.ob[k]; if ((a === A && b === B) || (a === B && b === A)) kill.push(k); else if (a === B || b === B) relabel.push([k, a === B ? A : a, b === B ? A : b]); }
  const arcUndo = w.store.edit(kill, relabel, []);
  const pa = w.pop[A], pb = w.pop[B], P = pa + pb || 1, ga = w.grdp[A], gb = w.grdp[B], G = ga + gb || 1;
  const wavg = (arr: Float64Array) => (arr[A] * pa + arr[B] * pb) / P;
  const big = w.area[A] >= w.area[B] ? A : B;
  const set = { urban: wavg(w.urban), lit: wavg(w.lit), mys: wavg(w.mys), eys: wavg(w.eys), life: wavg(w.life), poverty: wavg(w.poverty), elec: wavg(w.elec), water: wavg(w.water), age0: wavg(w.age0), age65: wavg(w.age65), specMult: wavg(w.specMult) };
  const sumArea = w.area[A] + w.area[B], capSum = w.capStock[A] + w.capStock[B];
  w.urban[A] = set.urban; w.lit[A] = set.lit; w.mys[A] = set.mys; w.eys[A] = set.eys; w.life[A] = set.life; w.poverty[A] = set.poverty; w.elec[A] = set.elec; w.water[A] = set.water; w.age0[A] = set.age0; w.age65[A] = set.age65; w.specMult[A] = set.specMult;
  for (const k of INTENSIVE) { const arr = w.s[k]; arr[A] = (arr[A] * pa + arr[B] * pb) / P; }
  for (let s = 0; s < 10; s++) { w.s.lab[A * 10 + s] += w.s.lab[B * 10 + s]; w.s.out[A * 10 + s] += w.s.out[B * 10 + s]; }
  w.s.taxC[A] += w.s.taxC[B]; w.s.taxL[A] += w.s.taxL[B];
  w.pop[A] = pa + pb; w.grdp[A] = ga + gb; w.capStock[A] = capSum; w.area[A] = sumArea;
  w.terrain[A] = w.terrain[big]; w.swamp[A] = Math.max(w.swamp[A], w.swamp[B]); w.roadClass[A] = Math.max(w.roadClass[A], w.roadClass[B]); w.railStation[A] = Math.max(w.railStation[A], w.railStation[B]); w.railPath[A] = Math.max(w.railPath[A], w.railPath[B]);
  w.portLevel[A] = Math.max(w.portLevel[A], w.portLevel[B]); w.schoolLevel[A] = Math.max(w.schoolLevel[A], w.schoolLevel[B]); w.healthLevel[A] = Math.max(w.healthLevel[A], w.healthLevel[B]);
  w.isCapitalSeed[A] = Math.max(w.isCapitalSeed[A], w.isCapitalSeed[B]); w.elev[A] = (w.elev[A] + w.elev[B]) / 2; w.spec1[A] = w.spec1[big]; w.spec2[A] = w.spec2[big];
  const ll = fromGrid(g, ...pointOnSurfaceLabel(polys, toGrid(g, w.labelLon[big], w.labelLat[big])));
  const smp: number[] = []; const addS = (S: number[], lo: number, la: number) => { for (let q = 0; q + 2 < S.length; q += 3) smp.push(Math.round((lo + S[q] * 0.001 - ll[0]) / 0.001), Math.round((la + S[q + 1] * 0.001 - ll[1]) / 0.001), S[q + 2]); };
  addS(sA, w.labelLon[A], w.labelLat[A]); addS(sB, w.labelLon[B], w.labelLat[B]); w.samples[A] = smp.slice(0, 48);
  w.labelLon[A] = ll[0]; w.labelLat[A] = ll[1]; w.bbox.set(bboxOfPolys(polys, g), A * 4);
  w.features[A] = { ...featA, properties: { ...featA.properties, name: name || nameA }, geometry: geometryFromPolys(polys, g) }; if (name) w.names[A] = name;
  w.recomputeDerived(A);
  w.alive[B] = 0; reg.kec = reg.kec.filter(i => i !== B); w.kecReg[B] = -1;
  w.regencies.forEach(r => { if (r.capital === B) r.capital = A; }); w.provinces.forEach(p => { if (p.capital === B) p.capital = A; });
  const seedMoves: Array<() => void> = [];
  const sd = w.raw.seeds; for (const grp of [sd.resources, sd.ports, sd.industries, sd.rail.flatMap(l => l.stations)] as Array<Array<{ kec: string }>>) for (const it of grp) if (it.kec === w.ids[B]) { it.kec = w.ids[A]; seedMoves.push(() => { it.kec = w.ids[B]; }); }
  w.rebuildIndex(); w.rebuildTopology();
  return {
    summary, cost: K.mergeCostRp, stability: 0, undoMonths: 1, change: { removed: [B], removedIds: [w.ids[B]], upserted: [A], admin: true, geometry: true },
    undo: () => {
      w.store.rollback(arcUndo); for (const u of seedMoves) u();
      w.alive[B] = 1; w.restoreRow(A, rowA); w.restoreRow(B, rowB); w.features[A] = featA; w.samples[A] = sA; w.samples[B] = sB; w.names[A] = nameA;
      reg.kec = regKec; w.regencies.forEach((r, i) => { r.capital = capsR[i]; }); w.provinces.forEach((p, i) => { p.capital = capsP[i]; });
      w.rebuildIndex(); w.rebuildTopology();
      return { removed: [], removedIds: [], upserted: [A, B], admin: true, geometry: true };
    }
  };
}
