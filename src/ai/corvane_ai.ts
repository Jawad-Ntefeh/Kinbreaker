/**
 * Corvane's AI. Produces one input snapshot per frame, exactly like a player, and only READS the sim.
 *
 * Fairness rules:
 * - It perceives Rook's state and move with a reaction delay (18 frames in phase 1, 15 in phase 2).
 *   Positions are visible immediately; what Rook is *doing* is not.
 * - Every random choice uses the sim's seeded RNG, so fights are reproducible.
 * - Readable patterns: never the same opener three times in a row; a throw after the player blocks
 *   3 attacks in 180 frames; two sweeping openers after 3 phase steps in 240 frames; Last Bell once.
 */
import type { CombatSim } from '../combat/combat_sim';
import type { Fighter, FighterState } from '../combat/fighter';
import { toAbsolute, type Button, type InputSnapshot } from '../combat/types';

export type Opener = 'jab' | 'cross' | 'body_hook' | 'liver_shot' | 'haymaker' | 'bell_ringer' | 'iron_wall' | 'last_bell' | 'grave_punch';
export type Range = 'close' | 'mid' | 'far';
export type Behaviour = 'footwork' | 'guard' | 'attack' | 'punish' | 'wake_up' | 'idle';

export const OPENER_MOVE: Readonly<Record<Opener, string>> = {
  jab: 'corvane_jab_1',
  cross: 'corvane_cross',
  body_hook: 'corvane_body_hook',
  liver_shot: 'corvane_liver_shot',
  haymaker: 'corvane_haymaker',
  bell_ringer: 'corvane_bell_ringer',
  iron_wall: 'corvane_iron_wall',
  last_bell: 'corvane_last_bell_1',
  grave_punch: 'corvane_grave_punch',
};

/** AI tuning. Frame counts here are behaviour timings, not move frame data. */
export const AI = {
  reactionDelay: [18, 15] as const,
  closeRange: 40,
  farRange: 90,
  footworkFrames: [30, 60] as const,
  guardFrames: [20, 45] as const,
  crouchGuardChance: 30,
  /** Guard holds back only within this gap (px); further away he stands his ground. */
  guardHoldGap: 30,
  punishChance: [70, 90] as const,
  jabDelay: [6, 10] as const,
  throwReadBlocks: 3,
  throwReadWindow: 180,
  phaseReadSteps: 3,
  phaseReadWindow: 240,
  phaseReadOpeners: 2,
  emberMinHealthPercent: 30,
  /** Grave Punch on a downed Rook: needs this many knockdown frames left; chance by phase. */
  graveMinFramesLeft: 14,
  graveChance: [70, 100] as const,
  /** Chance to break a throw once he has seen it. */
  throwBreakChance: 50,
  /** Give up approaching after this many frames. */
  approachLimit: 60,
  /** Largest gap (px between hurtboxes) at which each opener is thrown. */
  reach: { jab: 24, cross: 34, body_hook: 18, liver_shot: 26, haymaker: 50, bell_ringer: 12, iron_wall: 38, last_bell: 60, grave_punch: 60 } as Record<Opener, number>,
} as const;

export const SWEEPING: ReadonlySet<Opener> = new Set<Opener>(['body_hook', 'haymaker', 'iron_wall']);

/** What Corvane can see of Rook on a given frame. */
export interface Perception {
  frame: number;
  state: FighterState;
  moveId: string | null;
  moveFrame: number;
}

export interface AiLogEntry {
  frame: number;
  type: 'opener' | 'punish' | 'throw_read' | 'phase_read' | 'ember' | 'ground_hit';
  opener?: Opener;
  move?: string;
  range?: Range;
  forced?: string;
}

interface Plan {
  opener: Opener;
  move: string;
  dir: number;
  buttons: Button[];
  motion: number[] | null;
  dashIn: boolean;
  stage: 'approach' | 'execute' | 'running';
  step: number;
  frames: number;
  /** Jab string: total hits, and delay before the last one. */
  jabHits: number;
  jabDelay: number;
  isPunish: boolean;
  /** The move has started (the opener is logged at that point). */
  started: boolean;
  /** Range when the opener was chosen. */
  range: Range;
  forced?: string;
}

