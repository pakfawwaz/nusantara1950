import type { MapView } from './mapView';
import type { World } from '../world';

interface Cand { text: string; x: number; y: number; size: number; weight: number; prio: number; letter?: number; alpha?: number }

/** Canvas label overlay (no glyph server needed). Provinces → regencies → kecamatan by zoom, greedy collision avoidance. */
export class Labels {
  private ctx: CanvasRenderingContext2D; private raf = 0; private provAnchor: number[] = []; private regAnchor: number[] = []; private selected: ReadonlySet<number> = new Set();
  constructor(private canvas: HTMLCanvasElement, private view: MapView, private world: World) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.refreshAnchors();
    const inv = () => this.invalidate();
    view.map.on('move', inv); view.map.on('resize', inv); window.addEventListener('resize', inv);
  }
  refreshAnchors(): void {
    const w = this.world;
    this.regAnchor = w.regencies.map(r => w.anchorOf(r.kec));
    this.provAnchor = w.provinces.map((_, p) => w.anchorOf(w.provinceKec(p)));
    this.invalidate();
  }
  setSelected(s: ReadonlySet<number>): void { this.selected = s; this.invalidate(); }
  invalidate(): void { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }
  private draw(): void {
    const map = this.view.map, w = this.world, c = this.canvas, g = this.ctx, d = devicePixelRatio || 1;
    const r = map.getCanvas().getBoundingClientRect();
    if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; }
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const z = map.getZoom(); const cands: Cand[] = []; const W = r.width, H = r.height;
    const proj = (i: number) => map.project([w.labelLon[i], w.labelLat[i]]);
    if (z < 5.6) w.provinces.forEach((p, k) => { const a = this.provAnchor[k]; if (a < 0) return; const s = proj(a); cands.push({ text: p.name.toUpperCase(), x: s.x, y: s.y, size: z < 4.4 ? 11 : 14, weight: 700, prio: 1e9, letter: 2, alpha: 0.85 }); });
    else if (z < 7.6) w.regencies.forEach((rg, k) => { const s = proj(this.regAnchor[k]); if (s.x < -50 || s.x > W + 50 || s.y < -20 || s.y > H + 20) return; let pop = 0; for (const i of rg.kec) pop += w.pop[i]; cands.push({ text: rg.name.replace(/^Kabupaten /, '').replace(/^Kota /, rg.type === 'kota' ? '' : 'Kota '), x: s.x, y: s.y, size: 11, weight: rg.type === 'kota' ? 700 : 500, prio: pop }); });
    else {
      w.regencies.forEach((rg, k) => { const s = proj(this.regAnchor[k]); if (s.x < -50 || s.x > W + 50 || s.y < -20 || s.y > H + 20) return; cands.push({ text: rg.name.replace(/^Kabupaten /, '').toUpperCase(), x: s.x, y: s.y, size: 13, weight: 700, prio: 1e12, letter: 1.5, alpha: 0.55 }); });
      for (let i = 0; i < w.n; i++) {
        if (!w.alive[i]) continue; const s = proj(i); if (s.x < -30 || s.x > W + 30 || s.y < -10 || s.y > H + 10) continue;
        const extent = (w.bbox[i * 4 + 2] - w.bbox[i * 4]) * (512 * Math.pow(2, z)) / 360; // on-screen width in px
        if (extent < 34) continue; cands.push({ text: w.names[i], x: s.x, y: s.y, size: 10.5, weight: this.selected.has(i) ? 700 : 400, prio: w.pop[i] + (this.selected.has(i) ? 1e9 : 0) });
      }
    }
    cands.sort((a, b) => b.prio - a.prio);
    const placed: number[][] = []; let count = 0;
    for (const cd of cands) {
      if (count > 450) break;
      g.font = `${cd.weight} ${cd.size}px "Segoe UI", system-ui, sans-serif`;
      (g as unknown as { letterSpacing: string }).letterSpacing = cd.letter ? `${cd.letter}px` : '0px';
      const tw = g.measureText(cd.text).width, th = cd.size;
      const x0 = cd.x - tw / 2 - 2, y0 = cd.y - th / 2 - 1, x1 = x0 + tw + 4, y1 = y0 + th + 2;
      let hit = false; for (const p of placed) if (x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]) { hit = true; break; }
      if (hit) continue; placed.push([x0, y0, x1, y1]); count++;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 3.2; g.strokeStyle = 'rgba(255,252,244,0.85)';
      g.globalAlpha = cd.alpha ?? 1; g.strokeText(cd.text, cd.x, cd.y); g.fillStyle = '#2a2118'; g.fillText(cd.text, cd.x, cd.y); g.globalAlpha = 1;
    }
  }
}
