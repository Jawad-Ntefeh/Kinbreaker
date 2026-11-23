/**
 * CombatSim: owns the arena and two fighters. `step(p1, p2)` advances exactly one 60 Hz frame.
 * Pure logic: no DOM, deterministic integer math, runs in Node.
 *
 * Frame order inside step():
 *   1. buffer inputs
 *   2. advance timers (moves, stun, throws) — skipped for fighters in hitstop
 *   3. read inputs and start new moves (neutral fighters), cancels
 *   4. movement, walls, pushboxes
 *   5. hit detection (all contacts found against the same positions)
 *   6. apply results simultaneously (trades), hitstop
 *   7. stamina / poise regeneration
 */
import { Fighter, type FighterConfig, type WorldBox } from './fighter';
import type { Move } from './move_data';
import { SYSTEM, scaledDamage } from './system';
import type { InputSnapshot } from './types';
import { HASH_SEED, hashInt, hashString } from './hash';
import { getArena, type ArenaDef } from './arena_data';
import { Rng } from './rng';

export type ContactKind = 'hit' | 'counter' | 'block' | 'throw';

export interface CombatEvent {
  type:
    | 'hit'
    | 'counter'
    | 'block'
    | 'whiff_phase'
    | 'throw'
    | 'throw_break'
    | 'throw_land'
    | 'guard_break'
    | 'stagger'
    | 'launch'
    | 'wall_splat'
    | 'knockdown'
    | 'ground_hit'
    | 'armor'
    | 'ko'
    | 'phase2'
    | 'wall_break';
  attacker: number;
  defender: number;
  moveId: string;
  damage: number;
}

/** Measured frame advantage: frames between the two fighters becoming able to act. */
export interface AdvantageReadout {
  kind: 'HIT' | 'COUNTER' | 'BLOCK' | 'THROW' | 'BREAK';
  moveId: string;
  attacker: number;
  /** Positive = attacker can act first. */
  value: number;
}

export interface SimOptions {
  p1: FighterConfig;
  p2: FighterConfig;
  /** Start positions in px (default: centre of the arena, 120 px apart). */
  p1X?: number;
  p2X?: number;
  /** Refill health after a fighter has been neutral for a while (training mode). */
  trainingRefill?: boolean;
  /** Arena (default: the training arena). */
  arena?: ArenaDef;
  /** Arena width in px, overriding the arena's (tests). */
  arenaWidth?: number;
  /** Seed for the sim's RNG (used by AI decisions). */
  seed?: number;
  /** A fighter at 0 health is defeated (default true; training turns it off). */
  ko?: boolean;
}

interface Contact {
  attacker: Fighter;
  defender: Fighter;
  move: Move;
  kind: ContactKind | 'phase_miss' | 'ground';
  group: number;
}

interface PendingAdvantage {
  kind: AdvantageReadout['kind'];
  moveId: string;
  attacker: number;
  defender: number;
  attackerReady: number;
  defenderReady: number;
}


export class CombatSim {
  readonly fighters: readonly [Fighter, Fighter];
  frame = 0;
  /** Events produced by the last step (read-only for views and tests). */
  events: CombatEvent[] = [];
  lastAdvantage: AdvantageReadout | null = null;
  private pending: PendingAdvantage | null = null;
  /** Fighters frozen by hitstop on the current step. */
  private readonly frozen = [false, false];
  private readonly trainingRefill: boolean;
  /** Arena walls in subpixels. */
  arenaLeft = 0;
  arenaRight: number;
  readonly arena: ArenaDef;
  wallBroken = false;
  /** Seeded RNG owned by the sim; AI controllers draw their random choices from it. */
  readonly rng: Rng;
  /** Index of the fighter who won by KO, or null. */
  winner: number | null = null;
  private readonly ko: boolean;
  /** Moves of each fighter sorted by input specificity (motion > held direction > plain button). */
  private readonly moveOrder: readonly [Move[], Move[]];

  constructor(opts: SimOptions) {
    this.arena = opts.arena ?? getArena('training');
    this.arenaRight = opts.arenaWidth !== undefined ? opts.arenaWidth * 100 : this.arena.width;
    this.rng = new Rng(opts.seed ?? 1);
    this.ko = opts.ko ?? true;
    const mid = Math.trunc(this.arenaRight / 2);
    const half = Math.trunc(this.arena.startGap / 2);
    const x1 = opts.p1X !== undefined ? opts.p1X * 100 : mid - half;
    const x2 = opts.p2X !== undefined ? opts.p2X * 100 : mid + half;
    const a = new Fighter(0, opts.p1, x1, x1 <= x2 ? 1 : -1);
    const b = new Fighter(1, opts.p2, x2, x1 <= x2 ? -1 : 1);
    this.fighters = [a, b];
    this.trainingRefill = opts.trainingRefill ?? false;
    this.moveOrder = [sortMoves(a), sortMoves(b)];
  }

