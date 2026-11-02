import * as topojson from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { AdminSchema, AttrsSchema, GeoSchema, PopSamplesSchema, SeedsSchema } from './schemas';
import type { AdminFile, Attrs, Geo, Seeds } from './schemas';

export interface KecProps { id: string; name: string; kab_code: string; kab_name: string; prov_code: string; prov_name: string; bps_code: string }
export interface RawData {
  topo: Topology; kecObj: GeometryCollection<KecProps>; features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, KecProps>[];
  geo: Geo; attrs: Attrs; admin: AdminFile; seeds: Seeds; popSamples: number[][];
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status}`);
  return (await r.json()) as T;
}

export function buildRaw(topo: Topology, geoRaw: unknown, attrsRaw: unknown, adminRaw: unknown, seedsRaw: unknown, popRaw: unknown): RawData {
  const geo = GeoSchema.parse(geoRaw), attrs = AttrsSchema.parse(attrsRaw), admin = AdminSchema.parse(adminRaw), seeds = SeedsSchema.parse(seedsRaw);
  const popSamples = PopSamplesSchema.parse(popRaw).samples;
  const n = geo.ids.length;
  for (const [k, v] of Object.entries(attrs)) if (Array.isArray(v) && v.length !== n && k !== 'sectors' && k !== 'cultureGroups') throw new Error(`attrs.${k} has ${v.length} entries, expected ${n}`);
  if (popSamples.length !== n) throw new Error('popsamples length mismatch');
  const kecObj = topo.objects.kec as GeometryCollection<KecProps>;
  const fc = topojson.feature(topo, kecObj) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, KecProps>;
  for (const f of fc.features) f.id = f.properties.id; // top-level ids let MapLibre diff the source (GeoJSONSource.updateData)
  return { topo, kecObj, features: fc.features, geo, attrs, admin, seeds, popSamples };
}

export async function loadAll(base: string, progress: (msg: string, frac: number) => void): Promise<RawData> {
  const u = (f: string) => `${base}data/${f}`;
  progress('Loading kecamatan boundaries…', 0.05);
  const topo = await getJson<Topology>(u('kecamatan.topo.json'));
  progress('Loading attributes…', 0.35);
  const [geoRaw, attrsRaw, adminRaw, seedsRaw, popRaw] = await Promise.all([
    getJson<unknown>(u('kecamatan_geo.json')), getJson<unknown>(u('kecamatan_attrs.json')), getJson<unknown>(u('admin1950.json')),
    getJson<unknown>(u('seeds.json')), getJson<unknown>(u('popsamples.json'))
  ]);
  progress('Validating data…', 0.6);
  const raw = buildRaw(topo, geoRaw, attrsRaw, adminRaw, seedsRaw, popRaw);
  progress('Building geometry…', 0.8);
  return raw;
}
