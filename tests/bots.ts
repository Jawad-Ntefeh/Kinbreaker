/**
 * Scripted Rook players for fight tests and stats. They read the sim (with perfect, instant
 * knowledge) and produce input snapshots, like a player.
 */
import { CorvaneAI } from '../src/ai/corvane_ai';
import type { CombatSim } from '../src/combat/combat_sim';
import { toAbsolute, type Button, type InputSnapshot } from '../src/combat/types';
import { createCorvaneFight } from '../src/fights';

export interface Bot {
  update(sim: CombatSim): InputSnapshot;
}

function make(sim: CombatSim, last: { held: Set<Button> }, relDir: number, buttons: Button[]): InputSnapshot {
  const held = new Set<Button>(buttons.filter((b) => !last.held.has(b)));
  last.held = held;
  return { dir: toAbsolute(relDir, sim.fighters[0].facing), held };
}

/**
 * "Perfect" player: blocks highs and mids, crouch-blocks lows, breaks throws, phase-steps glinted
 * linear attacks, punishes unsafe moves (Rising Kick launch + jabs, or a jab string), and pokes with
 * lows (or the knee against a crouching guard).
 */
export class PerfectBot implements Bot {
  private last = { held: new Set<Button>() };
  private combo = false;
  private pokes = 0;
  private dashStep = 0;
  /** Dash in with 6, 5, 6. */
  private dash(out: (d: number, b?: Button[]) => InputSnapshot): InputSnapshot {
    const d = [6, 5, 6, 6][this.dashStep++ % 4]!;
    return out(d);
  }
  /** Every third poke against a standing guard is a sweep. */
  private sweepNext(): boolean {
    return this.pokes++ % 3 === 2;
  }

  update(sim: CombatSim): InputSnapshot {
    const me = sim.fighters[0];
    const c = sim.fighters[1];
    const out = (d: number, b: Button[] = []) => make(sim, this.last, d, b);
    if (me.state === 'defeated' || c.state === 'defeated') return out(5);
    if (me.state === 'thrown') return out(5, ['1']);

    const threat = c.state === 'attack' && c.move && c.moveFrame <= c.move.lastActive ? c.move : null;
    const guard = threat?.height === 'low' ? 1 : 4;

    if (!me.isNeutral) {
      // Continue strings and juggles by mashing jab (cancels into the second jab).
      if (me.state === 'attack' && this.combo) return out(5, ['1']);
      return out(guard);
    }
    if (c.state !== 'airborne' && c.state !== 'stagger' && c.state !== 'guard_break') this.combo = false;

    const gap = Math.trunc((Math.abs(me.x - c.x) - me.halfWidth - c.halfWidth) / 100);
    if (threat) {
      if (threat.glint && threat.path === 'linear' && c.moveFrame === threat.startup - 8) return out(5, ['phase']);
      // Launchers beat armor: Rising Kick (15f) lands before Iron Wall (22f).
      if (threat.armorFrames && gap <= 19 && c.moveFrame <= threat.startup - 15) {
        this.combo = true;
        return out(3, ['4']);
      }
      return out(guard);
    }

    // Juggle / free hits.
    if (c.state === 'airborne' || c.state === 'wall_splat') {
      this.combo = true;
      return gap > 27 ? out(6) : out(5, ['1']);
    }
    if (c.state === 'stagger' || c.state === 'guard_break') {
      this.combo = true;
      return gap > 13 ? out(6) : out(3, ['4']);
    }
    // Punish recovery.
    if (c.state === 'attack' && c.move) {
      const remaining = c.moveTotal - c.moveFrame;
      if (gap <= 19 && remaining >= 15) {
        this.combo = true;
        return out(3, ['4']);
      }
      if (gap <= 29 && remaining >= 10) {
        this.combo = true;
        return out(5, ['1']);
      }
      return out(4);
    }
    if (c.state === 'phase_transition') return out(4);
    if (c.state === 'knockdown' && gap <= 27 && !c.groundHitTaken) return out(2, ['1']);
    if (!c.isNeutral) return out(4);

    // Neutral: get close, then attack what his guard can't stop: a launcher against a crouching
    // guard, a sweep or low jab against a standing guard, a low jab otherwise.
    if (gap > 53) return this.dash(out);
    if (gap > 19) return out(6);
    if (c.state === 'block_crouch' || c.state === 'crouch') {
      this.combo = true;
      return out(3, ['4']);
    }
    if (c.state === 'block_stand' || c.state === 'walk_back') return out(2, [this.sweepNext() ? '4' : '1']);
    return out(2, ['1']);
  }
}

/** Presses random buttons and directions (seeded). */
export class MasherBot implements Bot {
  private s: number;
  private dir = 5;
  private last = { held: new Set<Button>() };
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  private rnd(n: number): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return (this.s >>> 8) % n;
  }
  update(sim: CombatSim): InputSnapshot {
    if (this.rnd(10) === 0) this.dir = [1, 2, 3, 4, 5, 6, 6, 6][this.rnd(8)]!;
    const b: Button[] = [];
    if (this.rnd(4) === 0) b.push((['1', '2', '3', '4'] as const)[this.rnd(4)]!);
    if (this.rnd(40) === 0) b.push('phase');
    return make(sim, this.last, this.dir, b);
  }
}

export interface FightResult {
  winner: 'rook' | 'corvane' | 'timeout';
  frames: number;
  sim: CombatSim;
  ai: CorvaneAI;
  hashes: number[];
  inputs: InputSnapshot[];
}

export function runFight(seed: number, bot: Bot, maxFrames: number, keepHashes = false): FightResult {
  const sim = createCorvaneFight(seed);
  const ai = new CorvaneAI(1);
  const hashes: number[] = [];
  const inputs: InputSnapshot[] = [];
  while (sim.winner === null && sim.frame < maxFrames) {
    const p1 = bot.update(sim);
    const p2 = ai.update(sim);
    inputs.push(p1);
    sim.step(p1, p2);
    if (keepHashes) hashes.push(sim.stateHash());
  }
  const winner = sim.winner === 0 ? 'rook' : sim.winner === 1 ? 'corvane' : 'timeout';
  return { winner, frames: sim.frame, sim, ai, hashes, inputs };
}
