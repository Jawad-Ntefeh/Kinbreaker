/**
 * Fighter: all per-fighter combat state. Pure data + small queries; the CombatSim drives it.
 * All positions and velocities are integers in subpixels (1 px = 100 units).
 */
import { InputBuffer } from './input_buffer';
import type { Box, Limb, Move, MoveSet } from './move_data';
import type { BossConfig } from './character_data';
import { SYSTEM } from './system';
import { hashInt, hashString } from './hash';

export const FIGHTER_STATES = [
  'idle',
  'walk_forward',
  'walk_back',
  'crouch',
  'block_stand',
  'block_crouch',
  'dash_forward',
  'backdash',
  'phase_step',
  'attack',
  'hitstun',
  'blockstun',
  'airborne',
  'knockdown',
  'wake_up',
  'throw_attempt',
  'thrown',
  'throw_break',
  'wall_splat',
  'stagger',
  'guard_break',
  'phase_transition',
  'defeated',
] as const;
export type FighterState = (typeof FIGHTER_STATES)[number];

/** States in which a fighter is free to act (start moves, walk, block). */
const NEUTRAL: ReadonlySet<FighterState> = new Set<FighterState>([
  'idle',
  'walk_forward',
  'walk_back',
  'crouch',
  'block_stand',
  'block_crouch',
]);

export type Limbs = Record<'left_arm' | 'right_arm' | 'left_leg' | 'right_leg', boolean>;
export const ALL_LIMBS: Limbs = { left_arm: true, right_arm: true, left_leg: true, right_leg: true };

export interface FighterConfig {
  name: string;
  moves: MoveSet;
  health: number;
  poise: number;
  limbs: Limbs;
  /** Subpixels. */
  body: { halfWidth: number; height: number; crouchHeight: number };
  walkForward: number;
  walkBack: number;
  dash: { frames: number; speed: number };
  backdash: { frames: number; speed: number };
  boss: BossConfig | null;
}

/** World-space box in subpixels: x0..x1 horizontally, y0..y1 vertically (up positive). */
export interface WorldBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type Glint = 'white' | 'red' | null;

export class Fighter {
  readonly index: number;
  readonly name: string;
  readonly moves: MoveSet;
  readonly limbs: Limbs;
  readonly config: FighterConfig;
  readonly halfWidth: number;
  readonly height: number;
  readonly crouchHeight: number;
  readonly buffer = new InputBuffer();

  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  facing: 1 | -1 = 1;

  state: FighterState = 'idle';
  /** Frames elapsed in a timed state. */
  stateFrame = 0;
  /** Length of a timed state; the state ends when stateFrame exceeds it. */
  stateLength = 0;

  move: Move | null = null;
  /** Current move frame, 1-based. */
  moveFrame = 0;
  /** Buffer frame on which the current move started (cancel presses must come after it). */
  moveStartInputFrame = 0;
  /** Hitbox groups of the current move that already connected (bitmask). */
  hitGroups = 0;
  /** The current move connected: 0 = no, 1 = hit, 2 = block. */
  connected = 0;
  /** Extra recovery added to the current move (whiff_recovery). */
  extraRecovery = 0;

  /** Crouching stance kept through hitstun/blockstun. */
  crouchStun = false;
  hitstop = 0;

  readonly maxHealth: number;
  health: number;
  readonly maxPoise: number;
  poise: number;
  /** Frames since poise damage was last taken. */
  poiseIdle = 0;
  stamina = SYSTEM.staminaMax;

  comboActive = false;
  comboHits = 0;
  comboDamage = 0;
  juggleCount = 0;
  gravity = SYSTEM.gravity;
  wallHits = 0;
  /** Height at which a wall splat started; the fighter slides from here to the floor. */
  splatY0 = 0;
  /** A ground hit was already taken during the current knockdown. */
  groundHitTaken = false;
  /** Frames spent in a neutral state (training refill). */
  neutralFrames = 0;

  /** Boss phase (1 or 2). */
  phase = 1;
  /** Phase 2 is due and starts once the fighter is back on their feet. */
  phase2Pending = false;
  /** Moves that cannot be started right now (phase-locked or already used once). */
  readonly lockedMoves = new Set<string>();
  /** Once-per-fight moves already used. */
  readonly usedOnce = new Set<string>();

  constructor(index: number, config: FighterConfig, x: number, facing: 1 | -1) {
    this.index = index;
    this.config = config;
    this.name = config.name;
    this.moves = config.moves;
    this.limbs = { ...config.limbs };
    this.halfWidth = config.body.halfWidth;
    this.height = config.body.height;
    this.crouchHeight = config.body.crouchHeight;
    this.maxHealth = config.health;
    this.health = config.health;
    this.maxPoise = config.poise;
    this.poise = config.poise;
    this.x = x;
    this.facing = facing;
    if (config.boss) for (const m of config.boss.phase2Moves) this.lockedMoves.add(m);
  }

  get isNeutral(): boolean {
    return NEUTRAL.has(this.state);
  }

  hasLimb(limb: Limb): boolean {
    if (limb === 'core' || limb === 'none') return true;
    return this.limbs[limb];
  }

  get isAirborne(): boolean {
    return this.state === 'airborne';
  }

