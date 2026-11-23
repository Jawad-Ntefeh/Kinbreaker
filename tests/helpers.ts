import { CombatSim, type SimOptions } from '../src/combat/combat_sim';
import type { FighterConfig } from '../src/combat/fighter';
import { fighterConfig } from '../src/combat/character_data';
import { getMoveSet, type MoveSet } from '../src/combat/move_data';
import { toAbsolute, type Button, type InputSnapshot } from '../src/combat/types';

export const rookMoves = (): MoveSet => getMoveSet('rook');

export function rookConfig(moves: MoveSet = rookMoves()): FighterConfig {
  return { ...fighterConfig('rook'), moves };
}
export function dummyConfig(moves: MoveSet = rookMoves()): FighterConfig {
  return { ...fighterConfig('dummy'), moves };
}
/** Rook's body width in px. */
export const ROOK_W = 24;

/** Rook at x, dummy at point-blank range (pushboxes touching) to her right. */
export function pointBlank(opts: Partial<SimOptions> = {}, x = 400): CombatSim {
  return new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: x, p2X: x + ROOK_W, ...opts });
}

export const N: InputSnapshot = { dir: 5, held: new Set() };

/** Input with a facing-relative direction. */
export function inp(relDir: number, facing: number, ...buttons: Button[]): InputSnapshot {
  return { dir: toAbsolute(relDir, facing), held: new Set(buttons) };
}

/** Step the sim with fixed inputs `frames` times. */
export function run(sim: CombatSim, frames: number, p1: InputSnapshot = N, p2: InputSnapshot = N): void {
  for (let i = 0; i < frames; i++) sim.step(p1, p2);
}

/** Step until a predicate is true (or fail after `max` frames). Returns frames stepped. */
export function runUntil(
  sim: CombatSim,
  pred: () => boolean,
  p1: InputSnapshot | (() => InputSnapshot) = N,
  p2: InputSnapshot | (() => InputSnapshot) = N,
  max = 600,
): number {
  for (let i = 1; i <= max; i++) {
    sim.step(typeof p1 === 'function' ? p1() : p1, typeof p2 === 'function' ? p2() : p2);
    if (pred()) return i;
  }
  throw new Error('runUntil: condition never became true');
}

/** Press a button for one frame (with a held direction), then release, then idle. */
export function tap(sim: CombatSim, who: 0 | 1, relDir: number, buttons: Button[], other: InputSnapshot = N): void {
  const f = sim.fighters[who];
  const s = inp(relDir, f.facing, ...buttons);
  if (who === 0) sim.step(s, other);
  else sim.step(other, s);
}
