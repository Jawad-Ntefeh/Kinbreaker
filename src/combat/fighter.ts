/**
 * Fighter: all per-fighter combat state. Pure data + small queries; the CombatSim drives it.
 * All positions and velocities are integers in subpixels (1 px = 100 units).
 */
import { InputBuffer } from './input_buffer';
import type { Box, Limb, Move, MoveSet } from './move_data';
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
}

/** World-space box in subpixels: x0..x1 horizontally, y0..y1 vertically (up positive). */
export interface WorldBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export class Fighter {
  readonly index: number;
  readonly name: string;
  readonly moves: MoveSet;
  readonly limbs: Limbs;
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

  constructor(index: number, config: FighterConfig, x: number, facing: 1 | -1) {
    this.index = index;
    this.name = config.name;
    this.moves = config.moves;
    this.limbs = { ...config.limbs };
    this.maxHealth = config.health;
    this.health = config.health;
    this.maxPoise = config.poise;
    this.poise = config.poise;
    this.x = x;
    this.facing = facing;
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
    return this.state !== 'wake_up';
  }

  /** In startup frames of an attack (counter-hit window). */
  get inStartup(): boolean {
    return this.state === 'attack' && !!this.move && this.moveFrame < this.move.startup;
  }

  /** In startup or active frames of an attack (used by "block when attacked" logic). */
  get isThreatening(): boolean {
    return this.state === 'attack' && !!this.move && this.moveFrame <= this.move.lastActive;
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
    const h = SYSTEM.halfWidth;
    let height = SYSTEM.bodyHeight;
    if (this.isCrouching) height = SYSTEM.crouchHeight;
    if (this.state === 'knockdown' || this.state === 'wake_up') {
      // Lying flat: as wide as the fighter is tall.
      const half = Math.trunc(SYSTEM.bodyHeight / 2);
      return { x0: this.x - half, x1: this.x + half, y0: this.y, y1: this.y + SYSTEM.knockdownHeight };
    }
    return { x0: this.x - h, x1: this.x + h, y0: this.y, y1: this.y + height };
  }

  pushbox(): WorldBox {
    const h = SYSTEM.halfWidth;
    return { x0: this.x - h, x1: this.x + h, y0: this.y, y1: this.y + SYSTEM.bodyHeight };
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
    return this.toWorld({ x: 0, y: 0, w: this.move.throwRange, h: SYSTEM.bodyHeight });
  }

  hashInto(h: number): number {
    const ints = [
      this.x, this.y, this.vx, this.vy, this.facing, FIGHTER_STATES.indexOf(this.state), this.stateFrame,
      this.stateLength, this.moveFrame, this.moveStartInputFrame, this.hitGroups, this.connected,
      this.crouchStun ? 1 : 0, this.hitstop, this.health, this.poise, this.poiseIdle, this.stamina,
      this.comboActive ? 1 : 0, this.comboHits, this.comboDamage, this.juggleCount, this.gravity,
      this.wallHits, this.neutralFrames, this.splatY0, this.groundHitTaken ? 1 : 0,
    ];
    for (const n of ints) h = hashInt(h, n);
    h = hashString(h, this.move ? this.move.id : '');
    return this.buffer.hashInto(h);
  }
}
