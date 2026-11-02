import type { Grid, Poly } from './grid';
import { areaKm2 } from './grid';
import { isValidPolys, unionPolys, roundPoly } from './jts';

/** Union of two kecamatan outlines. Shared edges are bit-identical on the integer grid so the union is exact. */
export function planMerge(grid: Grid, a: Poly[], b: Poly[]): { polys: Poly[]; areaKm2: number } | { error: string } {
  const u = unionPolys([...a, ...b]); const polys: Poly[] = [];
  for (const p of u) { const r = roundPoly(p); if (!r) return { error: 'Merged outline degenerate.' }; polys.push(r); }
  if (!isValidPolys(polys)) return { error: 'Merged outline is not valid.' };
  const area = areaKm2(polys, grid), expect = areaKm2(a, grid) + areaKm2(b, grid);
  if (Math.abs(area - expect) / expect > 0.005) return { error: 'Merge changed the area by more than 0.5%.' };
  return { polys, areaKm2: area };
}
