/** Factories for the game's fights, shared by the scenes and the tests. */
import { getArena } from './combat/arena_data';
import { fighterConfig } from './combat/character_data';
import { CombatSim } from './combat/combat_sim';

/** Rook vs Corvane in the Sunken Colosseum. */
export function createCorvaneFight(seed: number, opts: { ko?: boolean } = {}): CombatSim {
  return new CombatSim({
    ko: opts.ko ?? true,
    p1: fighterConfig('rook'),
    p2: fighterConfig('corvane'),
    arena: getArena('sunken_colosseum'),
    seed,
  });
}

/** Rook vs the training dummy. */
export function createTraining(): CombatSim {
  return new CombatSim({
    p1: fighterConfig('rook'),
    p2: fighterConfig('dummy'),
    arena: getArena('training'),
    trainingRefill: true,
    ko: false,
  });
}