const HISTORY = 32;

export class CorvaneAI {
  behaviour: Behaviour = 'idle';
  private timer = 0;
  private walkDir = 5;
  private walkTimer = 0;
  private guardDir = 4;
  private plan: Plan | null = null;
  private dashSeq: number[] = [];
  private readonly history: Perception[] = [];
  private lastPerceived: Perception | null = null;
  /** Openers actually started, newest last. */
  readonly openers: Opener[] = [];
  private blockedTimes: number[] = [];
  private phaseStepTimes: number[] = [];
  /** Number of phase steps seen in the current read window (for tests and the debug view). */
  phaseStepsSeen = 0;
  private throwReadArmed = false;
  private sweepForced = 0;
  private punish: { move: string; knownAt: number; chosen: string | null } | null = null;
  private followCrossWithJabs = false;
  private lastHeld = new Set<Button>();
  readonly log: AiLogEntry[] = [];

  constructor(readonly index = 1) {}

  /** Current reaction delay in frames. */
  reactionDelay(sim: CombatSim): number {
    return AI.reactionDelay[sim.fighters[this.index]!.phase >= 2 ? 1 : 0];
  }

  /** What Corvane perceives of Rook right now (her state `reactionDelay` frames ago). */
  perceived(sim: CombatSim): Perception {
    const d = this.reactionDelay(sim);
    const i = this.history.length - 1 - d;
    if (i < 0) return { frame: sim.frame - d, state: 'idle', moveId: null, moveFrame: 0 };
    return this.history[i]!;
  }

  private now = 0;
  private graveRolledFor = -1;
  private throwBreak: boolean | null = null;

  update(sim: CombatSim): InputSnapshot {
    const me = sim.fighters[this.index]!;
    const rook = sim.opponent(me);
    this.now = sim.frame;
    this.observe(sim, rook);
    this.trackPlanStart(me, rook);
    const p = this.perceived(sim);
    this.readEvents(sim, me, p);
    this.updateReads(sim, p);
    this.lastPerceived = p;

    if (me.state === 'defeated' || rook.state === 'defeated' || me.state === 'phase_transition') {
      this.plan = null;
      this.punish = null;
      return this.out(me, 5, []);
    }
    if (!me.isNeutral) return this.whileBusy(sim, me, rook);
    return this.whileNeutral(sim, me, rook, p);
  }

  /** Log an opener once its move has actually started. */
  private trackPlanStart(me: Fighter, rook: Fighter): void {
    const plan = this.plan;
    if (!plan || plan.started || me.state !== 'attack' || me.move?.id !== plan.move) return;
    plan.started = true;
    plan.stage = 'running';
    if (plan.isPunish) return;
    // Reads are used up only when the forced opener actually comes out.
    if (plan.forced === 'throw_read') this.throwReadArmed = false;
    if (plan.forced === 'phase_read') this.sweepForced = Math.max(0, this.sweepForced - 1);
    if (plan.forced === 'ember') this.log.push({ frame: this.now, type: 'ember' });
    this.openers.push(plan.opener);
    this.log.push({ frame: this.now, type: 'opener', opener: plan.opener, move: plan.move, range: plan.range, forced: plan.forced });
    void rook;
  }

  // ------------------------------------------------------------ perception

  private observe(sim: CombatSim, rook: Fighter): void {
    this.history.push({ frame: sim.frame, state: rook.state, moveId: rook.move?.id ?? null, moveFrame: rook.moveFrame });
    if (this.history.length > HISTORY) this.history.shift();
  }

