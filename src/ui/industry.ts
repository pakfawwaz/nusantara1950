import { h } from './dom';
import { toast, fmtMoney, field, select, textInput } from './modal';
import { openPanel, fmtT, pctf } from './panel';
import type { Game } from '../game';
import { aidOffers, fdiAllowed, fdiOffers, IC, TYPES, TYPE, compensationOf, privatizationPrice, capFor, requirements } from '../sim/industry';
import type { Financing, IndSpec, IndType, Industry } from '../sim/industry';
import type { SimWorld } from '../sim/types';
import { costIndex } from '../sim/transport';
import { yearOf, MONTH_NAMES, monthOfYear } from '../sim/balance';

const when = (m: number): string => `${MONTH_NAMES[monthOfYear(m)]} ${yearOf(m)}`;
const SECTOR_NAME = ['Food crops', 'Plantations', 'Fisheries', 'Forestry', 'Mining', 'Oil & gas', 'Manufacturing', 'Construction & utilities', 'Services', 'Tourism'];
const KIND_NAME: Record<string, string> = { process: 'Processing', extract: 'Extraction', power: 'Power', service: 'Service' };
const ownerText = (x: Industry): string => [x.state > 0.005 ? `State ${Math.round(x.state * 100)}%` : '', x.foreign > 0.005 ? `Foreign ${Math.round(x.foreign * 100)}%` : '', x.priv > 0.005 ? `Private ${Math.round(x.priv * 100)}%` : ''].filter(Boolean).join(' · ');

