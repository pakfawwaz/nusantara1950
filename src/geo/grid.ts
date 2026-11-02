/** Integer grid shared with the TopoJSON quantisation (0.0001°). All boundary editing happens on this grid so shared edges stay bit-exact. */
export type Pt = [number, number];
export type Ring = Pt[];
export type Poly = Ring[]; // [outer, ...holes]

export interface Grid { tx: number; ty: number; sx: number; sy: number }
export const gridOf = (t: { scale: [number, number]; translate: [number, number] }): Grid => ({ tx: t.translate[0], ty: t.translate[1], sx: t.scale[0], sy: t.scale[1] });
export const toGrid = (g: Grid, lon: number, lat: number): Pt => [Math.round((lon - g.tx) / g.sx), Math.round((lat - g.ty) / g.sy)];
export const fromGrid = (g: Grid, x: number, y: number): [number, number] => [x * g.sx + g.tx, y * g.sy + g.ty];

export function polysFromGeometry(g: GeoJSON.Polygon | GeoJSON.MultiPolygon, grid: Grid): Poly[] {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  return polys.map(p => p.map(r => r.map(c => toGrid(grid, c[0], c[1]))));
}
export function geometryFromPolys(polys: Poly[], grid: Grid): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  const conv = polys.map(p => p.map(r => r.map(([x, y]) => fromGrid(grid, x, y))));
  return conv.length === 1 ? { type: 'Polygon', coordinates: conv[0] } : { type: 'MultiPolygon', coordinates: conv };
}

/** Planar area of a polygon set in km², using a local equirectangular projection (error well below 0.1% at kecamatan scale). */
export function areaKm2(polys: Poly[], grid: Grid): number {
  let total = 0;
  for (const poly of polys) {
    const outer = poly[0]; if (!outer || outer.length < 4) continue;
    const lat0 = fromGrid(grid, 0, outer[0][1])[1]; const kx = Math.cos((lat0 * Math.PI) / 180) * 111.32 * grid.sx, ky = 110.57 * grid.sy;
    poly.forEach((ring, k) => {
      let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      const a = Math.abs(s) / 2 * kx * ky; total += k === 0 ? a : -a;
    });
  }
  return total;
}
export function bboxOfPolys(polys: Poly[], grid: Grid): [number, number, number, number] {
  let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
  for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const a = fromGrid(grid, x0, y0), b = fromGrid(grid, x1, y1); return [a[0], a[1], b[0], b[1]];
}
export function pointInPolys(polys: Poly[], x: number, y: number): boolean {
  for (const p of polys) {
    if (!inRing(p[0], x, y)) continue; let hole = false;
    for (let k = 1; k < p.length; k++) if (inRing(p[k], x, y)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}
function inRing(r: Ring, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
export const edgeKey = (a: Pt, b: Pt): string => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a[0]},${a[1]}|${b[0]},${b[1]}` : `${b[0]},${b[1]}|${a[0]},${a[1]}`);

/** Distance (grid units) from a point to the nearest ring segment of a polygon set. */
export function distToRings(polys: Poly[], x: number, y: number): number {
  let best = Infinity;
  for (const p of polys) for (const r of p) for (let i = 0; i < r.length - 1; i++) {
    const ax = r[i][0], ay = r[i][1], dx = r[i + 1][0] - ax, dy = r[i + 1][1] - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); const d = Math.hypot(ax + t * dx - x, ay + t * dy - y); if (d < best) best = d;
  }
  return best;
}