  opponent(f: Fighter): Fighter {
    return this.fighters[1 - f.index]!;
  }

  step(in1: InputSnapshot, in2: InputSnapshot): void {
    this.frame++;
    this.events = [];
    const [a, b] = this.fighters;
    a.buffer.push(in1.dir, in1.held);
    b.buffer.push(in2.dir, in2.held);

    for (const f of this.fighters) this.advance(f);
    this.updateThrows();
    this.checkKo();
    for (const f of this.fighters) this.startPhase2IfDue(f);
    this.measureAdvantage();
    for (const f of this.fighters) if (!this.frozen[f.index]) this.handleInput(f);
    this.move();
    this.resolveHits();
    this.checkKo();
    for (const f of this.fighters) this.regen(f);
  }

  // ---------------------------------------------------------------- KO and boss phases

  private checkKo(): void {
    if (!this.ko) return;
    for (const f of this.fighters) {
      if (f.health > 0 || f.state === 'defeated') continue;
      this.setTimed(f, 'defeated', 0);
      f.y = 0;
      f.vy = 0;
      f.hitstop = 0;
      if (this.winner === null) this.winner = 1 - f.index;
      this.event('ko', this.opponent(f), f, '', 0);
    }
  }

  /** Phase 2 starts once the boss is back on their feet (never mid-combo). */
  private startPhase2IfDue(f: Fighter): void {
    const boss = f.config.boss;
    if (!boss || !f.phase2Pending || !f.isNeutral || this.frozen[f.index] || f.health <= 0) return;
    f.phase2Pending = false;
    f.phase = 2;
    for (const m of boss.phase2Moves) if (!boss.oncePerFight.includes(m) || !f.usedOnce.has(m)) f.lockedMoves.delete(m);
    this.setTimed(f, 'phase_transition', boss.transitionFrames, 1);
    const opp = this.opponent(f);
    this.shift(opp, (opp.x >= f.x ? 1 : -1) * boss.transitionPushback);
    this.event('phase2', f, opp, '', 0);
  }

  private breakWall(by: Fighter): void {
    if (this.wallBroken || this.arena.breakableLeftWall <= 0) return;
    this.wallBroken = true;
    this.arenaLeft -= this.arena.breakableLeftWall;
    this.event('wall_break', by, this.opponent(by), '', 0);
  }

  // ---------------------------------------------------------------- timers

  private advance(f: Fighter): void {
    this.frozen[f.index] = f.hitstop > 0;
    if (f.hitstop > 0) {
      f.hitstop--;
      return;
    }
    switch (f.state) {
      case 'attack': {
        f.moveFrame++;
        const m = f.move;
        if (!m) {
          this.toNeutral(f);
          break;
        }
        if (m.cancelWindow && f.moveFrame === m.cancelWindow[0] && this.tryContinue(f, m)) break;
        if (f.moveFrame === m.lastActive + 1 && f.connected === 0) f.extraRecovery = m.whiffRecovery;
        if (f.moveFrame > f.moveTotal) this.toNeutral(f);
        break;
      }
      case 'airborne':
        break; // ends on landing (movement phase)
      case 'thrown':
        f.stateFrame++; // resolved by updateThrows()
        break;
      case 'idle':
      case 'walk_forward':
      case 'walk_back':
      case 'crouch':
      case 'block_stand':
      case 'block_crouch':
        break;
      case 'defeated':
        break;
      default:
        f.stateFrame++;
        if (f.state === 'phase_transition' && f.config.boss && f.stateFrame === f.config.boss.wallBreakFrame) this.breakWall(f);
        if (f.state === 'wall_splat') {
          // Slide down the wall, reaching the floor on the last frame.
          const t = Math.min(f.stateFrame, f.stateLength);
          f.y = f.splatY0 - Math.trunc((f.splatY0 * t) / f.stateLength);
        }
        if (f.stateFrame > f.stateLength) this.endTimedState(f);
    }
  }

