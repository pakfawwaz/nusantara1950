/* Headless simulation harness:  npm run sim:headless -- --policy=passive --years=1950-2030
   Runs the exact SimCore used by the browser worker, without any UI, and prints a table. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRaw } from '../src/data/loaders';
import { World } from '../src/world';
import { SimCore, newNation } from '../src/sim/core';
import { yearOf, HIST, interp } from '../src/sim/balance';
import type { Topology } from 'topojson-specification';

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const policy = arg('policy', 'passive'); const [y0, y1] = arg('years', '1950-2030').split('-').map(Number); const every = Number(arg('every', '5'));
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data'); const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const world = new World(buildRaw(read('kecamatan.topo.json') as Topology, read('kecamatan_geo.json'), read('kecamatan_attrs.json'), read('admin1950.json'), read('seeds.json'), read('popsamples.json')));
const nation = newNation(); const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed());
const target = 89e6; const t0 = performance.now(); let worst = 0;
const row = () => { const a = nation.agg, l = nation.last; const idx = interp(HIST.gdpPerCapitaIndex, yearOf(nation.month)) * 9.89e6;
  console.log([yearOf(nation.month), (a.pop / 1e6).toFixed(1), (a.gdppc / 1e6).toFixed(1), `${((a.gdppc / target) * 100).toFixed(0)}%`, `hist ${(idx / 1e6).toFixed(1)}`, a.ipm.toFixed(3), a.life.toFixed(1), a.mys.toFixed(1), a.eys.toFixed(1), `${(a.poverty * 100).toFixed(0)}%`, `${(a.urban * 100).toFixed(0)}%`, a.tfr.toFixed(2),
    `rev ${(((l.revenue + l.pad) / (a.gdp || 1)) * 100).toFixed(1)}%`, `def ${((l.deficit / (a.gdp || 1)) * 100).toFixed(1)}%`, `infl ${(nation.inflation * 100).toFixed(0)}%`, `stab ${nation.stability.toFixed(0)}`, `debt ${(((nation.debtDom + nation.debtExt) / (a.gdp || 1)) * 100).toFixed(0)}%`].join(' | ')); };
console.log('year | pop M | gdppc jt | %target | historical | IPM | e0 | MYS | EYS | poverty | urban | TFR | revenue | deficit | inflation | stability | debt');
row();
const months = (y1 - y0) * 12;
for (let m = 0; m < months; m++) { const s = performance.now(); core.step(); worst = Math.max(worst, performance.now() - s); if (nation.month % (12 * every) === 5 || m === months - 1) row(); }
console.log(`policy=${policy}  avg tick ${((performance.now() - t0) / months).toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
