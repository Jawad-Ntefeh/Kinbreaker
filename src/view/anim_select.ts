/**
 * Which animation plays: a pure function of the fighter's sim state and the names available in
 * the character's animation file.
 */
import type { FighterState } from '../combat/fighter';
import type { Height } from '../combat/move_data';
import { frameAtMoveFrame, frameAtTick, type Anim } from './anim_data';

/** The parts of a fighter the selection needs (a Fighter satisfies this). */
export interface AnimSubject {
  state: FighterState;
  move: { id: string } | null;
  hitHeight: Height | null;
  crouchStun: boolean;
}

/** Scene-level poses that override the sim state (boss intro, victory). */
export type ScenePose = 'intro' | 'victory' | null;

export const STATE_ANIMS = [
  'idle', 'walk_forward', 'walk_back', 'crouch', 'block_stand', 'block_crouch', 'dash_forward', 'backdash',
  'phase_step', 'hitstun_high', 'hitstun_mid', 'hitstun_low', 'blockstun_stand', 'blockstun_crouch', 'airborne',
  'knockdown', 'wake_up', 'thrown', 'throw_break', 'wall_splat', 'stagger', 'guard_break', 'ko', 'intro',
  'victory', 'phase_transition',
] as const;
export type StateAnim = (typeof STATE_ANIMS)[number];

export interface AnimChoice {
  name: string;
  /** Move animations play on the sim's move frame; state animations on a view counter. */
  kind: 'move' | 'state';
}

/** The state animation name for a fighter, before fallbacks. */
export function stateAnimName(f: AnimSubject): StateAnim {
  switch (f.state) {
    case 'hitstun':
      return f.hitHeight === 'low' ? 'hitstun_low' : f.hitHeight === 'high' ? 'hitstun_high' : 'hitstun_mid';
    case 'blockstun':
      return f.crouchStun ? 'blockstun_crouch' : 'blockstun_stand';
    case 'defeated':
      return 'ko';
    case 'attack':
    case 'throw_attempt':
      return 'idle';
    default:
      return f.state;
  }
}

const FALLBACK: Partial<Record<StateAnim, StateAnim[]>> = {
  hitstun_high: ['hitstun_mid'],
  hitstun_low: ['hitstun_mid', 'hitstun_high'],
  hitstun_mid: ['hitstun_high'],
  blockstun_crouch: ['blockstun_stand', 'block_stand'],
  blockstun_stand: ['block_stand'],
};

/**
 * Pick the animation: the current move (each part of a multi-part move has its own id), then the
 * state animation, then its fallback chain, then idle. Null if the file has none of them.
 */
export function selectAnim(f: AnimSubject, has: (name: string) => boolean, pose: ScenePose = null): AnimChoice | null {
  if (pose && has(pose) && (f.state === 'idle' || f.state === 'walk_forward' || f.state === 'walk_back')) return { name: pose, kind: 'state' };
  if ((f.state === 'attack' || f.state === 'throw_attempt') && f.move && has(f.move.id)) return { name: f.move.id, kind: 'move' };
  const s = stateAnimName(f);
  for (const name of [s, ...(FALLBACK[s] ?? []), 'idle']) if (has(name)) return { name, kind: 'state' };
  return null;
}

/** View-side clock for state animations: which one is playing and when it started. */
export interface AnimTrack {
  anim: string;
  start: number;
}

/**
 * The animation frame to show. Move animations use the sim's move frame (so they can't drift and
 * freeze during hitstop like the sim); state animations use `now - track.start` (view-side).
 */
export function pickFrame(
  f: AnimSubject & { moveFrame: number },
  file: { anims: ReadonlyMap<string, Anim> },
  pose: ScenePose,
  track: AnimTrack,
  now: number,
): { choice: AnimChoice; anim: Anim; index: number } | null {
  const choice = selectAnim(f, (n) => file.anims.has(n), pose);
  if (!choice) return null;
  const anim = file.anims.get(choice.name)!;
  if (choice.kind === 'move') return { choice, anim, index: frameAtMoveFrame(anim, f.moveFrame) };
  if (track.anim !== choice.name) {
    track.anim = choice.name;
    track.start = now;
  }
  return { choice, anim, index: frameAtTick(anim, now - track.start) };
}