  /** Events from the last sim step: what Corvane felt (his own hits/blocks) happens instantly. */
  private readEvents(sim: CombatSim, me: Fighter, p: Perception): void {
    for (const e of sim.events) {
      if (e.type === 'block' && e.attacker === me.index) this.blockedTimes.push(sim.frame);
      if (e.type === 'block' && e.defender === me.index) {
        // He blocked one of Rook's moves. He knows which once he has *seen* it start.
        const m = sim.opponent(me).moves.get(e.moveId);
        if (m) this.punish = { move: e.moveId, knownAt: sim.frame - (m.startup - 1) + this.reactionDelay(sim), chosen: null };
      }
      if ((e.type === 'hit' || e.type === 'counter') && e.attacker === me.index && e.moveId === OPENER_MOVE.cross && this.followCrossWithJabs) {
        this.followCrossWithJabs = false;
        this.plan = this.makePlan(sim, 'jab', true);
        this.plan.stage = 'execute';
      }
    }
    void p;
  }

  private updateReads(sim: CombatSim, p: Perception): void {
    // Throw read: 3 of his attacks blocked within 180 frames.
    this.blockedTimes = this.blockedTimes.filter((t) => sim.frame - t <= AI.throwReadWindow);
    if (this.blockedTimes.length >= AI.throwReadBlocks) {
      this.throwReadArmed = true;
      this.blockedTimes = [];
      this.dropPendingOpener();
      this.log.push({ frame: sim.frame, type: 'throw_read' });
    }
    // Phase-step read: 3 phase steps seen within 240 frames.
    const prev = this.lastPerceived;
    if (p.state === 'phase_step' && (!prev || prev.state !== 'phase_step')) this.phaseStepTimes.push(sim.frame);
    this.phaseStepTimes = this.phaseStepTimes.filter((t) => sim.frame - t <= AI.phaseReadWindow);
    this.phaseStepsSeen = this.phaseStepTimes.length;
    if (this.phaseStepTimes.length >= AI.phaseReadSteps) {
      this.sweepForced = AI.phaseReadOpeners;
      this.phaseStepTimes = [];
      this.dropPendingOpener();
      this.log.push({ frame: sim.frame, type: 'phase_read' });
    }
  }

  /** A read changes his mind: an opener that hasn't started yet is dropped. */
  private dropPendingOpener(): void {
    if (this.plan && !this.plan.started && !this.plan.isPunish && !this.plan.forced) {
      this.plan = null;
      this.timer = 0;
    }
  }

  /** Commit to a behaviour for a number of frames (debug and tests). */
  forceBehaviour(behaviour: 'guard' | 'footwork' | 'idle', frames: number, guardDir: 1 | 4 = 4): void {
    this.behaviour = behaviour;
    this.timer = frames;
    this.guardDir = guardDir;
    this.plan = null;
  }

  // ------------------------------------------------------------ busy (attacking, stunned)

  private whileBusy(sim: CombatSim, me: Fighter, rook: Fighter): InputSnapshot {
    // Punish: buffer the punisher in the last frames of blockstun, once he knows what he blocked.
    if (me.state === 'blockstun' && this.punish) {
      const pun = this.decidePunish(sim, me, rook);
      if (pun && me.stateLength - me.stateFrame <= 2 && me.hitstop === 0) return this.pressPlan(me, pun);
      return this.out(me, pun ? pun.dir : this.guardDir, []);
    }
    // Strings: press the next jab in the cancel window (sometimes delayed).
    const plan = this.plan;
    if (me.state === 'attack' && plan && plan.opener === 'jab' && me.move) {
      const idx = ['corvane_jab_1', 'corvane_jab_2', 'corvane_jab_3'].indexOf(me.move.id);
      if (idx >= 0 && idx + 1 < plan.jabHits && me.move.cancelWindow && me.hitstop === 0) {
        const isLast = idx + 2 === plan.jabHits;
        const at = me.move.cancelWindow[0] - 1 + (isLast ? plan.jabDelay : 0);
        if (me.moveFrame === at) return this.out(me, 5, ['1']);
      }
      return this.out(me, 5, []);
    }
    if (me.state === 'thrown') {
      // He can only break a throw he has seen coming (reaction delay), and not always.
      const seen = this.perceived(sim);
      if (this.throwBreak === null && seen.moveId && rook.moves.get(seen.moveId)?.height === 'throw') {
        this.throwBreak = sim.rng.chance(AI.throwBreakChance);
      }
      return this.out(me, 5, this.throwBreak ? ['1'] : []);
    }
    this.throwBreak = null;
    // Stunned: keep guarding once able.
    return this.out(me, me.state === 'blockstun' ? this.guardDir : 5, []);
  }

