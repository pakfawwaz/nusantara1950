// Derive per-kecamatan geometry facts + write public/data/kecamatan.topo.json and kecamatan_geo.json
import fs from 'node:fs';
import * as topojson from 'topojson-client';
import { area as turfArea, pointOnFeature } from '@turf/turf';

const topo = JSON.parse(fs.readFileSync('data_raw/work/kec_clean.json', 'utf8'));
const obj = topo.objects.kec;
const geoms = obj.geometries;
const raw = JSON.parse(fs.readFileSync('data_raw/work/kec_raw.geojson', 'utf8'));
const have = new Set(geoms.map(g => g.properties.id));
const lost = raw.features.filter(f => !have.has(f.properties.id)).map(f => f.properties.id + ' ' + f.properties.name);
console.log('lost during clean:', lost);

// area / label point
const feats = topojson.feature(topo, obj).features;
const n = feats.length;
const area = new Float32Array(n), labelLon = new Float32Array(n), labelLat = new Float32Array(n);
feats.forEach((f, i) => {
  area[i] = turfArea(f) / 1e6;
  const p = pointOnFeature(f).geometry.coordinates; labelLon[i] = p[0]; labelLat[i] = p[1];
});

// neighbours via shared arcs
const nb = topojson.neighbors(geoms);

// coastal = owns an arc used by no other geometry
const use = new Int32Array(topo.arcs.length);
const walk = a => Array.isArray(a) ? a.forEach(walk) : use[a < 0 ? ~a : a]++;
geoms.forEach(g => walk(g.arcs));
const coastal = new Uint8Array(n);
geoms.forEach((g, i) => { let c = 0; const w = a => Array.isArray(a) ? a.forEach(w) : (use[a < 0 ? ~a : a] === 1 && (c = 1)); w(g.arcs); coastal[i] = c; });

// islands = connected components of adjacency
const island = new Int32Array(n).fill(-1); let comp = 0; const compSize = [];
for (let s = 0; s < n; s++) {
  if (island[s] >= 0) continue;
  let size = 0; const st = [s]; island[s] = comp;
  while (st.length) { const u = st.pop(); size++; for (const v of nb[u]) if (island[v] < 0) { island[v] = comp; st.push(v); } }
  compSize.push(size); comp++;
}

// slim properties
for (const g of geoms) {
  const p = g.properties;
  g.properties = { id: p.id, name: p.name, kab_code: p.kab_code, kab_name: p.kab_name, prov_code: p.prov_code, prov_name: p.prov_name, bps_code: p.bps_code };
}
fs.writeFileSync('public/data/kecamatan.topo.json', JSON.stringify(topo));
const r1 = a => Array.from(a, v => Math.round(v * 1e4) / 1e4);
const geo = {
  ids: geoms.map(g => g.properties.id),
  area_km2: Array.from(area, v => Math.round(v * 100) / 100),
  label: [r1(labelLon), r1(labelLat)],
  coastal: Array.from(coastal),
  island: Array.from(island),
  neighbors: nb,
  islandSizes: compSize
};
fs.writeFileSync('public/data/kecamatan_geo.json', JSON.stringify(geo));
const big = compSize.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).slice(0, 12);
console.log('kecamatan', n, 'islands', comp, 'largest islands (kec count):', big.map(b => b[0]).join(','));
console.log('coastal share', (coastal.reduce((a, b) => a + b, 0) / n).toFixed(3), 'total area km2', Math.round(area.reduce((a, b) => a + b, 0)));
console.log('area min/median/max', Math.min(...area).toFixed(3), [...area].sort((a, b) => a - b)[n >> 1].toFixed(1), Math.max(...area).toFixed(0));
console.log('isolated (no neighbours):', nb.filter(x => !x.length).length);