  /** Linked parts of multi-hit moves start automatically if the previous part connected as required. */
  private tryContinue(f: Fighter, m: Move): boolean {
    const how = f.connected === 1 ? 'hit' : f.connected === 2 ? 'block' : 'whiff';
    for (const id of m.cancelInto) {
      const next = f.moves.get(id);
      if (next && next.continueOn.length > 0 && next.continueOn.includes(how)) {
        this.startMove(f, next, false, true);
        return true;
      }
    }
    return false;
  }

  private endTimedState(f: Fighter): void {
    switch (f.state) {
      case 'knockdown':
        this.setTimed(f, 'wake_up', SYSTEM.wakeUpFrames);
        break;
      case 'wall_splat':
        f.y = 0;
        f.vy = 0;
        this.setTimed(f, 'knockdown', SYSTEM.knockdownFrames);
        this.event('knockdown', this.opponent(f), f, '', 0);
        break;
      case 'stagger':
        f.poise = f.maxPoise;
        this.toNeutral(f);
        break;
      default:
        this.toNeutral(f);
    }
  }

  private setTimed(f: Fighter, state: Fighter['state'], length: number, startFrame = 0): void {
    if (state === 'knockdown') f.groundHitTaken = false;
    f.state = state;
    f.stateFrame = startFrame;
    f.stateLength = length;
    f.move = null;
    f.moveFrame = 0;
    f.vx = 0;
  }

  private toNeutral(f: Fighter): void {
    f.state = 'idle';
    f.stateFrame = 0;
    f.stateLength = 0;
    f.move = null;
    f.moveFrame = 0;
    f.extraRecovery = 0;
    f.vx = 0;
    f.vy = 0;
    f.y = 0;
    f.comboActive = false;
    f.juggleCount = 0;
    f.gravity = SYSTEM.gravity;
    f.wallHits = 0;
    f.crouchStun = false;
  }

  // ---------------------------------------------------------------- throws

  private updateThrows(): void {
    for (const atk of this.fighters) {
      if (atk.state !== 'throw_attempt') continue;
      const def = this.opponent(atk);
      if (def.state !== 'thrown' || !atk.move) continue;
      const brk = atk.move.throwBreak;
      if (def.stateFrame <= SYSTEM.throwBreakWindow) {
        const age = brk ? def.buffer.pressAge(brk, def.stateFrame + 1) : -1;
        if (age >= 0) {
          def.buffer.consume(brk!);
          const moveId = atk.move.id;
          this.setTimed(atk, 'throw_break', SYSTEM.throwBreakFrames, 1);
          this.setTimed(def, 'throw_break', SYSTEM.throwBreakFrames, 1);
          this.separate(atk, def, SYSTEM.throwBreakSeparation);
          this.event('throw_break', atk, def, moveId, 0);
          this.pending = {
            kind: 'BREAK', moveId, attacker: atk.index, defender: def.index, attackerReady: -1, defenderReady: -1,
          };
        }
      } else {
        // Throw lands.
        const dmg = this.applyDamage(def, atk.move.damage);
        this.event('throw_land', atk, def, atk.move.id, dmg);
        this.setTimed(def, 'knockdown', SYSTEM.knockdownFrames);
      }
    }
  }

  /** Push two fighters apart until their origins are `distance` apart (walls respected). */
  private separate(a: Fighter, b: Fighter, distance: number): void {
    const left = a.x <= b.x ? a : b;
    const right = left === a ? b : a;
    const gap = right.x - left.x;
    if (gap >= distance) return;
    const need = distance - gap;
    const half = Math.trunc(need / 2);
    this.shift(left, -half);
    this.shift(right, need - half);
    // Whatever a wall blocked goes to the other fighter.
    const now = right.x - left.x;
    if (now < distance) {
      if (left.x <= this.minX(left)) this.shift(right, distance - now);
      else this.shift(left, -(distance - now));
    }
  }

  minX(f: Fighter): number {
    return this.arenaLeft + f.halfWidth;
  }
  maxX(f: Fighter): number {
    return this.arenaRight - f.halfWidth;
  }

  private shift(f: Fighter, dx: number): void {
    f.x = Math.min(this.maxX(f), Math.max(this.minX(f), f.x + dx));
  }

  // ---------------------------------------------------------------- frame advantage