  private decidePunish(sim: CombatSim, me: Fighter, rook: Fighter): Plan | null {
    const pun = this.punish!;
    if (sim.frame < pun.knownAt) return null;
    if (pun.chosen === null) {
      const m = rook.moves.get(pun.move);
      const adv = m?.onBlock ?? 0;
      let choice = 'none';
      if (adv <= -10) {
        // Never punishes a safe move; unsafe moves are punished with a roll.
        if (sim.rng.chance(AI.punishChance[me.phase >= 2 ? 1 : 0])) choice = adv <= -14 ? 'cross' : 'jab';
      }
      pun.chosen = choice;
      if (choice !== 'none') {
        this.plan = this.makePlan(sim, choice as Opener, true);
        this.plan.stage = 'execute';
        if (choice === 'jab') this.plan.jabHits = 1;
        this.followCrossWithJabs = choice === 'cross';
        this.log.push({ frame: sim.frame, type: 'punish', move: this.plan.move, opener: choice as Opener });
      }
    }
    return pun.chosen !== 'none' ? this.plan : null;
  }

  // ------------------------------------------------------------ neutral

  private whileNeutral(sim: CombatSim, me: Fighter, rook: Fighter, p: Perception): InputSnapshot {
    const gap = this.gap(me, rook);
    const range = this.range(gap);

    // A buffered punish whose press was missed: throw it now.
    if (this.plan?.isPunish && !this.plan.started && this.plan.stage === 'execute' && this.plan.frames < 6) {
      this.plan.frames++;
      this.behaviour = 'punish';
      return this.pressPlan(me, this.plan);
    }
    this.punish = null;

    // A plan whose move has run its course (or never came out) is finished.
    if (this.plan && (this.plan.started || this.plan.frames > AI.approachLimit + 10)) this.plan = null;
    if (this.plan) return this.runPlan(me, gap);

    // Grave Punch: Rook lying in reach with enough knockdown left (a fall is plain to see).
    if (rook.state === 'knockdown' && !rook.groundHitTaken && rook.stateLength - rook.stateFrame >= AI.graveMinFramesLeft && gap <= AI.reach.grave_punch) {
      const knockdownId = sim.frame - rook.stateFrame;
      if (this.graveRolledFor !== knockdownId) {
        this.graveRolledFor = knockdownId;
        if (sim.rng.chance(AI.graveChance[me.phase >= 2 ? 1 : 0])) {
          this.plan = this.makePlan(sim, 'grave_punch', true);
          this.plan.stage = 'execute';
          this.log.push({ frame: sim.frame, type: 'ground_hit', move: OPENER_MOVE.grave_punch });
          return this.runPlan(me, gap);
        }
      }
    }

    // Wake-up: Rook down or invulnerable → walk to mid range and wait; ground hit if possible.
    const down = p.state === 'knockdown' || p.state === 'wake_up' || p.state === 'defeated' || rook.state === 'wake_up';
    if (down) {
      this.behaviour = 'wake_up';
      if (rook.state === 'knockdown' && !rook.groundHitTaken && rook.stateLength - rook.stateFrame >= 20 && gap <= AI.reach.liver_shot) {
        this.plan = this.makePlan(sim, 'liver_shot', true);
        this.log.push({ frame: sim.frame, type: 'ground_hit', move: OPENER_MOVE.liver_shot });
        return this.runPlan(me, gap);
      }
      const target = 60;
      return this.out(me, gap > target + 8 ? 6 : gap < target - 8 ? 4 : 5, []);
    }

    // Ember: Last Bell once, the first time at mid range with at least 30% health (phase 2).
    if (me.phase >= 2 && range === 'mid' && !me.lockedMoves.has(OPENER_MOVE.last_bell) && me.health * 100 >= me.maxHealth * AI.emberMinHealthPercent) {
      this.plan = this.makePlan(sim, 'last_bell', false);
      this.plan.forced = 'ember';
      this.plan.range = range;
      this.behaviour = 'attack';
      return this.runPlan(me, gap);
    }

    if (this.timer <= 0) this.chooseBehaviour(sim, me, range);
    this.timer--;

    switch (this.behaviour) {
      case 'attack': {
        const opener = this.chooseOpener(sim, me, range);
        if (!opener) {
          // Far: dash in instead of attacking.
          this.behaviour = 'footwork';
          this.timer = 20;
          this.dashSeq = [6, 5, 6];
          return this.footwork(sim, me, gap);
        }
        this.plan = this.makePlan(sim, opener, false);
        this.plan.range = range;
        return this.runPlan(me, gap);
      }
      case 'idle':
        return this.out(me, 5, []);
      case 'guard':
        // Guarding means holding back, which walks backwards when nothing is coming: only hold it
        // when Rook is close, otherwise stand his ground (a boxer doesn't run).
        return this.out(me, gap < AI.guardHoldGap || this.guardDir === 1 ? this.guardDir : 5, []);
      case 'footwork':
      default:
        return this.footwork(sim, me, gap);
    }
  }