/** Which industry to build in kecamatan `kec`, and how to pay for it: budget (APBN), foreign investment (a proposal with terms) or an aid loan. */
export function openIndustryDialog(game: Game, kec: number, preType?: string): void {
  const w = game.world, n0 = game.nation, year = yearOf(n0.month);
  if (!w.alive[kec] || w.isLocked(kec)) { toast('That kecamatan is not under your control yet.', true); return; }
  const sw = w as unknown as SimWorld;
  const ok0 = (t: IndType) => requirements(sw, n0, t, kec, year).reqs.every(r => r.ok);
  let type = preType ?? (TYPES.find(t => ok0(t))?.id ?? TYPES[0].id), fin: Financing = 'apbn', offer = '', partner = '', name = '';
  const back = h('div', { class: 'modal-back' }); const box = h('div', { class: 'modal mid', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Build an industry' });
  const form = h('div', { class: 'form' }); const out = h('div', { class: 'preview' });
  const okBtn = h('button', { class: 'btn primary', type: 'button', text: 'Start construction', disabled: true }), cancel = h('button', { class: 'btn', type: 'button', text: 'Cancel' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); }; const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const typeSel = select(TYPES.slice().sort((a, b) => a.unlock - b.unlock || a.name.localeCompare(b.name)).map(t => ({ value: t.id, label: `${ok0(t) ? '✓' : year < t.unlock ? '🔒' : '✗'} ${t.name}${year < t.unlock ? ` (from ${t.unlock})` : ''}` })), type, () => { type = typeSel.value; offer = ''; partner = ''; name = ''; nameIn.value = ''; rebuild(); });
  const nameIn = textInput('', () => { name = nameIn.value; }, 'Name (optional)');
  const finBox = h('div', { class: 'fld' }); const extra = h('div');
  const radio = (v: Financing, label: string, tip: string) => { const id = `fin-${v}`; const r = h('input', { type: 'radio', name: 'fin', id, value: v }) as HTMLInputElement; r.checked = fin === v; r.addEventListener('change', () => { fin = v; offer = ''; partner = ''; rebuild(); }); return h('label', { class: 'radio', title: tip, for: id }, r, h('span', { text: label })); };
  const spec = (): IndSpec => ({ type, kec, financing: fin, offer, partner, name });
  const rebuild = () => {
    const t = TYPE.get(type) as IndType; finBox.replaceChildren(h('span', { text: 'Financing' }), h('div', { class: 'radios' }, radio('apbn', 'Budget (APBN)', 'You pay month by month; 100% state-owned; profits flow to the budget.'), radio('fdi', 'Foreign investment', 'Investors pay; you grant terms (ownership, tax holiday, local content).'), radio('aid', 'Aid loan', 'A partner lends at low interest; it adds external debt and may be tied or conditional.')));
    extra.replaceChildren();
    if (fin === 'fdi') {
      const offers = fdiOffers(game.nation, t, year), why = fdiAllowed(game.nation, t, year);
      if (why) extra.append(h('div', { class: 'chk warn', text: `! ${why}` })); else if (!offers.length) extra.append(h('div', { class: 'chk warn', text: `! Investment climate ${Math.round(game.nation.fin.climate)} is too low: investors want at least ${IC.fdi.minClimate}.` }));
      else { if (!offers.some(o => o.id === offer)) offer = offers[0].id;
        extra.append(h('div', { class: 'fld' }, h('span', { text: "Investors' proposals" }), h('div', { class: 'offers' }, ...offers.map(o => { const r = h('input', { type: 'radio', name: 'offer', value: o.id }) as HTMLInputElement; r.checked = offer === o.id; r.addEventListener('change', () => { offer = o.id; run(); });
          return h('label', { class: 'offer' }, r, h('div', {}, h('b', { text: o.name }), h('div', { class: 'dim', text: `${Math.round(o.foreign * 100)}% foreign${o.divestYears ? `, falling to ${Math.round(o.divestTo * 100)}% over ${o.divestYears} years` : ''} · ${o.holiday}-year tax holiday · ${Math.round(o.local * 100)}% local content` }))); }))));
      }
    } else if (fin === 'aid') {
      const offers = aidOffers(game.nation, year, game.nation.agg.gdp);
      if (!offers.length) extra.append(h('div', { class: 'chk warn', text: '! No partner is lending at your current alignment and date (see Finance).' }));
      else { if (!offers.some(o => o.partner.id === partner)) partner = offers[0].partner.id;
        const ps = select(offers.map(o => ({ value: o.partner.id, label: `${o.partner.name} — ${o.partner.grant ? 'grant' : `${(o.partner.rate * 100).toFixed(1)}%`}${o.partner.tied ? `, tied ${Math.round(o.partner.tied * 100)}%` : ''}${o.partner.conditional ? ', conditional' : ''} (up to ${fmtT(o.remaining)} this year)` })), partner, () => { partner = ps.value; run(); }); extra.append(field('Lender', ps)); }
    }
    run();
  };
  let seq = 0;
  const run = () => {
    const my = ++seq; const p = game.planIndustry(spec()); const t = p.type; if (my !== seq) return; const rows: Node[] = [];
    for (const r of p.reqs) rows.push(h('div', { class: r.ok ? 'chk ok' : 'chk bad', text: `${r.ok ? '✓' : '✗'} ${r.label}` }));
    for (const e of p.errors.filter(e => !e.startsWith('Requires:'))) rows.push(h('div', { class: 'chk bad', text: `✗ ${e}` }));
    for (const m of p.warnings) rows.push(h('div', { class: 'chk warn', text: `! ${m}` }));
    if (t) {
      const margin = p.va * t.margin, payback = p.va + margin > 0 ? p.cost / p.va : Infinity; const gdp = Math.max(1, game.nation.agg.gdp);
      const how = fin === 'apbn' ? `Paid by the budget over ${p.months} months (${fmtMoney(p.cost / p.months)} a month)` : fin === 'aid' ? `Financed by a loan drawn over ${p.months} months` : 'Paid by the investor';
      rows.push(h('div', { class: 'box' }, h('div', { text: `${KIND_NAME[t.kind]} · ${SECTOR_NAME[t.sector]} · ${p.months} months to build · about ${t.jobs.toLocaleString()} jobs` }),
        h('div', { text: `Cost ${fmtMoney(p.cost)}${p.cap !== 1 ? ` (deposit size ${(p.cap * IC.capacity.sizeDivisor).toFixed(0)}/5)` : ''}. ${how}. Cash now ${fmtMoney(game.nation.cash)}.` }),
        h('div', { text: `At full capacity: value added ≈ ${fmtMoney(p.va)}/yr (${(p.va / gdp * 100).toFixed(2)}% of GDP), profit ≈ ${fmtMoney(margin)}/yr${Number.isFinite(payback) ? ` → output pays back the cost in ≈ ${payback < 1 ? '<1' : payback.toFixed(0)} years` : ''}.` })));
      if (t.power) rows.push(h('div', { class: 'dim', text: `Raises electrification of nearby kecamatan by up to ${Math.round(t.power.boost * 100)} points.` }));
      if (t.link) rows.push(h('div', { class: 'dim', text: `Linkage: boosts ${SECTOR_NAME[t.link.sector].toLowerCase()} output in surrounding kecamatan.` }));
    }
    out.replaceChildren(...rows); okBtn.disabled = !p.ok;
  };
  okBtn.addEventListener('click', async () => { okBtn.disabled = true; const r = await game.startIndustry(spec()); if (r.ok) { toast(r.summary ?? 'Started.'); close(); } else { toast(r.error ?? 'Not allowed.', true); run(); } });
  cancel.addEventListener('click', close); back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  form.append(field('Industry', typeSel), field('Name', nameIn), finBox, extra);
  box.append(h('h3', { text: `Build an industry — ${w.names[kec]}` }), h('p', { class: 'intro', text: 'Industries add output (value added) in their kecamatan, boost neighbouring sectors and need power, skilled labour, port or road access and often a resource. Unfinished projects can be cancelled; money spent is lost.' }), form, out, h('div', { class: 'actions' }, cancel, okBtn)); back.append(box); document.getElementById('app')?.append(back);
  rebuild();
}

type Tab = 'mine' | 'catalog' | 'deposits';
/** Industries window: what you own and run, the catalog of types, and discovered / undiscovered deposits. */
export function openIndustry(game: Game, pickKec: (i: number) => void): void {
  openPanel('Industry', 'wide', body => {
    let tab: Tab = 'mine'; const root = h('div'); body.append(root);
    const render = () => {
      const n = game.nation, w = game.world, year = yearOf(n.month); root.replaceChildren();
      const tabs = h('div', { class: 'pills' }, ...(['mine', 'catalog', 'deposits'] as Tab[]).map(k => h('button', { class: 'pill', type: 'button', 'aria-pressed': String(tab === k), text: k === 'mine' ? 'My industries' : k === 'catalog' ? 'Catalog' : 'Deposits', onclick: () => { tab = k; render(); } })));
      root.append(tabs);
      if (tab === 'mine') {
        const list = n.ind.list.filter(x => x.status !== 'closed'); const run = list.filter(x => x.status === 'running'), va = run.reduce((s, x) => s + x.va, 0), profit = run.reduce((s, x) => s + x.profit * x.state, 0);
        root.append(h('p', { class: 'intro', text: `${run.length} running, ${list.length - run.length} under construction. Value added ${fmtT(va)}/yr (${pctf(va / Math.max(1, n.agg.gdp), 2)} of GDP); profit to the budget ${fmtT(profit)}/yr. Industries that already existed in 1950 are part of the baseline economy.` }));
        const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Industry', 'Where', 'Owner', 'Status', 'Use', 'Value added', ''].map((c, k) => h('th', { class: k < 2 ? 'l' : '', text: c })))));
        const tb = h('tbody'); for (const x of list.sort((a, b) => b.va - a.va)) {
          const tt = TYPE.get(x.type) as IndType; const acts: HTMLElement[] = [];
          if (x.status === 'building') { acts.push(h('button', { class: 'btn small', type: 'button', text: x.paused ? 'Resume' : 'Pause', onclick: async () => { await game.setIndustryPaused(x.id, !x.paused); render(); } }), h('button', { class: 'btn small', type: 'button', text: 'Cancel', onclick: async () => { if (confirm(`Cancel ${x.name}? Money spent so far (${fmtMoney(x.paid)}) is lost.`)) { await game.cancelIndustry(x.id); render(); } } })); }
          else { if (x.foreign > 0.005) acts.push(h('button', { class: 'btn small', type: 'button', title: `Compensation ≈ ${fmtMoney(compensationOf(x))}; frightens investors for years`, text: 'Nationalise', onclick: async () => { const r = await game.nationalize(x.id); toast(r.ok ? r.summary ?? 'Done' : r.error ?? 'Not possible', !r.ok); render(); } })); if (x.state > 0.005) acts.push(h('button', { class: 'btn small', type: 'button', title: `Sale price ≈ ${fmtMoney(privatizationPrice(n, x))}`, text: 'Sell', onclick: async () => { const r = await game.privatize(x.id); toast(r.ok ? r.summary ?? 'Done' : r.error ?? 'Not possible', !r.ok); render(); } })); }
          const tr = h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: x.name, title: tt.name }), h('td', { class: 'l' }, h('a', { href: '#', text: w.names[x.kec] ?? '?', onclick: (e: Event) => { e.preventDefault(); pickKec(x.kec); } })), h('td', { text: ownerText(x) }),
            h('td', { text: x.status === 'building' ? `${x.paused ? 'paused · ' : ''}${Math.round((x.progress / Math.max(1, x.months)) * 100)}% built` : `running${x.inBase ? ' (1950)' : ''}` }), h('td', { text: x.status === 'running' ? pctf(Math.min(1, x.util), 0) : '—' }), h('td', { text: x.status === 'running' ? fmtT(x.va) : '—' }), h('td', {}, ...acts));
          tb.append(tr);
        }
        if (!list.length) tb.append(h('tr', {}, h('td', { colspan: '7', class: 'dim', text: 'Nothing yet. Use the Build industry tool on the map.' }))); t.append(tb); root.append(h('div', { class: 'tablewrap' }, t));
      } else if (tab === 'catalog') {
        root.append(h('p', { class: 'intro', text: `Costs are shown at ${year} prices. Use the Build industry tool (left rail) or a deposit's Develop button to choose a site; requirements are checked there.` }));
        const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Type', 'Kind', 'From', 'Cost', 'Value added /yr', 'Build', 'Needs'].map((c, k) => h('th', { class: k < 2 || k === 6 ? 'l' : '', text: c })))));
        const tb = h('tbody'); for (const ty of TYPES.slice().sort((a, b) => a.unlock - b.unlock || a.name.localeCompare(b.name))) {
          const r = ty.requires; const need = [r.mys ? `schooling ${r.mys}` : '', r.elec ? `power ${Math.round(r.elec * 100)}%` : '', r.port ? `port ${r.port}` : '', r.road ? `road ${r.road}` : '', ty.resource ? `${ty.resource.join('/')} deposit` : '', ...ty.needs.map(q => `input: ${q}`)].filter(Boolean).join(', ');
          tb.append(h('tr', { style: `cursor:default;${year < ty.unlock ? 'opacity:.55' : ''}` }, h('td', { class: 'l', text: ty.name }), h('td', { class: 'l', text: KIND_NAME[ty.kind] }), h('td', { text: String(ty.unlock) }), h('td', { text: fmtT(ty.cost * costIndex(year) * 1e6) }), h('td', { text: fmtT(ty.va * 1e6) }), h('td', { text: `${ty.months} mo` }), h('td', { class: 'l', text: need })));
        } t.append(tb); root.append(h('div', { class: 'tablewrap' }, t));
      } else {
        const exp = n.policy.budget.exploration; root.append(h('p', { class: 'intro', text: `Exploration budget in force: ${exp.toFixed(2)}% of GDP (${fmtT(exp / 100 * n.agg.gdp)}/yr). ${n.settings.historical ? 'Historical mode: deposits are also found on their real discovery dates.' : 'Randomised mode: deposits are found only by exploring.'} Set the line in the Budget window.` }));
        const t = h('table', { class: 't' }, h('thead', {}, h('tr', {}, ...['Deposit', 'Resource', 'Where', 'Size', 'Status', ''].map((c, k) => h('th', { class: k < 3 ? 'l' : '', text: c })))));
        const tb = h('tbody'); for (const d of n.ind.deposits.slice().sort((a, b) => Number(b.revealed) - Number(a.revealed) || b.size - a.size)) {
          const typ = (IC.resourceType as Record<string, string>)[d.type]; const btn = d.revealed && !d.developed && year >= (TYPE.get(typ)?.unlock ?? 0) ? h('button', { class: 'btn small', type: 'button', text: 'Develop…', onclick: () => { openIndustryDialog(game, d.kec, typ); } }) : h('span', { class: 'dim', text: d.developed ? 'in development' : '' });
          tb.append(h('tr', { style: 'cursor:default' }, h('td', { class: 'l', text: d.revealed ? d.name : '???' }), h('td', { class: 'l', text: d.type }), h('td', { class: 'l' }, d.revealed ? h('a', { href: '#', text: w.names[d.kec] ?? '?', onclick: (e: Event) => { e.preventDefault(); pickKec(d.kec); } }) : h('span', { class: 'dim', text: 'unknown' })),
            h('td', { text: d.revealed ? `${d.size}/5` : '?' }), h('td', { text: d.revealed ? `found ${when(d.revealedMonth)}` : `${Math.round(d.progress * 100)}% explored` }), h('td', {}, btn)));
        } t.append(tb); root.append(h('div', { class: 'tablewrap' }, t));
      }
    };
    render(); const id = window.setInterval(() => { if (document.body.contains(root)) render(); }, 4000); return () => clearInterval(id);
  });
}
void capFor;
