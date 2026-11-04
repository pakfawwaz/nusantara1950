import D from '../config/demands.json';
import adminCfg from '../config/admin.json';
import type { World } from './world';
import type { Game } from './game';
import type { Command } from './admin/types';
import type { Petition, PetitionKind } from './sim/petitions';
import { interp, yearOf } from './sim/balance';
import { components, haversineKm, popOf, urbanOf } from './admin/rules';

const R = adminCfg.regency, P = adminCfg.province;
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
/** Deterministic pseudo-random number in [0,1) from a month and a key (so a reload replays the same petitions). */
function hash01(month: number, key: string): number { let h = 2166136261 ^ month; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return ((h >>> 0) % 100000) / 100000; }
const bare = (s: string): string => s.replace(/^(Kabupaten|Kota)( Administrasi)?\s+/i, '').trim();
const kindOf = (s: string): 'kabupaten' | 'kota' => (/^kota/i.test(s) ? 'kota' : 'kabupaten');
const m = (x: number): string => (x >= 1e6 ? `${(x / 1e6).toFixed(1)} million` : `${Math.round(x / 1000)} thousand`);

interface Cand { kind: PetitionKind; key: string; score: number; title: string; text: string; cmd: Command; kecs: number[] }

export class Demands {
  private busy = false; private seen: number;
  constructor(private game: Game, private onNew: (p: Petition) => void) { this.seen = game.nation.petitions.next; }
  get list(): Petition[] { return this.game.nation.petitions.list; }

  /** Call once per tick. Expires old petitions and, every few months, looks for a new regional demand. */
  async tick(): Promise<void> {
    const n = this.game.nation, st = n.petitions; let changed = false;
    for (const p of [...st.list]) if (n.month > p.due) { this.decline(p, true); changed = true; }
    if (changed) this.game.petitionsChanged();
    if (this.busy || n.month === 0 || n.month % D.scanEveryMonths !== 3 || st.list.length >= D.maxPending) return;
    this.busy = true; try { await this.scan(); } finally { this.busy = false; }
  }

  private decline(p: Petition, expired: boolean): void {
    const n = this.game.nation, st = n.petitions; st.list = st.list.filter(q => q.id !== p.id); st.refused[p.key] = n.month; st.declined++;
    n.adminHits += (expired ? D.expireStabilityHit : D.rejectStabilityHit) * (0.5 + p.support);
  }
  async grant(id: number): Promise<{ ok: boolean; error?: string; summary?: string }> {
    const p = this.list.find(q => q.id === id); if (!p) return { ok: false, error: 'That petition is no longer open.' };
    const r = await this.game.exec(p.cmd); if (!r.ok) return r;
    const st = this.game.nation.petitions; st.list = st.list.filter(q => q.id !== id); st.granted++; this.game.petitionsChanged(); return r;
  }
  refuse(id: number): void { const p = this.list.find(q => q.id === id); if (!p) return; this.decline(p, false); this.game.petitionsChanged(); }

  private async scan(): Promise<void> {
    const g = this.game, n = g.nation, st = n.petitions, w = g.world; const era = interp(D.eraDraw as Array<[number, number]>, yearOf(n.month)); const open = new Set(st.list.map(p => p.key));
    const cands = [...this.regencyCands(w), ...this.provinceCands(w), ...this.switchCands(w), ...this.kecamatanCands(w)].filter(c => !open.has(c.key) && !(st.refused[c.key] !== undefined && n.month - st.refused[c.key] < D.cooldownMonths) && c.score >= D.threshold)
      .map(c => ({ c, r: hash01(n.month, c.key) })).filter(({ c, r }) => r < Math.min(0.95, c.score * D.drawScale * era)).sort((a, b) => b.c.score - a.c.score);
    let made = 0; const used = new Set<string>();
    for (const { c } of cands) {
      if (made >= D.maxNewPerScan) break; if (c.kecs.some(i => used.has(String(i)))) continue;
      const pl = await g.plan(c.cmd); if (!pl.preview.ok) continue;
      const p: Petition = { id: st.next++, kind: c.kind, key: c.key, month: n.month, due: n.month + D.responseMonths, support: c.score, title: c.title, text: c.text, cmd: c.cmd, cost: pl.preview.cost, kecs: c.kecs };
      st.list.push(p); c.kecs.forEach(i => used.add(String(i))); made++; this.onNew(p);
    }
    if (made) g.petitionsChanged();
  }

