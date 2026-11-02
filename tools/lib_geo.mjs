import fs from 'node:fs';
import * as topojson from 'topojson-client';
import Flatbush from 'flatbush';

export function loadKec(dir = 'public/data') {
  const topo = JSON.parse(fs.readFileSync(`${dir}/kecamatan.topo.json`, 'utf8'));
  const geo = JSON.parse(fs.readFileSync(`${dir}/kecamatan_geo.json`, 'utf8'));
  const feats = topojson.feature(topo, topo.objects.kec).features;
  const P = feats.map(f => f.properties);
  return { topo, geo, feats, P, n: feats.length };
}

function ringBbox(coords) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [x, y] of coords) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function inPolygon(x, y, poly) { // poly = [outer, ...holes]
  if (!inRing(x, y, poly[0])) return false;
  for (let k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) return false;
  return true;
}
export function inGeometry(x, y, g) {
  if (g.type === 'Polygon') return inPolygon(x, y, g.coordinates);
  for (const p of g.coordinates) if (inPolygon(x, y, p)) return true;
  return false;
}

export class Locator {
  constructor(feats, geo) {
    this.feats = feats; this.geo = geo;
    const polys = feats.map(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
    this.polys = polys;
    // one box per polygon part for tighter filtering
    const boxes = []; this.owner = [];
    polys.forEach((parts, i) => parts.forEach(p => { boxes.push(ringBbox(p[0])); this.owner.push(i); }));
    this.idx = new Flatbush(boxes.length);
    boxes.forEach(b => this.idx.add(b[0], b[1], b[2], b[3]));
    this.idx.finish();
    this.parts = []; polys.forEach(parts => parts.forEach(p => this.parts.push(p)));
    // label points index for nearest fallback
    this.lab = new Flatbush(feats.length);
    for (let i = 0; i < feats.length; i++) { const x = geo.label[0][i], y = geo.label[1][i]; this.lab.add(x, y, x, y); }
    this.lab.finish();
  }
  locate(lon, lat) {
    const hits = this.idx.search(lon, lat, lon, lat);
    for (const h of hits) if (inPolygon(lon, lat, this.parts[h])) return this.owner[h];
    return -1;
  }
  nearest(lon, lat) { return this.lab.neighbors(lon, lat, 1)[0]; }
  // returns {i, exact, distKm}
  resolve(lon, lat) {
    const i = this.locate(lon, lat);
    if (i >= 0) return { i, exact: true, distKm: 0 };
    const j = this.nearest(lon, lat);
    return { i: j, exact: false, distKm: haversine(lon, lat, this.geo.label[0][j], this.geo.label[1][j]) };
  }
}

export function haversine(lon1, lat1, lon2, lat2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

class MinHeap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}
// shortest kecamatan path by label-point distance over the adjacency graph; returns array of indices or null
export function shortestPath(geo, from, to) {
  if (from === to) return [from];
  const n = geo.ids.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const h = new MinHeap(); dist[from] = 0; h.push(0, from);
  while (h.size) {
    const [d, u] = h.pop(); if (d > dist[u]) continue; if (u === to) break;
    for (const v of geo.neighbors[u]) {
      const w = haversine(geo.label[0][u], geo.label[1][u], geo.label[0][v], geo.label[1][v]);
      if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; h.push(dist[v], v); }
    }
  }
  if (!isFinite(dist[to])) return null;
  const path = []; for (let c = to; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}

// deterministic RNG
export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
