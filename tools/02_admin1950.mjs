// Build the 1950 administrative structure by rolling back pemekaran (tools/regency_parents.src.csv).
// Output: data_raw/work/admin_struct.json and tools/regency_parents.csv (with names, for review).
import fs from 'node:fs';
const topo = JSON.parse(fs.readFileSync('public/data/kecamatan.topo.json', 'utf8'));
const geoms = topo.objects.kec.geometries;
const P = geoms.map(g => g.properties);

// modern kab/kota table
const modern = {};
for (const p of P) modern[p.kab_code] ??= { code: p.kab_code, name: p.kab_name, prov: p.prov_code, kec: [] };
P.forEach((p, i) => modern[p.kab_code].kec.push(i));

// parent map
const parent = {}, meta = {};
for (const line of fs.readFileSync('tools/regency_parents.src.csv', 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || line.startsWith('modern_code')) continue;
  const [c, par, yr, conf] = line.split(',');
  if (!modern[c]) throw new Error('unknown modern code ' + c);
  if (!modern[par]) throw new Error('unknown parent code ' + par);
  parent[c] = par; meta[c] = { year: +yr, conf };
}
// 1950 kota that are kept as their own city regency (spec list + a few medium-confidence additions)
const KEEP_KOTA = new Set(['31.71','32.71','32.72','32.73','32.74','33.71','33.72','33.73','33.74','33.75','33.76','34.71',
  '35.71','35.72','35.73','35.74','35.75','35.76','35.77','35.78','12.71','12.72','13.71','13.75','16.71','73.71','71.71','63.71','61.71','81.71']);
const root = c => { const seen = new Set(); while (parent[c] && parent[c] !== c) { if (seen.has(c)) throw new Error('cycle ' + c); seen.add(c); c = parent[c]; } return c; };

// modern kota not kept and not in map -> fallback: neighbour kabupaten (resolved later with adjacency)
const geo = JSON.parse(fs.readFileSync('public/data/kecamatan_geo.json', 'utf8'));
const warnings = [];
for (const c of Object.keys(modern)) {
  const isKota = /^\d\d\.7\d$/.test(c);
  if (isKota && !KEEP_KOTA.has(c) && !parent[c]) {
    const cnt = {};
    for (const i of modern[c].kec) for (const j of geo.neighbors[i]) { const k = P[j].kab_code; if (k !== c) cnt[k] = (cnt[k] || 0) + 1; }
    const best = Object.entries(cnt).filter(([k]) => !/^\d\d\.7\d$/.test(k) || KEEP_KOTA.has(k)).sort((a, b) => b[1] - a[1])[0];
    if (best) { parent[c] = best[0]; meta[c] = { year: 0, conf: 'auto' }; warnings.push(`auto-merged ${c} ${modern[c].name} -> ${best[0]}`); }
  }
}

const PROV1950 = [
  { id: 'SUMUT', name: 'Sumatera Utara', codes: ['11','12'], capital: '12.71' },
  { id: 'SUMTENG', name: 'Sumatera Tengah', codes: ['13','14','15','21'], capital: '13.75' },
  { id: 'SUMSEL', name: 'Sumatera Selatan', codes: ['16','17','18','19'], capital: '16.71' },
  { id: 'JABAR', name: 'Jawa Barat', codes: ['31','32','36'], capital: '32.73' },
  { id: 'JATENG', name: 'Jawa Tengah', codes: ['33'], capital: '33.74' },
  { id: 'DIY', name: 'Daerah Istimewa Yogyakarta', codes: ['34'], capital: '34.71' },
  { id: 'JATIM', name: 'Jawa Timur', codes: ['35'], capital: '35.78' },
  { id: 'KALIMANTAN', name: 'Kalimantan', codes: ['61','62','63','64','65'], capital: '63.71' },
  { id: 'SULAWESI', name: 'Sulawesi', codes: ['71','72','73','74','75','76'], capital: '73.71' },
  { id: 'MALUKU', name: 'Maluku', codes: ['81','82'], capital: '81.71' },
  { id: 'SUNDAKECIL', name: 'Sunda Kecil', codes: ['51','52','53'], capital: '51.08' },
  { id: 'IRIANBARAT', name: 'Irian Barat', codes: ['91','92','93','94','95','96'], capital: '91.03', locked: true }
];
const provOfCode = {}; PROV1950.forEach(p => p.codes.forEach(c => provOfCode[c] = p.id));
const RENAME = { '14.02': 'Kabupaten Indragiri', '21.01': 'Kabupaten Kepulauan Riau', '31.71': 'Kota Jakarta Raya', '62.01': 'Kabupaten Kotawaringin', '82.01': 'Kabupaten Maluku Utara' };

const regs = {};
for (const c of Object.keys(modern)) {
  const r = root(c);
  regs[r] ??= { code: r, name: RENAME[r] ?? modern[r].name, type: /^\d\d\.7\d$/.test(r) ? 'kota' : 'kabupaten', prov: provOfCode[r.slice(0, 2)], merged: [], kec: [] };
  regs[r].kec.push(...modern[c].kec);
  if (c !== r) regs[r].merged.push(c);
}
const list = Object.values(regs).sort((a, b) => a.code.localeCompare(b.code));
list.forEach(r => { r.id = 'R' + r.code; });
const kecReg = new Array(P.length);
for (const r of list) for (const i of r.kec) kecReg[i] = r.id;

// sanity
const missing = kecReg.filter(x => !x).length;
const byProv = {}; for (const r of list) { byProv[r.prov] ??= { reg: 0, kec: 0 }; byProv[r.prov].reg++; byProv[r.prov].kec += r.kec.length; }
console.log('modern kab/kota', Object.keys(modern).length, '-> 1950 regencies', list.length, 'unassigned kec', missing);
console.table(byProv);
console.log('kota kept:', list.filter(r => r.type === 'kota').length, '| auto-merged warnings:', warnings.length); warnings.forEach(w => console.log(' ', w));
const small = list.filter(r => r.kec.length < 5).map(r => `${r.name}(${r.kec.length})`); console.log('regencies with <5 kecamatan:', small.join(', '));

fs.writeFileSync('data_raw/work/admin_struct.json', JSON.stringify({ provinces: PROV1950, regencies: list.map(({ id, code, name, type, prov, merged, kec }) => ({ id, code, name, type, prov, merged, kec })), kecRegency: kecReg }));
// reviewable CSV with names
const rows = ['modern_code,modern_name,parent_code,parent_name,year_formed,confidence'];
for (const c of Object.keys(parent).sort()) rows.push([c, modern[c].name, parent[c], modern[parent[c]].name, meta[c].year, meta[c].conf].map(s => /,/.test(String(s)) ? `"${s}"` : s).join(','));
fs.writeFileSync('tools/regency_parents.csv', rows.join('\n') + '\n');
