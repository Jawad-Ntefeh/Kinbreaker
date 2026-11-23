/**
 * Animations from poses: timing comes from the move data (startup / smear / impact / recovery via
 * the art spec's movePoses) or from the art spec's state list, so every generated animation passes
 * the validator by construction. Adds secondary motion (coat tails, braid) and smear frames.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Move } from '../../../src/combat/move_data';
import { movePoses, STATE_SPECS, type MovePhase } from '../../../src/view/anim_layout';
import { lerpPose, SRC, type Pose, type Pt } from './core';
import { compose, orderedBones, solve, type BoneState, type Layer, type Rig } from './rig';
import { finish, type Frame } from './post';

export interface AnimDef {
  poses?: string[];
  move?: string;
  startup?: string[];
  impact?: string;
  recovery?: string[];
  /** Body travel speed in px/frame (for secondary motion). */
  speed?: number;
}

export interface BuiltFrame {
  frame: Frame;
  dur: number;
  impact: boolean;
  phase: MovePhase | 'state';
  pose: Pose;
  bones: Map<string, BoneState>;
  layer: Layer;
  outside: number;
}

export interface BuiltAnim {
  name: string;
  loop: boolean;
  move: Move | null;
  frames: BuiltFrame[];
}

export function loadAnimDefs(char: string): Record<string, AnimDef> {
  const raw = JSON.parse(readFileSync(join(SRC, char, 'anims.json'), 'utf8')) as Record<string, AnimDef>;
  return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

/** Pick `n` poses along a list of key poses, interpolating between them when needed. */
export function samplePoses(keys: Pose[], n: number): Pose[] {
  if (n <= 0) return [];
  if (keys.length === n) return keys;
  if (keys.length === 1) return Array.from({ length: n }, () => keys[0]!);
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : (i * (keys.length - 1)) / (n - 1);
    const k = Math.min(keys.length - 2, Math.floor(t));
    return lerpPose(keys[k]!, keys[k + 1]!, t - k);
  });
}

/** Limb name in move data → bones that strike (for smears and the hitbox check). */
export function strikingBones(rig: Rig, move: Move): string[] {
  return rig.skeleton.limbs?.[move.limb] ?? [];
}

export interface Timeline {
  poses: Pose[];
  durs: number[];
  loop: boolean;
  speed: number;
}

/** Which key pose is showing at sim frame t (looping or clamped). */
function poseIndexAt(tl: Timeline, t: number): number {
  const total = tl.durs.reduce((a, b) => a + b, 0);
  let tt = tl.loop ? ((t % total) + total) % total : Math.max(0, Math.min(total - 1, t));
  for (let i = 0; i < tl.durs.length; i++) {
    tt -= tl.durs[i]!;
    if (tt < 0) return i;
  }
  return tl.durs.length - 1;
}

/**
 * Secondary motion: each secondary bone's world angle follows its parent with a lag of 2-4
 * frames, trails behind the body's travel speed and bobs with the body.
 */
