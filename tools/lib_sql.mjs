// Parsers for the cahyadsn/wilayah SQL dumps (MIT licensed). Windows-safe, pure Node.
import fs from 'node:fs';
import path from 'node:path';

export function parseNames(sqlFile) {
  const t = fs.readFileSync(sqlFile, 'utf8');
  const prov = {}, kab = {}, kec = {};
  const re = /\('(\d{2}(?:\.\d{2}){0,2})','((?:[^']|'')*)'\)/g;
  let m;
  while ((m = re.exec(t))) {
    const code = m[1], name = m[2].replace(/''/g, "'");
    if (code.length === 2) prov[code] = name;
    else if (code.length === 5) kab[code] = name;
    else if (code.length === 8) kec[code] = name;
  }
  return { prov, kab, kec };
}

// Returns GeoJSON features (lon/lat). Source stores [lat,lng]; depth 3 = Polygon, 4 = MultiPolygon.
export function parseKecBoundaries(dir) {
  const feats = [];
  const files = fs.readdirSync(dir).filter(f => /^wilayah_boundaries_kec_\d+\.sql$/.test(f)).sort();
  const re = /\('([\d.]+)','((?:[^']|'')*)',(-?[\d.]+),(-?[\d.]+),'(\[.*?\])'\)[,;]/g;
  const swap = ring => ring.map(([la, lo]) => [lo, la]);
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    let m;
    while ((m = re.exec(t))) {
      const p = JSON.parse(m[5]);
      let d = 0, x = p;
      while (Array.isArray(x)) { d++; x = x[0]; }
      const geometry = d === 4
        ? { type: 'MultiPolygon', coordinates: p.map(poly => poly.map(swap)) }
        : { type: 'Polygon', coordinates: p.map(swap) };
      feats.push({ type: 'Feature', properties: { code: m[1], src_name: m[2].replace(/''/g, "'") }, geometry });
    }
  }
  return feats;
}