  private measureAdvantage(): void {
    const p = this.pending;
    if (!p) return;
    const atk = this.fighters[p.attacker]!;
    const def = this.fighters[p.defender]!;
    if (p.attackerReady < 0 && atk.isNeutral) p.attackerReady = this.frame;
    if (p.defenderReady < 0 && def.isNeutral) p.defenderReady = this.frame;
    if (p.attackerReady >= 0 && p.defenderReady >= 0) {
      this.lastAdvantage = { kind: p.kind, moveId: p.moveId, attacker: p.attacker, value: p.defenderReady - p.attackerReady };
      this.pending = null;
    }
  }

  // ---------------------------------------------------------------- input

  private handleInput(f: Fighter): void {
    const opp = this.opponent(f);
    if (f.isNeutral) {
      if (opp.x !== f.x) f.facing = opp.x > f.x ? 1 : -1;
      if (this.tryStartMove(f, this.moveOrder[f.index]!, false)) return;
      if (this.tryPhaseStep(f)) return;
      if (this.tryDash(f)) return;
      this.neutralMovement(f, opp);
      return;
    }
    if (f.state === 'attack' && f.move) {
      this.tryCancel(f);
      this.tryUpgrade(f);
    }
  }

  /** Does the buffer hold the input for this move right now? */
  private matches(f: Fighter, m: Move, pressWindow: number): boolean {
    if (!f.hasLimb(m.limb) || f.lockedMoves.has(m.id) || m.continueOn.length > 0) return false;
    const buf = f.buffer;
    const btns = m.input.buttons;
    let age: number;
    if (btns.length === 1) {
      age = buf.pressAge(btns[0]!, pressWindow);
      if (age < 0) return false;
    } else {
      if (!buf.together(btns[0]!, btns[1]!, SYSTEM.togetherWindow, pressWindow)) return false;
      age = Math.max(buf.pressAge(btns[0]!, pressWindow), buf.pressAge(btns[1]!, pressWindow));
    }
    if (m.input.motion) return buf.motion(m.input.motion, f.facing);
    if (m.input.dir !== null) {
      // The direction may be held now or when the button was pressed.
      return buf.heldDir(f.facing) === m.input.dir || buf.dirAt(age, f.facing) === m.input.dir;
    }
    return true;
  }

  private tryStartMove(f: Fighter, candidates: readonly Move[], allowCancelOnly: boolean, pressWindow = SYSTEM.buttonBuffer): boolean {
    for (const m of candidates) {
      if (m.cancelOnly && !allowCancelOnly) continue;
      if (this.matches(f, m, pressWindow)) {
        this.startMove(f, m);
        return true;
      }
    }
    return false;
  }

  private startMove(f: Fighter, m: Move, keepFrame = false, automatic = false): void {
    if (!automatic) {
      for (const b of m.input.buttons) f.buffer.consume(b);
      if (m.input.motion) f.buffer.consumeMotions();
    }
    const once = f.config.boss?.oncePerFight;
    if (once && once.includes(m.id)) {
      f.lockedMoves.add(m.id);
      f.usedOnce.add(m.id);
    }
    f.extraRecovery = 0;
    f.state = 'attack';
    f.move = m;
    if (!keepFrame) {
      f.moveFrame = 1;
      f.moveStartInputFrame = f.buffer.frame;
    }
    f.hitGroups = 0;
    f.connected = 0;
    f.stateFrame = 0;
    f.vx = 0;
  }

  private tryCancel(f: Fighter): void {
    const m = f.move!;
    if (!m.cancelWindow || m.cancelInto.length === 0) return;
    if (f.moveFrame < m.cancelWindow[0] || f.moveFrame > m.cancelWindow[1]) return;
    if (m.cancelOn.length > 0) {
      const ok =
        (f.connected === 1 && m.cancelOn.includes('hit')) ||
        (f.connected === 2 && m.cancelOn.includes('block')) ||
        (f.connected === 0 && m.cancelOn.includes('whiff'));
      if (!ok) return;
    }
    const targets = this.moveOrder[f.index]!.filter((c) => m.cancelInto.includes(c.id));
    // Presses buffered any time after the current move started count.
    const window = f.buffer.frame - f.moveStartInputFrame;
    if (window > 0) this.tryStartMove(f, targets, true, window);
  }

