// Generates 1950 kecamatan attributes (synthetic but plausible, calibrated to config targets).
// FALLBACK METHODS (no GHSL / ETOPO access in this build environment) are documented in DATA_NOTES.md.
import fs from 'node:fs';
import { loadKec, Locator, haversine, mulberry32, hashStr, gauss } from './lib_geo.mjs';
import Flatbush from 'flatbush';

const CFG = JSON.parse(fs.readFileSync('config/world.json', 'utf8'));
const { geo, feats, P, n } = loadKec();
const loc = new Locator(feats, geo);
const adm = JSON.parse(fs.readFileSync('data_raw/work/admin_struct.json', 'utf8'));
const seedsResolved = JSON.parse(fs.readFileSync('public/data/seeds.json', 'utf8'));
const resRaw = JSON.parse(fs.readFileSync('tools/seeds/resources.json', 'utf8'));
const infraRaw = JSON.parse(fs.readFileSync('tools/seeds/infrastructure.json', 'utf8'));
const idIndex = new Map(geo.ids.map((id, i) => [id, i]));
const SECT = ['food', 'plantation', 'fisheries', 'forestry', 'mining', 'oilgas', 'manufacturing', 'construction', 'services', 'tourism'];
const S = Object.fromEntries(SECT.map((s, i) => [s, i]));
const AGRI = [S.food, S.plantation, S.fisheries, S.forestry];
const A = geo.area_km2, LX = geo.label[0], LY = geo.label[1];
const prov = P.map(p => p.prov_code), kab = P.map(p => p.kab_code);
const isKotaModern = P.map(p => /^\d\d\.7\d$/.test(p.kab_code));
const rngOf = (i, salt = 0) => mulberry32(hashStr(geo.ids[i] + ":" + salt) ^ 0x9e3779b9);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sum = a => a.reduce((s, v) => s + v, 0);
const norm = s => s.replace(/\./g, '').toLowerCase();

