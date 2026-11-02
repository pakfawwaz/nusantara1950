import type { World, Regency, Province } from '../world';
import type { Applied, Command, Plan, Preview } from './types';
import { R, P, newCheck, rule, checkRegencyShape, components, isContiguous, popOf } from './rules';

type Admin = { provinces: Province[]; regencies: Regency[] };
const cloneAdmin = (w: World): Admin => ({ provinces: w.provinces.map(p => ({ ...p })), regencies: w.regencies.map(r => ({ ...r, kec: [...r.kec], merged: [...r.merged] })) });
const fail = (error: string): Plan => ({ preview: { ok: false, errors: [error], warnings: [], checks: [], cost: 0, annualCost: 0, summary: '', months: 0 } });
const fmt = (v: number) => Math.round(v).toLocaleString('en-US');
let counter = 0;
const freshId = (w: World, prefix: string, taken: (id: string) => boolean): string => { let id: string; do { id = `${prefix}${String(++counter).padStart(3, '0')}`; } while (taken(id)); return id; };

function done(w: World, before: Admin, summary: string, cost: number, stability: number, undoMonths: number, extra?: { undo?: () => void }): Applied {
  w.rebuildIndex();
  return {
    summary, cost, stability, undoMonths, change: { removed: [], removedIds: [], upserted: [], admin: true, geometry: false },
    undo: () => { w.provinces = before.provinces; w.regencies = before.regencies; w.rebuildIndex(); extra?.undo?.(); return { removed: [], removedIds: [], upserted: [], admin: true, geometry: false }; }
  };
}
const regOf = (w: World, id: string): number => w.regIndex.get(id) ?? -1;
const provOf = (w: World, id: string): number => w.provIndex.get(id) ?? -1;
const mostPopulous = (w: World, kecs: number[]): number => kecs.reduce((b, i) => (w.pop[i] > w.pop[b] ? i : b), kecs[0]);
const prev = (c: ReturnType<typeof newCheck>, cost: number, annual: number, months: number, summary: string): Preview => ({ ok: c.errors.length === 0, errors: c.errors, warnings: c.warnings, checks: c.ok, cost, annualCost: annual, months, summary });
const lockedProv = (w: World, p: number) => w.provinces[p]?.locked;

export function planCreateRegency(w: World, month: number, cmd: Extract<Command, { type: 'createRegency' }>): Plan {
  const kecs = [...new Set(cmd.kecs)].filter(i => w.alive[i]); const c = newCheck();
  if (!kecs.length) return fail('Select the kecamatan that will form the new regency.');
  const name = cmd.name.trim(); if (!name) return fail('Give the new regency a name.');
  const provs = new Set(kecs.map(i => w.provOfKec(i))); const regs = new Set(kecs.map(i => w.kecReg[i]));
  if (provs.size > 1) return fail('All kecamatan must be in the same province.');
  const p = [...provs][0]; if (lockedProv(w, p)) return fail('That province is locked.');
  rule(c, !w.regencies.some(r => r.name.toLowerCase() === (cmd.kind === 'kota' ? `kota ${name}` : `kabupaten ${name}`).toLowerCase()), 'Name is free', 'A regency with that name already exists.');
  rule(c, kecs.includes(cmd.capital), 'Capital is inside the new regency', 'The capital must be one of the selected kecamatan.');
  checkRegencyShape(w, c, kecs, cmd.kind, 'New regency');
  for (const k of regs) {
    const reg = w.regencies[k]; const rest = reg.kec.filter(i => !kecs.includes(i));
    if (!rest.length) { c.errors.push(`${reg.name} would be left with no kecamatan; select fewer, or merge regencies instead.`); continue; }
    checkRegencyShape(w, c, rest, reg.type, `${reg.name} (remaining)`, { count: reg.kec.length, comps: components(w, reg.kec).length });
  }
  const months = R.persiapanMonths, summary = `Create ${cmd.kind === 'kota' ? 'Kota' : 'Kabupaten'} ${name} (${kecs.length} kecamatan, ${fmt(popOf(w, kecs))} people)`;
  const preview = prev(c, R.setupCostRp, R.annualOverheadRp, months, summary);
  if (!preview.ok) return { preview };
  return { preview, apply: () => {
    const before = cloneAdmin(w); const id = freshId(w, 'N', x => w.regIndex.has(x));
    for (const k of regs) w.regencies[k].kec = w.regencies[k].kec.filter(i => !kecs.includes(i));
    for (const k of regs) { const r = w.regencies[k]; if (!r.kec.includes(r.capital)) r.capital = mostPopulous(w, r.kec); }
    w.regencies.push({ id, name: cmd.kind === 'kota' ? `Kota ${name}` : `Kabupaten ${name}`, type: cmd.kind, prov: w.provinces[p].id, capital: cmd.capital, kec: kecs, merged: [], status: 'preparing', activeMonth: month + months });
    return done(w, before, summary, R.setupCostRp, R.grantStabilityBonus * 0, months);
  } };
}

