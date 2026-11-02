import type { World } from '../world';
import type { Game } from '../game';
import type { Command } from '../admin/types';
import type { Loaded, SaveMeta } from './format';
import type { TA } from '../sim/snapshot';
import { migrateNation } from '../sim/core';

export function makeMeta(world: World, game: Game, label: string): SaveMeta {
  return { label, month: game.month, geoLog: structuredClone(game.geoLog), names: world.names.slice(0, world.n), history: structuredClone(game.history) };
}

/** Rebuild a saved game on a fresh world: replay the kecamatan splits / merges (deterministic geometry), then overwrite every per-kecamatan row, the admin structure and the nation from the save. */
export async function restoreSave(world: World, game: Game, loaded: Loaded): Promise<void> {
  const { header, rows } = loaded;
  for (const cmd of header.meta.geoLog as Command[]) { const plan = await game.plan(cmd); if (!plan.apply) throw new Error(`Could not replay "${cmd.type}": ${plan.preview.errors[0] ?? 'rejected'}`); plan.apply(); }
  if (world.n !== header.n) throw new Error(`Save mismatch: ${header.n} kecamatan saved, ${world.n} after replay`);
  const n = world.n;
  for (const f of world.rowFields) { const src = rows[f.name] as TA | undefined; if (src) (f.a as TA).set(src.subarray(0, n * f.stride)); }
  world.alive.set((rows.alive as Uint8Array).subarray(0, n));
  header.meta.names.forEach((nm, i) => { world.names[i] = nm; if (world.features[i]) world.features[i].properties.name = nm; });
  world.regencies = header.regencies.map(r => ({ ...r })); world.provinces = header.provinces.map(p => ({ ...p }));
  world.rebuildIndex(); world.rebuildTopology();
  game.nation = migrateNation(header.nation, () => world.transportSeed()); game.history.length = 0; game.history.push(...(header.meta.history as typeof game.history)); game.geoLog = header.meta.geoLog as Command[];
}