// ---------- 1. terrain (fallback: ridge-line elevation proxy) ----------
const RIDGES = [
  { name: 'Barisan', peak: 2800, L: 28, pts: [[95.3,5.5],[96.8,4.4],[97.6,3.6],[98.5,3.2],[98.9,2.6],[99.5,1.3],[100.0,0.2],[100.4,-0.5],[101.3,-1.7],[102.0,-3.0],[102.6,-3.8],[103.4,-4.7],[104.2,-5.3],[104.7,-5.9]] },
  { name: 'Nias', peak: 600, L: 15, pts: [[97.5,1.1],[97.8,0.6]] },
  { name: "Java spine", peak: 2200, L: 16, pts: [[105.9,-6.8],[106.9,-6.8],[107.6,-7.1],[108.4,-7.2],[109.2,-7.2],[109.9,-7.2],[110.4,-7.4],[111.2,-7.6],[111.8,-7.8],[112.9,-8.0],[114.1,-8.1]] },
  { name: "Java south hills", peak: 450, L: 20, pts: [[106.5,-7.1],[107.5,-7.6],[109.0,-7.45],[110.6,-8.0],[111.4,-8.1],[112.4,-8.2]] },
  { name: 'Bali-Lombok-Sumbawa', peak: 2000, L: 22, pts: [[115.0,-8.4],[115.4,-8.4],[116.4,-8.4],[117.4,-8.6],[118.2,-8.6]] },
  { name: 'Flores-Alor arc', peak: 1700, L: 25, pts: [[119.8,-8.6],[121.0,-8.7],[122.5,-8.6],[123.5,-8.3],[124.7,-8.3]] },
  { name: 'Timor', peak: 1700, L: 30, pts: [[123.6,-9.9],[124.5,-9.5],[125.3,-9.1]] },
  { name: 'Sumba', peak: 600, L: 25, pts: [[119.5,-9.7],[120.8,-9.9]] },
  { name: 'Schwaner-Muller', peak: 1500, L: 45, pts: [[111.5,-0.8],[112.7,-0.2],[113.8,0.6],[114.8,1.6],[115.6,2.5],[116.3,3.5]] },
  { name: 'Meratus', peak: 900, L: 25, pts: [[115.4,-2.3],[115.7,-3.0],[115.9,-3.7]] },
  { name: 'Sulawesi centre', peak: 2200, L: 30, pts: [[120.2,-1.2],[120.0,-2.0],[120.1,-3.0],[119.9,-3.6],[120.1,-4.4]] },
  { name: 'Sulawesi north arm', peak: 1700, L: 28, pts: [[124.9,1.2],[124.2,0.9],[123.3,0.6],[122.0,0.7],[121.0,0.5]] },
  { name: 'Sulawesi SE arm', peak: 1200, L: 30, pts: [[121.8,-2.6],[122.2,-3.6],[122.4,-4.4]] },
  { name: 'Sulawesi eastern', peak: 1400, L: 30, pts: [[121.8,-1.4],[122.3,-1.8]] },
  { name: 'Papua central', peak: 3500, L: 45, pts: [[133.0,-3.6],[134.5,-3.8],[136.0,-4.1],[137.5,-4.1],[139.0,-4.2],[140.4,-4.6]] },
  { name: 'Bird head', peak: 1800, L: 35, pts: [[132.3,-1.2],[133.3,-1.8],[133.3,-2.6]] },
  { name: 'Seram', peak: 1800, L: 22, pts: [[128.9,-3.1],[129.6,-3.1],[130.4,-3.1]] },
  { name: 'Halmahera', peak: 1400, L: 22, pts: [[127.8,1.0],[128.0,0.3],[128.2,-0.6]] },
  { name: 'Buru', peak: 1500, L: 22, pts: [[126.5,-3.3],[126.9,-3.4]] }
];
const kmPerLon = lat => 111.32 * Math.cos(lat * Math.PI / 180);
function distToRidge(lon, lat, r) {
  let best = 1e9;
  for (let k = 0; k < r.pts.length - 1; k++) {
    const [x1, y1] = r.pts[k], [x2, y2] = r.pts[k + 1];
    const kx = kmPerLon(lat);
    const ax = (x1 - lon) * kx, ay = (y1 - lat) * 111.32, bx = (x2 - lon) * kx, by = (y2 - lat) * 111.32;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? -(ax * dx + ay * dy) / L2 : 0; t = clamp(t, 0, 1);
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  if (r.pts.length === 1) best = Math.hypot((r.pts[0][0] - lon) * kmPerLon(lat), (r.pts[0][1] - lat) * 111.32);
  return best;
}
const elev = new Float32Array(n), ridgeDist = new Float32Array(n), terrain = new Uint8Array(n), swamp = new Uint8Array(n);
for (let i = 0; i < n; i++) {
  const rng = rngOf(i); let e = 0, dmin = 1e9;
  for (const r of RIDGES) { const d = distToRidge(LX[i], LY[i], r); dmin = Math.min(dmin, d); e = Math.max(e, r.peak * Math.exp(-((d / (r.L * 0.95)) ** 2))); }
  e = e * (0.75 + 0.5 * rng()) + 5 + 25 * rng();
  if (A[i] < 3) e = Math.min(e, 60); // dense urban cores sit low
  elev[i] = e; ridgeDist[i] = dmin;
}
const SWAMP_PROV = new Set(['14', '15', '16', '61', '62', '63', '64', '65', '93', '92', '91', '18', '19']);
for (let i = 0; i < n; i++) {
  const e = elev[i], coast = geo.coastal[i];
  terrain[i] = e > 700 ? 3 : e > 220 ? 2 : (coast && e < 40) ? 0 : 1;
  const nearCoast = coast || geo.neighbors[i].some(j => geo.coastal[j]);
  if (SWAMP_PROV.has(prov[i]) && e < 28 && ridgeDist[i] > 55 && nearCoast && A[i] > 60 && !isKotaModern[i]) swamp[i] = 1;
}

// ---------- 2. population (fallback: area^a x urban boosts within census-1961 province groups) ----------
const cp = CFG.population;
const groupOf = {}; for (const [g, codes] of Object.entries(cp.groups)) codes.forEach(c => groupOf[c] = g);
// 1950 cities: 1961-census city populations (thousand, approximate, from recall; scaled to the 1950 national total) are
// distributed over the modern kecamatan of the city with distance decay from the core (core = smallest-area kecamatan).
const CITIES = [
  ['31.71', ['31.71','31.72','31.73','31.74','31.75','31.01'], 2907], ['35.78', ['35.78'], 1008], ['32.73', ['32.73'], 973], ['33.74', ['33.74'], 503],
  ['12.71', ['12.71'], 480], ['16.71', ['16.71'], 475], ['73.71', ['73.71'], 384], ['35.73', ['35.73'], 341], ['33.72', ['33.72'], 367], ['34.71', ['34.71'], 313],
  ['32.71', ['32.71'], 154], ['13.71', ['13.71'], 144], ['63.71', ['63.71'], 214], ['61.71', ['61.71'], 150], ['71.71', ['71.71'], 130], ['32.74', ['32.74'], 158],
  ['33.76', ['33.76'], 91], ['33.75', ['33.75'], 102], ['35.71', ['35.71'], 100], ['35.77', ['35.77'], 90], ['33.71', ['33.71'], 85], ['33.73', ['33.73'], 40],
  ['35.72', ['35.72'], 55], ['35.76', ['35.76'], 52], ['35.75', ['35.75'], 61], ['35.74', ['35.74'], 70], ['32.72', ['32.72'], 70], ['12.72', ['12.72'], 100],
  ['13.75', ['13.75'], 50], ['81.71', ['81.71'], 80]
];
const CENTER_NAME = { '31.71': 'Gambir', '32.73': 'Sumur Bandung', '35.78': 'Genteng', '33.74': 'Semarang Tengah', '12.71': 'Medan Kota', '16.71': 'Ilir Timur I',
  '73.71': 'Ujung Pandang', '35.73': 'Klojen', '33.72': 'Pasar Kliwon', '34.71': 'Gondomanan', '13.71': 'Padang Barat', '63.71': 'Banjarmasin Tengah',
  '71.71': 'Wenang', '61.71': 'Pontianak Kota', '32.71': 'Bogor Tengah', '32.74': 'Kejaksan', '81.71': 'Sirimau' };
const NATSCALE = CFG.targets1950.population / sum(Object.values(cp.census1961_thousands_by_group)) / 1000;
const cityCenter = {}, cityKec = {}, cityOf = new Int32Array(n).fill(-1), cityDecay = new Array(n).fill(0);
CITIES.forEach(([id, codes, pop61], ci) => {
  const ks = []; for (let i = 0; i < n; i++) if (codes.includes(kab[i])) ks.push(i);
  const want = CENTER_NAME[id]; let c = want ? ks.find(i => norm(P[i].name) === norm(want)) : undefined;
  if (c === undefined) { // fallback: smallest-area kecamatan that is connected to the rest of the city (skips island districts)
    const ksSet = new Set(ks); const conn = ks.filter(i => geo.neighbors[i].some(j => ksSet.has(j)) || ks.length === 1);
    c = (conn.length ? conn : ks).reduce((a, b) => A[b] < A[a] ? b : a);
  }
  const totA = sum(ks.map(i => A[i])), tau = clamp(Math.sqrt(totA) / 3.2, 1.2, 10);
  cityCenter[id] = c; cityKec[id] = ks;
  for (const i of ks) { const d = haversine(LX[c], LY[c], LX[i], LY[i]); cityDecay[i] = d; cityOf[i] = ci; }
  const ww = ks.map(i => A[i] * Math.exp(-cityDecay[i] / tau)), tw = sum(ww);
  ks.forEach((i, k) => { cityDecay[i] = { pop: pop61 * 1000 * NATSCALE * ww[k] / tw, d: cityDecay[i], tau }; });
});
const cityPopFixed = new Float64Array(n); const cityDist = new Float64Array(n), cityTau = new Float64Array(n);
for (let i = 0; i < n; i++) if (cityOf[i] >= 0) { cityPopFixed[i] = cityDecay[i].pop; cityDist[i] = cityDecay[i].d; cityTau[i] = cityDecay[i].tau; }
const w = new Float64Array(n);
for (let i = 0; i < n; i++) {
  if (cityOf[i] >= 0) continue;
  let x = Math.pow(A[i], cp.areaExponent);
  if (isKotaModern[i]) x *= 1.6;           // other modern kota (merged into kabupaten in 1950): mild urban boost
  else if (A[i] < cp.smallAreaKm2) x *= cp.smallAreaBoost;
  if (geo.coastal[i]) x *= cp.coastalBoost;
  if (terrain[i] === 3) x *= 0.85;
  if (swamp[i]) x *= 0.55;
  x *= Math.exp(0.15 * gauss(rngOf(i)));
  w[i] = x;
}
const groupW = {}, groupCity = {};
for (let i = 0; i < n; i++) { const g = groupOf[prov[i]]; groupW[g] = (groupW[g] || 0) + w[i]; groupCity[g] = (groupCity[g] || 0) + cityPopFixed[i]; }
const total61 = sum(Object.values(cp.census1961_thousands_by_group));
const pop = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const g = groupOf[prov[i]];
  if (cityOf[i] >= 0) { pop[i] = cityPopFixed[i]; continue; }
  const groupTarget = CFG.targets1950.population * (cp.census1961_thousands_by_group[g] / total61);
  pop[i] = Math.max(0, groupTarget - groupCity[g]) * (w[i] / groupW[g]);
}
const totalPop = sum(pop);

