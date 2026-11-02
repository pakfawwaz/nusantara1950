import type { World } from '../world';
import { SECTOR_LABELS } from '../world';
import { LOCKED_COLOR, PROVINCE_HUES, RAMPS, SECTOR_COLORS, TERRAIN_COLORS, hashUnit, hsl } from './palette';
import { t } from '../ui/i18n';

export interface LegendItem { color: string; label: string }
export interface ModeResult { colors: string[]; legend: LegendItem[]; unit?: string }
export interface MapMode { id: string; label: string; /** true = colours only change with administrative edits, not with the monthly tick */ static?: boolean; compute(w: World): ModeResult; value?(w: World, i: number): string }

const fmtNum = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtPop = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(2)} M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} k` : fmtNum(v);
export const fmtRp = (v: number) => v >= 1e12 ? `Rp ${(v / 1e12).toFixed(1)} T` : v >= 1e9 ? `Rp ${(v / 1e9).toFixed(1)} B` : v >= 1e6 ? `Rp ${(v / 1e6).toFixed(1)} jt` : `Rp ${fmtNum(v)}`;

function quantileMode(id: string, label: string, ramp: string[], get: (w: World, i: number) => number, fmt: (v: number) => string, fmtTip: (v: number) => string): MapMode {
  return {
    id, label,
    compute(w) {
      const vals: number[] = []; for (let i = 0; i < w.n; i++) if (w.alive[i] && !w.isLocked(i)) vals.push(get(w, i));
      const sorted = vals.slice().sort((a, b) => a - b); const K = ramp.length;
      const breaks: number[] = []; for (let k = 1; k < K; k++) breaks.push(sorted[Math.floor((sorted.length * k) / K)]);
      const colors = new Array<string>(w.n);
      for (let i = 0; i < w.n; i++) {
        if (!w.alive[i]) continue;
        if (w.isLocked(i)) { colors[i] = LOCKED_COLOR; continue; }
        const v = get(w, i); let c = 0; while (c < breaks.length && v >= breaks[c]) c++; colors[i] = ramp[c];
      }
      const legend: LegendItem[] = ramp.map((color, k) => {
        const lo = k === 0 ? sorted[0] : breaks[k - 1], hi = k === K - 1 ? sorted[sorted.length - 1] : breaks[k];
        return { color, label: `${fmt(lo)} – ${fmt(hi)}` };
      });
      legend.push({ color: LOCKED_COLOR, label: t('legend.locked') });
      return { colors, legend };
    },
    value: (w, i) => fmtTip(get(w, i))
  };
}

/** Fixed class breaks (not quantiles) so a colour always means the same thing. */
function classMode(id: string, label: string, ramp: string[], breaks: number[], labels: string[], get: (w: World, i: number) => number, tip: (v: number) => string): MapMode {
  return {
    id, label,
    compute(w) {
      const colors = new Array<string>(w.n);
      for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; if (w.isLocked(i)) { colors[i] = LOCKED_COLOR; continue; } const v = get(w, i); let c = 0; while (c < breaks.length && v >= breaks[c]) c++; colors[i] = ramp[c]; }
      return { colors, legend: [...ramp.map((color, k) => ({ color, label: labels[k] })), { color: LOCKED_COLOR, label: t('legend.locked') }] };
    },
    value: (w, i) => tip(get(w, i))
  };
}

export const MODES: MapMode[] = [
  {
    id: 'political', label: t('mode.political'), static: true,
    compute(w) {
      const colors = new Array<string>(w.n);
      for (let i = 0; i < w.n; i++) {
        if (!w.alive[i]) continue;
        const k = w.kecReg[i], p = w.provinces[w.regProv[k]];
        if (p.locked) { colors[i] = LOCKED_COLOR; continue; }
        const h = PROVINCE_HUES[p.id] ?? Math.round(hashUnit(p.id) * 360); const u = hashUnit(w.regencies[k].id);
        colors[i] = hsl(h, 38 + 14 * u, 70 + 12 * (hashUnit(w.regencies[k].id + 'x') - 0.5) * 1.6);
      }
      const legend = w.provinces.map(p => ({ color: p.locked ? LOCKED_COLOR : hsl(PROVINCE_HUES[p.id] ?? Math.round(hashUnit(p.id) * 360), 45, 66), label: p.name + (p.locked ? ' (locked)' : '') }));
      return { colors, legend };
    },
    value: (w, i) => w.regencies[w.kecReg[i]].name
  },
  quantileMode('density', t('mode.density'), RAMPS.amber, (w, i) => w.density[i], v => v >= 100 ? fmtNum(v) : v.toFixed(1), v => `${fmtNum(v, v < 10 ? 1 : 0)} /km²`),
  quantileMode('gdppc', t('mode.gdppc'), RAMPS.green, (w, i) => w.gdppc[i], v => `${(v / 1e6).toFixed(1)} jt`, v => `${fmtRp(v)} per person`),
  quantileMode('ipm', t('mode.ipm'), RAMPS.blue, (w, i) => w.ipm[i], v => v.toFixed(3), v => `IPM ${v.toFixed(3)}`),
  {
    id: 'specialty', label: t('mode.specialty'), static: true,
    compute(w) {
      const colors = new Array<string>(w.n); for (let i = 0; i < w.n; i++) if (w.alive[i]) colors[i] = w.isLocked(i) ? LOCKED_COLOR : SECTOR_COLORS[w.spec1[i]];
      return { colors, legend: [...SECTOR_LABELS.map((l, s) => ({ color: SECTOR_COLORS[s], label: l })), { color: LOCKED_COLOR, label: t('legend.locked') }] };
    },
    value: (w, i) => `${SECTOR_LABELS[w.spec1[i]]} (×${w.specMult[i].toFixed(2)})`
  },
  quantileMode('electrification', t('mode.electrification'), RAMPS.magma, (w, i) => w.elec[i], v => `${(v * 100).toFixed(0)}%`, v => `${(v * 100).toFixed(1)}% electrified`),
  {
    id: 'terrain', label: t('mode.terrain'), static: true,
    compute(w) {
      const colors = new Array<string>(w.n);
      for (let i = 0; i < w.n; i++) if (w.alive[i]) colors[i] = w.isLocked(i) ? LOCKED_COLOR : w.swamp[i] ? TERRAIN_COLORS[4] : TERRAIN_COLORS[w.terrain[i]];
      return { colors, legend: [0, 1, 2, 3].map(k => ({ color: TERRAIN_COLORS[k], label: t(`terrain.${k}`) })).concat([{ color: TERRAIN_COLORS[4], label: t('terrain.swamp') }, { color: LOCKED_COLOR, label: t('legend.locked') }]) };
    },
    value: (w, i) => `${t(`terrain.${w.terrain[i]}`)}${w.swamp[i] ? ' · swamp/peat' : ''}`
  },
  {
    id: 'infrastructure', label: t('mode.infrastructure'), static: true,
    compute(w) {
      const C = { none: '#ece6d6', local: '#d7cfb8', trunk: '#8fc7c0', nat: '#4aa89c', toll: '#1f7f78', hc: '#0f4f4b', rail: '#c9a4d6', halt: '#f0a35a', major: '#d6453d', port: '#2b5f9e' };
      const colors = new Array<string>(w.n); const road = ['none', 'local', 'trunk', 'nat', 'toll', 'hc'] as const;
      for (let i = 0; i < w.n; i++) {
        if (!w.alive[i]) continue;
        colors[i] = w.isLocked(i) ? LOCKED_COLOR : w.portLevel[i] >= 2 ? C.port : w.railStation[i] === 2 ? C.major : w.railStation[i] === 1 ? C.halt : w.railPath[i] ? C.rail : C[road[Math.min(5, w.roadClass[i])]];
      }
      return { colors, legend: [{ color: C.port, label: 'Regional/national port' }, { color: C.major, label: 'Major rail station' }, { color: C.halt, label: 'Rail halt' }, { color: C.rail, label: 'On rail line (no station)' }, { color: C.hc, label: 'High-capacity toll' }, { color: C.toll, label: 'Toll motorway' }, { color: C.nat, label: 'National road' }, { color: C.trunk, label: 'Provincial road' }, { color: C.local, label: 'Local road' }, { color: C.none, label: 'Track / none' }, { color: LOCKED_COLOR, label: t('legend.locked') }] };
    },
    value: (w, i) => `${t(`road.${w.roadClass[i]}`)}${w.railStation[i] ? ' · rail station' : w.railPath[i] ? ' · rail line' : ''}${w.portLevel[i] ? ` · port L${w.portLevel[i]}` : ''}`
  },
  quantileMode('ma', t('mode.ma'), RAMPS.teal, (w, i) => w.s.ma[i], v => `${(v * 100).toFixed(2)}%`, v => `Market access ${(v * 100).toFixed(2)}% (people reachable, discounted by travel time, as a share of the nation)`),
  quantileMode('taxrev', t('mode.taxrev'), RAMPS.green, (w, i) => (w.s.taxC[i] + w.s.taxL[i]) / Math.max(1, w.pop[i]), v => `${(v / 1e3).toFixed(0)} k`, v => `Tax and revenue-share ${fmtRp(v)} per person / yr`),
  classMode('funding', t('mode.funding'), ['#a3261e', '#d9693a', '#e5b04a', '#9ccf8e', '#2d8f6b'], [0.6, 0.85, 1.0, 1.3], ['< 60 % (breakdown risk)', '60 – 85 %', '85 – 100 %', '100 – 130 %', '≥ 130 %'], (w, i) => w.s.fund[i], v => `Funding ratio ${(v * 100).toFixed(0)}% of operating cost`),
  classMode('stability', t('mode.stability'), ['#8c1d18', '#d9693a', '#e5c04a', '#9ccf8e', '#2d8f6b'], [30, 45, 60, 75], ['< 30 (unrest)', '30 – 45', '45 – 60', '60 – 75', '≥ 75 (calm)'], (w, i) => w.s.stab[i], v => `Stability ${v.toFixed(0)} / 100`)
];
