import { h, $, esc } from './dom';
import { t } from './i18n';
import type { Agg, World } from '../world';
import { SECTOR_LABELS } from '../world';
import { SECTOR_COLORS } from '../map/palette';
import { fmtPop, fmtRp } from '../map/modes';
import type { Selection } from '../map/selection';
import type { AdminPanel } from './adminPanel';
import type { Game } from '../game';
import { B } from '../sim/balance';
import { TR } from '../sim/transport';
import { stockSat } from '../sim/model';
import { dateText } from './topbar';
import { fmtT, pctf } from './panel';

type Scope = 'kecamatan' | 'regency' | 'province';
type Tab = 'overview' | 'demography' | 'economy' | 'budget' | 'infrastructure' | 'admin' | 'history';
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;
const num = (v: number, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export class Inspector {
  private el = $('inspector'); private scope: Scope = 'kecamatan'; private tab: Tab = 'overview';
  constructor(private world: World, private game: Game, private sel: Selection, private onSelectGroup: (kecs: number[], primary: number) => void, private onFit: (kecs: number[]) => void) {
    sel.onChange(() => { this.scope = 'kecamatan'; this.render(); });
    this.render();
  }
  private admin: AdminPanel | null = null;
  setAdmin(p: AdminPanel): void { this.admin = p; }
  /** Open straight on the Admin tab (used after drawing a split line, etc.). */
  showTab(tab: Tab): void { this.tab = tab; this.render(); }
  refresh(): void { this.render(); }
  private scopeKecs(): { kecs: number[]; title: string; sub: string; locked: boolean; kind: Scope; extra?: string } | null {
    const w = this.world, sel = this.sel; if (!sel.sel.size) return null;
    const prim = sel.primary >= 0 ? sel.primary : [...sel.sel][0]; const k = w.kecReg[prim], p = w.regProv[k]; const reg = w.regencies[k], prov = w.provinces[p];
    if (this.scope === 'regency') return { kecs: reg.kec, title: reg.name, sub: `${prov.name} · ${reg.kec.length} kecamatan`, locked: prov.locked, kind: 'regency', extra: `Capital: ${w.names[reg.capital]}` };
    if (this.scope === 'province') { const ks = w.provinceKec(p); return { kecs: ks, title: prov.name, sub: `${w.regencies.filter((_, i) => w.regProv[i] === p).length} regencies · ${ks.length} kecamatan`, locked: prov.locked, kind: 'province', extra: `Capital: ${w.names[prov.capital]}` }; }
    const kecs = [...sel.sel];
    if (kecs.length === 1) return { kecs, title: w.names[prim], sub: `${reg.name} · ${prov.name}`, locked: prov.locked, kind: 'kecamatan', extra: `Modern: ${w.modernKab[prim]}, ${w.modernProv[prim]}` };
    const regs = new Set(kecs.map(i => w.kecReg[i])); const provs = new Set(kecs.map(i => w.regProv[w.kecReg[i]]));
    return { kecs, title: `${kecs.length} kecamatan selected`, sub: `${regs.size} regenc${regs.size === 1 ? 'y' : 'ies'} · ${provs.size} provinc${provs.size === 1 ? 'e' : 'es'}`, locked: [...provs].some(q => w.provinces[q].locked), kind: 'kecamatan' };
  }
  actions: ((act: string, kec: number) => void) | null = null;
  private render(): void {
    const w = this.world; const sc = this.scopeKecs(); const keep = this.el.querySelector('.ins-body')?.scrollTop ?? 0; this.el.replaceChildren();
    if (!sc) { this.el.append(h('div', { class: 'empty' }, h('div', { class: 't', text: t('inspector.empty.title') }), h('div', { text: t('inspector.empty.body') }))); return; }
    const agg = w.aggregate(sc.kecs);
    const head = h('div', { class: 'ins-head' });
    const title = h('div', { class: 'ins-title', text: sc.title }); if (sc.locked) title.append(h('span', { class: 'badge warn', text: 'locked' }));
    head.append(title, h('div', { class: 'ins-sub', text: sc.sub }));
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Scope' });
    (['kecamatan', 'regency', 'province'] as Scope[]).forEach(s => seg.append(h('button', { type: 'button', 'aria-pressed': String(this.scope === s), text: t('scope.' + s), onclick: () => { this.scope = s; this.render(); } })));
    head.append(seg);
    const tabs = h('div', { class: 'tabs', role: 'tablist' });
    (['overview', 'demography', 'economy', 'budget', 'infrastructure', 'admin', 'history'] as Tab[]).forEach(k => tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': String(this.tab === k), text: t('tab.' + k), onclick: () => { this.tab = k; this.render(); } })));
    const body = h('div', { class: 'ins-body' });
    if (sc.locked) body.append(h('div', { class: 'note', text: t('inspector.locked') }));
    if (this.tab === 'admin' && this.admin) this.admin.render(body, { scope: this.scope, sel: [...this.sel.sel], primary: this.sel.primary });
    else { body.innerHTML += this.content(sc, agg); body.querySelectorAll<HTMLElement>('[data-act]').forEach(b => b.addEventListener('click', () => this.actions?.(b.dataset.act as string, Number(b.dataset.k)))); }
    const row = h('div', { class: 'btnrow' },
      h('button', { class: 'btn', type: 'button', text: t('btn.selectRegency'), onclick: () => { const prim = this.sel.primary >= 0 ? this.sel.primary : [...this.sel.sel][0]; this.onSelectGroup(w.regencies[w.kecReg[prim]].kec, prim); } }),
      h('button', { class: 'btn', type: 'button', text: t('btn.selectProvince'), onclick: () => { const prim = this.sel.primary >= 0 ? this.sel.primary : [...this.sel.sel][0]; this.onSelectGroup(w.provinceKec(w.regProv[w.kecReg[prim]]), prim); } }),
      h('button', { class: 'btn', type: 'button', text: 'Zoom to', onclick: () => this.onFit(sc.kecs) }),
      h('button', { class: 'btn', type: 'button', text: t('btn.clear'), onclick: () => this.sel.clear() }));
    body.append(row);
    this.el.append(head, tabs, body); body.scrollTop = keep;
  }
  private content(sc: NonNullable<ReturnType<Inspector['scopeKecs']>>, a: Agg): string {
    const w = this.world; const single = sc.kecs.length === 1 && sc.kind === 'kecamatan'; const i = sc.kecs[0];
    const stat = (k: string, v: string, small = '') => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}${small ? ` <small>${esc(small)}</small>` : ''}</div></div>`;
    const kv = (k: string, v: string) => `<div class="kv"><span>${esc(k)}</span><span>${v}</span></div>`;
    const bar = (lab: string, frac: number, val: string, color = 'var(--teal)') => `<div class="row"><span class="lab">${esc(lab)}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%;background:${color}"></i></span><span class="val">${val}</span></div>`;
    let out = '';
    if (sc.extra) out += `<div class="ins-sub" style="margin:-4px 0 10px">${esc(sc.extra)}</div>`;
    if (this.tab === 'overview') {
      out += `<div class="grid2">${stat('Population', fmtPop(a.pop))}${stat('Area', num(a.area), 'km²')}${stat('Density', num(a.density, a.density < 10 ? 1 : 0), '/km²')}${stat('IPM', a.ipm.toFixed(3))}${stat('GRDP', fmtRp(a.grdp), '/yr')}${stat('GRDP per capita', fmtRp(a.gdppc))}${stat('Urban', pct(a.urban))}${stat('Poverty', pct(a.poverty))}</div>`;
      if (single) {
        const regIdx = w.kecReg[i], reg = w.regencies[regIdx], prov = w.provinces[w.regProv[regIdx]];
        out += '<h4>Place</h4>' + kv('Terrain', esc(t(`terrain.${w.terrain[i]}`)) + (w.swamp[i] ? ' · swamp/peat' : '')) + kv('Elevation (proxy)', `${num(w.elev[i])} m`) + kv('Coast', w.coastal[i] ? 'Coastal / border' : 'Inland')
          + kv('Island group', `${num(w.islandSizes[w.island[i]])} kecamatan`) + kv('Neighbours', String(w.neighbors[i].length));
        const caps = [reg.capital === i ? `${esc(reg.name)} (regency)` : '', prov.capital === i ? `${esc(prov.name)} (province)` : ''].filter(Boolean);
        if (caps.length) out += kv('Capital of', caps.join(', '));
      }
      if (sc.kind !== 'kecamatan' || sc.kecs.length > 1) {
        const regs = new Map<number, number>(); sc.kecs.forEach(q => regs.set(w.kecReg[q], (regs.get(w.kecReg[q]) ?? 0) + w.pop[q]));
        out += '<h4>Largest regencies in view</h4>' + [...regs].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, p]) => bar(w.regencies[k].name.replace(/^Kabupaten /, ''), p / (a.pop || 1), fmtPop(p))).join('');
      }
    } else if (this.tab === 'demography') {
      out += `<div class="grid2">${stat('Urban share', pct(a.urban, 1))}${stat('Life expectancy', a.life.toFixed(1), 'yrs')}${stat('Adult literacy', pct(a.literacy))}${stat('Mean schooling', a.mys.toFixed(2), 'yrs')}${stat('Expected schooling', a.eys.toFixed(1), 'yrs')}${stat('Poverty rate', pct(a.poverty))}</div>`;
      out += '<h4>Age structure</h4>' + bar('0–14', a.age0_14, pct(a.age0_14), '#6aa37a') + bar('15–64', 1 - a.age0_14 - a.age65, pct(1 - a.age0_14 - a.age65), '#3f7cc0') + bar('65+', a.age65, pct(a.age65), '#b8892d');
      if (single) out += '<h4>Culture (flavour only)</h4>' + kv('Dominant group', esc(w.raw.attrs.cultureGroups[w.culture[i]] ?? '—'));
      const tf = w.s.tfr; if (single) out += kv('Fertility (TFR)', tf[i].toFixed(2));
    } else if (this.tab === 'budget') {
      out += this.budgetTab(sc, a, stat, kv, bar);
    } else if (this.tab === 'history') {
      out += this.historyTab(kv);
    } else if (this.tab === 'economy') {
      out += `<div class="grid2">${stat('GRDP', fmtRp(a.grdp), '/yr')}${stat('GRDP per capita', fmtRp(a.gdppc))}${stat('Capital stock', fmtRp(a.capitalStock))}${stat('Capital / output', (a.capitalStock / (a.grdp || 1)).toFixed(2))}</div>`;
      out += '<h4>Sectors — share of jobs (bar) vs output</h4>';
      SECTOR_LABELS.forEach((l, s) => { out += bar(l, a.laborShare[s], `${(a.outputShare[s] * 100).toFixed(1)}%`, SECTOR_COLORS[s]); });
      out += `<div class="ins-sub" style="margin-top:4px">Bars: share of workers · numbers: share of output</div>`;
      if (single) out += '<h4>Specialty</h4>' + kv('Primary', `${esc(SECTOR_LABELS[w.spec1[i]])} (×${w.specMult[i].toFixed(2)})`) + kv('Secondary', esc(SECTOR_LABELS[w.spec2[i]]));
    } else {
      out += `<div class="grid2">${stat('Electrification', pct(a.elec, 1))}${stat('Clean water', pct(a.water))}</div>`;
      if (single) {
        out += '<h4>Access</h4>' + kv('Road', esc(t(`road.${w.roadClass[i]}`))) + kv('Rail', w.railStation[i] === 2 ? 'Major station' : w.railStation[i] === 1 ? 'Halt' : w.railPath[i] ? 'Line passes through, no station' : 'None') + kv('Port', w.portLevel[i] ? `Level ${w.portLevel[i]}` : 'None');
        out += '<h4>Services</h4>' + kv('Schools', esc(t(`school.${w.schoolLevel[i]}`))) + kv('Health', esc(t(`health.${w.healthLevel[i]}`)));
        const res = w.knownResources(i); if (res.length) out += '<h4>Known resources</h4>' + res.map(r => kv(esc(r.type), esc(r.name))).join('');
        let sw = 0, sm = 0; for (let q = 0; q < w.n; q++) if (w.alive[q] && !w.isLocked(q)) { sw += w.pop[q]; sm += w.pop[q] * w.s.ma[q]; }
        const mean = sm / (sw || 1), hrs = (v: number) => (v < 1 ? `${Math.round(v * 60)} min` : `${v.toFixed(1)} h`);
        out += '<h4>Market access</h4>' + kv('Access index', `${(w.s.ma[i] * 100).toFixed(2)}%  ·  ×${(w.s.ma[i] / (mean || 1)).toFixed(2)} of national average`) + kv('To regency capital', hrs(w.s.tcap[i])) + kv('To province capital', hrs(w.s.tprov[i]));
        const tr = this.game.nation.transport; const line = tr.lines.find(l => l.path.includes(i));
        if (line) out += kv('Railway', `${esc(line.name)} (${esc(TR.rail[line.cls].name)}, ${Math.round(line.cond * 100)}% condition)`);
        const btns: string[] = [];
        if ((w.coastal[i] || w.portLevel[i] > 0) && !w.isLocked(i) && w.portLevel[i] < TR.ports.levels.length - 1) btns.push(`<button class="btn small" type="button" data-act="port" data-k="${i}">${w.portLevel[i] ? 'Upgrade port…' : 'Build port…'}</button>`);
        if (w.railPath[i] && w.railStation[i] < 2 && !w.isLocked(i)) btns.push(`<button class="btn small" type="button" data-act="station" data-k="${i}">${w.railStation[i] ? 'Upgrade station…' : 'Add station…'}</button>`);
        const here = this.game.nation.ind.list.filter(x => x.kec === i && x.status !== 'closed'); const deps = this.game.nation.ind.deposits.filter(d => d.kec === i && d.revealed);
        if (here.length || deps.length) out += '<h4>Industry</h4>' + here.map(x => kv(esc(x.name), x.status === 'building' ? `building (${Math.round((x.progress / Math.max(1, x.months)) * 100)}%)` : `running${x.foreign > 0.005 ? `, ${Math.round(x.foreign * 100)}% foreign` : ''}`)).join('') + deps.map(d => kv(`${esc(d.name)} (${esc(d.type)})`, d.developed ? 'in development' : 'discovered')).join('');
        if (!w.isLocked(i)) btns.push(`<button class="btn small" type="button" data-act="industry" data-k="${i}">Build industry…</button>`);
        if (btns.length) out += `<div class="btnrow">${btns.join('')}</div>`;
      } else {
        const ks = sc.kecs; const c = (f: (q: number) => number) => ks.reduce((s, q) => s + f(q), 0);
        out += '<h4>Network</h4>' + kv('Rail stations', `${c(q => (w.railStation[q] ? 1 : 0))}`) + kv('Kecamatan on a rail line', `${c(q => w.railPath[q])}`) + kv('Ports', `${c(q => (w.portLevel[q] ? 1 : 0))}`) + kv('On provincial trunk road', `${c(q => (w.roadClass[q] === 2 ? 1 : 0))}`);
        out += '<h4>Services</h4>' + kv('Kecamatan with senior high+', `${c(q => (w.schoolLevel[q] >= 3 ? 1 : 0))}`) + kv('Kecamatan with a hospital', `${c(q => (w.healthLevel[q] >= 2 ? 1 : 0))}`);
      }
    }
    return out;
  }

  private budgetTab(sc: NonNullable<ReturnType<Inspector['scopeKecs']>>, a: Agg, stat: (k: string, v: string, small?: string) => string, kv: (k: string, v: string) => string, bar: (l: string, f: number, v: string, c?: string) => string): string {
    const w = this.world, st = this.game.stats; const n = this.game.nation; if (!st) return '<div class="note">The budget appears after the first month of simulation. Press play (or the 1–4 keys).</div>';
    const prim = this.sel.primary >= 0 ? this.sel.primary : sc.kecs[0]; const k = w.kecReg[prim], p = w.regProv[k]; let out = '';
    const fundBar = (f: number) => bar('Funding ratio', Math.min(1, f), pctf(f, 0), f < 0.6 ? '#a3261e' : f < 0.85 ? '#d9893a' : '#2d6f68');
    if (sc.kind === 'regency' || (sc.kind === 'kecamatan' && sc.kecs.length === 1)) {
      const own = st.regPad[k] + st.regDbh[k];
      out += `<h4>${esc(w.regencies[k].name)} — regency budget</h4><div class="grid2">${stat('Running cost', fmtT(st.regOp[k]), '/yr')}${stat('Own revenue', fmtT(own), '/yr')}${stat('DAU received', fmtT(st.regDau[k]), '/yr')}${stat('DAK received', fmtT(st.regDak[k]), '/yr')}</div>`;
      out += fundBar(st.regFund[k]) + kv('Governance quality', st.regGov[k].toFixed(2)) + kv('Stability', st.regStab[k].toFixed(0)) + kv('Status', w.regencies[k].status === 'preparing' ? 'in persiapan (−10% governance)' : 'active');
      out += `<div class="ins-sub" style="margin:6px 0 0">Funding ratio = own revenue + DAU against running costs of the regency and its kecamatan. Under 100% the administration thins out and governance falls.</div>`;
    }
    if (sc.kind === 'province') out += `<h4>${esc(w.provinces[p].name)} — provincial budget</h4><div class="grid2">${stat('Running cost', fmtT(st.provOp[p]), '/yr')}${stat('Own revenue (30% of PAD)', fmtT(st.provPad[p]), '/yr')}${stat('DAU received', fmtT(st.provDau[p]), '/yr')}${stat('Governance', st.provGov[p].toFixed(2))}</div>${fundBar(st.provFund[p])}`;
    out += `<h4>Taxes raised here</h4><div class="grid2">${stat('Central taxes', fmtT(sc.kecs.reduce((s, i) => s + w.s.taxC[i], 0)), '/yr')}${stat('Regional (PAD + shares)', fmtT(a.tax - sc.kecs.reduce((s, i) => s + w.s.taxC[i], 0)), '/yr')}</div>`;
    const r50 = B.stocks.r50; let e = 0, hh = 0, inf = 0, ag = 0, P = 0; for (const i of sc.kecs) { const y = w.gdppc[i], q = w.pop[i]; P += q; e += stockSat(w.s.eduStock[i], y, r50.edu) * q; hh += stockSat(w.s.healthStock[i], y, r50.health) * q; inf += stockSat(w.s.infraStock[i], y, r50.infra) * q; ag += stockSat(w.s.agStock[i], y, r50.ag) * q; }
    out += '<h4>Public-service capital (0–100%)</h4>' + bar('Education', e / (P || 1), pctf(e / (P || 1), 0), '#3f7cc0') + bar('Health', hh / (P || 1), pctf(hh / (P || 1), 0), '#a3261e') + bar('Infrastructure', inf / (P || 1), pctf(inf / (P || 1), 0), '#b8892d') + bar('Farm inputs', ag / (P || 1), pctf(ag / (P || 1), 0), '#6aa37a');
    out += `<div class="ins-sub" style="margin-top:6px">National preset: ${esc(n.policy.devPreset)}${n.policy.provPreset[w.provinces[p].id] ? ` · this province: ${esc(n.policy.provPreset[w.provinces[p].id])}` : ''}. Change it in the Budget window.</div>`;
    return out;
  }
  private historyTab(kv: (k: string, v: string) => string): string {
    const g = this.game; const items = [...g.history].reverse().slice(0, 60); let out = '<h4>Your decisions</h4>';
    out += items.length ? items.map(e => kv(`${dateText(e.month)}`, `${esc(e.summary)}${e.cost ? ` · ${fmtT(e.cost)}` : ''}`)).join('') : '<div class="dim">Nothing yet. Reorganising regions, splitting kecamatan and so on will be logged here.</div>';
    const notes = g.nation.notices; if (notes.length) out += '<h4>Notices</h4>' + [...notes].reverse().slice(0, 20).map(x => `<div class="hist">${esc(x)}</div>`).join('');
    return out;
  }
}
