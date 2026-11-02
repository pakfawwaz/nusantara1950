import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { Snapshot, TA } from '../sim/snapshot';

export const SAVE_VERSION = 1;
/** Small, JSON-able metadata that lives on the main thread: the geometry edits to replay, names and bookkeeping. */
export interface SaveMeta { label: string; month: number; geoLog: unknown[]; names: string[]; history: unknown[]; extra?: Record<string, unknown> }
interface Header { version: number; meta: SaveMeta; n: number; arrays: Array<{ name: string; type: string; length: number }>; neighbors: number[][]; regencies: Snapshot['regencies']; provinces: Snapshot['provinces']; nation: Snapshot['nation'] }
const CTORS: Record<string, { new (b: ArrayBuffer, o: number, l: number): TA }> = { Float64Array, Float32Array, Uint8Array, Uint16Array, Int32Array };

/** Container: [u32 header length][header JSON][array bytes…], deflated. Arrays are 8-byte aligned inside the container. */
export function buildSave(s: Snapshot, meta: SaveMeta): Uint8Array {
  const arrays = Object.entries(s.rows).map(([name, a]) => ({ name, type: a.constructor.name, length: a.length }));
  const header: Header = { version: SAVE_VERSION, meta, n: s.n, arrays, neighbors: s.neighbors, regencies: s.regencies, provinces: s.provinces, nation: s.nation };
  const hb = strToU8(JSON.stringify(header)); const pad = (x: number) => (x + 7) & ~7; let off = pad(4 + hb.length);
  for (const a of Object.values(s.rows)) off = pad(off + a.byteLength);
  const out = new Uint8Array(off); new DataView(out.buffer).setUint32(0, hb.length, true); out.set(hb, 4); let p = pad(4 + hb.length);
  for (const a of Object.values(s.rows)) { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), p); p = pad(p + a.byteLength); }
  return deflateSync(out, { level: 1 });
}
export interface Loaded { header: Header; rows: Record<string, TA> }
export function readSave(bytes: Uint8Array): Loaded {
  const raw = inflateSync(bytes); const hl = new DataView(raw.buffer, raw.byteOffset).getUint32(0, true);
  const header = JSON.parse(strFromU8(raw.subarray(4, 4 + hl))) as Header; if (header.version !== SAVE_VERSION) throw new Error(`Unsupported save version ${header.version}`);
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer; const rows: Record<string, TA> = {}; const pad = (x: number) => (x + 7) & ~7; let p = pad(4 + hl);
  for (const a of header.arrays) { const C = CTORS[a.type]; rows[a.name] = new C(buf, p, a.length); p = pad(p + a.length * (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT); }
  return { header, rows };
}
