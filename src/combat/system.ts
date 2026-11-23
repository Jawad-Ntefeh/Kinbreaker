/**
 * System-wide combat constants, loaded from data/system.json so no frame numbers live in code.
 * Pixel values are converted to subpixels (1 px = 100 units).
 */
import raw from '../../data/system.json';
import { SUBPX } from './move_data';

const px = (v: number): number => Math.round(v * SUBPX);

export const SYSTEM = {
  knockdownHeight: px(raw.body.knockdown_height),
  glintStart: raw.glint.from_startup_minus,
  glintEnd: raw.glint.to_startup_minus,
  phaseFrames: raw.phase_step.frames,
  phaseDrift: px(raw.phase_step.drift),
  phaseInvuln: raw.phase_step.invuln as [number, number],
  phaseCost: raw.phase_step.stamina_cost,
  hitstopHit: raw.hitstop.hit,
  hitstopBlock: raw.hitstop.block,
  pushback: px(raw.pushback),
  guardBreakFrames: raw.guard_break_frames,
  staggerFrames: raw.stagger_frames,
  knockdownFrames: raw.knockdown_frames,
  wakeUpFrames: raw.wake_up_frames,
  wallSplatFrames: raw.wall_splat.frames,
  wallSplatMaxHits: raw.wall_splat.max_hits,
  throwBreakWindow: raw.throw.break_window,
  throwBreakFrames: raw.throw.break_frames,
  throwBreakSeparation: px(raw.throw.break_separation),
  throwHitRecovery: raw.throw.hit_recovery,
  launchVy: px(raw.launch.vy),
  launchVx: px(raw.launch.vx),
  gravity: px(raw.launch.gravity),
  juggleVy: px(raw.juggle.vy),
  juggleVx: px(raw.juggle.vx),
  gravityStep: px(raw.juggle.gravity_step),
  damageScaling: raw.damage_scaling as readonly number[],
  poiseRegenDelay: raw.poise_regen_delay,
  staminaMax: raw.stamina_max,
  buttonBuffer: raw.button_buffer,
  togetherWindow: raw.together_window,
  trainingRefillDelay: raw.training_refill_delay,
} as const;

/** Damage percent for the n-th hit of a combo (1-based). */
export function damageScalePercent(hitNumber: number): number {
  const t = SYSTEM.damageScaling;
  return t[Math.min(Math.max(hitNumber, 1), t.length) - 1]!;
}

export function scaledDamage(damage: number, hitNumber: number): number {
  return Math.trunc((damage * damageScalePercent(hitNumber)) / 100);
}