  /** Demand for a new kabupaten / kota: a group of kecamatan that, in the modern map, form a regency of their own. */
  private regencyCands(w: World): Cand[] {
    const out: Cand[] = []; const stab = this.game.nation.stability;
    w.regencies.forEach((r, k) => {
      if (r.status !== 'active' || w.provinces[w.regProv[k]].locked || r.kec.length < D.regency.minParentKec) return;
      const alive = r.kec.filter(i => w.alive[i]); const total = popOf(w, alive); const capKec = r.capital;
      const groups = new Map<string, number[]>(); for (const i of alive) { const key = w.modernKab[i]; const l = groups.get(key); if (l) l.push(i); else groups.set(key, [i]); }
      if (groups.size < 2) return; const home = [...groups.entries()].sort((a, b) => popOf(w, b[1]) - popOf(w, a[1]))[0][0];
      for (const [mk, ks0] of groups) {
        if (mk === home) continue; const ks = components(w, ks0).sort((a, b) => b.length - a.length)[0]; const pop = popOf(w, ks);
        if (ks.length < R.minKecKabupaten || pop < R.minPopKabupaten) continue; const rest = alive.length - ks.length; if (rest < R.minKecKabupaten) continue;
        const cap = ks.reduce((b, i) => (w.pop[i] > w.pop[b] ? i : b), ks[0]); const remote = haversineKm(w.labelLon[cap], w.labelLat[cap], w.labelLon[capKec], w.labelLat[capKec]);
        const score = 0.4 * clamp01(remote / D.regency.remoteKm) + 0.35 * clamp01(pop / D.regency.bigPop) + D.stabilityWeight * clamp01(1 - stab / 100) + 0.15 * clamp01(ks.length / alive.length * 2);
        const kind = urbanOf(w, ks) >= R.kotaMinUrban && /^kota/i.test(mk) ? 'kota' : kindOf(mk); const name = bare(mk); const full = `${kind === 'kota' ? 'Kota' : 'Kabupaten'} ${name}`;
        if (w.regencies.some(q => q.name.toLowerCase() === full.toLowerCase())) continue;
        out.push({ kind: 'newRegency', key: `reg:${mk}:${r.id}`, score, kecs: ks, cmd: { type: 'createRegency', kecs: ks, name, kind, capital: cap },
          title: `${name} demands its own ${kind}`,
          text: `The people of ${ks.length} kecamatan in the outlying part of ${r.name} (${m(pop)} people, ${Math.round(remote)} km from the regency seat) demand to form ${full}. They say development in ${r.name} never reaches them.` });
      }
      // fallback: a very large regency whose far side is poorly served
      if (total >= D.regency.fallbackMinPop && alive.length >= D.regency.fallbackMinKec) {
        const far = alive.reduce((b, i) => (haversineKm(w.labelLon[i], w.labelLat[i], w.labelLon[capKec], w.labelLat[capKec]) > haversineKm(w.labelLon[b], w.labelLat[b], w.labelLon[capKec], w.labelLat[capKec]) ? i : b), alive[0]);
        const want = Math.max(R.minKecKabupaten, Math.round(alive.length * D.regency.fallbackShare)); const set = new Set([far]); const q = [far];
        for (let h = 0; h < q.length && set.size < want; h++) for (const j of w.neighbors[q[h]]) if (!set.has(j) && alive.includes(j) && set.size < want) { set.add(j); q.push(j); }
        const ks = [...set]; if (ks.length < R.minKecKabupaten || alive.length - ks.length < R.minKecKabupaten) return; const pop = popOf(w, ks); if (pop < R.minPopKabupaten) return;
        const cap = ks.reduce((b, i) => (w.pop[i] > w.pop[b] ? i : b), ks[0]); const name = w.names[cap]; if (w.regencies.some(x => x.name.toLowerCase() === `kabupaten ${name}`.toLowerCase())) return;
        const remote = haversineKm(w.labelLon[cap], w.labelLat[cap], w.labelLon[capKec], w.labelLat[capKec]);
        const score = 0.4 * clamp01(remote / D.regency.remoteKm) + 0.35 * clamp01(pop / D.regency.bigPop) + D.stabilityWeight * clamp01(1 - stab / 100) - 0.05;
        out.push({ kind: 'newRegency', key: `regfb:${cap}:${r.id}`, score, kecs: ks, cmd: { type: 'createRegency', kecs: ks, name, kind: 'kabupaten', capital: cap }, title: `${name} demands its own kabupaten`,
          text: `${ks.length} kecamatan around ${name} (${m(pop)} people, ${Math.round(remote)} km from the seat of ${r.name}) ask to be separated as Kabupaten ${name}, saying the regency is too big to be governed from one town.` });
      }
    });
    return out;
  }

