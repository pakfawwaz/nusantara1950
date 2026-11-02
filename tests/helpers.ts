import fs from 'node:fs';
import path from 'node:path';
import { buildRaw } from '../src/data/loaders';
import { World } from '../src/world';
import type { Topology } from 'topojson-specification';

const dir = path.resolve(__dirname, '../public/data');
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
let cache: { topo: unknown; geo: unknown; attrs: unknown; admin: unknown; seeds: unknown; pop: unknown } | null = null;
/** Fresh World built from the committed data files (each call returns an independent, mutable world). */
export function loadWorld(): World {
  cache ??= { topo: read('kecamatan.topo.json'), geo: read('kecamatan_geo.json'), attrs: read('kecamatan_attrs.json'), admin: read('admin1950.json'), seeds: read('seeds.json'), pop: read('popsamples.json') };
  const c = structuredClone(cache);
  return new World(buildRaw(c.topo as Topology, c.geo, c.attrs, c.admin, c.seeds, c.pop));
}
/** A straight cut through the label point of kecamatan `i` at `deg` degrees, long enough to cross it. Returns lon/lat points. */
export function lineThrough(w: World, i: number, deg: number, len = 1): Array<[number, number]> {
  const lon = w.labelLon[i], lat = w.labelLat[i]; const bb = w.bbox; const r = Math.max(bb[i * 4 + 2] - bb[i * 4], bb[i * 4 + 3] - bb[i * 4 + 1]) * len;
  const a = (deg * Math.PI) / 180; return [[lon - Math.cos(a) * r, lat - Math.sin(a) * r], [lon + Math.cos(a) * r, lat + Math.sin(a) * r]];
}
/** Advance the calendar the way a simulation tick would (month counter + persiapan units becoming active), without running the economy. */
export function tickCalendar(g: { nation: { month: number }; world: World; afterTick: (changed: boolean) => void }, months: number): void {
  for (let m = 0; m < months; m++) {
    g.nation.month++; let changed = false;
    for (const r of g.world.regencies) if (r.status === 'preparing' && r.activeMonth <= g.nation.month) { r.status = 'active'; changed = true; }
    for (const p of g.world.provinces) if (p.status === 'preparing' && p.activeMonth <= g.nation.month) { p.status = 'active'; changed = true; }
    g.afterTick(changed);
  }
}