  /**
   * Keyboard-friendly simultaneous presses: if a single-button move started in the last
   * couple of frames and the second button of a two-button move arrives, switch to it.
   */
  private tryUpgrade(f: Fighter): void {
    const m = f.move!;
    if (m.input.buttons.length !== 1 || f.moveFrame > SYSTEM.togetherWindow + 1 || f.connected) return;
    const first = m.input.buttons[0]!;
    for (const c of this.moveOrder[f.index]!) {
      if (c.input.buttons.length !== 2 || !c.input.buttons.includes(first) || c.cancelOnly) continue;
      if (!f.hasLimb(c.limb) || c.input.motion || f.lockedMoves.has(c.id) || c.continueOn.length > 0) continue;
      if (c.input.dir !== null && f.buffer.heldDir(f.facing) !== c.input.dir) continue;
      const second = c.input.buttons[0] === first ? c.input.buttons[1]! : c.input.buttons[0]!;
      const a = f.buffer.pressAge(first, SYSTEM.buttonBuffer, true);
      const b = f.buffer.pressAge(second, SYSTEM.buttonBuffer);
      if (a >= 0 && b >= 0 && Math.abs(a - b) <= SYSTEM.togetherWindow) {
        this.startMove(f, c, true);
        return;
      }
    }
  }

  private tryPhaseStep(f: Fighter): boolean {
    if (!f.buffer.pressed('phase', SYSTEM.buttonBuffer)) return false;
    if (f.stamina < SYSTEM.phaseCost) return false;
    f.buffer.consume('phase');
    f.stamina -= SYSTEM.phaseCost;
    const d = f.buffer.heldDir(f.facing);
    const drift = d === 6 || d === 9 || d === 3 ? 1 : d === 4 || d === 7 || d === 1 ? -1 : 0;
    this.setTimed(f, 'phase_step', SYSTEM.phaseFrames, 1);
    f.vx = drift * SYSTEM.phaseDrift * f.facing;
    return true;
  }

  private tryDash(f: Fighter): boolean {
    if (f.buffer.motion('66', f.facing)) {
      f.buffer.consumeMotions();
      this.setTimed(f, 'dash_forward', f.config.dash.frames, 1);
      f.vx = f.config.dash.speed * f.facing;
      return true;
    }
    if (f.buffer.motion('44', f.facing)) {
      f.buffer.consumeMotions();
      this.setTimed(f, 'backdash', f.config.backdash.frames, 1);
      f.vx = -f.config.backdash.speed * f.facing;
      return true;
    }
    return false;
  }

  private neutralMovement(f: Fighter, opp: Fighter): void {
    const d = f.buffer.heldDir(f.facing);
    f.vx = 0;
    if (d === 1) f.state = 'block_crouch';
    else if (d === 2 || d === 3) f.state = 'crouch';
    else if (d === 4 || d === 7) {
      if (opp.isThreatening) f.state = 'block_stand';
      else {
        f.state = 'walk_back';
        f.vx = -f.config.walkBack * f.facing;
      }
    } else if (d === 6 || d === 9) {
      f.state = 'walk_forward';
      f.vx = f.config.walkForward * f.facing;
    } else f.state = 'idle';
  }

  // ---------------------------------------------------------------- movement

  private move(): void {
    for (const f of this.fighters) {
      if (this.frozen[f.index]) continue;
      if (f.state === 'attack' && f.move) {
        let dx = 0;
        for (const s of f.move.movement) if (s.frame <= f.moveFrame) dx = s.dx;
        f.vx = dx * f.facing;
      }
      if (f.state === 'airborne') {
        f.vy -= f.gravity;
        f.y += f.vy;
        if (f.y <= 0) {
          f.y = 0;
          f.vy = 0;
          this.setTimed(f, 'knockdown', SYSTEM.knockdownFrames);
          this.event('knockdown', this.opponent(f), f, '', 0);
        }
      }
      if (f.vx !== 0) {
        const before = f.x;
        this.shift(f, f.vx);
        const hitWall = f.x !== before + f.vx;
        if (hitWall && f.state === 'airborne') this.wallSplat(f);
      }
    }
    this.pushApart();
  }

  private wallSplat(f: Fighter): void {
    const y = f.y;
    this.setTimed(f, 'wall_splat', SYSTEM.wallSplatFrames);
    f.y = y;
    f.splatY0 = y;
    f.vy = 0;
    f.wallHits = 0;
    this.event('wall_splat', this.opponent(f), f, '', 0);
  }

  /** Pushboxes: fighters never overlap. */
  private pushApart(): void {
    const [a, b] = this.fighters;
    const left = a.x < b.x || (a.x === b.x && a.facing === 1) ? a : b;
    const right = left === a ? b : a;
    this.separate(left, right, left.halfWidth + right.halfWidth);
  }

  // ---------------------------------------------------------------- hits

