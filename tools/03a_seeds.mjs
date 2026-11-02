// Resolve hand-curated seeds to kecamatan; route rail/road lines over the adjacency graph.
import fs from 'node:fs';
import { loadKec, Locator, shortestPath } from './lib_geo.mjs';

const { geo, feats, P, n } = loadKec();
const loc = new Locator(feats, geo);
const res = JSON.parse(fs.readFileSync('tools/seeds/resources.json', 'utf8'));
const infra = JSON.parse(fs.readFileSync('tools/seeds/infrastructure.json', 'utf8'));
const issues = [];
const R = (label, lon, lat) => {
  const r = loc.resolve(lon, lat);
  if (!r.exact) issues.push(`${label}: offshore/outside -> nearest kecamatan ${P[r.i].name} (${r.distKm.toFixed(0)} km)`);
  if (r.distKm > 120) issues.push(`  !! ${label}: nearest is ${r.distKm.toFixed(0)} km away`);
  return r.i;
};
const out = { resources: [], rail: [], ports: [], industries: [], roads: [] };

for (const [bucket, hidden] of [['known', false], ['hidden', true]]) {
  for (const r of res[bucket]) {
    const i = R(`resource ${r.name}`, r.lonlat[0], r.lonlat[1]);
    out.resources.push({ kec: geo.ids[i], type: r.type, name: r.name, size: r.size, hidden, knownYear: r.knownYear ?? null, conf: r.conf, crop: r.crop ?? null, lonlat: r.lonlat });
  }
}
function route(label, stops) { // stops: [{i, name, major}]; returns {stations, path}
  const path = []; let broken = 0;
  for (let k = 0; k < stops.length; k++) {
    if (k === 0) { path.push(stops[0].i); continue; }
    const seg = shortestPath(geo, stops[k - 1].i, stops[k].i);
    if (!seg) { broken++; issues.push(`${label}: no land path ${stops[k - 1].name} -> ${stops[k].name}`); path.push(stops[k].i); continue; }
    for (const s of seg.slice(1)) path.push(s);
  }
  return { path, broken };
}
for (const line of infra.rail) {
  const stops = line.stations.map(([name, lon, lat, major]) => ({ name, lonlat: [lon, lat], i: R(`rail ${line.id} ${name}`, lon, lat), major: !!major }));
  const { path, broken } = route(`rail ${line.id}`, stops);
  out.rail.push({ id: line.id, name: line.name, gauge: line.gauge, degraded: !!line.degraded,
    stations: stops.map(s => ({ name: s.name, kec: geo.ids[s.i], level: s.major ? 2 : 1, lonlat: s.lonlat })),
    path: path.map(i => geo.ids[i]), brokenLegs: broken });
}
for (const p of infra.ports) out.ports.push({ name: p.name, kec: geo.ids[R(`port ${p.name}`, p.lonlat[0], p.lonlat[1])], level: p.level, lonlat: p.lonlat });
for (const d of infra.industries) out.industries.push({ ...d, kec: geo.ids[R(`industry ${d.name}`, d.lonlat[0], d.lonlat[1])] });
for (const rd of infra.roads_trunk) {
  const stops = rd.waypoints.map(([name, lon, lat]) => ({ name, i: R(`road ${rd.id} ${name}`, lon, lat) }));
  const { path, broken } = route(`road ${rd.id}`, stops);
  out.roads.push({ id: rd.id, name: rd.name, class: rd.class, path: path.map(i => geo.ids[i]), brokenLegs: broken });
}
fs.writeFileSync('public/data/seeds.json', JSON.stringify(out));
console.log('resources', out.resources.length, '| rail lines', out.rail.length, 'stations', out.rail.reduce((s, l) => s + l.stations.length, 0), 'path kec', out.rail.reduce((s, l) => s + l.path.length, 0),
  '| ports', out.ports.length, '| industries', out.industries.length, '| trunk roads', out.roads.length, 'path kec', out.roads.reduce((s, l) => s + l.path.length, 0));
console.log('issues:', issues.length); issues.forEach(s => console.log(' ', s));