  private chooseBehaviour(sim: CombatSim, me: Fighter, range: Range): void {
    const w: Record<Range, [number, number, number]> = {
      // attack, guard, footwork
      close: [55, 30, 15],
      mid: [45, 20, 35],
      far: [35, 10, 55],
    };
    const [a, g] = w[range];
    const r = sim.rng.int(100);
    if (r < a) {
      this.behaviour = 'attack';
      this.timer = 1;
    } else if (r < a + g) {
      this.behaviour = 'guard';
      this.timer = sim.rng.range(AI.guardFrames[0], AI.guardFrames[1]);
      this.guardDir = me.phase >= 2 && sim.rng.chance(AI.crouchGuardChance) ? 1 : 4;
    } else {
      this.behaviour = 'footwork';
      this.timer = sim.rng.range(AI.footworkFrames[0], AI.footworkFrames[1]);
      this.walkTimer = 0;
    }
  }

  private footwork(sim: CombatSim, me: Fighter, gap: number): InputSnapshot {
    if (this.dashSeq.length) return this.out(me, this.dashSeq.shift()!, []);
    if (this.walkTimer <= 0) {
      this.walkTimer = sim.rng.range(6, 14);
      if (gap > 80) {
        this.walkDir = 6;
        if (sim.rng.chance(25)) this.dashSeq = [5, 6];
      } else if (gap < 45) this.walkDir = 4;
      else this.walkDir = [4, 5, 6][sim.rng.int(3)]!;
    }
    this.walkTimer--;
    return this.out(me, this.walkDir, []);
  }

  // ------------------------------------------------------------ openers

  /** Weighted opener choice by range, with the readable rules applied. Null = dash in instead. */
  private chooseOpener(sim: CombatSim, me: Fighter, range: Range): Opener | null {
    const p2 = me.phase >= 2;
    const banned = this.bannedOpener();
    let forced: string | undefined;
    let pick: Opener | null = null;

    if (this.sweepForced > 0) {
      let options: Opener[] = p2 ? ['body_hook', 'iron_wall'] : ['body_hook'];
      options = options.filter((o) => o !== banned && !me.lockedMoves.has(OPENER_MOVE[o]));
      if (options.length === 0) options = ['haymaker']; // keeps the "never three in a row" rule
      pick = options[sim.rng.int(options.length)]!;
      forced = 'phase_read';
    } else if (this.throwReadArmed && range === 'close') {
      pick = 'bell_ringer';
      forced = 'throw_read';
    } else {
      const table: [Opener, number][] =
        range === 'close'
          ? [['jab', 40], ['body_hook', 20], ['liver_shot', 20], ['bell_ringer', 20]]
          : range === 'mid'
            ? [['cross', 40], ['jab', 30], ['liver_shot', 30]]
            : [['haymaker', 25]];
      let weights = table.map(([o, wt]) => [o, p2 && range !== 'far' ? wt * 4 : wt] as [Opener, number]);
      if (p2 && range !== 'far') weights.push(['iron_wall', 100]); // 20% of the total
      weights = weights.filter(([o]) => o !== banned && !me.lockedMoves.has(OPENER_MOVE[o]));
      if (range === 'far') {
        // Haymaker 25%, otherwise dash in.
        if (weights.length && sim.rng.chance(25)) pick = 'haymaker';
        else return null;
      } else {
        const total = weights.reduce((s, [, wt]) => s + wt, 0);
        let r = sim.rng.int(total);
        for (const [o, wt] of weights) {
          if (r < wt) {
            pick = o;
            break;
          }
          r -= wt;
        }
      }
    }
    if (pick && forced) this.pendingForced = forced;
    return pick;
  }