// ---------- 3. regency capitals + urban share ----------
const regOf = adm.kecRegency; const regIndex = new Map(adm.regencies.map((r, k) => [r.id, k]));
const coreName = nm => nm.replace(/^(Kabupaten|Kota Administrasi|Kota)\s+/i, '').replace(/\./g, '').trim().toLowerCase();
const CAPITAL_OVERRIDE = { // regency id -> kecamatan name (historical seats where I am fairly sure; otherwise heuristic)
  'R32.04': 'Dayeuhkolot', 'R33.08': 'Mungkid', 'R35.07': 'Kepanjen', 'R35.15': 'Sidoarjo', 'R33.10': 'Klaten Tengah', 'R12.07': 'Lubuk Pakam',
  'R51.08': 'Buleleng', 'R51.03': 'Denpasar Barat', 'R16.01': 'Baturaja Timur', 'R13.01': 'Painan', 'R64.02': 'Tenggarong', 'R14.01': 'Bangkinang'
};
const cityByRegCode = {}; CITIES.forEach(([id]) => { cityByRegCode['R' + id] = id; });
const dens0 = Float64Array.from(pop, (p, i) => p / A[i]);
const capital = new Int32Array(adm.regencies.length);
adm.regencies.forEach((r, k) => {
  if (cityByRegCode[r.id]) { capital[k] = cityCenter[cityByRegCode[r.id]]; return; }
  const cn = coreName(r.name); let best = -1, bs = -1; const ov = CAPITAL_OVERRIDE[r.id];
  for (const i of r.kec) {
    const nm = norm(P[i].name); let s = dens0[i];
    if (ov && nm === norm(ov)) s *= 1e6;
    if (nm === cn) s *= 50; else if (nm === 'kota ' + cn || nm === cn + ' kota') s *= 40; else if (nm.includes(cn) || cn.includes(nm)) s *= 4;
    if (s > bs) { bs = s; best = i; }
  }
  capital[k] = best;
});
const isCapital = new Uint8Array(n); capital.forEach(i => isCapital[i] = 1);
const provCapital = {}; adm.provinces.forEach(p => { const cr = adm.regencies.findIndex(r => r.code === p.capital); provCapital[p.id] = cr >= 0 ? capital[cr] : -1; });
// urban share
const dens = Float64Array.from(pop, (p, i) => p / A[i]);
let urban = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const rng = rngOf(i);
  let u = 0.015 + 0.10 * Math.min(1, dens[i] / 2500);
  if (isCapital[i]) u = Math.max(u, 0.30 + 0.1 * rng());
  if (cityOf[i] >= 0) u = Math.max(u, 0.15 + 0.80 * Math.exp(-cityDist[i] / (1.3 * cityTau[i])));
  else if (isKotaModern[i]) u = Math.max(u, 0.30 + 0.25 * Math.min(1, dens[i] / 3000) + 0.05 * rng());
  urban[i] = u;
}
function rescaleUrban(target) {
  for (let it = 0; it < 12; it++) {
    const cur = sum(Array.from(urban, (u, i) => u * pop[i])) / totalPop; const f = target / cur;
    for (let i = 0; i < n; i++) urban[i] = clamp(urban[i] * f, 0.002, 0.97);
  }
}
rescaleUrban(CFG.targets1950.urbanShare);

