import type { World } from '../world';
import cfg from '../../config/admin.json';

export const R = cfg.regency, P = cfg.province, K = cfg.kecamatan;
export const haversineKm = (lon1: number, lat1: number, lon2: number, lat2: number): number => {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2; return 12742 * Math.asin(Math.sqrt(a));
};

/**
 * Connected components of a set of kecamatan. Land adjacency joins neighbours; coastal kecamatan from different parts are also joined when
 * their label points are within `seaLinkKm` ("within 50 km by sea for island groups").
 */
export function components(w: World, kecs: readonly number[]): number[][] {
  const set = new Set(kecs); const seen = new Set<number>(); const comps: number[][] = [];
  for (const s of kecs) {
    if (seen.has(s)) continue; const comp: number[] = []; const st = [s]; seen.add(s);
    while (st.length) { const q = st.pop() as number; comp.push(q); for (const j of w.neighbors[q]) if (set.has(j) && !seen.has(j)) { seen.add(j); st.push(j); } }
    comps.push(comp);
  }
  if (comps.length < 2) return comps;
  // sea links: union-find over components using coastal kecamatan only
  const parent = comps.map((_, i) => i); const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const coastalOf = comps.map(c => c.filter(i => w.coastal[i]));
  for (let a = 0; a < comps.length; a++) for (let b = a + 1; b < comps.length; b++) {
    if (find(a) === find(b)) continue; let hit = false;
    outer: for (const i of coastalOf[a]) for (const j of coastalOf[b]) { if (haversineKm(w.labelLon[i], w.labelLat[i], w.labelLon[j], w.labelLat[j]) <= cfg.seaLinkKm) { hit = true; break outer; } }
    if (hit) parent[find(a)] = find(b);
  }
  const merged = new Map<number, number[]>(); comps.forEach((c, i) => { const r = find(i); const l = merged.get(r); if (l) l.push(...c); else merged.set(r, [...c]); });
  return [...merged.values()];
}
export const isContiguous = (w: World, kecs: readonly number[]): boolean => components(w, kecs).length <= 1;

export const popOf = (w: World, kecs: readonly number[]): number => { let s = 0; for (const i of kecs) s += w.pop[i]; return s; };
export const urbanOf = (w: World, kecs: readonly number[]): number => { let u = 0, p = 0; for (const i of kecs) { u += w.urban[i] * w.pop[i]; p += w.pop[i]; } return p ? u / p : 0; };

export interface Check { errors: string[]; warnings: string[]; ok: string[] }
export const newCheck = (): Check => ({ errors: [], warnings: [], ok: [] });
export function rule(c: Check, pass: boolean, okMsg: string, failMsg: string, warnOnly = false): void { if (pass) c.ok.push(okMsg); else (warnOnly ? c.warnings : c.errors).push(failMsg); }

/** Shape rules for a regency made of `kecs`. `before` = components/count it had previously (existing units are never punished for old defects, only for getting worse). */
export function checkRegencyShape(w: World, c: Check, kecs: number[], kind: 'kabupaten' | 'kota', label: string, before?: { count: number; comps: number }): void {
  const minKec = kind === 'kota' ? R.minKecKota : R.minKecKabupaten, minPop = kind === 'kota' ? R.minPopKota : R.minPopKabupaten;
  const shrinking = before ? kecs.length < before.count : true;
  rule(c, kecs.length >= minKec || !shrinking, `${label}: ${kecs.length} kecamatan (min ${minKec})`, `${label} would have only ${kecs.length} kecamatan (a ${kind} needs ≥ ${minKec}).`);
  const pop = popOf(w, kecs);
  rule(c, pop >= minPop || !shrinking, `${label}: population ${Math.round(pop).toLocaleString('en-US')} (min ${minPop.toLocaleString('en-US')})`, `${label} would have only ${Math.round(pop).toLocaleString('en-US')} people (min ${minPop.toLocaleString('en-US')}).`);
  const comps = components(w, kecs).length;
  rule(c, comps <= (before ? Math.max(1, before.comps) : 1), `${label}: contiguous`, `${label} would not be contiguous (${comps} separate parts; sea links count only within ${cfg.seaLinkKm} km).`);
  if (kind === 'kota' && !before) rule(c, urbanOf(w, kecs) >= R.kotaMinUrban, `${label}: urban share ${(urbanOf(w, kecs) * 100).toFixed(0)}%`, `A kota needs an urban share ≥ ${R.kotaMinUrban * 100}% (this selection: ${(urbanOf(w, kecs) * 100).toFixed(0)}%).`);
}
