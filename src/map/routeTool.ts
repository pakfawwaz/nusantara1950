import type { MapView } from './mapView';
import type { Selection, Tool } from './selection';
import type { Game } from '../game';
import { routeThrough } from '../sim/projects';
import type { TW } from '../sim/transport';
import { yearOf } from '../sim/balance';
import { toast } from '../ui/modal';

export type RouteKind = 'road' | 'rail';
/** Click kecamatan to lay out a road or railway: start, optional waypoints, end. The cheapest route between them is drawn live (existing infrastructure is reused). Enter / double-click prices it. */
export class RouteTool {
  private via: number[] = []; private kind: RouteKind | null = null; private hint: HTMLElement | null = null; private downAt: { x: number; y: number } | null = null;
  constructor(private view: MapView, private sel: Selection, private game: Game, private onFinish: (kind: RouteKind, via: number[]) => void, private onPort: (kec: number) => void, private onIndustry: (kec: number) => void = () => {}) {
    const map = view.map;
    sel.onTool((t: Tool) => { const k = t === 'road' || t === 'rail' ? t : null; if (k !== this.kind) { this.kind = k; this.reset(); } this.showHint(t === 'road' || t === 'rail' || t === 'port' || t === 'industry', t); });
    map.on('mousedown', e => { this.downAt = { x: e.point.x, y: e.point.y }; });
    map.on('click', e => {
      if (this.downAt && Math.abs(e.point.x - this.downAt.x) + Math.abs(e.point.y - this.downAt.y) > 4) return; const i = view.pick(e.point.x, e.point.y);
      if (this.sel.tool === 'port') { if (i < 0) return; sel.setTool('select'); sel.set([i]); this.onPort(i); return; }
      if (this.sel.tool === 'industry') { if (i < 0) return; sel.setTool('select'); sel.set([i]); this.onIndustry(i); return; }
      if (!this.kind || i < 0) return; if (this.via[this.via.length - 1] === i) return;
      if (!this.game.world.alive[i] || this.game.world.isLocked(i)) { toast('That kecamatan is not under your control yet.', true); return; }
      this.via.push(i); this.draw();
    });
    map.on('dblclick', () => { if (this.kind) this.finish(); });
    window.addEventListener('keydown', e => {
      if (!this.kind) return; const tag = (e.target as HTMLElement)?.tagName; if (tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === 'Enter') this.finish(); else if (e.key === 'Escape') { sel.setTool('select'); } else if (e.key === 'Backspace') { this.via.pop(); this.draw(); e.preventDefault(); }
    });
  }
  private reset(): void { this.via = []; this.view.setPreview(null); }
  private routeFor(via: number[]): number[] | null { const g = this.game; return routeThrough(g.world as unknown as TW, via, this.kind as RouteKind, this.kind === 'road' ? 2 : 0, yearOf(g.month)); }
  private draw(): void {
    if (!this.kind) return; const w = this.game.world; const feats: GeoJSON.Feature[] = [];
    if (this.via.length >= 2) { const r = this.routeFor(this.via); if (r) feats.push({ type: 'Feature', properties: { kind: 'route', stroke: '#e08a1e', color: '#e08a1e' }, geometry: { type: 'LineString', coordinates: r.map(i => [w.labelLon[i], w.labelLat[i]]) } }); }
    this.via.forEach((i, q) => feats.push({ type: 'Feature', properties: { kind: 'wp', color: q === 0 || q === this.via.length - 1 ? '#8c2f2b' : '#3f7cc0', stroke: '#8c2f2b' }, geometry: { type: 'Point', coordinates: [w.labelLon[i], w.labelLat[i]] } }));
    this.view.setPreview(feats.length ? { type: 'FeatureCollection', features: feats } : null);
  }
  private showHint(on: boolean, tool: Tool): void {
    this.hint?.remove(); this.hint = null; if (!on) return; const d = document.createElement('div'); d.className = 'splitbar';
    d.textContent = tool === 'industry' ? 'Industry: click a kecamatan to choose what to build and how to finance it · Esc cancel.' : tool === 'port' ? 'Port: click a coastal kecamatan to build or upgrade its port · Esc cancel.' : `${tool === 'road' ? 'Road' : 'Railway'}: click the start kecamatan, any waypoints, then the end. The cheapest route is drawn as you go. Enter or double-click to price it · Backspace removes a point · Esc cancel.`;
    document.getElementById('app')?.append(d); this.hint = d;
  }
  private finish(): void {
    if (!this.kind) return; if (this.via.length < 2) { toast('Click at least a start and an end kecamatan.', true); return; }
    const kind = this.kind, via = this.via.slice(); this.sel.setTool('select'); this.onFinish(kind, via);
  }
}