// ---------- 4. seed influence fields ----------
const resList = [];
for (const [bucket, hidden] of [['known', false], ['hidden', true]]) for (const r of resRaw[bucket]) resList.push({ ...r, hidden, c: loc.resolve(r.lonlat[0], r.lonlat[1]).i });
const KNOWN_AT_START = r => !r.hidden && (!r.knownYear || r.knownYear <= 1950);
const inf = { oil: new Float64Array(n), mine: new Float64Array(n), plant: new Float64Array(n), rice: new Float64Array(n), sugar: new Float64Array(n) };
const pointIdx = new Flatbush(n); for (let i = 0; i < n; i++) pointIdx.add(LX[i], LY[i], LX[i], LY[i]); pointIdx.finish();
const spread = (field, r, radiusKm, size) => {
  const dLat = radiusKm / 111, dLon = radiusKm / kmPerLon(r.lonlat[1]);
  for (const j of pointIdx.search(r.lonlat[0] - dLon, r.lonlat[1] - dLat, r.lonlat[0] + dLon, r.lonlat[1] + dLat)) {
    const d = haversine(r.lonlat[0], r.lonlat[1], LX[j], LY[j]); if (d > radiusKm) continue;
    field[j] += size * (1 - d / radiusKm) ** 1.2;
  }
  field[r.c] += size;
};
const MINE_TYPES = new Set(['tin', 'coal', 'bauxite', 'gold', 'copper', 'nickel']);
for (const r of resList) {
  if (!KNOWN_AT_START(r)) continue;
  if (r.type === 'oil' || r.type === 'gas') spread(inf.oil, r, 0, r.size);
  else if (MINE_TYPES.has(r.type)) spread(inf.mine, r, 6, r.size);
  else if (r.type === 'plantation') spread(inf.plant, r, 32, r.size / 4);
  else if (r.type === 'sugar') spread(inf.sugar, r, 28, r.size / 4);
  else if (r.type === 'rice') spread(inf.rice, r, 30, r.size / 4);
}
const enclave = new Float64Array(n), manuf = new Float64Array(n);
for (const d of infraRaw.industries) {
  const c = loc.resolve(d.lonlat[0], d.lonlat[1]).i;
  const k = d.type === 'sugar_mill' ? (d.count || 4) * 0.015 : d.type === 'textile' ? 0.06 : d.type === 'cement' ? 0.10 : d.type === 'refinery' ? 0.04 : 0.02;
  manuf[c] += k; if (d.type === 'refinery' || d.type === 'tin_mine' || d.type === 'cement') enclave[c] = 1;
}
const portLevel = new Uint8Array(n); for (const p of seedsResolved.ports) { const i = idIndex.get(p.kec); portLevel[i] = Math.max(portLevel[i], p.level); }
const railLevel = new Uint8Array(n); for (const l of seedsResolved.rail) for (const s of l.stations) { const i = idIndex.get(s.kec); railLevel[i] = Math.max(railLevel[i], s.level); }
const railPath = new Uint8Array(n); for (const l of seedsResolved.rail) for (const id of l.path) railPath[idIndex.get(id)] = 1;
const roadClass = new Uint8Array(n);
for (let i = 0; i < n; i++) roadClass[i] = (urban[i] > 0.15 || isCapital[i]) ? 1 : 0;
for (const r of seedsResolved.roads) for (const id of r.path) roadClass[idIndex.get(id)] = 2;
for (const l of seedsResolved.rail) for (const id of l.path) roadClass[idIndex.get(id)] = Math.max(roadClass[idIndex.get(id)], 1);
const UNIS = [[106.85, -6.19], [110.375, -7.77], [107.61, -6.89], [112.76, -7.27], [106.80, -6.56]].map(([x, y]) => loc.resolve(x, y).i);
const isUni = new Uint8Array(n); UNIS.forEach(i => isUni[i] = 1);