  get isCrouching(): boolean {
    if (this.state === 'crouch' || this.state === 'block_crouch') return true;
    if (this.state === 'hitstun' || this.state === 'blockstun') return this.crouchStun;
    return false;
  }

  /** Phase-step frames that are invulnerable to linear attacks. */
  get isPhaseInvulnerable(): boolean {
    const [a, b] = SYSTEM.phaseInvuln;
    return this.state === 'phase_step' && this.stateFrame >= a && this.stateFrame <= b;
  }

  /** Can this fighter be hit by attacks at all? (Knocked-down fighters only by ground hits.) */
  get isHittable(): boolean {
    return this.state !== 'wake_up' && this.state !== 'phase_transition' && this.state !== 'defeated';
  }

  /** In startup frames of an attack (counter-hit window). */
  get inStartup(): boolean {
    return this.state === 'attack' && !!this.move && this.moveFrame < this.move.startup;
  }

  /** In startup or active frames of an attack (used by "block when attacked" logic). */
  get isThreatening(): boolean {
    return this.state === 'attack' && !!this.move && this.moveFrame <= this.move.lastActive;
  }

  /** Total frames of the current move, including whiff recovery if it applies. */
  get moveTotal(): number {
    return this.move ? this.move.total + this.extraRecovery : 0;
  }

  /** Telegraph flash on big attacks: from frame startup-14 to startup-6. White = linear, red = sweeping. */
  get glint(): Glint {
    const m = this.move;
    if (this.state !== 'attack' || !m || !m.glint) return null;
    if (this.moveFrame < m.startup - SYSTEM.glintStart || this.moveFrame > m.startup - SYSTEM.glintEnd) return null;
    return m.path === 'sweeping' ? 'red' : 'white';
  }

  /** Armor: hits deal damage but don't interrupt the move. */
  get isArmored(): boolean {
    const a = this.move?.armorFrames;
    return this.state === 'attack' && !!a && this.moveFrame >= a[0] && this.moveFrame <= a[1];
  }

  /** Converts a facing-right local box to world space. */
  toWorld(b: Box): WorldBox {
    const x0 = this.facing === 1 ? this.x + b.x : this.x - b.x - b.w;
    return { x0, x1: x0 + b.w, y0: this.y + b.y, y1: this.y + b.y + b.h };
  }

  /** Current hurtbox in world space. */
  hurtbox(): WorldBox {
    if (this.state === 'attack' && this.move) {
      for (const o of this.move.hurtboxOverrides) {
        if (this.moveFrame >= o.frames[0] && this.moveFrame <= o.frames[1]) return this.toWorld(o);
      }
    }
    const h = this.halfWidth;
    if (this.state === 'knockdown' || this.state === 'wake_up' || this.state === 'defeated') {
      // Lying flat: as wide as the fighter is tall.
      const half = Math.trunc(this.height / 2);
      return { x0: this.x - half, x1: this.x + half, y0: this.y, y1: this.y + SYSTEM.knockdownHeight };
    }
    const height = this.isCrouching ? this.crouchHeight : this.height;
    return { x0: this.x - h, x1: this.x + h, y0: this.y, y1: this.y + height };
  }

  pushbox(): WorldBox {
    const h = this.halfWidth;
    return { x0: this.x - h, x1: this.x + h, y0: this.y, y1: this.y + this.height };
  }

  /** Hitboxes active on the current frame (world space), with their group. */
  activeHitboxes(): { box: WorldBox; group: number }[] {
    if (this.state !== 'attack' || !this.move) return [];
    const out: { box: WorldBox; group: number }[] = [];
    for (const hb of this.move.hitboxes) {
      if (this.moveFrame >= hb.frames[0] && this.moveFrame <= hb.frames[1]) out.push({ box: this.toWorld(hb), group: hb.group });
    }
    return out;
  }

  /** Throw range zone (world space) while a throw is active, for the debug view and for throw checks. */
  throwZone(): WorldBox | null {
    if (this.state !== 'attack' || !this.move || this.move.height !== 'throw') return null;
    if (this.moveFrame < this.move.startup || this.moveFrame > this.move.lastActive) return null;
    return this.toWorld({ x: 0, y: 0, w: this.move.throwRange, h: this.height });
  }

  hashInto(h: number): number {
    const ints = [
      this.x, this.y, this.vx, this.vy, this.facing, FIGHTER_STATES.indexOf(this.state), this.stateFrame,
      this.stateLength, this.moveFrame, this.moveStartInputFrame, this.hitGroups, this.connected,
      this.extraRecovery, this.crouchStun ? 1 : 0, this.hitstop, this.health, this.poise, this.poiseIdle,
      this.stamina, this.comboActive ? 1 : 0, this.comboHits, this.comboDamage, this.juggleCount, this.gravity,
      this.wallHits, this.neutralFrames, this.splatY0, this.groundHitTaken ? 1 : 0, this.phase,
      this.phase2Pending ? 1 : 0,
    ];
    for (const n of ints) h = hashInt(h, n);
    h = hashString(h, this.move ? this.move.id : '');
    h = hashString(h, [...this.lockedMoves].sort().join(','));
    return this.buffer.hashInto(h);
  }
}
