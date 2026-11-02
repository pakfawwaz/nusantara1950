import { describe, it, expect } from 'vitest';
import { loadWorld, tickCalendar } from './helpers';
import { Game } from '../src/game';
import { components, isContiguous } from '../src/admin/rules';
import type { World } from '../src/world';

/** BFS inside a regency from its capital: a contiguous group of `count` kecamatan. */
function group(w: World, k: number, count: number): number[] {
  const reg = w.regencies[k]; const set = new Set(reg.kec); const out = [reg.capital]; const seen = new Set(out);
  for (let q = 0; q < out.length && out.length < count; q++) for (const j of w.neighbors[out[q]]) if (set.has(j) && !seen.has(j) && out.length < count) { seen.add(j); out.push(j); }
  return out;
}
const bigRegency = (w: World, min: number) => w.regencies.findIndex((r, k) => r.kec.length >= min && r.type === 'kabupaten' && !w.provinces[w.regProv[k]].locked && components(w, r.kec).length === 1);

describe('regency commands', () => {
  it('creates a regency (preparing → active) and undo restores the old map', async () => {
    const w = loadWorld(), g = new Game(w); const pn = w.regencies.length;
    let k = -1, sel: number[] = [], cmd = { type: 'createRegency' as const, kecs: sel, name: 'Testlandia', kind: 'kabupaten' as const, capital: 0 }, pv = await g.preview(cmd);
    for (let q = 0; q < w.regencies.length && !pv.ok; q++) { if (w.regencies[q].kec.length < 14 || w.regencies[q].type !== 'kabupaten' || w.provinces[w.regProv[q]].locked) continue; const s6 = group(w, q, 6); if (s6.length < 6) continue; cmd = { ...cmd, kecs: s6, capital: s6[0] }; pv = await g.preview(cmd); if (pv.ok) { k = q; sel = s6; } }
    const parent = w.regencies[k].kec.length;
    expect(pv.errors).toEqual([]); expect(pv.months).toBe(12); expect(pv.cost).toBeGreaterThan(0);
    const cash0 = g.cash; const r = await g.exec(cmd); expect(r.ok).toBe(true);
    expect(w.regencies.length).toBe(pn + 1); const nr = w.regencies[w.regencies.length - 1]; expect(nr.status).toBe('preparing');
    expect(w.regencies[k].kec.length).toBe(parent - 6); for (const i of sel) expect(w.kecReg[i]).toBe(w.regencies.length - 1);
    expect(g.cash).toBeLessThan(cash0);
    // sum of kecamatan over regencies is unchanged (population conservation across reorganisation)
    expect(w.regencies.reduce((s, x) => s + x.kec.length, 0)).toBe(w.n0);
    expect(g.canUndo()).not.toBeNull(); tickCalendar(g, 11); expect(nr.status).toBe('preparing'); expect(g.canUndo()).not.toBeNull();
    expect(await g.undo()).toBe(true); expect(w.regencies.length).toBe(pn); expect(g.cash).toBeCloseTo(cash0, 0); for (const i of sel) expect(w.kecReg[i]).toBe(k);
    const r2 = await g.exec(cmd); expect(r2.ok).toBe(true); tickCalendar(g, 12); expect(w.regencies[w.regencies.length - 1].status).toBe('active'); expect(g.canUndo()).toBeNull();
  });

  it('enforces size, contiguity and parent-validity rules', async () => {
    const w = loadWorld(), g = new Game(w); const k = bigRegency(w, 16);
    const tooSmall = await g.preview({ type: 'createRegency', kecs: group(w, k, 3), name: 'Kecil', kind: 'kabupaten', capital: w.regencies[k].capital }); expect(tooSmall.ok).toBe(false); expect(tooSmall.errors.join(' ')).toMatch(/at least|needs|only/);
    // two far-apart kecamatan on different islands/regions plus fillers are not contiguous
    let a = -1, b = -1; for (let i = 0; i < w.n && a < 0; i++) if (w.provOfKec(i) === 3) a = i; for (let i = w.n - 1; i >= 0 && b < 0; i--) if (w.provOfKec(i) === 3 && !w.neighbors[a].includes(i) && w.kecReg[i] !== w.kecReg[a]) b = i;
    const mixed = await g.preview({ type: 'createRegency', kecs: [a, b], name: 'Aneh', kind: 'kabupaten', capital: a }); expect(mixed.ok).toBe(false);
    // everything in the parent → parent would be left empty
    const all = await g.preview({ type: 'createRegency', kecs: w.regencies[k].kec, name: 'Semua', kind: 'kabupaten', capital: w.regencies[k].capital }); expect(all.ok).toBe(false);
    // locked province
    const lk = w.provinces.findIndex(p => p.locked); const li = w.provinceKec(lk)[0]; const lock = await g.preview({ type: 'createRegency', kecs: [li], name: 'X', kind: 'kabupaten', capital: li }); expect(lock.ok).toBe(false);
  });

  it('moves kecamatan between neighbouring regencies and merges regencies', async () => {
    const w = loadWorld(), g = new Game(w);
    // find a kecamatan on the border of its regency whose neighbour regency is in the same province
    let moved = -1, dest = '';
    outer: for (let k = 0; k < w.regencies.length; k++) { const reg = w.regencies[k]; if (reg.kec.length < 8 || w.provinces[w.regProv[k]].locked) continue;
      for (const i of reg.kec) { if (i === reg.capital) continue; for (const j of w.neighbors[i]) { const k2 = w.kecReg[j]; if (k2 !== k && w.regProv[k2] === w.regProv[k]) { const rest = reg.kec.filter(x => x !== i); if (components(w, rest).length === 1) { moved = i; dest = w.regencies[k2].id; break outer; } } } } }
    expect(moved).toBeGreaterThanOrEqual(0);
    const from = w.kecReg[moved]; const r = await g.exec({ type: 'moveKecamatan', kecs: [moved], toRegency: dest }); expect(r.ok).toBe(true);
    expect(w.regencies[w.kecReg[moved]].id).toBe(dest); expect(isContiguous(w, w.regencies[w.kecReg[moved]].kec)).toBe(true);
    await g.undo(); expect(w.kecReg[moved]).toBe(from);
    // merge two adjacent regencies of one province, then undo
    const a = w.regencies[from], bId = dest; const n0 = w.regencies.length; const m = await g.exec({ type: 'mergeRegencies', keep: a.id, absorb: bId }); expect(m.ok).toBe(true);
    expect(w.regencies.length).toBe(n0 - 1); expect(w.regencies.reduce((s, x) => s + x.kec.length, 0)).toBe(w.n0); expect(g.history[g.history.length - 1].stability).toBeLessThan(0);
    await g.undo(); expect(w.regencies.length).toBe(n0);
  });
});

