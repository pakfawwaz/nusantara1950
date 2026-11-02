// Downloads the raw inputs that CAN be scripted (kecamatan boundary SQL + name list) from GitHub raw. Node >= 18, no external tools.
import fs from 'node:fs'; import path from 'node:path';
const BASE = 'https://raw.githubusercontent.com/cahyadsn';
const dir = 'data_raw/kecamatan_sql'; fs.mkdirSync(dir, { recursive: true });
const get = async (url, out) => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' -> ' + r.status); fs.writeFileSync(out, Buffer.from(await r.arrayBuffer())); console.log('ok', out); };
await get(`${BASE}/wilayah/master/db/wilayah.sql`, 'data_raw/wilayah.sql');
const PROV = [11,12,13,14,15,16,17,18,19,21,31,32,33,34,35,36,51,52,53,61,62,63,64,65,71,72,73,74,75,76,81,82,91,92,93,94,95,96];
for (const p of PROV) await get(`${BASE}/wilayah_boundaries/main/db/kec/wilayah_boundaries_kec_${p}.sql`, path.join(dir, `wilayah_boundaries_kec_${p}.sql`));
await get(`${BASE}/wilayah_boundaries/main/LICENSE`, path.join(dir, 'LICENSE_cahyadsn_wilayah_boundaries.txt'));
console.log('Done. Optional (not scripted): GHSL GHS-POP 1975 and ETOPO 2022, see DATA_NOTES.md.');