  private resolveHits(): void {
    const contacts: Contact[] = [];
    for (const atk of this.fighters) {
      if (this.frozen[atk.index] || atk.state !== 'attack' || !atk.move) continue;
      const c = this.findContact(atk, this.opponent(atk));
      if (c) contacts.push(c);
    }
    // A throw and an attack connecting on the same frame: the attack wins.
    // Two throws on the same frame: both are broken.
    if (contacts.length === 2) {
      const [c1, c2] = contacts as [Contact, Contact];
      if (c1.kind === 'throw' && c2.kind === 'throw') {
        for (const f of this.fighters) this.setTimed(f, 'throw_break', SYSTEM.throwBreakFrames, 1);
        this.separate(c1.attacker, c2.attacker, SYSTEM.throwBreakSeparation);
        this.event('throw_break', c1.attacker, c1.defender, c1.move.id, 0);
        return;
      }
      const isStrike = (c: Contact) => c.kind !== 'throw' && c.kind !== 'phase_miss';
      if (c1.kind === 'throw' && isStrike(c2)) contacts.splice(0, 1);
      else if (c2.kind === 'throw' && isStrike(c1)) contacts.splice(1, 1);
    }
    // Results were decided above against the same state, then applied together (trades).
    for (const c of contacts) this.applyContact(c);
  }

  private findContact(atk: Fighter, def: Fighter): Contact | null {
    const m = atk.move!;
    if (m.height === 'throw') {
      const zone = atk.throwZone();
      if (!zone || atk.connected) return null;
      if (!this.canBeThrown(def)) return null;
      const front = def.hurtbox();
      const nearEdge = atk.facing === 1 ? front.x0 - atk.x : atk.x - front.x1;
      if (nearEdge > m.throwRange) return null;
      return { attacker: atk, defender: def, move: m, kind: 'throw', group: 0 };
    }
    if (!def.isHittable) return null;
    const downed = def.state === 'knockdown';
    if (downed && (def.groundHitTaken || !(m.height === 'low' || m.properties.includes('ground_hit')))) return null;
    const hurt = def.hurtbox();
    for (const { box, group } of atk.activeHitboxes()) {
      if (atk.hitGroups & (1 << group)) continue;
      if (!overlap(box, hurt)) continue;
      // Contact: decide the result.
      if (downed) return { attacker: atk, defender: def, move: m, kind: 'ground', group };
      if (m.path === 'linear' && def.isPhaseInvulnerable) return { attacker: atk, defender: def, move: m, kind: 'phase_miss', group };
      if (m.height === 'high' && def.isCrouching) continue;
      const stance = this.blockStance(def);
      const blocked = (stance === 'stand' && (m.height === 'high' || m.height === 'mid')) || (stance === 'crouch' && m.height === 'low');
      if (blocked) return { attacker: atk, defender: def, move: m, kind: 'block', group };
      return { attacker: atk, defender: def, move: m, kind: def.inStartup ? 'counter' : 'hit', group };
    }
    return null;
  }

  private canBeThrown(def: Fighter): boolean {
    switch (def.state) {
      case 'airborne':
      case 'knockdown':
      case 'wake_up':
      case 'hitstun':
      case 'blockstun':
      case 'thrown':
      case 'throw_attempt':
      case 'throw_break':
      case 'wall_splat':
      case 'phase_transition':
      case 'defeated':
        return false;
      default:
        return def.y === 0;
    }
  }

  /** How the defender is guarding right now, if at all. */
  private blockStance(def: Fighter): 'stand' | 'crouch' | null {
    const d = def.buffer.heldDir(def.facing);
    if (def.state === 'blockstun') return d === 1 || d === 2 || d === 3 ? 'crouch' : 'stand';
    if (!def.isNeutral) return null;
    if (d === 4 || d === 7) return 'stand';
    if (d === 1) return 'crouch';
    return null;
  }

