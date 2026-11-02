import type { MapView } from './mapView';
import type { Selection } from './selection';
import type { Game } from '../game';
import { toast } from '../ui/modal';

/** Draw a polyline across one kecamatan: click to add vertices, double-click or Enter to finish, Backspace removes the last vertex, Esc cancels. */
export class SplitTool {
  private pts: Array<[number, number]> = []; private active = false; private hint: HTMLElement | null = null; private downAt: { x: number; y: number } | null = null; private mouse: [number, number] | null = null;
  constructor(private view: MapView, private sel: Selection, private game: Game, private onFinish: (kec: number, line: Array<[number, number]>) => void) {
    const map = view.map;
    sel.onTool(t => { const on = t === 'split'; if (on !== this.active) { this.active = on; this.reset(); this.showHint(on); } });
    map.on('mousedown', e => { this.downAt = { x: e.point.x, y: e.point.y }; });
    map.on('click', e => { if (!this.active) return; if (this.downAt && Math.abs(e.point.x - this.downAt.x) + Math.abs(e.point.y - this.downAt.y) > 4) return; this.add([e.lngLat.lng, e.lngLat.lat]); });
    map.on('dblclick', () => { if (this.active) this.finish(); });
    map.on('mousemove', e => { if (this.active && this.pts.length) { this.mouse = [e.lngLat.lng, e.lngLat.lat]; this.draw(); } });
    window.addEventListener('keydown', e => {
      if (!this.active) return; const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT'; if (typing) return;
      if (e.key === 'Enter') this.finish(); else if (e.key === 'Escape') { this.reset(); sel.setTool('select'); } else if (e.key === 'Backspace') { this.pts.pop(); this.draw(); e.preventDefault(); }
    });
  }
  private add(p: [number, number]): void {
    const last = this.pts[this.pts.length - 1]; if (last) { const a = this.view.map.project(last), b = this.view.map.project(p); if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 5) return; }
    this.pts.push(p); this.draw();
  }
  private reset(): void { this.pts = []; this.mouse = null; this.view.setPreview(null); }
  private draw(): void {
    const pts = this.mouse && this.pts.length ? [...this.pts, this.mouse] : this.pts;
    this.view.setPreview(pts.length >= 2 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { kind: 'cut', color: '#e0301e', stroke: '#e0301e' }, geometry: { type: 'LineString', coordinates: pts } }] } : null);
  }
  private showHint(on: boolean): void {
    this.hint?.remove(); this.hint = null; if (!on) return; const d = document.createElement('div'); d.className = 'splitbar';
    d.textContent = 'Split: click points to draw a line across ONE kecamatan, from outside edge to outside edge. Double-click or Enter to finish · Backspace undo point · Esc cancel.';
    document.getElementById('app')?.append(d); this.hint = d;
  }
  private finish(): void {
    if (this.pts.length < 2) { toast('Click at least two points: start outside the kecamatan, end outside on the other side.', true); return; }
    // the target is the kecamatan the line spends most of its length in
    const map = this.view.map, w = this.game.world; const counts = new Map<number, number>();
    for (let q = 0; q < this.pts.length - 1; q++) {
      const a = map.project(this.pts[q]), b = map.project(this.pts[q + 1]); const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
      for (let k = 0; k <= n; k++) { const i = this.view.pick(a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n); if (i >= 0) counts.set(i, (counts.get(i) ?? 0) + 1); }
    }
    let best = -1, bc = 0; for (const [i, c] of counts) if (c > bc) { bc = c; best = i; }
    if (best < 0 || !w.alive[best]) { toast('The line does not cross any kecamatan.', true); return; }
    const line = this.pts.slice(); this.pts = []; this.mouse = null; this.view.setPreview(null); this.sel.setTool('select'); this.sel.set([best]);
    this.onFinish(best, line);
  }
}