// ---------- 5. sectors ----------
const OUTER = new Set(['11','12','13','14','15','16','17','18','19','21','61','62','63','64','65','71','72','73','74','75','76','81','82','91','92','93','94','95','96']);
const LABOR_BASE = [0.64, 0.03, 0.02, 0.02, 0.002, 0.001, 0.08, 0.012, 0.19, 0.005];
const L = Array.from({ length: n }, () => new Float64Array(10));
const spec1 = new Uint8Array(n), spec2 = new Uint8Array(n), specMult = new Float64Array(n).fill(1);
const sectorMult = Array.from({ length: n }, () => new Float64Array(10).fill(1));
for (let i = 0; i < n; i++) {
  const rng = rngOf(i), l = L[i], u = urban[i];
  LABOR_BASE.forEach((v, s) => l[s] = v);
  // urban shift
  const agri = sum(AGRI.map(s => l[s])), freed = agri * 0.9 * u;
  AGRI.forEach(s => l[s] *= (1 - 0.9 * u));
  l[S.manufacturing] += 0.30 * freed; l[S.services] += 0.60 * freed; l[S.construction] += 0.08 * freed; l[S.tourism] += 0.02 * freed;
  // coast & islands
  const smallIsland = geo.islandSizes[geo.island[i]] < 60;
  if (geo.coastal[i]) { const f = 0.04 + (smallIsland ? 0.06 : 0); l[S.fisheries] += f; l[S.food] -= f * 0.9; l[S.services] -= f * 0.1; }
  // forestry on thinly populated outer islands
  if (OUTER.has(prov[i])) { const f = 0.12 * Math.exp(-dens[i] / 60); l[S.forestry] += f; l[S.food] -= f * 0.8; l[S.services] -= f * 0.2; }
  // seed effects
  const wp = Math.min(1.3, inf.plant[i] + inf.sugar[i] * 0.8);
  if (wp > 0) { const f = 0.30 * wp; l[S.plantation] += f; l[S.food] -= f * 0.8; l[S.services] -= f * 0.2; sectorMult[i][S.plantation] *= 1 + 0.30 * Math.min(1, wp); }
  if (inf.rice[i] > 0) { const f = 0.08 * Math.min(1.2, inf.rice[i]); l[S.food] += f; l[S.services] -= f; sectorMult[i][S.food] *= 1 + 0.20 * Math.min(1, inf.rice[i]); }
  if (inf.mine[i] > 0) { const f = Math.min(0.4, 0.05 * inf.mine[i]); l[S.mining] += f; l[S.food] -= f * 0.7; l[S.services] -= f * 0.3; sectorMult[i][S.mining] *= 1.2; }
  if (inf.oil[i] > 0) { const f = Math.min(0.25, 0.03 * inf.oil[i]); l[S.oilgas] += f; l[S.food] -= f * 0.7; l[S.services] -= f * 0.3; sectorMult[i][S.oilgas] *= 1.5; }
  if (manuf[i] > 0) { const f = Math.min(0.3, manuf[i]); l[S.manufacturing] += f; l[S.food] -= f * 0.8; l[S.services] -= f * 0.2; }
  if (portLevel[i] > 0) { l[S.services] += 0.02 * portLevel[i]; l[S.food] -= 0.02 * portLevel[i]; }
  if (prov[i] === '51') { l[S.tourism] += 0.015; l[S.food] -= 0.015; sectorMult[i][S.tourism] *= 1.3; }
  for (let s = 0; s < 10; s++) l[s] = Math.max(0.0005, l[s] * (1 + 0.06 * gauss(rng)));
  const t = sum(l); for (let s = 0; s < 10; s++) l[s] /= t;
  // specialty: sectors with largest location multiplier x share relative to base
  const score = SECT.map((_, s) => [s, (l[s] / LABOR_BASE[s]) * sectorMult[i][s]]).sort((a, b) => b[1] - a[1]);
  spec1[i] = score[0][0]; spec2[i] = score[1][0];
  specMult[i] = clamp(1 + 0.08 * Math.log(1 + score[0][1]), 1.0, 1.35);
  sectorMult[i][spec1[i]] *= specMult[i];
}
// calibrate agricultural job share nationally
for (let it = 0; it < 20; it++) {
  const cur = sum(Array.from(L, (l, i) => pop[i] * sum(AGRI.map(s => l[s])))) / totalPop;
  const g = CFG.targets1950.agricultureJobShare / cur;
  for (let i = 0; i < n; i++) {
    const l = L[i]; const a = sum(AGRI.map(s => l[s])); const a2 = Math.min(0.97, a * g);
    AGRI.forEach(s => l[s] *= a2 / a); const rest = 1 - a, rest2 = 1 - a2; for (let s = 0; s < 10; s++) if (!AGRI.includes(s)) l[s] *= rest2 / rest;
  }
}
// output: workers x productivity x multipliers; calibrate agri output share
const PROD = SECT.map(s => CFG.economy.sectorProductivity[s]);
const workers = Float64Array.from(pop, p => p * 0.42);
const out = Array.from({ length: n }, () => new Float64Array(10));
for (let i = 0; i < n; i++) for (let s = 0; s < 10; s++) out[i][s] = workers[i] * L[i][s] * PROD[s] * sectorMult[i][s] * Math.exp(0.06 * gauss(rngOf(i, 100 + s)));
const provFactor = i => CFG.economy.gdpPerCapitaProvinceFactor[prov[i]] ?? 1;
for (let i = 0; i < n; i++) for (let s = 0; s < 10; s++) out[i][s] *= provFactor(i);
{
  let ag = 0, non = 0; for (let i = 0; i < n; i++) for (let s = 0; s < 10; s++) (AGRI.includes(s) ? (ag += out[i][s]) : (non += out[i][s]));
  const tgt = CFG.targets1950.agricultureOutputShare; const f = (tgt * non) / ((1 - tgt) * ag);
  for (let i = 0; i < n; i++) for (const s of AGRI) out[i][s] *= f;
}
const targetGDP = totalPop * CFG.targetGdpPerCapita2026 * CFG.startGdpPerCapitaFraction;
let grdp = Float64Array.from(out, o => sum(o));
{ const f = targetGDP / sum(grdp); for (let i = 0; i < n; i++) { for (let s = 0; s < 10; s++) out[i][s] *= f; grdp[i] *= f; } }
// cap extreme GDP per capita (enclaves), then re-normalise
const natPc = targetGDP / totalPop;
for (let it = 0; it < 4; it++) {
  for (let i = 0; i < n; i++) { const cap = CFG.economy.gdpPerCapitaCapRatio * natPc * pop[i]; if (grdp[i] > cap) { const f = cap / grdp[i]; for (let s = 0; s < 10; s++) out[i][s] *= f; grdp[i] = cap; } }
  const f = targetGDP / sum(grdp); for (let i = 0; i < n; i++) { for (let s = 0; s < 10; s++) out[i][s] *= f; grdp[i] *= f; }
}
const gdppc = Float64Array.from(grdp, (g, i) => g / pop[i]);
const cap = CFG.economy.capitalOutputRatio;
const kStock = Float64Array.from(grdp, (g, i) => g * (cap.base + cap.urbanAdd * urban[i] + cap.enclaveAdd * Math.min(1, enclave[i] + (inf.oil[i] > 0 ? 1 : 0) + (inf.mine[i] > 0 ? 0.5 : 0))));

