import { del, get, set } from 'idb-keyval';

export interface SlotInfo { id: string; label: string; month: number; date: string; gdppc: number; savedAt: number; bytes: number; kind: 'auto' | 'manual' | 'import' }
const META = 'nus:meta'; const slotKey = (id: string) => `nus:slot:${id}`;
export const PENDING_LOAD = 'nus:pending-load';
export const AUTO_SLOTS = ['auto1', 'auto2', 'auto3']; export const MANUAL_SLOTS = ['manual1', 'manual2', 'manual3', 'manual4', 'manual5'];

async function meta(): Promise<Record<string, SlotInfo>> { try { return (await get<Record<string, SlotInfo>>(META)) ?? {}; } catch { return {}; } }
export async function listSlots(): Promise<Record<string, SlotInfo>> { return meta(); }
export async function writeSlot(id: string, bytes: Uint8Array, info: Omit<SlotInfo, 'id' | 'bytes' | 'savedAt'>): Promise<boolean> {
  try { await set(slotKey(id), bytes); const m = await meta(); m[id] = { ...info, id, bytes: bytes.byteLength, savedAt: Date.now() }; await set(META, m); return true; } catch (e) { console.warn('save failed', e); return false; }
}
export async function readSlot(id: string): Promise<Uint8Array | undefined> { try { return await get<Uint8Array>(slotKey(id)); } catch { return undefined; } }
export async function deleteSlot(id: string): Promise<void> { try { await del(slotKey(id)); const m = await meta(); delete m[id]; await set(META, m); } catch { /* ignore */ } }