  private applyContact(c: Contact): void {
    const { attacker: atk, defender: def, move: m } = c;
    if (c.kind === 'phase_miss') {
      this.event('whiff_phase', atk, def, m.id, 0);
      return;
    }
    atk.hitGroups |= 1 << c.group;
    if (c.kind === 'ground') {
      // Ground hit: half damage, once per knockdown, the knockdown timer is untouched.
      atk.connected = 1;
      atk.hitstop = Math.max(atk.hitstop, SYSTEM.hitstopHit);
      def.groundHitTaken = true;
      const dmg = this.applyDamage(def, m.damage, 50);
      this.event('ground_hit', atk, def, m.id, dmg);
      return;
    }
    const contactFrame = atk.moveFrame;
    const remaining = m.lastActive - contactFrame + m.recovery;

    if (c.kind === 'throw') {
      atk.connected = 1;
      atk.state = 'throw_attempt';
      atk.stateFrame = 0;
      atk.stateLength = SYSTEM.throwBreakWindow + SYSTEM.throwHitRecovery;
      atk.vx = 0;
      this.setTimed(def, 'thrown', 0);
      this.event('throw', atk, def, m.id, 0);
      this.startPending('THROW', atk, def, m.id);
      return;
    }

    if (c.kind === 'block') {
      atk.connected = 2;
      atk.hitstop = Math.max(atk.hitstop, SYSTEM.hitstopBlock);
      def.hitstop = Math.max(def.hitstop, SYSTEM.hitstopBlock);
      const crouch = this.blockStance(def) === 'crouch';
      def.stamina -= m.damage;
      if (def.stamina <= 0) {
        def.stamina = 0;
        this.setTimed(def, 'guard_break', SYSTEM.guardBreakFrames);
        this.event('guard_break', atk, def, m.id, 0);
      } else {
        this.setTimed(def, 'blockstun', Math.max(1, (m.onBlock ?? 0) + remaining));
        def.crouchStun = crouch;
      }
      this.event('block', atk, def, m.id, 0);
      this.pushBack(atk, def);
      this.startPending('BLOCK', atk, def, m.id);
      return;
    }

    const counter = c.kind === 'counter';
    const launchesNow = m.properties.includes('launcher') || (counter && m.properties.includes('counter_hit_launch')) || (counter ? m.onCounterHit : m.onHit) === 'launch';
    if (def.isArmored && !launchesNow) {
      // Armor: damage and poise damage, but no hitstun, no hitstop for the defender, no interruption.
      atk.connected = 1;
      atk.hitstop = Math.max(atk.hitstop, SYSTEM.hitstopHit);
      const dmg = this.applyDamage(def, m.damage);
      this.event('armor', atk, def, m.id, dmg);
      if (m.poiseDamage > 0) {
        def.poise -= m.poiseDamage;
        def.poiseIdle = 0;
        if (def.poise <= 0) {
          // A poise break still beats armor.
          def.poise = 0;
          this.setTimed(def, 'stagger', SYSTEM.staggerFrames);
          this.event('stagger', atk, def, m.id, 0);
        }
      }
      return;
    }

    // Hit or counter hit.
    atk.connected = 1;
    atk.hitstop = Math.max(atk.hitstop, SYSTEM.hitstopHit);
    def.hitstop = Math.max(def.hitstop, SYSTEM.hitstopHit);
    const dmg = this.applyDamage(def, m.damage);
    this.event(counter ? 'counter' : 'hit', atk, def, m.id, dmg);

    let staggered = false;
    if (def.state !== 'stagger' && m.poiseDamage > 0) {
      def.poise -= m.poiseDamage;
      def.poiseIdle = 0;
      if (def.poise <= 0) {
        def.poise = 0;
        staggered = true;
      }
    }

    const outcome = counter ? m.onCounterHit : m.onHit;
    const launch = m.properties.includes('launcher') || (counter && m.properties.includes('counter_hit_launch')) || outcome === 'launch';
    const knockdown = m.properties.includes('knockdown') || outcome === 'knockdown';
    const away = atk.x <= def.x ? 1 : -1;
    const crouch = def.isCrouching;

    if (def.state === 'airborne') {
      def.juggleCount++;
      def.gravity = SYSTEM.gravity + def.juggleCount * SYSTEM.gravityStep;
      def.vy = SYSTEM.juggleVy;
      def.vx = SYSTEM.juggleVx * away;
    } else if (def.state === 'wall_splat') {
      def.wallHits++;
      if (launch || def.wallHits >= SYSTEM.wallSplatMaxHits) {
        def.y = 0;
        this.setTimed(def, 'knockdown', SYSTEM.knockdownFrames);
        this.event('knockdown', atk, def, m.id, 0);
      }
    } else if (launch) {
      this.setTimed(def, 'airborne', 0);
      def.juggleCount = 0;
      def.gravity = SYSTEM.gravity;
      def.vy = SYSTEM.launchVy;
      def.vx = SYSTEM.launchVx * away;
      this.event('launch', atk, def, m.id, 0);
    } else if (knockdown) {
      this.setTimed(def, 'knockdown', SYSTEM.knockdownFrames);
      this.event('knockdown', atk, def, m.id, 0);
    } else if (staggered) {
      this.setTimed(def, 'stagger', SYSTEM.staggerFrames);
      this.event('stagger', atk, def, m.id, 0);
    } else if (def.state === 'stagger' || def.state === 'guard_break') {
      // Free hits: the state keeps running.
    } else {
      const stun = typeof outcome === 'number' ? outcome + remaining : remaining;
      this.setTimed(def, 'hitstun', Math.max(1, stun));
      def.crouchStun = crouch;
    }

    if (def.state !== 'airborne' && def.state !== 'wall_splat') {
      this.pushBack(atk, def);
      if (m.properties.includes('wall_splat') && this.atWall(def) && def.state !== 'knockdown') this.wallSplat(def);
    }
    this.startPending(counter ? 'COUNTER' : 'HIT', atk, def, m.id);
  }