// ---------- 6. social indicators ----------
const lit = new Float64Array(n), mys = new Float64Array(n), eys = new Float64Array(n), life = new Float64Array(n), pov = new Float64Array(n);
const a014 = new Float64Array(n), a65 = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const rng = rngOf(i, 7), base = CFG.social.literacyBase[prov[i]] ?? 0.3;
  lit[i] = clamp(base + (0.92 - base) * 0.75 * urban[i] ** 0.8 + 0.04 * gauss(rng) + (isUni[i] ? 0.1 : 0), 0.02, 0.97);
}
function calibrate(arr, target, lo, hi, popWeighted = true) {
  for (let it = 0; it < 30; it++) { const cur = sum(Array.from(arr, (v, i) => v * pop[i])) / totalPop; const f = target / cur; for (let i = 0; i < n; i++) arr[i] = clamp(arr[i] * f, lo, hi); }
}
calibrate(lit, CFG.targets1950.adultLiteracy, 0.02, 0.97);
for (let i = 0; i < n; i++) mys[i] = 2.4 * Math.pow(lit[i], 1.35) * (1 + 0.5 * urban[i]);
calibrate(mys, CFG.targets1950.meanYearsSchooling, 0.05, 6);
for (let i = 0; i < n; i++) eys[i] = clamp(3.0 + 5.5 * lit[i] + 1.5 * urban[i], 2, 11);
for (let i = 0; i < n; i++) life[i] = 40 + (CFG.social.lifeExpectancyOffset[prov[i]] ?? 0) + 3.0 * urban[i] + 2.5 * Math.log(gdppc[i] / natPc) + 0.8 * gauss(rngOf(i, 11)) - (swamp[i] ? 1.5 : 0);
{ for (let it = 0; it < 10; it++) { const cur = sum(Array.from(life, (v, i) => v * pop[i])) / totalPop; const d = CFG.targets1950.lifeExpectancy - cur; for (let i = 0; i < n; i++) life[i] = clamp(life[i] + d, 28, 55); } }
for (let i = 0; i < n; i++) pov[i] = clamp(0.62 / Math.pow(gdppc[i] / natPc, 0.9) + 0.02 * gauss(rngOf(i, 13)), 0.08, 0.92);
for (let i = 0; i < n; i++) { a014[i] = CFG.social.age0_14 - 0.04 * urban[i] + 0.008 * gauss(rngOf(i, 17)); a65[i] = CFG.social.age65 + 0.004 * gauss(rngOf(i, 19)); }
// services
const schoolLevel = new Uint8Array(n), healthLevel = new Uint8Array(n), water = new Float64Array(n), elec = new Float64Array(n);
for (let i = 0; i < n; i++) {
  schoolLevel[i] = isUni[i] ? 4 : isKotaModern[i] || urban[i] > 0.7 ? 3 : (isCapital[i] || urban[i] > 0.25) ? 2 : lit[i] > 0.2 ? 1 : 0;
  healthLevel[i] = isUni[i] ? 4 : isKotaModern[i] ? 3 : isCapital[i] ? 2 : urban[i] > 0.08 ? 1 : 0;
  water[i] = clamp(0.04 + 0.35 * urban[i] ** 0.9 + 0.02 * gauss(rngOf(i, 23)), 0.005, 0.8);
  elec[i] = clamp(0.004 + 0.55 * urban[i] ** 1.2 + 0.25 * Math.min(1, enclave[i] + (inf.oil[i] > 0 ? 0.6 : 0) + (inf.mine[i] > 0 ? 0.4 : 0)) + (prov[i] === '31' ? 0.12 : 0), 0.001, 0.92);
}
calibrate(elec, 0.05, 0.001, 0.92);