  /** Demand for a new province: regencies that, in the modern map, belong to another province than the 1950 one they sit in. */
  private provinceCands(w: World): Cand[] {
    const out: Cand[] = []; const stab = this.game.nation.stability;
    w.provinces.forEach((prov, p) => {
      if (prov.locked || prov.status !== 'active') return; const regs = w.regencies.map((r, k) => ({ r, k })).filter(({ r, k }) => w.regProv[k] === p && r.status === 'active'); if (regs.length < P.minRegencies + P.parentMinRegencies) return;
      const groups = new Map<string, number[]>(); const maj = (k: number): string => { const t = new Map<string, number>(); for (const i of w.regencies[k].kec) t.set(w.modernProv[i], (t.get(w.modernProv[i]) ?? 0) + w.pop[i]); return [...t.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };
      for (const { k } of regs) { const mp = maj(k); const l = groups.get(mp); if (l) l.push(k); else groups.set(mp, [k]); }
      if (groups.size < 2) return; const home = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
      for (const [mp, ks] of groups) {
        if (mp === home || ks.length < P.minRegencies || regs.length - ks.length < P.parentMinRegencies) continue; const kecs = ks.flatMap(k => w.regencies[k].kec); if (components(w, kecs).length !== 1) continue;
        const pop = popOf(w, kecs); const cap = kecs.reduce((b, i) => (w.pop[i] > w.pop[b] ? i : b), kecs[0]); const remote = haversineKm(w.labelLon[cap], w.labelLat[cap], w.labelLon[prov.capital], w.labelLat[prov.capital]);
        const score = 0.4 * clamp01(remote / D.province.remoteKm) + 0.35 * clamp01(pop / D.province.bigPop) + D.stabilityWeight * clamp01(1 - stab / 100) + 0.1;
        if (w.provinces.some(q => q.name.toLowerCase() === mp.toLowerCase())) continue;
        out.push({ kind: 'newProvince', key: `prov:${mp}:${prov.id}`, score, kecs, cmd: { type: 'createProvince', regencies: ks.map(k => w.regencies[k].id), name: mp, capital: cap }, title: `${mp} demands provincial status`,
          text: `Leaders of ${ks.length} regencies in ${prov.name} (${m(pop)} people, ${Math.round(remote)} km from the provincial capital) call for a new province, ${mp}. They want their own budget and their own governor.` });
      }
    });
    return out;
  }

  /** A regency asks to leave its province for a neighbour: either the modern map puts it there, or the neighbour's capital is much closer. */
  private switchCands(w: World): Cand[] {
    const out: Cand[] = []; const provByName = new Map(w.provinces.map((p, i) => [p.name.toLowerCase(), i] as const));
    w.regencies.forEach((r, k) => {
      const p = w.regProv[k]; if (r.status !== 'active' || w.provinces[p].locked || w.provinces[p].status !== 'active') return; const alive = r.kec.filter(i => w.alive[i]); if (!alive.length) return;
      const t = new Map<string, number>(); for (const i of alive) t.set(w.modernProv[i], (t.get(w.modernProv[i]) ?? 0) + w.pop[i]); const mp = [...t.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const touching = new Set<number>(); for (const i of alive) for (const j of w.neighbors[i]) { const q = w.regProv[w.kecReg[j]]; if (q >= 0 && q !== p && !w.provinces[q].locked) touching.add(q); }
      const cap = r.capital, dOwn = haversineKm(w.labelLon[cap], w.labelLat[cap], w.labelLon[w.provinces[p].capital], w.labelLat[w.provinces[p].capital]);
      let best = -1, score = 0, why = '';
      const hist = provByName.get(mp.toLowerCase()); if (hist !== undefined && hist !== p && touching.has(hist)) { best = hist; score = 0.75; why = `they say they belong with ${w.provinces[hist].name} by history and culture`; }
      else for (const q of touching) { const dNew = haversineKm(w.labelLon[cap], w.labelLat[cap], w.labelLon[w.provinces[q].capital], w.labelLat[w.provinces[q].capital]); if (dOwn > D.switch.minOwnKm && dNew < D.switch.ratio * dOwn) { const s = 0.4 + 0.4 * (1 - dNew / dOwn); if (s > score) { best = q; score = s; why = `${w.provinces[q].name}'s capital is ${Math.round(dNew)} km away, ${w.provinces[p].name}'s is ${Math.round(dOwn)} km`; } } }
      if (best < 0) return; const stab = this.game.nation.stability; score = Math.min(1, score + D.stabilityWeight * 0.3 * clamp01(1 - stab / 100));
      out.push({ kind: 'switchProvince', key: `sw:${r.id}:${w.provinces[best].id}`, score, kecs: alive, cmd: { type: 'moveRegency', regency: r.id, toProvince: w.provinces[best].id }, title: `${r.name} wants to join ${w.provinces[best].name}`,
        text: `The people of ${r.name} (${m(popOf(w, alive))}) petition to leave ${w.provinces[p].name} and join ${w.provinces[best].name}: ${why}.` });
    });
    return out;
  }

  /** Very populous kecamatan ask to be divided (the line is drawn across the longer side of the area; you can undo in Regions → History). */
  private kecamatanCands(w: World): Cand[] {
    const out: Cand[] = []; const stab = this.game.nation.stability, K = D.kecamatan;
    for (let i = 0; i < w.n; i++) {
      if (!w.alive[i] || w.pop[i] < K.minPop || w.area[i] < K.minAreaKm2) continue; const k = w.kecReg[i]; if (k < 0 || w.provinces[w.regProv[k]].locked || w.regencies[k].status !== 'active') continue;
      const line = this.cutLine(w, i); if (!line) continue; const score = 0.45 * clamp01(w.pop[i] / K.bigPop) + 0.25 * clamp01(w.area[i] / 400) + D.stabilityWeight * clamp01(1 - stab / 100) + 0.1;
      out.push({ kind: 'newKecamatan', key: `kec:${w.ids[i]}`, score, kecs: [i], cmd: { type: 'splitKecamatan', kec: i, line }, title: `${w.names[i]} asks to be divided`,
        text: `${w.names[i]} (${m(w.pop[i])} people, ${Math.round(w.area[i])} km²) is too large for one camat to serve. Residents of both halves ask for two kecamatan.` });
    }
    return out;
  }
  private cutLine(w: World, i: number): Array<[number, number]> | null {
    const g = w.features[i]?.geometry as { type: string; coordinates: unknown } | undefined; if (!g) return null; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { const [x, y] = c as number[]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } else if (Array.isArray(c)) c.forEach(walk); };
    walk(g.coordinates); if (x1 <= x0 || y1 <= y0) return null; const k = Math.cos(((y0 + y1) / 2) * Math.PI / 180), padX = (x1 - x0) * 0.05, padY = (y1 - y0) * 0.05;
    return (x1 - x0) * k >= y1 - y0 ? [[(x0 + x1) / 2, y0 - padY], [(x0 + x1) / 2, y1 + padY]] : [[x0 - padX, (y0 + y1) / 2], [x1 + padX, (y0 + y1) / 2]];
  }
}