export function secondaryAngles(rig: Rig, tl: Timeline, k: number): Record<string, number> {
  const starts = tl.durs.map((_, i) => tl.durs.slice(0, i).reduce((a, b) => a + b, 0));
  const cache = new Map<number, Map<string, BoneState>>();
  const solved = (i: number) => {
    let s = cache.get(i);
    if (!s) cache.set(i, (s = solve(rig, tl.poses[i]!)));
    return s;
  };
  const defs = new Map(rig.skeleton.bones.map((b) => [b.name, b]));
  const memo = new Map<string, number>();
  /** World angle of a bone at key pose i (secondary bones computed, others solved). */
  const world = (name: string, i: number): number => {
    const def = defs.get(name)!;
    const sec = def.secondary;
    if (!sec) return solved(i).get(name)!.world;
    const key = `${name}@${i}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const lag = poseIndexAt(tl, starts[i]! - sec.lag);
    const parentIsSecondary = !!defs.get(def.parent!)?.secondary;
    const swing = world(def.parent!, lag) - world(def.parent!, i);
    const bob = (tl.poses[i]!.root[1] - tl.poses[lag]!.root[1]) * (sec.bob ?? 0);
    let w = (parentIsSecondary ? world(def.parent!, i) : 0) + sec.base + (sec.inherit ?? 0) * swing + (sec.speed ?? 0) * tl.speed + bob;
    if (sec.copy) w += (sec.mix ?? 1) * world(sec.copy, i);
    memo.set(key, w);
    return w;
  };
  const out: Record<string, number> = {};
  for (const def of orderedBones(rig.skeleton)) if (def.secondary) out[def.name] = world(def.name, k);
  return out;
}

export function renderPose(rig: Rig, pose: Pose, cell: Pt, pivot: Pt, worldExtra: Record<string, number> = {}): { frame: Frame; bones: Map<string, BoneState>; layer: Layer; outside: number } {
  const p: Pose = { ...pose, w: { ...pose.w, ...worldExtra } };
  const bones = solve(rig, p);
  const { layer, outside } = compose(rig, bones, cell[0], cell[1], pivot, p.hide);
  const frame = finish(layer, rig.pal);
  return { frame, bones, layer, outside };
}

/**
 * Smear frame: the body a little before the impact pose, with the striking limb drawn stretched
 * along its path from the previous pose to the impact pose in its lighter colours.
 */
export function renderSmear(rig: Rig, from: Pose, to: Pose, striking: string[], cell: Pt, pivot: Pt, worldExtra: Record<string, number>): ReturnType<typeof renderPose> {
  const body = lerpPose(from, to, 0.8);
  const p: Pose = { ...body, w: { ...body.w, ...worldExtra } };
  const bones = solve(rig, p);
  const { layer, outside } = compose(rig, bones, cell[0], cell[1], pivot, p.hide);
  for (const t of [0.35, 0.5, 0.65]) {
    const mid = lerpPose(from, to, t);
    const mb = solve(rig, { ...mid, w: { ...mid.w, ...worldExtra } });
    const only = new Map([...mb].filter(([k]) => striking.includes(k)));
    const ghost = compose(rig, only, cell[0], cell[1], pivot).layer;
    for (let i = 0; i < ghost.ramp.length; i++) {
      if (ghost.ramp[i]! < 0 || layer.ramp[i]! >= 0) continue;
      layer.ramp[i] = ghost.ramp[i]!;
      layer.step[i] = ghost.max[i]!; // lighter colours along the path
      layer.min[i] = ghost.min[i]!;
      layer.max[i] = ghost.max[i]!;
      layer.fixed[i] = 1;
      layer.bone[i] = ghost.bone[i]!;
      layer.z[i] = ghost.z[i]! - 1;
      layer.group[i] = ghost.group[i]!;
    }
  }
  return { frame: finish(layer, rig.pal), bones, layer, outside };
}

/** Build one animation: frames, durations and impact flags. */
export function buildAnim(rig: Rig, name: string, def: AnimDef, poses: Map<string, Pose>, moves: Map<string, Move>, cell: Pt, pivot: Pt): BuiltAnim {
  const get = (n: string) => {
    const p = poses.get(n);
    if (!p) throw new Error(`${rig.name}: animation ${name} uses unknown pose "${n}"`);
    return p;
  };
  let keyPoses: Pose[];
  let durs: number[];
  let phases: (MovePhase | 'state')[];
  let loop = false;
  let move: Move | null = null;
  if (def.move) {
    move = moves.get(def.move) ?? null;
    if (!move) throw new Error(`${rig.name}: animation ${name}: no move "${def.move}"`);
    const plan = movePoses(move);
    const count = (ph: MovePhase) => plan.filter((p) => p.phase === ph).length;
    const startup = samplePoses((def.startup ?? []).map(get), count('startup'));
    const recovery = samplePoses((def.recovery ?? []).map(get), count('recovery'));
    const impact = get(def.impact!);
    keyPoses = [];
    let si = 0;
    let ri = 0;
    for (const p of plan) {
      if (p.phase === 'startup') keyPoses.push(startup[si++]!);
      else if (p.phase === 'recovery') keyPoses.push(recovery[ri++]!);
      else keyPoses.push(impact); // smear frames are drawn from the previous pose to this one
    }
    durs = plan.map((p) => p.dur);
    phases = plan.map((p) => p.phase);
  } else {
    const spec = STATE_SPECS.find((s) => s.name === name);
    if (!spec) throw new Error(`${rig.name}: "${name}" is not a state animation in the art spec`);
    keyPoses = samplePoses((def.poses ?? []).map(get), spec.poses);
    durs = keyPoses.map(() => spec.dur);
    phases = keyPoses.map(() => 'state');
    loop = spec.loop;
  }
  const tl: Timeline = { poses: keyPoses, durs, loop, speed: def.speed ?? 0 };
  const frames: BuiltFrame[] = keyPoses.map((pose, k) => {
    const sec = secondaryAngles(rig, tl, k);
    const phase = phases[k]!;
    const r =
      phase === 'smear' && move
        ? renderSmear(rig, keyPoses[k - 1] ?? pose, pose, strikingBones(rig, move), cell, pivot, sec)
        : renderPose(rig, pose, cell, pivot, sec);
    return { ...r, dur: durs[k]!, impact: phase === 'impact', phase, pose };
  });
  return { name, loop, move, frames };
}

/**
 * Does the striking limb line up with the hitbox on the impact frame? Returns the overlap of the
 * limb's pixels with the move's first hitbox (in cell pixels), or a message if they miss.
 */
export function hitboxCheck(rig: Rig, anim: BuiltAnim, pivot: Pt): string | null {
  const m = anim.move;
  if (!m || m.height === 'throw' || !m.hitboxes.length) return null;
  const f = anim.frames.find((fr) => fr.impact)!;
  const striking = new Set(strikingBones(rig, m).map((n) => f.bones.get(n)?.index ?? -1));
  if (!striking.size || striking.has(-1)) return `${anim.name}: no striking bones for limb ${m.limb}`;
  const hb = m.hitboxes[0]!;
  const x0 = pivot[0] + Math.round(hb.x / 100);
  const x1 = pivot[0] + Math.round((hb.x + hb.w) / 100);
  const y1 = pivot[1] - Math.round(hb.y / 100);
  const y0 = pivot[1] - Math.round((hb.y + hb.h) / 100);
  let inside = 0;
  let total = 0;
  let maxX = -1;
  for (let y = 0; y < f.layer.h; y++) for (let x = 0; x < f.layer.w; x++) {
    const b = f.layer.bone[y * f.layer.w + x]!;
    if (!striking.has(b)) continue;
    total++;
    maxX = Math.max(maxX, x);
    if (x >= x0 && x < x1 && y >= y0 && y < y1) inside++;
  }
  if (inside === 0) return `${anim.name}: the striking limb misses the hitbox (limb reaches x=${maxX - pivot[0]}, hitbox x ${hb.x / 100}..${(hb.x + hb.w) / 100}, y ${hb.y / 100}..${(hb.y + hb.h) / 100})`;
  void total;
  return null;
}