// ---------- 7. culture (flavour only) ----------
const GROUPS = []; const gid = s => { let k = GROUPS.indexOf(s); if (k < 0) { GROUPS.push(s); k = GROUPS.length - 1; } return k; };
const CULT = c => { // c: modern kab code
  const p = c.slice(0, 2), k = c;
  const T = (m) => m[k]; const sets = (arr, v, d) => arr.includes(k) ? v : d;
  switch (p) {
    case '11': return sets(['11.04','11.13','11.17','11.02'], 'Gayo/Alas', sets(['11.10','11.75'], 'Singkil', 'Acehnese'));
    case '12': return sets(['12.06'], 'Karo Batak', sets(['12.08'], 'Simalungun Batak', sets(['12.02','12.12','12.16','12.17','12.01','12.73'], 'Toba Batak', sets(['12.03','12.13','12.21','12.20','12.77'], 'Mandailing Batak', sets(['12.11','12.15'], 'Pakpak Batak', sets(['12.04','12.14','12.24','12.25','12.78'], 'Nias', 'Malay (Deli)'))))));
    case '13': return k === '13.09' ? 'Mentawai' : 'Minangkabau';
    case '14': case '21': return 'Malay';
    case '15': return k === '15.01' || k === '15.72' ? 'Kerinci' : 'Jambi Malay';
    case '16': return 'Palembang/Musi Malay';
    case '17': return 'Rejang/Bengkulu Malay';
    case '18': return 'Lampungese';
    case '19': return 'Bangka-Belitung Malay';
    case '31': return 'Betawi';
    case '32': return sets(['32.09','32.12','32.74','32.08'], 'Cirebonese', sets(['32.16','32.75'], 'Betawi', 'Sundanese'));
    case '36': return sets(['36.04','36.72','36.73'], 'Banten Javanese', sets(['36.03','36.71','36.74'], 'Betawi/Sundanese', 'Sundanese'));
    case '33': return sets(['33.28','33.29','33.76'], 'Javanese (Tegal)', 'Javanese');
    case '34': return 'Javanese';
    case '35': return sets(['35.26','35.27','35.28','35.29'], 'Madurese', sets(['35.11','35.12','35.13','35.14','35.09','35.08','35.74','35.75'], 'Madurese-Javanese (Pendalungan)', sets(['35.10'], 'Osing', 'Javanese')));
    case '51': return 'Balinese';
    case '52': return sets(['52.04','52.07'], 'Samawa', sets(['52.05','52.06','52.72'], 'Mbojo (Bima-Dompu)', 'Sasak'));
    case '53': return sets(['53.01','53.02','53.03','53.71'], 'Atoni (Timorese)', sets(['53.04','53.21'], 'Tetun/Belu', sets(['53.05'], 'Alorese', sets(['53.06','53.13'], 'Lamaholot', sets(['53.07','53.08'], 'Sikka-Lio', sets(['53.09','53.16'], 'Ngada', sets(['53.10','53.15','53.19'], 'Manggarai', sets(['53.11','53.12','53.17','53.18'], 'Sumbanese', sets(['53.14'], 'Rotenese', 'Sabu')))))))));
    case '61': return 'Malay/Dayak';
    case '62': return 'Dayak Ngaju';
    case '63': return 'Banjar';
    case '64': return 'Kutai/Banjar';
    case '65': return 'Tidung/Dayak';
    case '71': return sets(['71.02','71.05','71.06','71.07','71.72','71.73','71.71'], 'Minahasan', sets(['71.03','71.04','71.09'], 'Sangihe-Talaud', 'Bolaang Mongondow'));
    case '72': return sets(['72.02','72.09'], 'Pamona/Poso', sets(['72.01','72.07','72.11'], 'Banggai', 'Kaili'));
    case '73': return sets(['73.18','73.26'], 'Toraja', sets(['73.01','73.02','73.03','73.04','73.05','73.06','73.71'], 'Makassarese', sets(['73.17','73.22','73.24','73.73'], 'Luwu', 'Bugis')));
    case '74': return sets(['74.03','74.13','74.10'], 'Muna', sets(['74.04','74.14','74.15','74.07','74.72','74.06'], 'Buton', 'Tolaki'));
    case '75': return 'Gorontalo';
    case '76': return 'Mandar';
    case '81': return sets(['81.02','81.03','81.07','81.08','81.72'], 'Kei/Tanimbar', 'Ambonese/Central Moluccan');
    case '82': return 'North Moluccan';
    case '93': return k === '93.04' ? 'Asmat' : 'Marind/Papuan';
    case '94': case '95': return 'Highland Papuan';
    default: return 'Coastal Papuan';
  }
};
const culture = Uint8Array.from({ length: n }, (_, i) => gid(CULT(kab[i])));

