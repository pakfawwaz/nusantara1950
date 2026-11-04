import type { Command } from '../admin/types';

export type PetitionKind = 'newKecamatan' | 'newRegency' | 'newProvince' | 'switchProvince';
/** A regional demand waiting for the player's answer. `cmd` is executed through the ordinary admin command pipeline if it is granted. */
export interface Petition { id: number; kind: PetitionKind; key: string; month: number; due: number; support: number; title: string; text: string; cmd: Command; cost: number; kecs: number[] }
export interface PetitionState { list: Petition[]; next: number; refused: Record<string, number>; granted: number; declined: number }
export const newPetitions = (): PetitionState => ({ list: [], next: 1, refused: {}, granted: 0, declined: 0 });
