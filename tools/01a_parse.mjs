import fs from 'node:fs';
import { parseNames, parseKecBoundaries } from './lib_sql.mjs';
const names = parseNames('data_raw/wilayah.sql');
const feats = parseKecBoundaries('data_raw/kecamatan_sql');
let missing = 0;
for (const f of feats) {
  const c = f.properties.code, pc = c.slice(0, 2), kc = c.slice(0, 5);
  f.properties = {
    id: c, name: names.kec[c] ?? f.properties.src_name,
    kab_code: kc, kab_name: names.kab[kc] ?? '?', prov_code: pc, prov_name: names.prov[pc] ?? '?', bps_code: c.replace(/\./g, '')
  };
  if (!names.kab[kc] || !names.prov[pc]) missing++;
}
fs.writeFileSync('data_raw/work/kec_raw.geojson', JSON.stringify({ type: 'FeatureCollection', features: feats }));
console.log('features', feats.length, 'prov', Object.keys(names.prov).length, 'kab', Object.keys(names.kab).length, 'missing names', missing);
const byProv = {}; for (const f of feats) byProv[f.properties.prov_name] = (byProv[f.properties.prov_name] || 0) + 1;
console.log(byProv);