export function planMoveKecamatan(w: World, cmd: Extract<Command, { type: 'moveKecamatan' }>): Plan {
  const kecs = [...new Set(cmd.kecs)].filter(i => w.alive[i]); const c = newCheck();
  const to = regOf(w, cmd.toRegency); if (to < 0) return fail('Pick the destination regency.'); if (!kecs.length) return fail('Select kecamatan to move.');
  const dest = w.regencies[to]; const dProv = w.regProv[to];
  if (lockedProv(w, dProv) || kecs.some(i => w.isLocked(i))) return fail('Locked provinces cannot be changed.');
  const moving = kecs.filter(i => w.kecReg[i] !== to); if (!moving.length) return fail('They already belong to that regency.');
  const srcs = new Set(moving.map(i => w.kecReg[i]));
  const merged = [...dest.kec, ...moving];
  checkRegencyShape(w, c, merged, dest.type, `${dest.name} (after)`, { count: dest.kec.length, comps: components(w, dest.kec).length });
  const destComps = components(w, merged).length; if (destComps > components(w, dest.kec).length) c.errors.push(`They do not touch ${dest.name}.`);
  for (const k of srcs) {
    const reg = w.regencies[k]; const rest = reg.kec.filter(i => !moving.includes(i));
    if (!rest.length) { c.errors.push(`${reg.name} would be left empty; merge regencies instead.`); continue; }
    checkRegencyShape(w, c, rest, reg.type, `${reg.name} (remaining)`, { count: reg.kec.length, comps: components(w, reg.kec).length });
  }
  const cost = R.moveKecCostRp * moving.length; const summary = `Move ${moving.length} kecamatan to ${dest.name}`;
  const preview = prev(c, cost, 0, 0, summary);
  if (!preview.ok) return { preview };
  return { preview, apply: () => {
    const before = cloneAdmin(w);
    for (const k of srcs) { const r = w.regencies[k]; r.kec = r.kec.filter(i => !moving.includes(i)); if (!r.kec.includes(r.capital)) r.capital = mostPopulous(w, r.kec); }
    dest.kec = merged;
    w.rebuildIndex();
    for (let pi = 0; pi < w.provinces.length; pi++) { const pr = w.provinces[pi]; if (pr.capital >= 0 && w.provOfKec(pr.capital) !== pi) { const ks = w.provinceKec(pi); pr.capital = ks.length ? mostPopulous(w, ks) : -1; } }
    return done(w, before, summary, cost, 0, 1);
  } };
}

export function planMergeRegencies(w: World, cmd: Extract<Command, { type: 'mergeRegencies' }>): Plan {
  const a = regOf(w, cmd.keep), b = regOf(w, cmd.absorb); const c = newCheck();
  if (a < 0 || b < 0 || a === b) return fail('Pick two different regencies.');
  const A = w.regencies[a], B = w.regencies[b];
  if (lockedProv(w, w.regProv[a]) || lockedProv(w, w.regProv[b])) return fail('Locked provinces cannot be changed.');
  rule(c, A.prov === B.prov, 'Same province', 'Regencies in different provinces cannot be merged directly (move one first).');
  const kecs = [...A.kec, ...B.kec]; const type = A.type === 'kota' && B.type === 'kota' ? 'kota' : 'kabupaten';
  const comps = components(w, kecs).length; rule(c, comps < components(w, A.kec).length + components(w, B.kec).length, 'Regencies touch each other', 'The regencies are not adjacent.');
  const name = (cmd.name?.trim() || A.name); const cap = A.capital;
  const summary = `Merge ${B.name} into ${A.name} (${kecs.length} kecamatan)`; const cost = R.mergeCostRp;
  const preview = prev(c, cost, -R.annualOverheadRp, 0, summary); preview.warnings.push(`Small stability hit (−${R.mergeStabilityHit}) in the merged area; saves one regency's overhead.`);
  if (!preview.ok) return { preview };
  return { preview, apply: () => {
    const before = cloneAdmin(w); const ai = regOf(w, A.id);
    const keepReg = w.regencies[ai]; const abs = w.regencies[regOf(w, B.id)];
    keepReg.kec = kecs; keepReg.type = type; keepReg.name = name.startsWith('Kabupaten ') || name.startsWith('Kota ') ? name : (type === 'kota' ? `Kota ${name}` : `Kabupaten ${name}`); keepReg.capital = w.pop[cap] >= w.pop[abs.capital] ? cap : abs.capital; keepReg.merged = [...keepReg.merged, ...abs.merged, abs.id];
    w.regencies = w.regencies.filter(r => r !== abs); w.rebuildIndex();
    return done(w, before, summary, cost, -R.mergeStabilityHit, 1);
  } };
}

