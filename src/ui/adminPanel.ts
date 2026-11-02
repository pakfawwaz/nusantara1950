import { h } from './dom';
import type { Game } from '../game';
import type { Command, Preview } from '../admin/types';
import { field, fmtMoney, openCommandDialog, select, textInput, toast } from './modal';
import { fmtPop } from '../map/modes';
import { ZC, zoneCost } from '../sim/zones';
import type { SimWorld } from '../sim/types';

// state of the special-area form survives the panel being redrawn every month
const zf = { name: '', cut: 0.5, ease: 0.5 };

export interface AdminCtx { scope: 'kecamatan' | 'regency' | 'province'; sel: number[]; primary: number }
const PIECE_COLORS = ['#3f7cc0', '#d9822b', '#4a9a5a', '#a2569d', '#c24a4a', '#2d9aa6'];

export class AdminPanel {
  constructor(private game: Game, private startSplit: () => void, private showPreview: (fc: GeoJSON.FeatureCollection | null) => void) {}
  private get w() { return this.game.world; }

  /** Draw split / merge pieces on the map while a dialog is open. */
  piecesPreview = (p: Preview | null): void => {
    if (!p?.pieces) { this.showPreview(null); return; }
    this.showPreview({ type: 'FeatureCollection', features: p.pieces.map((pc, j) => ({ type: 'Feature', properties: { color: PIECE_COLORS[j % 6], stroke: '#2a2118', kind: 'piece' }, geometry: pc.polys })) });
  };

  private adjacentRegencies(kecs: number[], sameProvince: number | null): string[] {
    const w = this.w; const out = new Set<number>(); const own = new Set(kecs.map(i => w.kecReg[i]));
    for (const i of kecs) for (const j of w.neighbors[i]) { const k = w.kecReg[j]; if (k >= 0 && !own.has(k) && (sameProvince === null || w.regProv[k] === sameProvince) && !w.provinces[w.regProv[k]].locked) out.add(k); }
    return [...out].sort((a, b) => a - b).map(k => w.regencies[k].id);
  }
  private regName = (id: string) => this.w.regencies[this.w.regIndex.get(id) as number]?.name ?? id;


