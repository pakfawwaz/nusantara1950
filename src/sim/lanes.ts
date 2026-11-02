import Z from '../../config/zones.json';
import type { SimWorld } from './types';
import type { Nation } from './types';

const L = Z.lanes; const R = 6371;
/** Distance (km) from point p to segment ab on a locally flat projection (adequate at these scales). */
function segKm(lon: number, lat: number, a: number[], b: number[]): number {
  const k = Math.cos((lat * Math.PI) / 180), ax = (a[0] - lon) * k, ay = a[1] - lat, bx = (b[0] - lon) * k, by = b[1] - lat, dx = bx - ax, dy = by - ay; const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0; return Math.hypot(ax + t * dx, ay + t * dy) * ((Math.PI / 180) * R);
}
/** Static proximity (0..1) of every kecamatan to the nearest shipping lane. */
export function laneProximity(w: SimWorld, out: Float64Array): void {
  const routes = Object.values(L.routes);
  for (let i = 0; i < w.n; i++) { if (!w.alive[i]) { out[i] = 0; continue; } let d = Infinity; for (const r of routes) for (let q = 0; q + 1 < r.length; q++) d = Math.min(d, segKm(w.labelLon[i], w.labelLat[i], r[q], r[q + 1])); out[i] = Math.max(0, 1 - d / L.radiusKm); }
}
/** Output bonus rows: a port or a running industry near a lane lets that place (and, half as strongly, its neighbours) plug into world trade. Recomputed yearly. */
export function laneRows(w: SimWorld, n: Nation, prox: Float64Array, out: Float64Array): void {
  out.fill(0, 0, w.n); const add = (i: number, v: number) => { out[i] = Math.min(L.maxBonus, out[i] + v); };
  const hit = (i: number, strength: number) => { if (prox[i] <= 0) return; const v = L.maxBonus * strength * prox[i]; add(i, v); for (const j of w.neighbors[i]) if (w.alive[j]) add(j, v * L.spillWeight * (prox[j] > 0 ? 1 : 0.6)); };
  for (let i = 0; i < w.n; i++) if (w.alive[i] && w.portLevel[i] > 0) hit(i, L.portLevelWeight[Math.min(4, w.portLevel[i])]);
  for (const x of n.ind.list) if (x.status === 'running' && x.kec < w.n && w.alive[x.kec]) hit(x.kec, L.industryWeight);
}