export function planCreateProvince(w: World, month: number, cmd: Extract<Command, { type: 'createProvince' }>): Plan {
  const ids = [...new Set(cmd.regencies)]; const c = newCheck(); const rs = ids.map(id => regOf(w, id));
  if (rs.some(r => r < 0) || !rs.length) return fail('Select the regencies that will form the new province.');
  const name = cmd.name.trim(); if (!name) return fail('Give the new province a name.');
  const provs = new Set(rs.map(r => w.regProv[r])); if (provs.size > 1) return fail('All regencies must be in the same province.');
  const p = [...provs][0]; const par = w.provinces[p]; if (par.locked) return fail('That province is locked.');
  const kecs = rs.flatMap(r => w.regencies[r].kec);
  rule(c, !w.provinces.some(x => x.name.toLowerCase() === name.toLowerCase()), 'Name is free', 'A province with that name already exists.');
  rule(c, rs.length >= P.minRegencies, `${rs.length} regencies (min ${P.minRegencies})`, `A province needs at least ${P.minRegencies} regencies (selected ${rs.length}).`);
  const left = w.regencies.filter((_, i) => w.regProv[i] === p && !rs.includes(i));
  rule(c, left.length >= P.parentMinRegencies, `${par.name} keeps ${left.length} regencies`, `${par.name} would keep only ${left.length} regencies (min ${P.parentMinRegencies}).`);
  rule(c, kecs.includes(cmd.capital), 'Capital is inside the new province', 'The capital must be a kecamatan of the new province.');
  rule(c, isContiguous(w, kecs), 'Regencies form one contiguous area', 'The regencies are not contiguous.');
  const months = P.persiapanMonths, summary = `Create Province ${name} (${rs.length} regencies, ${fmt(popOf(w, kecs))} people)`;
  const preview = prev(c, P.setupCostRp, P.annualOverheadRp, months, summary);
  if (!preview.ok) return { preview };
  return { preview, apply: () => {
    const before = cloneAdmin(w); const id = freshId(w, 'PN', x => w.provIndex.has(x));
    w.provinces.push({ id, name, locked: false, capital: cmd.capital, joinYear: null, status: 'preparing', activeMonth: month + months });
    for (const r of ids) w.regencies[regOf(w, r)].prov = id;
    w.rebuildIndex(); return done(w, before, summary, P.setupCostRp, 0, months);
  } };
}

export function planMoveRegency(w: World, cmd: Extract<Command, { type: 'moveRegency' }>): Plan {
  const r = regOf(w, cmd.regency), to = provOf(w, cmd.toProvince); const c = newCheck();
  if (r < 0 || to < 0) return fail('Pick a regency and a destination province.');
  const reg = w.regencies[r], from = w.regProv[r]; if (from === to) return fail('It already belongs to that province.');
  if (w.provinces[from].locked || w.provinces[to].locked) return fail('Locked provinces cannot be changed.');
  const destKec = w.provinceKec(to); const touches = components(w, [...destKec, ...reg.kec]).length < components(w, destKec).length + components(w, reg.kec).length;
  rule(c, touches, `Touches ${w.provinces[to].name}`, `${reg.name} does not touch ${w.provinces[to].name}.`);
  const left = w.regencies.filter((_, i) => w.regProv[i] === from && i !== r).length;
  rule(c, left >= P.parentMinRegencies, `${w.provinces[from].name} keeps ${left} regencies`, `${w.provinces[from].name} would keep only ${left} regencies (min ${P.parentMinRegencies}).`);
  const summary = `Move ${reg.name} to ${w.provinces[to].name}`; const cost = P.moveRegencyCostRp; const preview = prev(c, cost, 0, 0, summary);
  if (!preview.ok) return { preview };
  return { preview, apply: () => {
    const before = cloneAdmin(w); const rr = w.regencies[r]; rr.prov = w.provinces[to].id; w.rebuildIndex();
    const pr = w.provinces[from]; if (pr.capital >= 0 && w.provOfKec(pr.capital) !== from) { const ks = w.provinceKec(from); pr.capital = ks.length ? mostPopulous(w, ks) : -1; }
    return done(w, before, summary, cost, 0, 1);
  } };
}

