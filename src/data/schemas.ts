import { z } from 'zod';

const nums = z.array(z.number());
const ints = z.array(z.number().int());

export const GeoSchema = z.object({
  ids: z.array(z.string()),
  area_km2: nums,
  label: z.tuple([nums, nums]),
  coastal: ints,
  island: ints,
  neighbors: z.array(ints),
  islandSizes: ints
});

export const AttrsSchema = z.object({
  sectors: z.array(z.string()).length(10),
  cultureGroups: z.array(z.string()),
  n: z.number().int(),
  population: nums, urban: nums, age0_14: nums, age65: nums,
  literacy: nums, meanYearsSchooling: nums, expectedYearsSchooling: nums, lifeExpectancy: nums, poverty: nums,
  laborShare: z.array(ints), outputShare: z.array(ints),
  specialty1: ints, specialty2: ints, specialtyMult: nums,
  grdp_rp_million: nums, capital_rp_million: nums,
  electrification: nums, schoolLevel: ints, healthLevel: ints, cleanWater: nums,
  roadClass: ints, railStation: ints, railPath: ints, portLevel: ints,
  terrain: ints, swamp: ints, elevProxy_m: nums, culture: ints, isCapital: ints
});

export const AdminSchema = z.object({
  provinces: z.array(z.object({ id: z.string(), name: z.string(), locked: z.boolean(), capital: z.string(), joinYear: z.number().nullable() })),
  regencies: z.array(z.object({ id: z.string(), name: z.string(), type: z.enum(['kabupaten', 'kota']), prov: z.string(), capital: z.string(), kec: z.array(z.string()), merged: z.array(z.string()) }))
});

export const SeedsSchema = z.object({
  resources: z.array(z.object({ kec: z.string(), type: z.string(), name: z.string(), size: z.number(), hidden: z.boolean(), knownYear: z.number().nullable(), conf: z.string(), crop: z.string().nullable(), lonlat: z.tuple([z.number(), z.number()]) })),
  rail: z.array(z.object({ id: z.string(), name: z.string(), gauge: z.number(), degraded: z.boolean(), stations: z.array(z.object({ name: z.string(), kec: z.string(), level: z.number(), lonlat: z.tuple([z.number(), z.number()]) })), path: z.array(z.string()), brokenLegs: z.number() })),
  ports: z.array(z.object({ name: z.string(), kec: z.string(), level: z.number(), lonlat: z.tuple([z.number(), z.number()]) })),
  industries: z.array(z.object({ type: z.string(), name: z.string(), kec: z.string(), owner: z.string(), lonlat: z.tuple([z.number(), z.number()]) }).passthrough()),
  roads: z.array(z.object({ id: z.string(), name: z.string(), class: z.string(), path: z.array(z.string()), brokenLegs: z.number() }))
});

export const PopSamplesSchema = z.object({ samples: z.array(ints) });
export type Geo = z.infer<typeof GeoSchema>;
export type Attrs = z.infer<typeof AttrsSchema>;
export type AdminFile = z.infer<typeof AdminSchema>;
export type Seeds = z.infer<typeof SeedsSchema>;
