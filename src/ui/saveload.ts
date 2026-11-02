import { h } from './dom';
import { openPanel } from './panel';
import { toast } from './modal';
import type { Autosaver } from '../save/autosave';
import { AUTO_SLOTS, MANUAL_SLOTS, PENDING_LOAD, deleteSlot, listSlots, readSlot, writeSlot } from '../save/store';
import type { SlotInfo } from '../save/store';
import type { Game } from '../game';
import type { SimClient } from '../sim/client';
import { dateText } from './topbar';

const when = (t: number) => new Date(t).toLocaleString();
/** Loading reloads the page and restores the chosen slot while the world is rebuilt (a save replays geometry edits, so it is simplest to start from a clean world). */
export function startLoad(slot: string): void { try { sessionStorage.setItem(PENDING_LOAD, slot); } catch { /* ignore */ } location.reload(); }

export function openSaveLoad(game: Game, sim: SimClient, auto: Autosaver): void {
  openPanel('Save / Load', 'mid', (body) => {
    const list = h('div'); const render = async () => {
      const info = await listSlots(); list.replaceChildren();
      const slotRow = (id: string, title: string, manual: boolean) => {
        const m: SlotInfo | undefined = info[id];
        const row = h('div', { class: 'slot' }, h('div', { class: 'grow' }, h('b', { text: title }), h('small', { text: m ? `${m.date} · GDP/capita Rp ${(m.gdppc / 1e6).toFixed(1)} jt · saved ${when(m.savedAt)} · ${(m.bytes / 1e6).toFixed(1)} MB` : 'empty' })));
        if (manual) row.append(h('button', { class: 'btn small', type: 'button', text: 'Save here', onclick: async () => { await sim.drain(); const ok = await auto.now(id, `Manual save · ${dateText(game.month)}`, 'manual'); toast(ok ? 'Game saved.' : 'Saving failed (browser storage unavailable or full).', !ok); void render(); } }));
        row.append(h('button', { class: 'btn small', type: 'button', text: 'Load', disabled: !m, onclick: () => startLoad(id) }));
        row.append(h('button', { class: 'btn small', type: 'button', text: 'Export', disabled: !m, title: 'Download this save as a file', onclick: async () => { const b = await readSlot(id); if (!b) return; const a = h('a', { href: URL.createObjectURL(new Blob([b as BlobPart])), download: `nusantara1950-${id}.nus` }); a.click(); URL.revokeObjectURL(a.href); } }));
        if (manual) row.append(h('button', { class: 'btn small', type: 'button', text: 'Delete', disabled: !m, onclick: async () => { await deleteSlot(id); void render(); } }));
        return row;
      };
      list.append(h('h4', { text: 'Manual saves' }), ...MANUAL_SLOTS.map((id, k) => slotRow(id, `Slot ${k + 1}`, true)), h('h4', { text: 'Autosaves (rolling, newest overwrites oldest)' }), ...AUTO_SLOTS.map((id, k) => slotRow(id, `Auto ${k + 1}`, false)));
    };
    const imp = h('input', { type: 'file', accept: '.nus', hidden: true }); imp.addEventListener('change', async () => { const f = imp.files?.[0]; if (!f) return; const bytes = new Uint8Array(await f.arrayBuffer()); const ok = await writeSlot('import', bytes, { label: f.name, month: 0, date: 'imported', gdppc: 0, kind: 'import' }); if (ok) startLoad('import'); else toast('Import failed.', true); });
    const auto1 = h('input', { type: 'checkbox' }); auto1.checked = auto.enabled; auto1.addEventListener('change', () => { auto.enabled = auto1.checked; });
    body.append(h('p', { class: 'intro', text: 'Saves live in this browser (IndexedDB). Export a file to keep a copy or move it to another computer.' }),
      h('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, auto1, h('span', { text: 'Autosave every game month (at most once every few seconds of real time)' })), list,
      h('div', { class: 'btnrow' }, h('button', { class: 'btn', type: 'button', text: 'Import a save file…', onclick: () => imp.click() }), imp));
    void render();
  });
}