  private pendingForced: string | undefined;

  /** The opener used for the last two openers in a row, which can't be used a third time. */
  private bannedOpener(): Opener | null {
    const n = this.openers.length;
    if (n >= 2 && this.openers[n - 1] === this.openers[n - 2]) return this.openers[n - 1]!;
    return null;
  }

  private makePlan(sim: CombatSim, opener: Opener, isPunish: boolean): Plan {
    const me = sim.fighters[this.index]!;
    const move = me.moves.get(OPENER_MOVE[opener])!;
    let jabHits = 1;
    let jabDelay = 0;
    if (opener === 'jab') {
      jabHits = sim.rng.range(1, 3);
      if (me.phase >= 2 && jabHits === 3 && sim.rng.chance(50)) jabDelay = sim.rng.range(AI.jabDelay[0], AI.jabDelay[1]);
    }
    const plan: Plan = {
      opener,
      move: move.id,
      dir: move.input.dir ?? 5,
      buttons: [...move.input.buttons] as Button[],
      motion: move.input.motion ? move.input.motion.split('').map(Number) : null,
      dashIn: opener === 'jab' && !isPunish,
      stage: 'approach',
      step: 0,
      frames: 0,
      jabHits,
      jabDelay,
      isPunish,
      started: false,
      range: 'mid',
      forced: this.pendingForced,
    };
    this.pendingForced = undefined;
    return plan;
  }

  private runPlan(me: Fighter, gap: number): InputSnapshot {
    const plan = this.plan!;
    plan.frames++;
    if (plan.stage === 'approach') {
      if (gap > AI.reach[plan.opener]) {
        if (plan.frames > AI.approachLimit) {
          this.plan = null;
          return this.out(me, 5, []);
        }
        if (this.dashSeq.length) return this.out(me, this.dashSeq.shift()!, []);
        if (plan.dashIn && gap > AI.reach[plan.opener] + 30) {
          plan.dashIn = false;
          this.dashSeq = [5, 6];
          return this.out(me, 6, []);
        }
        return this.out(me, 6, []);
      }
      plan.stage = 'execute';
      this.dashSeq = [];
    }
    if (plan.stage === 'execute') return this.pressPlan(me, plan);
    return this.out(me, 5, []);
  }

  /** Produce the input for a plan's move; motions take one frame per direction. */
  private pressPlan(me: Fighter, plan: Plan): InputSnapshot {
    if (plan.motion && plan.step < plan.motion.length - 1) {
      return this.out(me, plan.motion[plan.step++]!, []);
    }
    const dir = plan.motion ? plan.motion[plan.motion.length - 1]! : plan.dir;
    return this.out(me, dir, plan.buttons);
  }

  // ------------------------------------------------------------ helpers

  /** Gap between the two hurtboxes, in px. */
  gap(me: Fighter, rook: Fighter): number {
    return Math.trunc((Math.abs(me.x - rook.x) - me.halfWidth - rook.halfWidth) / 100);
  }

  range(gap: number): Range {
    return gap < AI.closeRange ? 'close' : gap <= AI.farRange ? 'mid' : 'far';
  }

  /** Build a snapshot from a facing-relative direction; never holds a button two frames in a row. */
  private out(me: Fighter, relDir: number, buttons: Button[]): InputSnapshot {
    const held = new Set<Button>(buttons.filter((b) => !this.lastHeld.has(b)));
    this.lastHeld = held;
    return { dir: toAbsolute(relDir, me.facing), held };
  }
}
