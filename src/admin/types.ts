import type { Pt } from '../geo/grid';

export type Command =
  | { type: 'createRegency'; kecs: number[]; name: string; kind: 'kabupaten' | 'kota'; capital: number }
  | { type: 'moveKecamatan'; kecs: number[]; toRegency: string }
  | { type: 'mergeRegencies'; keep: string; absorb: string; name?: string }
  | { type: 'createProvince'; regencies: string[]; name: string; capital: number }
  | { type: 'moveRegency'; regency: string; toProvince: string }
  | { type: 'mergeProvinces'; keep: string; absorb: string; name?: string }
  | { type: 'splitKecamatan'; kec: number; line: Pt[]; names?: string[] }
  | { type: 'mergeKecamatan'; keep: number; absorb: number; name?: string }
  | { type: 'rename'; unit: 'regency' | 'province' | 'kecamatan'; id: string; name: string }
  | { type: 'setCapital'; unit: 'regency' | 'province'; id: string; kec: number };

/** What the UI must refresh after a command (or its undo). */
export interface Change { removed: number[]; removedIds: string[]; upserted: number[]; admin: boolean; geometry: boolean; tick?: boolean }

export interface Preview {
  ok: boolean; errors: string[]; warnings: string[]; checks: string[]; cost: number; annualCost: number; summary: string; months: number;
  pieces?: Array<{ areaKm2: number; pop: number; polys: GeoJSON.Polygon | GeoJSON.MultiPolygon; name: string }>;
}
export interface Applied { summary: string; cost: number; stability: number; undoMonths: number; change: Change; undo: () => Change }
export interface Plan { preview: Preview; apply?: () => Applied }