// ---------- 8. population samples (synthetic: urban core + rural scatter) ----------
const SAMPLES = [];
for (let i = 0; i < n; i++) {
  const rng = rngOf(i, 29), feat = feats[i]; const parts = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of parts) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const ns = clamp(Math.round(3 + A[i] / 40), 3, cp.sampleMax), nCore = Math.max(1, Math.round(ns * 0.3)), rad = Math.min(3, Math.sqrt(A[i]) / 8) / kmPerLon(LY[i]);
  const pts = []; const rural = 1 - urban[i];
  for (let k = 0; k < nCore; k++) pts.push([LX[i] + gauss(rng) * rad, LY[i] + gauss(rng) * rad * 0.9, urban[i] * 0.9 / nCore + 0.1 / ns]);
  for (let k = nCore; k < ns; k++) {
    let x = LX[i], y = LY[i];
    for (let t = 0; t < 120; t++) { const cx = x0 + (x1 - x0) * rng(), cy = y0 + (y1 - y0) * rng(); if (loc.polys[i].some(poly => inPolygonLocal(cx, cy, poly))) { x = cx; y = cy; break; } }
    pts.push([x, y, rural / (ns - nCore) * (0.5 + rng())]);
  }
  const tw = sum(pts.map(p => p[2])); const flat = [];
  for (const [x, y, wt] of pts) flat.push(Math.round((x - LX[i]) * 1000), Math.round((y - LY[i]) * 1000), Math.max(1, Math.round(wt / tw * 255)));
  SAMPLES.push(flat);
}
function inPolygonLocal(x, y, poly) {
  const inR = ring => { let c = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xi, yi] = ring[a], [xj, yj] = ring[b]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  if (!inR(poly[0])) return false; for (let k = 1; k < poly.length; k++) if (inR(poly[k])) return false; return true;
}

// ---------- write ----------
const r = (a, d = 0) => Array.from(a, v => { const m = 10 ** d; return Math.round(v * m) / m; });
const attrs = {
  schema: 'SoA arrays aligned with kecamatan_geo.ids; sectors order: ' + SECT.join(','),
  sectors: SECT, cultureGroups: GROUPS, n,
  population: r(pop), urban: r(urban, 3), age0_14: r(a014, 3), age65: r(a65, 3),
  literacy: r(lit, 3), meanYearsSchooling: r(mys, 2), expectedYearsSchooling: r(eys, 1), lifeExpectancy: r(life, 1), poverty: r(pov, 3),
  laborShare: L.map(l => r(l, 4).map(v => Math.round(v * 10000))), outputShare: out.map((o, i) => { const t = grdp[i]; return Array.from(o, v => Math.round(v / t * 10000)); }),
  specialty1: Array.from(spec1), specialty2: Array.from(spec2), specialtyMult: r(specMult, 2),
  grdp_rp_million: r(Float64Array.from(grdp, v => v / 1e6), 1), capital_rp_million: r(Float64Array.from(kStock, v => v / 1e6), 1),
  electrification: r(elec, 3), schoolLevel: Array.from(schoolLevel), healthLevel: Array.from(healthLevel), cleanWater: r(water, 3),
  roadClass: Array.from(roadClass), railStation: Array.from(railLevel), railPath: Array.from(railPath), portLevel: Array.from(portLevel),
  terrain: Array.from(terrain), swamp: Array.from(swamp), elevProxy_m: r(elev), culture: Array.from(culture),
  isCapital: Array.from(isCapital)
};
fs.writeFileSync('public/data/kecamatan_attrs.json', JSON.stringify(attrs));
fs.writeFileSync('public/data/popsamples.json', JSON.stringify({ note: 'per kecamatan flat [dx,dy,w]*; dx,dy in 0.001 degree offsets from label point; w 1..255 relative weight. SYNTHETIC (no GHSL).', samples: SAMPLES }));
const regOut = adm.regencies.map((rg, k) => ({ id: rg.id, name: rg.name, type: rg.type, prov: rg.prov, capital: geo.ids[capital[k]], kec: rg.kec.map(i => geo.ids[i]), merged: rg.merged }));
fs.writeFileSync('public/data/admin1950.json', JSON.stringify({
  note: 'Approximate 1950 administrative structure (modern kabupaten/kota rolled back, see tools/regency_parents.csv). Capitals are heuristic where not overridden.',
  provinces: adm.provinces.map(p => ({ id: p.id, name: p.name, locked: !!p.locked, capital: geo.ids[provCapital[p.id]], joinYear: p.locked ? CFG.locked.joinYear : null })),
  regencies: regOut
}));
console.log('pop', Math.round(totalPop), 'urban', (sum(Array.from(urban, (u, i) => u * pop[i])) / totalPop).toFixed(3), 'GDP/cap Rp', Math.round(natPc), 'agri output', (sum(Array.from(out, (o, i) => sum(AGRI.map(s => o[s])))) / sum(grdp)).toFixed(3));
fs.writeFileSync('data_raw/work/attr_debug.json', JSON.stringify({ SECT }));