describe('province commands', () => {
  it('creates a province from five regencies and refuses fewer', async () => {
    const w = loadWorld(), g = new Game(w);
    const p = w.provinces.findIndex(x => x.id === 'JATENG'); const regs = w.regencies.map((r, i) => [r, i] as const).filter(([, i]) => w.regProv[i] === p).map(([r]) => r);
    // BFS over regency adjacency for 5 contiguous regencies
    const adj = (a: number, b: number) => w.regencies[a].kec.some(i => w.neighbors[i].some(j => w.kecReg[j] === b));
    const ids = [w.regIndex.get(regs[0].id) as number]; for (let q = 0; q < ids.length && ids.length < 5; q++) for (const r of regs) { const j = w.regIndex.get(r.id) as number; if (!ids.includes(j) && ids.length < 5 && adj(ids[q], j)) ids.push(j); }
    expect(ids.length).toBe(5); const names = ids.map(i => w.regencies[i].id); const cap = w.regencies[ids[0]].capital;
    const few = await g.preview({ type: 'createProvince', regencies: names.slice(0, 4), name: 'Mini', capital: cap }); expect(few.ok).toBe(false);
    const total = w.provinces.length; const r = await g.exec({ type: 'createProvince', regencies: names, name: 'Jawa Selatan', capital: cap });
    expect(r.ok).toBe(true); expect(w.provinces.length).toBe(total + 1); expect(w.provinces[w.provinces.length - 1].status).toBe('preparing');
    for (const id of names) expect(w.regProv[w.regIndex.get(id) as number]).toBe(w.provinces.length - 1);
    expect(await g.undo()).toBe(true); expect(w.provinces.length).toBe(total);
  });
  it('merges provinces and refuses Irian Barat', async () => {
    const w = loadWorld(), g = new Game(w);
    const bad = await g.preview({ type: 'mergeProvinces', keep: 'JATENG', absorb: 'IRIANBARAT' }); expect(bad.ok).toBe(false);
    const m = await g.exec({ type: 'mergeProvinces', keep: 'JATENG', absorb: 'DIY' }); expect(m.ok).toBe(true); expect(w.provIndex.has('DIY')).toBe(false); expect(w.regencies.every(r => w.provIndex.has(r.prov))).toBe(true);
    await g.undo(); expect(w.provIndex.has('DIY')).toBe(true);
  });
});
