/**
 * Training dummy AI. It only READS the sim and produces an input snapshot each frame,
 * which goes through the dummy's InputBuffer like any other input.
 */
import type { CombatSim } from '../combat/combat_sim';
import { toAbsolute, type Button, type InputSnapshot } from '../combat/types';

export const DUMMY_MODES = ['stand', 'crouch', 'block all', 'block after first', 'jab', 'high kick'] as const;
export type DummyMode = (typeof DUMMY_MODES)[number];

/** Frames between attacks in the attacking modes. */
const ATTACK_INTERVAL = 60;
/** Frames of quiet before "block after first" lets the next hit through again. */
const REARM_FRAMES = 40;

export class DummyController {
  mode: DummyMode = 'stand';
  private timer = 0;
  private blocking = false;
  private quiet = 0;

  constructor(readonly index: number) {}

  cycleMode(): DummyMode {
    const i = DUMMY_MODES.indexOf(this.mode);
    this.setMode(DUMMY_MODES[(i + 1) % DUMMY_MODES.length]!);
    return this.mode;
  }

  setMode(mode: DummyMode): void {
    this.mode = mode;
    this.timer = 0;
    this.blocking = false;
    this.quiet = 0;
  }

  update(sim: CombatSim): InputSnapshot {
    const me = sim.fighters[this.index]!;
    const opp = sim.opponent(me);
    const rel = (dir: number, ...buttons: Button[]): InputSnapshot => ({
      dir: toAbsolute(dir, me.facing),
      held: new Set(buttons),
    });

    switch (this.mode) {
      case 'stand':
        return rel(5);
      case 'crouch':
        return rel(2);
      case 'jab':
      case 'high kick': {
        const t = this.timer++;
        const btn: Button = this.mode === 'jab' ? '1' : '4';
        return t % ATTACK_INTERVAL === 0 ? rel(5, btn) : rel(5);
      }
      case 'block all':
        return this.guard(sim, rel);
      case 'block after first': {
        const hurt = me.state === 'hitstun' || me.state === 'airborne' || me.state === 'stagger' || me.state === 'wall_splat' || me.state === 'knockdown';
        if (hurt) this.blocking = true;
        if (me.isNeutral && !opp.isThreatening) this.quiet++;
        else this.quiet = 0;
        if (this.quiet > REARM_FRAMES) this.blocking = false;
        return this.blocking ? this.guard(sim, rel) : rel(5);
      }
    }
  }

  /** Block every hit correctly: low → crouch block, everything else → stand block. */
  private guard(sim: CombatSim, rel: (dir: number) => InputSnapshot): InputSnapshot {
    const me = sim.fighters[this.index]!;
    const opp = sim.opponent(me);
    if (opp.state === 'attack' && opp.move) return rel(opp.move.height === 'low' ? 1 : 4);
    if (me.state === 'blockstun') return rel(me.crouchStun ? 1 : 4);
    return rel(5);
  }
}
