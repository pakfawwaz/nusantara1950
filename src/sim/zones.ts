import Z from '../../config/zones.json';
import type { SimWorld, Nation } from './types';
import { TYPES, TYPE, requirements, planIndustry, startIndustry, type IndType } from './industry';
import { rand } from './events';
import BUD from '../../config/budget.json';

export const ZC = Z;
/** A Special Area (otorita): a set of kecamatan with its own corporate-tax cut and lighter regulation. */
export interface Zone { id: number; name: string; kecs: number[]; pphCut: number; ease: number; start: number }
export interface ZoneState { list: Zone[]; next: number; organicBuilt: number; gdp0: number }
export const newZones = (): ZoneState => ({ list: [], next: 1, organicBuilt: 0, gdp0: 0 });

export interface ZoneSpec { name: string; kecs: number[]; pphCut: number; ease: number }
export function zoneCost(n: Nation, kecCount: number): number { return Z.setupCostGdpShare * Math.max(1, n.agg.gdp) * kecCount; }
/** Validation shared by the UI preview and the game command. */
export function checkZone(w: SimWorld, n: Nation, spec: ZoneSpec, replacing?: number): string | null {
  if (!spec.name.trim()) return 'Give the area a name.';
  if (!spec.kecs.length) return 'Select at least one kecamatan on the map first.'; if (spec.kecs.length > Z.maxKec) return `A special area can cover at most ${Z.maxKec} kecamatan.`;
  for (const i of spec.kecs) { if (i < 0 || i >= w.n || !w.alive[i]) return 'The selection contains a kecamatan that no longer exists.'; const o = n.zones.list.find(z => z.id !== replacing && z.kecs.includes(i)); if (o) return `A selected kecamatan already belongs to "${o.name}".`; }
  if (spec.pphCut < 0 || spec.pphCut > Z.maxPphCut || spec.ease < 0 || spec.ease > 1) return 'Tax cut or regulation level out of range.';
  return null;
}
export function createZone(w: SimWorld, n: Nation, spec: ZoneSpec): string {
  const err = checkZone(w, n, spec); if (err) return err; const cost = zoneCost(n, spec.kecs.length); if (cost > n.cash) return 'Not enough cash in the treasury for the set-up cost.';
  n.cash -= cost; n.zones.list.push({ id: n.zones.next++, name: spec.name.trim(), kecs: [...spec.kecs], pphCut: spec.pphCut, ease: spec.ease, start: n.month }); n.adminHits += Z.easeStabilityCostPerKec * spec.kecs.length * spec.ease; return '';
}
export function editZone(w: SimWorld, n: Nation, id: number, patch: { pphCut?: number; ease?: number; name?: string }): string {
  const z = n.zones.list.find(q => q.id === id); if (!z) return 'That area no longer exists.'; const s = { name: patch.name ?? z.name, kecs: z.kecs, pphCut: patch.pphCut ?? z.pphCut, ease: patch.ease ?? z.ease }; const err = checkZone(w, n, s, id); if (err) return err; Object.assign(z, s); return '';
}
export function removeZone(n: Nation, id: number): boolean { const k = n.zones.list.findIndex(z => z.id === id); if (k < 0) return false; n.zones.list.splice(k, 1); return true; }
/** Per-kecamatan cut / ease rows, rebuilt when the zone list changes. */
export function zoneRows(w: SimWorld, n: Nation, cut: Float64Array, ease: Float64Array): void {
  cut.fill(0); ease.fill(0); for (const z of n.zones.list) for (const i of z.kecs) if (i < w.n && w.alive[i]) { cut[i] = z.pphCut; ease[i] = z.ease; }
}
/** Keep zones valid when kecamatan are split or merged. */
export function remapZones(w: SimWorld, n: Nation, ch: { removed: number[]; upserted: number[] }): void {
  if (ch.removed.length) { const gone = new Set(ch.removed); for (const z of n.zones.list) { const had = z.kecs.some(i => gone.has(i)); z.kecs = z.kecs.filter(i => !gone.has(i)); if (had && ch.upserted[0] !== undefined && !z.kecs.includes(ch.upserted[0])) z.kecs.push(ch.upserted[0]); } n.zones.list = n.zones.list.filter(z => z.kecs.length); return; }
  if (ch.upserted.length < 2) return; const R = ch.upserted[0]; for (const z of n.zones.list) if (z.kecs.includes(R)) for (const p of ch.upserted) if (w.alive[p] && !z.kecs.includes(p)) z.kecs.push(p);
}

/**
 * Once a year private firms start plants on their own where the return is good. The chance rises with the plant's return on cost, the investment climate, stability and
 * falls with the corporate-tax rate actually paid there (national rate, or the special-area rate), so tax policy and special areas matter.
 */
export function organicIndustry(w: SimWorld, n: Nation, year: number, cut: Float64Array): number {
  const O = Z.organic, ref = BUD.tax.refRates.pph; const clampF = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
  const climateF = clampF(n.fin.climate / O.climateRef, 0.3, 1.6), stabF = clampF(n.stability / O.stabilityRef, 0.2, 1.3);
  const elig = TYPES.filter(t => t.unlock <= year && (t.kind === 'process' || t.kind === 'service')); if (!elig.length) return 0;
  const gdp0 = Math.max(1, n.agg.gdp), capScale = Math.max(1, Math.pow(gdp0 / Math.max(1, n.zones.gdp0 || gdp0), O.capExponent));
  const picks: Array<{ i: number; t: IndType; p: number }> = []; let tries = 0, pops = 0; for (let i = 0; i < w.n; i++) if (w.alive[i]) pops += w.pop[i];
  while (tries++ < O.sampleKec) {
    let r = rand(n.ev) * pops, i = 0; for (; i < w.n - 1; i++) { if (!w.alive[i]) continue; r -= w.pop[i]; if (r <= 0) break; } if (!w.alive[i]) continue;
    const pph = n.policy.rates.pph * (1 - cut[i]), taxF = Math.exp(-O.taxElasticity * (pph - ref) / ref);
    for (const t of elig) {
      const { reqs } = requirements(w, n, t, i, year); if (!reqs.every(q => q.ok)) continue; if (n.ind.list.some(x => x.kec === i && x.type === t.id && x.status !== 'closed')) continue;
      const pl = planIndustry(w, n, { type: t.id, kec: i, financing: 'apbn' }, year, 1); if (!pl.ok || pl.cost <= 0) continue;
      const roi = (pl.va * t.margin) / pl.cost; picks.push({ i, t, p: O.baseRate * (roi / O.roiRef) * taxF * climateF * stabF });
    }
  }
  let made = 0; for (const c of picks.sort(() => rand(n.ev) - 0.5)) { if (made >= O.maxPerYear) break; if (rand(n.ev) > Math.min(0.6, c.p)) continue;
    if (n.ind.list.some(x => x.kec === c.i && x.type === c.t.id && x.status !== 'closed')) continue;
    const spec = { type: c.t.id, kec: c.i, financing: 'apbn' as const }; const plan = planIndustry(w, n, spec, year, 1); if (!plan.ok) continue;
    plan.cap *= capScale; plan.cost *= capScale; plan.va *= capScale; const ind = startIndustry(w, n, spec, plan, n.month); ind.financing = 'private'; ind.state = 0; ind.priv = 1; ind.foreign = 0; made++; n.zones.organicBuilt++; }
  return made;
}
export { TYPE };