export function planMergeProvinces(w: World, cmd: Extract<Command, { type: 'mergeProvinces' }>): Plan {
  const a = provOf(w, cmd.keep), b = provOf(w, cmd.absorb); const c = newCheck();
  if (a < 0 || b < 0 || a === b) return fail('Pick two different provinces.');
  const A = w.provinces[a], B = w.provinces[b]; if (A.locked || B.locked) return fail('Locked provinces cannot be merged.');
  const ka = w.provinceKec(a), kb = w.provinceKec(b); rule(c, components(w, [...ka, ...kb]).length < components(w, ka).length + components(w, kb).length, 'Provinces touch each other', 'The provinces are not adjacent.');
  const summary = `Merge ${B.name} into ${A.name}`; const cost = P.mergeCostRp;
  const preview = prev(c, cost, -P.annualOverheadRp, 0, summary); preview.warnings.push(`Stability hit (−${P.mergeStabilityHit}) in the merged area; saves one province's overhead.`);
  if (!preview.ok) return { preview };
  return { preview, apply: () => {
    const before = cloneAdmin(w); const keep = w.provinces[provOf(w, A.id)], abs = w.provinces[provOf(w, B.id)];
    for (const r of w.regencies) if (r.prov === abs.id) r.prov = keep.id;
    if (cmd.name?.trim()) keep.name = cmd.name.trim();
    w.provinces = w.provinces.filter(p => p !== abs); w.rebuildIndex(); return done(w, before, summary, cost, -P.mergeStabilityHit, 1);
  } };
}

export function planRename(w: World, cmd: Extract<Command, { type: 'rename' }>): Plan {
  const name = cmd.name.trim(); if (!name) return fail('Names cannot be empty.');
  if (cmd.unit === 'kecamatan') { const i = w.idIndex.get(cmd.id) ?? -1; if (i < 0 || !w.alive[i]) return fail('Unknown kecamatan.'); const old = w.names[i];
    return { preview: { ok: true, errors: [], warnings: [], checks: [], cost: 0, annualCost: 0, months: 0, summary: `Rename ${old} to ${name}` }, apply: () => { w.names[i] = name; w.features[i].properties.name = name; return { summary: `Renamed ${old} to ${name}`, cost: 0, stability: 0, undoMonths: 1, change: { removed: [], removedIds: [], upserted: [i], admin: false, geometry: false }, undo: () => { w.names[i] = old; w.features[i].properties.name = old; return { removed: [], removedIds: [], upserted: [i], admin: false, geometry: false }; } }; } }; }
  const list = cmd.unit === 'regency' ? w.regencies : w.provinces; const u = list.find(x => x.id === cmd.id); if (!u) return fail('Unknown unit.'); const old = u.name;
  return { preview: { ok: true, errors: [], warnings: [], checks: [], cost: 0, annualCost: 0, months: 0, summary: `Rename ${old} to ${name}` }, apply: () => { u.name = name; return { summary: `Renamed ${old} to ${name}`, cost: 0, stability: 0, undoMonths: 1, change: { removed: [], removedIds: [], upserted: [], admin: true, geometry: false }, undo: () => { u.name = old; return { removed: [], removedIds: [], upserted: [], admin: true, geometry: false }; } }; } };
}

export function planSetCapital(w: World, cmd: Extract<Command, { type: 'setCapital' }>): Plan {
  const i = cmd.kec; if (!w.alive[i]) return fail('Unknown kecamatan.');
  const unit = cmd.unit === 'regency' ? w.regencies.find(r => r.id === cmd.id) : w.provinces.find(p => p.id === cmd.id); if (!unit) return fail('Unknown unit.');
  const inside = cmd.unit === 'regency' ? (unit as Regency).kec.includes(i) : w.provinceKec(w.provIndex.get(cmd.id) as number).includes(i);
  if (!inside) return fail('The capital must lie inside the unit.');
  const old = unit.capital;
  return { preview: { ok: true, errors: [], warnings: [], checks: [], cost: 0, annualCost: 0, months: 0, summary: `Move capital of ${unit.name} to ${w.names[i]}` }, apply: () => { unit.capital = i; return { summary: `Capital of ${unit.name} is now ${w.names[i]}`, cost: 0, stability: 0, undoMonths: 1, change: { removed: [], removedIds: [], upserted: [], admin: true, geometry: false }, undo: () => { unit.capital = old; return { removed: [], removedIds: [], upserted: [], admin: true, geometry: false }; } }; } };
}