  /** Special areas (otorita): create from the current selection, adjust or dissolve. */
  private specialAreas(into: HTMLElement, sel: number[]): void {
    const g = this.game, n = g.nation, d = h('div', { class: 'admin-sec' }, h('h4', { text: 'Special areas (otorita)' }));
    const slider = (label: string, get: () => number, max: number, on: (v: number) => void): HTMLElement => { const out = h('span', { class: 'dim', text: `${Math.round(get() * 100)}%` }); const r = h('input', { type: 'range', min: '0', max: String(Math.round(max * 100)), step: '5', value: String(Math.round(get() * 100)), 'aria-label': label }); r.addEventListener('input', () => { on(Number(r.value) / 100); out.textContent = `${r.value}%`; }); return h('label', { class: 'setrow' }, h('span', { text: label }), r, out); };
    const free = sel.filter(i => !n.zones.list.some(z => z.kecs.includes(i)));
    d.append(h('p', { class: 'dim', text: `Select kecamatan, then create an area with its own corporate-tax cut (revenue lost there) and lighter regulation (better local governance, small stability cost). Investors favour low-tax, well-run places. Set-up costs ${(ZC.setupCostGdpShare * 100).toFixed(2)}% of GDP per kecamatan.` }));
    const name = h('input', { type: 'text', placeholder: 'Name, e.g. Otorita Batam', value: zf.name, style: 'width:100%' }); name.addEventListener('input', () => { zf.name = name.value; });
    const cost = zoneCost(n, free.length);
    d.append(name, slider('Corporate-tax cut', () => zf.cut, ZC.maxPphCut, v => { zf.cut = v; }), slider('Regulation eased', () => zf.ease, 1, v => { zf.ease = v; }),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', type: 'button', disabled: !free.length, text: free.length ? `Create from ${free.length} selected kecamatan (${fmtMoney(cost)})` : 'Select kecamatan not already in an area', onclick: () => void g.zoneCreate({ name: zf.name || `Special area ${n.zones.next}`, kecs: free, pphCut: zf.cut, ease: zf.ease }).then(r => { toast(r.ok ? (r.summary ?? 'Done') : (r.error ?? 'Not allowed'), !r.ok); if (r.ok) zf.name = ''; }) })));
    for (const z of n.zones.list) {
      const pop = z.kecs.reduce((s, i) => s + (this.w.alive[i] ? this.w.pop[i] : 0), 0);
      d.append(h('div', { class: 'hist' }, h('b', { text: z.name }), ` · ${z.kecs.length} kecamatan · ${fmtPop(pop)} people`,
        slider('Tax cut', () => z.pphCut, ZC.maxPphCut, v => void g.zoneEdit(z.id, { pphCut: v })), slider('Regulation eased', () => z.ease, 1, v => void g.zoneEdit(z.id, { ease: v })),
        h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Dissolve', onclick: () => void g.zoneRemove(z.id) }))));
    }
    if (n.zones.organicBuilt) d.append(h('p', { class: 'dim', text: `Private firms have started ${n.zones.organicBuilt} plants on their own so far.` }));
    into.append(d);
  }

  render(into: HTMLElement, ctx: AdminCtx): void {
    const w = this.w, g = this.game; into.replaceChildren();
    const sec = (title: string, ...kids: Array<Node | null>): void => { const d = h('div', { class: 'admin-sec' }, h('h4', { text: title })); kids.forEach(k => k && d.append(k)); into.append(d); };
    const btn = (text: string, on: () => void, disabled = false, title = ''): HTMLButtonElement => h('button', { class: 'btn', type: 'button', text, onclick: on, disabled, title });
    const sel = ctx.sel.filter(i => w.alive[i]); const prim = ctx.primary >= 0 && w.alive[ctx.primary] ? ctx.primary : sel[0];
    if (prim === undefined) { into.append(h('div', { class: 'note', text: 'Select kecamatan on the map to reorganise them.' })); }
    else {
      const k = w.kecReg[prim], reg = w.regencies[k], p = w.regProv[k], prov = w.provinces[p];
      if (prov.locked) { into.append(h('div', { class: 'note', text: 'Irian Barat is not under your administration yet.' })); }
      else {
        const stat = (u: { status: string; activeMonth: number }, name: string) => (u.status === 'preparing' ? h('div', { class: 'note', text: `${name} is in persiapan until month ${u.activeMonth} (now month ${g.month}); not yet fully effective.` }) : null);
        if (ctx.scope === 'kecamatan') {
          sec('Regency formation', stat(reg, reg.name),
            h('p', { text: `${sel.length} kecamatan selected · ${fmtPop(sel.reduce((s, i) => s + w.pop[i], 0))} people` }),
            h('div', { class: 'btnrow' }, btn('Create regency from selection…', () => this.dlgCreateRegency(sel)), btn('Move selection to another regency…', () => this.dlgMoveKec(sel))));
          if (sel.length === 2) sec('Merge kecamatan', h('div', { class: 'btnrow' }, btn(`Merge ${w.names[sel[0]]} + ${w.names[sel[1]]}…`, () => this.dlgMergeKec(sel[0], sel[1]))));
          if (sel.length === 1) sec('This kecamatan', h('p', { text: 'Draw a line across it to split it into administratively separate kecamatan.' }),
            h('div', { class: 'btnrow' }, btn('Split with a line…', this.startSplit), btn('Rename…', () => this.dlgRename('kecamatan', w.ids[prim], w.names[prim])), btn('Make regency capital', () => void this.run({ type: 'setCapital', unit: 'regency', id: reg.id, kec: prim }), reg.capital === prim)));
        } else if (ctx.scope === 'regency') {
          const regsTouched = [...new Set(sel.map(i => w.kecReg[i]))].filter(q => q >= 0).map(q => w.regencies[q].id);
          sec(reg.name, stat(reg, reg.name),
            h('div', { class: 'btnrow' }, btn('Rename…', () => this.dlgRename('regency', reg.id, reg.name)), btn('Set capital…', () => this.dlgCapital('regency', reg.id, reg.kec)),
              btn('Merge into adjacent regency…', () => this.dlgMergeReg(reg.id)), btn('Move to another province…', () => this.dlgMoveReg(reg.id))));
          sec('Province formation', h('p', { text: `The selection touches ${regsTouched.length} regenc${regsTouched.length === 1 ? 'y' : 'ies'}. A new province needs ≥ 5 contiguous regencies of one province.` }),
            h('div', { class: 'btnrow' }, btn('Create province from these regencies…', () => this.dlgCreateProvince(regsTouched))));
        } else {
          sec(prov.name, stat(prov, prov.name), h('div', { class: 'btnrow' }, btn('Rename…', () => this.dlgRename('province', prov.id, prov.name)), btn('Set capital…', () => this.dlgCapital('province', prov.id, w.provinceKec(p))), btn('Merge into adjacent province…', () => this.dlgMergeProv(prov.id))));
        }
      }
    }
    this.specialAreas(into, sel);
    const hist = g.history.slice(-5).reverse();
    sec('Recent changes', ...(hist.length ? hist.map(e => h('div', { class: 'hist', text: `Month ${e.month}: ${e.summary}${e.cost ? ` (${fmtMoney(e.cost)})` : ''}` })) : [h('div', { class: 'hist', text: 'None yet.' })]),
      h('div', { class: 'btnrow' }, btn(g.undoLabel() ? `Undo: ${g.undoLabel()}` : 'Nothing to undo', () => { g.undo(); toast('Undone'); }, !g.undoLabel())));
  }

  private async run(cmd: Command): Promise<void> { const r = await this.game.exec(cmd); toast(r.ok ? (r.summary ?? 'Done') : (r.error ?? 'Not allowed'), !r.ok); }

  private dlgCreateRegency(kecs: number[]): void {
    const w = this.w; let kind = 'kabupaten', name = '', cap = String([...kecs].sort((a, b) => w.pop[b] - w.pop[a])[0]);
    openCommandDialog(this.game, {
      title: 'Create a new regency', confirm: 'Create regency', intro: `${kecs.length} kecamatan become a new regency; it spends the persiapan period before it is fully effective.`,
      build: (f, ch) => {
        f.append(field('Type', select([{ value: 'kabupaten', label: 'Kabupaten' }, { value: 'kota', label: 'Kota' }], kind, () => { kind = (f.querySelector('select') as HTMLSelectElement).value; ch(); })),
          field('Name (without Kabupaten / Kota)', textInput('', () => { name = (f.querySelectorAll('input')[0] as HTMLInputElement).value; ch(); }, 'e.g. Bandung Barat')),
          field('Capital kecamatan', select([...kecs].sort((a, b) => w.pop[b] - w.pop[a]).map(i => ({ value: String(i), label: `${w.names[i]} (${fmtPop(w.pop[i])})` })), cap, () => { cap = (f.querySelectorAll('select')[1] as HTMLSelectElement).value; ch(); })));
      },
      command: () => ({ type: 'createRegency', kecs, name, kind: kind as 'kabupaten' | 'kota', capital: Number(cap) })
    });
  }
  private dlgMoveKec(kecs: number[]): void {
    const w = this.w; const opts = this.adjacentRegencies(kecs, null); let dest = opts[0] ?? '';
    if (!opts.length) { toast('No neighbouring regency to move them to.', true); return; }
    openCommandDialog(this.game, {
      title: 'Move kecamatan to another regency', confirm: 'Move', intro: `${kecs.length} kecamatan: ${kecs.slice(0, 4).map(i => w.names[i]).join(', ')}${kecs.length > 4 ? '…' : ''}`,
      build: (f, ch) => f.append(field('Destination (only regencies they border)', select(opts.map(id => ({ value: id, label: `${this.regName(id)} · ${w.provinces[w.regProv[w.regIndex.get(id) as number]].name}` })), dest, () => { dest = (f.querySelector('select') as HTMLSelectElement).value; ch(); }))),
      command: () => ({ type: 'moveKecamatan', kecs, toRegency: dest })
    });
  }
  private dlgMergeKec(a: number, b: number): void {
    const w = this.w; let keep = String(a), name = '';
    openCommandDialog(this.game, {
      title: 'Merge two kecamatan', confirm: 'Merge', intro: 'Adjacent kecamatan of the same regency become one; people, output and capital are added together.',
      build: (f, ch) => f.append(field('Keep as the main kecamatan', select([a, b].map(i => ({ value: String(i), label: w.names[i] })), keep, () => { keep = (f.querySelector('select') as HTMLSelectElement).value; ch(); })),
        field('New name (optional)', textInput('', () => { name = (f.querySelector('input') as HTMLInputElement).value; ch(); }))),
      command: () => ({ type: 'mergeKecamatan', keep: Number(keep), absorb: Number(keep) === a ? b : a, name }),
      onPreview: this.piecesPreview
    });
  }
  private dlgRename(unit: 'regency' | 'province' | 'kecamatan', id: string, cur: string): void {
    let name = cur;
    openCommandDialog(this.game, { title: 'Rename', confirm: 'Rename', build: (f, ch) => f.append(field('New name', textInput(cur, () => { name = (f.querySelector('input') as HTMLInputElement).value; ch(); }))), command: () => ({ type: 'rename', unit, id, name }) });
  }
  private dlgCapital(unit: 'regency' | 'province', id: string, kecs: number[]): void {
    const w = this.w; const sorted = [...kecs].sort((a, b) => w.pop[b] - w.pop[a]).slice(0, 80); let cap = String(sorted[0]);
    openCommandDialog(this.game, { title: 'Set capital', confirm: 'Set capital', intro: 'Showing the 80 most populous kecamatan.', build: (f, ch) => f.append(field('Capital kecamatan', select(sorted.map(i => ({ value: String(i), label: `${w.names[i]} (${fmtPop(w.pop[i])})` })), cap, () => { cap = (f.querySelector('select') as HTMLSelectElement).value; ch(); }))), command: () => ({ type: 'setCapital', unit, id, kec: Number(cap) }) });
  }
  private dlgMergeReg(id: string): void {
    const w = this.w; const k = w.regIndex.get(id) as number; const opts = this.adjacentRegencies(w.regencies[k].kec, w.regProv[k]); let other = opts[0] ?? '';
    if (!opts.length) { toast('No neighbouring regency in the same province.', true); return; }
    openCommandDialog(this.game, { title: `Merge into ${w.regencies[k].name}`, confirm: 'Merge regencies', intro: 'The chosen regency is absorbed; its kecamatan, and the saved overhead, join this one.',
      build: (f, ch) => f.append(field('Absorb this regency', select(opts.map(o => ({ value: o, label: this.regName(o) })), other, () => { other = (f.querySelector('select') as HTMLSelectElement).value; ch(); }))),
      command: () => ({ type: 'mergeRegencies', keep: id, absorb: other }) });
  }
  private dlgMoveReg(id: string): void {
    const w = this.w; const k = w.regIndex.get(id) as number; const from = w.regProv[k];
    const adj = new Set<number>(); for (const i of w.regencies[k].kec) for (const j of w.neighbors[i]) { const q = w.regProv[w.kecReg[j]]; if (q !== from && !w.provinces[q].locked) adj.add(q); }
    const opts = [...adj]; if (!opts.length) { toast('This regency does not border another province.', true); return; } let dest = w.provinces[opts[0]].id;
    openCommandDialog(this.game, { title: `Move ${w.regencies[k].name} to another province`, confirm: 'Move regency', build: (f, ch) => f.append(field('Destination province', select(opts.map(q => ({ value: w.provinces[q].id, label: w.provinces[q].name })), dest, () => { dest = (f.querySelector('select') as HTMLSelectElement).value; ch(); }))), command: () => ({ type: 'moveRegency', regency: id, toProvince: dest }) });
  }
  private dlgMergeProv(id: string): void {
    const w = this.w; const p = w.provIndex.get(id) as number; const adj = new Set<number>();
    for (const i of w.provinceKec(p)) for (const j of w.neighbors[i]) { const q = w.provOfKec(j); if (q !== p && !w.provinces[q].locked) adj.add(q); }
    const opts = [...adj]; if (!opts.length) { toast('No neighbouring province to merge with.', true); return; } let other = w.provinces[opts[0]].id;
    openCommandDialog(this.game, { title: `Merge into ${w.provinces[p].name}`, confirm: 'Merge provinces', build: (f, ch) => f.append(field('Absorb this province', select(opts.map(q => ({ value: w.provinces[q].id, label: w.provinces[q].name })), other, () => { other = (f.querySelector('select') as HTMLSelectElement).value; ch(); }))), command: () => ({ type: 'mergeProvinces', keep: id, absorb: other }) });
  }
  private dlgCreateProvince(regs: string[]): void {
    const w = this.w; let name = ''; const kecs = regs.flatMap(id => w.regencies[w.regIndex.get(id) as number].kec); const sorted = [...kecs].sort((a, b) => w.pop[b] - w.pop[a]).slice(0, 60); let cap = String(sorted[0]);
    openCommandDialog(this.game, { title: 'Create a new province', confirm: 'Create province', intro: `${regs.length} regencies, ${fmtPop(kecs.reduce((s, i) => s + w.pop[i], 0))} people.`,
      build: (f, ch) => f.append(field('Province name', textInput('', () => { name = (f.querySelector('input') as HTMLInputElement).value; ch(); }, 'e.g. Jawa Selatan')), field('Capital kecamatan', select(sorted.map(i => ({ value: String(i), label: `${w.names[i]} (${fmtPop(w.pop[i])})` })), cap, () => { cap = (f.querySelector('select') as HTMLSelectElement).value; ch(); }))),
      command: () => ({ type: 'createProvince', regencies: regs, name, capital: Number(cap) }) });
  }

  /** Dialog opened by the split tool after the line is drawn. */
  openSplit(kec: number, line: Array<[number, number]>, onClose: () => void): void {
    const w = this.w; const names: string[] = [];
    openCommandDialog(this.game, {
      title: `Split ${w.names[kec]}`, confirm: 'Split kecamatan', intro: 'Population is estimated from synthetic sample points (no raster data); output follows the urban core and resource sites.',
      build: (f, ch) => { void this.game.plan({ type: 'splitKecamatan', kec, line }).then(pl => { const pcs = pl.preview.pieces ?? []; pcs.forEach((pc, j) => { names[j] = pc.name; f.append(field(`Piece ${j + 1} name`, textInput(pc.name, () => { names[j] = (f.querySelectorAll('input')[j] as HTMLInputElement).value; ch(); }))); }); }); },
      command: () => ({ type: 'splitKecamatan', kec, line, names }),
      onPreview: this.piecesPreview,
      onClose
    });
  }
}
