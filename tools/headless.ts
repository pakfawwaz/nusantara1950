/* Headless simulation harness:  npm run sim:headless -- --policy=passive --years=1950-2030
   Runs the exact SimCore used by the browser worker, without any UI, and prints a table. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRaw } from '../src/data/loaders';
import { World } from '../src/world';
import { SimCore, newNation } from '../src/sim/core';
import { yearOf, monthOfYear, HIST, interp } from '../src/sim/balance';
import type { Topology } from 'topojson-specification';
import { Agent } from './policies';
import { B } from '../src/sim/balance';
import IND from '../config/industries.json';
import EVC from '../config/events.json';
import BUDC from '../config/budget.json';
/** CFG='{"B.frontier.policyMultiplier.edu":1.2,"IND.capacity.sizeDivisor":3}' overrides config values for one run (calibration experiments). Array entries by index: "B.sectors.tfpGrowth.0". Multiply with "*": {"B.sectors.tfpGrowth.*":0.7}. */
function overrides(): void {
  const roots: Record<string, unknown> = { B, IND, EV: EVC, BUD: BUDC }; const cfg = JSON.parse(process.env.CFG ?? '{}') as Record<string, number>;
  for (const [k, v] of Object.entries(cfg)) {
    const parts = k.split('.'); let o = roots[parts[0]] as Record<string, unknown>; for (const q of parts.slice(1, -1)) o = o[q] as Record<string, unknown>; const last = parts[parts.length - 1];
    if (last === '*') { const arr = o as unknown as number[]; for (let i = 0; i < arr.length; i++) arr[i] *= v; } else o[last] = v;
  }
}
overrides();
import type { PolicyName } from './policies';

const arg = (k: string, d: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const policy = arg('policy', 'passive'); const [y0, y1] = arg('years', '1950-2030').split('-').map(Number); const every = Number(arg('every', '5'));
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data'); const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const world = new World(buildRaw(read('kecamatan.topo.json') as Topology, read('kecamatan_geo.json'), read('kecamatan_attrs.json'), read('admin1950.json'), read('seeds.json'), read('popsamples.json')));
const nation = newNation(Number(arg('seed', '1'))); if (arg('mode', 'historical') === 'randomized') nation.settings.historical = false; nation.settings.lose = { hyper: false, collapse: false, default: false, timeout: false }; const core = new SimCore(world, nation); core.bootstrap(world.transportSeed(), world.industrySeed());
const agent = new Agent(policy as PolicyName, core); let won = -1; const target = 89e6; const t0 = performance.now(); let worst = 0;
const series2026 = () => { const i = nation.series.t.findIndex(t => t >= 2026); return i >= 0 ? nation.series.gdppc[i] : nation.agg.gdppc; };
const row = () => { const a = nation.agg, l = nation.last; const idx = interp(HIST.gdpPerCapitaIndex, yearOf(nation.month)) * 9.89e6;
  console.log([yearOf(nation.month), (a.pop / 1e6).toFixed(1), (a.gdppc / 1e6).toFixed(1), `${((a.gdppc / target) * 100).toFixed(0)}%`, `hist ${(idx / 1e6).toFixed(1)}`, a.ipm.toFixed(3), a.life.toFixed(1), a.mys.toFixed(1), a.eys.toFixed(1), `${(a.poverty * 100).toFixed(0)}%`, `${(a.urban * 100).toFixed(0)}%`, a.tfr.toFixed(2),
    `rev ${(((l.revenue + l.pad) / (a.gdp || 1)) * 100).toFixed(1)}%`, `def ${((l.deficit / (a.gdp || 1)) * 100).toFixed(1)}%`, `infl ${(nation.inflation * 100).toFixed(0)}%`, `stab ${nation.stability.toFixed(0)}`, `debt ${(((nation.debtDom + nation.debtExt) / (a.gdp || 1)) * 100).toFixed(0)}%`, ...(process.env.DIAG ? [`pol ${core.polNow.toFixed(2)}`, `eduSat ${a.eduSat.toFixed(2)}`, `gov ${a.gov.toFixed(2)}`, `tfp ${nation.tfp.map(x => x.toFixed(2)).join(',')}`] : [])].join(' | ')); };
console.log('year | pop M | gdppc jt | %target | historical | IPM | e0 | MYS | EYS | poverty | urban | TFR | revenue | deficit | inflation | stability | debt');
row();
const months = (y1 - y0) * 12;
for (let m = 0; m < months; m++) { agent.act(); const s = performance.now(); core.step(); if (won < 0 && nation.agg.gdppc >= target) won = yearOf(nation.month) + monthOfYear(nation.month) / 12; worst = Math.max(worst, performance.now() - s); if (nation.month % (12 * every) === 5 || m === months - 1) row(); }
console.log(`started ${JSON.stringify(agent.started)} | first reached target: ${won < 0 ? 'never' : won.toFixed(1)} | gdppc 2026: ${(series2026() / 1e6).toFixed(1)} M\npolicy=${policy}  avg tick ${((performance.now() - t0) / months).toFixed(1)} ms, worst ${worst.toFixed(1)} ms`);
