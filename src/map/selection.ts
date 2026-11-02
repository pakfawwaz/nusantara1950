import type { MapView } from './mapView';
import type { World } from '../world';

export type Tool = 'select' | 'box' | 'lasso' | 'split' | 'road' | 'rail' | 'port' | 'industry';
/** Tools that work by clicking on the map (the map can still be panned) rather than by drawing a selection shape. */
export const isClickTool = (t: Tool): boolean => t === 'select' || t === 'split' || t === 'road' || t === 'rail' || t === 'port' || t === 'industry';
export class Selection {
  readonly sel = new Set<number>(); primary = -1; tool: Tool = 'select';
  private listeners: Array<() => void> = []; private toolListeners: Array<(t: Tool) => void> = [];
  private drawCtx: CanvasRenderingContext2D; private drawing: { x: number; y: number }[] | null = null; private dragStart: { x: number; y: number } | null = null; private panned = false;
  constructor(private view: MapView, private world: World, private drawCanvas: HTMLCanvasElement) {
    this.drawCtx = drawCanvas.getContext('2d') as CanvasRenderingContext2D;
    const cont = view.map.getCanvasContainer();
    cont.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('keydown', e => { if (e.key === 'Escape') { this.cancelDraw(); this.clear(); } });
    view.map.on('click', e => { if (this.tool !== 'select' || this.panned) return; const o = e.originalEvent; this.apply(this.view.pick(e.point.x, e.point.y) >= 0 ? [this.view.pick(e.point.x, e.point.y)] : [], o.shiftKey ? 'add' : o.altKey ? 'sub' : 'replace', true); });
  }
  /** Forget selected kecamatan that no longer exist (after merges / undo). */
  prune(): void { let ch = false; for (const i of [...this.sel]) if (i >= this.world.n || !this.world.alive[i]) { this.sel.delete(i); ch = true; } if (ch) { if (!this.sel.has(this.primary)) this.primary = [...this.sel][0] ?? -1; this.emit(); } }
  onChange(f: () => void): void { this.listeners.push(f); }
  onTool(f: (t: Tool) => void): void { this.toolListeners.push(f); }
  setTool(t: Tool): void { this.tool = t; this.cancelDraw(); const dragPan = this.view.map.dragPan; if (isClickTool(t)) dragPan.enable(); else dragPan.disable(); this.view.map.getCanvas().style.cursor = t === 'select' ? '' : 'crosshair'; this.toolListeners.forEach(f => f(t)); }
  private emit(): void { this.view.setSelection(this.sel); this.listeners.forEach(f => f()); }
  clear(): void { if (!this.sel.size) return; this.sel.clear(); this.primary = -1; this.emit(); }
  set(ids: number[], primary?: number): void { this.sel.clear(); ids.forEach(i => this.sel.add(i)); this.primary = primary ?? ids[0] ?? -1; this.emit(); }
  private apply(ids: number[], mode: 'replace' | 'add' | 'sub', fromClick = false): void {
    if (mode === 'replace') { this.sel.clear(); ids.forEach(i => this.sel.add(i)); this.primary = ids[0] ?? -1; }
    else if (mode === 'add') { if (fromClick && ids.length === 1 && this.sel.has(ids[0])) { this.sel.delete(ids[0]); if (this.primary === ids[0]) this.primary = [...this.sel][0] ?? -1; } else { ids.forEach(i => this.sel.add(i)); if (ids.length) this.primary = ids[ids.length - 1]; } }
    else { ids.forEach(i => this.sel.delete(i)); if (!this.sel.has(this.primary)) this.primary = [...this.sel][0] ?? -1; }
    this.emit();
  }
  private pt(e: PointerEvent) { const r = this.view.map.getCanvas().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private down(e: PointerEvent): void {
    this.panned = false; const p = this.pt(e);
    if (isClickTool(this.tool)) { this.dragStart = p; return; }
    if (e.button !== 0) return;
    this.sizeDraw(); this.drawing = [p]; this.dragStart = p; e.preventDefault();
  }
  private move(e: PointerEvent): void {
    const p = this.pt(e);
    if (isClickTool(this.tool) && this.dragStart && (Math.abs(p.x - this.dragStart.x) + Math.abs(p.y - this.dragStart.y)) > 4) this.panned = true;
    if (!this.drawing) return;
    if (this.tool === 'lasso') this.drawing.push(p); else this.drawing = [this.drawing[0], p];
    this.render();
  }
  private up(e: PointerEvent): void {
    if (isClickTool(this.tool)) { this.dragStart = null; return; }
    if (!this.drawing) return; const pts = this.drawing; this.cancelDraw();
    const mode = e.shiftKey ? 'add' : e.altKey ? 'sub' : 'replace';
    let inside: (x: number, y: number) => boolean;
    if (this.tool === 'box') { if (pts.length < 2) return; const [a, b] = [pts[0], pts[pts.length - 1]]; const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y); if (x1 - x0 < 4 && y1 - y0 < 4) return; inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1; }
    else { if (pts.length < 3) return; inside = (x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { if ((pts[i].y > y) !== (pts[j].y > y) && x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) c = !c; } return c; }; }
    const w = this.world, ids: number[] = [];
    for (let i = 0; i < w.n; i++) { if (!w.alive[i]) continue; const s = this.view.map.project([w.labelLon[i], w.labelLat[i]]); if (inside(s.x, s.y)) ids.push(i); }
    this.apply(ids, mode);
  }
  private sizeDraw(): void { const r = this.view.map.getCanvas().getBoundingClientRect(), d = devicePixelRatio || 1; this.drawCanvas.width = r.width * d; this.drawCanvas.height = r.height * d; this.drawCanvas.style.width = r.width + 'px'; this.drawCanvas.style.height = r.height + 'px'; this.drawCtx.setTransform(d, 0, 0, d, 0, 0); }
  private cancelDraw(): void { this.drawing = null; this.dragStart = null; this.drawCtx.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height); }
  private render(): void {
    const g = this.drawCtx, pts = this.drawing; if (!pts) return; g.clearRect(0, 0, this.drawCanvas.width, this.drawCanvas.height);
    g.strokeStyle = '#e0301e'; g.fillStyle = 'rgba(224,48,30,0.12)'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath();
    if (this.tool === 'box') { const a = pts[0], b = pts[pts.length - 1]; g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }
    else { g.moveTo(pts[0].x, pts[0].y); for (const p of pts) g.lineTo(p.x, p.y); g.closePath(); }
    g.fill(); g.stroke();
  }
}