  private atWall(f: Fighter): boolean {
    return f.x <= this.minX(f) || f.x >= this.maxX(f);
  }

  /** Push the defender back; whatever a wall blocks moves the attacker instead. */
  private pushBack(atk: Fighter, def: Fighter): void {
    const dir = atk.x <= def.x ? 1 : -1;
    const before = def.x;
    this.shift(def, SYSTEM.pushback * dir);
    const moved = Math.abs(def.x - before);
    if (moved < SYSTEM.pushback) this.shift(atk, -(SYSTEM.pushback - moved) * dir);
  }

  private applyDamage(def: Fighter, damage: number, percent = 100): number {
    if (!def.comboActive) {
      def.comboActive = true;
      def.comboHits = 0;
      def.comboDamage = 0;
    }
    def.comboHits++;
    const dmg = Math.trunc((scaledDamage(damage, def.comboHits) * percent) / 100);
    def.health = Math.max(0, def.health - dmg);
    def.comboDamage += dmg;
    const boss = def.config.boss;
    if (boss && def.phase === 1 && def.health * 100 <= def.maxHealth * boss.phase2HealthPercent) def.phase2Pending = true;
    return dmg;
  }

  private startPending(kind: AdvantageReadout['kind'], atk: Fighter, def: Fighter, moveId: string): void {
    this.pending = { kind, moveId, attacker: atk.index, defender: def.index, attackerReady: -1, defenderReady: -1 };
  }

  private event(type: CombatEvent['type'], atk: Fighter, def: Fighter, moveId: string, damage: number): void {
    this.events.push({ type, attacker: atk.index, defender: def.index, moveId, damage });
  }

  // ---------------------------------------------------------------- regen

  private regen(f: Fighter): void {
    const guarding = f.state === 'block_stand' || f.state === 'block_crouch' || f.state === 'blockstun' || f.state === 'phase_step';
    if (!guarding && f.stamina < SYSTEM.staminaMax) f.stamina++;
    if (f.state !== 'stagger') {
      f.poiseIdle++;
      if (f.poiseIdle > SYSTEM.poiseRegenDelay && f.poise < f.maxPoise) f.poise++;
    }
    if (f.isNeutral) f.neutralFrames++;
    else f.neutralFrames = 0;
    if (this.trainingRefill && f.neutralFrames >= SYSTEM.trainingRefillDelay) f.health = f.maxHealth;
  }

  // ---------------------------------------------------------------- hashing

  stateHash(): number {
    let h = hashInt(HASH_SEED, this.frame);
    h = hashInt(h, this.arenaLeft);
    h = hashInt(h, this.arenaRight);
    h = hashInt(h, this.rng.state);
    h = hashInt(h, this.winner ?? -1);
    for (const f of this.fighters) h = f.hashInto(h);
    const p = this.pending;
    if (p) {
      h = hashString(h, p.kind + p.moveId);
      h = hashInt(h, p.attacker);
      h = hashInt(h, p.attackerReady);
      h = hashInt(h, p.defenderReady);
    }
    const a = this.lastAdvantage;
    if (a) {
      h = hashString(h, a.kind + a.moveId);
      h = hashInt(h, a.value);
    }
    return h >>> 0;
  }
}

function overlap(a: WorldBox, b: WorldBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Most specific inputs first: more buttons, then motion > held direction > plain; then id for stability. */
function sortMoves(f: Fighter): Move[] {
  // More buttons first, then motion > held direction > plain button.
  const rank = (m: Move) => m.input.buttons.length * 10 + (m.input.motion ? 3 : m.input.dir !== null ? 2 : 1);
  return [...f.moves.values()].sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
