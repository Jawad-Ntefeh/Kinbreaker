/**
 * Placeholder silhouettes: a few rectangles (head, torso, upper/lower arms and legs) posed per
 * state and per move phase. Pure logic: produces rectangles in cell coordinates; sprites.ts draws them.
 *
 * Coordinates while posing: x forward from the pivot (facing right), y up from the floor.
 * During a move's impact pose the attacking limb reaches toward the move's hitbox, so the
 * placeholder already shows where attacks land.
 */
import type { Limbs } from '../combat/fighter';
import type { Move } from '../combat/move_data';
import type { PoseKey } from './anim_layout';

export type Shade = 'outline' | 'dark' | 'base' | 'light';

export interface PoseRect {
  x: number;
  y: number;
  w: number;
  h: number;
  shade: Shade;
}

export interface Body {
  /** Standing height in px. */
  height: number;
  /** Hurtbox width in px. */
  width: number;
  /** Crouch height in px. */
  crouch: number;
  limbs: Limbs;
  /** Cell size and pivot, to keep reaching limbs inside the cell. */
  cell: readonly [number, number];
  pivot: readonly [number, number];
}

type Pt = [number, number];

/** A fighter's posed skeleton before it becomes rectangles. */
interface Skeleton {
  hip: number; // hip height
  lean: number; // torso shift forward
  lying: number; // 0 standing; >0: lying, at this height off the floor
  frontHand: Pt;
  backHand: Pt;
  frontFoot: Pt;
  backFoot: Pt;
  /** Limbs drawn even if missing (the attacking limb of the dummy's moves). */
  forceLimb?: keyof Limbs;
}

export function posePlaceholder(key: PoseKey, body: Body): PoseRect[] {
  return toRects(skeletonFor(key, body), body);
}

function proportions(b: Body) {
  const head = Math.round(b.height * 0.16);
  const torso = Math.round(b.height * 0.33);
  const leg = b.height - head - torso;
  return { leg, torso, head, headW: Math.max(8, Math.round(head * 0.8)), torsoW: Math.max(12, Math.round(b.width * 0.58)), arm: 4, legW: 5 };
}

function skeletonFor(key: PoseKey, b: Body): Skeleton {
  const p = proportions(b);
  const stand = p.leg;
  const crouchHip = Math.max(8, stand - (b.height - b.crouch));
  const shoulder = (hip: number) => hip + p.torso - 3;
  const guard = (hip: number, lean: number): Skeleton => ({
    hip,
    lean,
    lying: 0,
    frontHand: [lean + 13, shoulder(hip) - 2],
    backHand: [lean + 9, shoulder(hip) - 6],
    frontFoot: [7, 0],
    backFoot: [-7, 0],
  });
  const t = key.of > 1 ? key.index / (key.of - 1) : 0;

  if (key.move) return moveSkeleton(key, b, guard, stand, crouchHip, shoulder);

  switch (key.state) {
    case 'idle':
      return guard(stand - (key.index % 2), 0);
    case 'walk_forward':
    case 'walk_back': {
      const s = guard(stand, key.state === 'walk_forward' ? 1 : -1);
      const phase = [0, 5, 8, 5, 0, -5][key.index % 6]!;
      s.frontFoot = [5 + phase, phase > 4 ? 2 : 0];
      s.backFoot = [-5 - phase, phase < -2 ? 2 : 0];
      s.hip = stand - (phase === 8 || phase === 0 ? 1 : 0);
      return s;
    }
    case 'crouch':
      return { ...guard(key.index === 0 ? Math.round((stand + crouchHip) / 2) : crouchHip, 2), frontFoot: [10, 0], backFoot: [-9, 0] };
    case 'block_stand':
      return { ...guard(stand, -1), frontHand: [10, shoulder(stand) + 4], backHand: [7, shoulder(stand) + 2] };
    case 'block_crouch':
    case 'blockstun_crouch':
      return { ...guard(crouchHip, -1), frontHand: [10, shoulder(crouchHip) + 3], backHand: [7, shoulder(crouchHip) + 1], frontFoot: [10, 0], backFoot: [-9, 0] };
    case 'blockstun_stand':
      return { ...guard(stand, -3), frontHand: [8, shoulder(stand) + 4], backHand: [5, shoulder(stand) + 2] };
    case 'dash_forward':
      return { ...guard(stand - 2, 4), frontFoot: [12 - key.index * 4, 2], backFoot: [-10, 0] };
    case 'backdash':
      return { ...guard(stand - 2, -4), frontFoot: [8, 0], backFoot: [-12 + key.index * 4, 2] };
    case 'phase_step':
      return { ...guard(stand - 3, -2 + key.index), frontFoot: [4, 3 - key.index], backFoot: [-4, 0] };
    case 'hitstun_high':
      return { ...guard(stand, -5 + key.index * 2), frontHand: [2, shoulder(stand) - 12], backHand: [-4, shoulder(stand) - 14] };
    case 'hitstun_mid':
      return { ...guard(stand - 4, 3 - key.index), frontHand: [6, shoulder(stand) - 18], backHand: [2, shoulder(stand) - 20], backFoot: [-10, 0] };
    case 'hitstun_low':
      return { ...guard(stand - 2, -2), frontFoot: [2, 4], backFoot: [-11, 0] };
    case 'airborne':
    case 'thrown':
      return { ...guard(stand, -6), lying: 18 + key.index * 4, frontHand: [8, 10], backHand: [4, 14] };
    case 'knockdown':
    case 'ko':
      return key.index === 0 ? { ...guard(stand - 8, -10) } : { ...guard(stand, 0), lying: 1 };
    case 'wake_up':
      return guard(Math.round(crouchHip + (stand - crouchHip) * t), Math.round(3 - 3 * t));
    case 'throw_break':
      return { ...guard(stand, 1), frontHand: [18 - key.index * 6, shoulder(stand) - 8], backHand: [14 - key.index * 6, shoulder(stand) - 8] };
    case 'wall_splat':
      return { ...guard(stand - key.index * 6, -3), frontHand: [-2, shoulder(stand) + 6], backHand: [-6, shoulder(stand) + 4] };
    case 'stagger':
      return { ...guard(stand - 5, 4 - (key.index % 2) * 2), frontHand: [8, shoulder(stand) - 22], backHand: [4, shoulder(stand) - 24] };
    case 'guard_break':
      return { ...guard(stand, -4), frontHand: [4, shoulder(stand) + 10], backHand: [-6, shoulder(stand) + 8] };
    case 'intro':
    case 'victory':
    case 'phase_transition': {
      const up = Math.round(10 * t);
      return { ...guard(stand, 0), frontHand: [8, shoulder(stand) - 8 + up], backHand: [-8, shoulder(stand) - 8 + up] };
    }
    default:
      return guard(stand, 0);
  }
}

function moveSkeleton(
  key: PoseKey,
  b: Body,
  guard: (hip: number, lean: number) => Skeleton,
  stand: number,
  crouchHip: number,
  shoulder: (hip: number) => number,
): Skeleton {
  const m = key.move as Move;
  const crouching = m.hurtboxOverrides.some((o) => o.h / 100 < b.height - 4);
  const hip = crouching ? crouchHip : stand;
  const lunges = m.movement.some((s) => s.dx > 0);
  const s = guard(hip, key.phase === 'startup' && lunges ? 3 : 0);
  if (crouching) {
    s.frontFoot = [10, 0];
    s.backFoot = [-9, 0];
  }
  // Where the attack lands, clamped inside the cell.
  const maxX = b.cell[0] - b.pivot[0] - 5; // room for the limb thickness and outline
  let tx: number;
  let ty: number;
  if (m.height === 'throw') {
    tx = Math.min(maxX, Math.round(m.throwRange / 100));
    ty = shoulder(hip) - 10;
  } else {
    const hb = m.hitboxes[0]!;
    tx = Math.min(maxX, Math.round((hb.x + hb.w) / 100));
    ty = Math.round((hb.y + hb.h / 2) / 100);
  }
  const reach = key.phase === 'impact' ? 1 : key.phase === 'recovery' ? 0.5 : 0;
  const lerp = (a: Pt, bb: Pt): Pt => [Math.round(a[0] + (bb[0] - a[0]) * reach), Math.round(a[1] + (bb[1] - a[1]) * reach)];
  const target: Pt = [tx, ty];
  const limb = m.limb;
  if (limb === 'left_arm' || limb === 'core') {
    const wind: Pt = [s.lean - 4, shoulder(hip) - 6];
    s.frontHand = key.phase === 'startup' ? wind : lerp(wind, target);
  }
  if (limb === 'right_arm' || limb === 'core') {
    const wind: Pt = [s.lean - 8, shoulder(hip) - 8];
    s.backHand = key.phase === 'startup' ? wind : lerp(wind, [target[0] - (limb === 'core' ? 4 : 0), target[1] + (limb === 'core' ? 4 : 0)]);
    if (limb === 'right_arm') s.forceLimb = 'right_arm';
  }
  if (limb === 'left_leg' || limb === 'right_leg') {
    const chamber: Pt = [6, Math.round(hip * 0.6)];
    const foot = key.phase === 'startup' ? chamber : lerp(chamber, target);
    if (limb === 'left_leg') s.frontFoot = foot;
    else s.backFoot = foot;
  }
  return s;
}

/** Turn a skeleton into outlined rectangles in cell coordinates (y down, origin top-left). */
function toRects(sk: Skeleton, b: Body): PoseRect[] {
  const p = proportions(b);
  const [px, py] = b.pivot;
  const out: PoseRect[] = [];
  // Pose space (x forward, y up) → cell space.
  const add = (x: number, y: number, w: number, h: number, shade: Shade) => {
    out.push({ x: px + x, y: py - (y + h), w: Math.max(1, w), h: Math.max(1, h), shade });
  };
  // An axis-aligned "L" from a to b: horizontal at a's height, then vertical at b's x.
  const seg = (a: Pt, c: Pt, t: number, shade: Shade) => {
    const h = t >> 1;
    add(Math.min(a[0], c[0]) - h, a[1] - h, Math.abs(c[0] - a[0]) + t, t, shade);
    add(c[0] - h, Math.min(a[1], c[1]) - h, t, Math.abs(c[1] - a[1]) + t, shade);
  };
  const limb = (from: Pt, to: Pt, joint: Pt, t: number, shade: Shade) => {
    seg(from, joint, t, shade);
    seg(joint, to, t, shade);
  };
  if (sk.lying > 0) {
    // Lying flat, centred on the pivot: head, torso, legs.
    const y = sk.lying - 1;
    const len = Math.min(b.cell[0] - 6, p.leg + p.torso + p.head);
    const x0 = -(len >> 1);
    const legLen = Math.round(len * 0.45);
    const torsoLen = Math.round(len * 0.38);
    add(x0 + torsoLen + p.head - 4, y, legLen, p.legW + 1, 'dark');
    add(x0 + p.head - 2, y, torsoLen, Math.max(8, p.torsoW - 4), 'base');
    add(x0, y + 1, p.head, p.headW - 1, 'light');
    add(x0 + p.head + 2, y + Math.max(8, p.torsoW - 4) - 1, Math.round(torsoLen * 0.6), p.arm, 'light');
    return outline(out);
  }
  const hip = sk.hip;
  const tw = p.torsoW;
  const shoulderY = hip + p.torso - 3;
  const knee = (hipX: number, foot: Pt): Pt => [Math.round((hipX + foot[0]) / 2) + 2, Math.round((hip + foot[1]) / 2)];
  const elbow = (sx: number, hand: Pt): Pt =>
    Math.abs(hand[0] - sx) > 12
      ? [Math.round((sx + hand[0]) / 2), Math.round((shoulderY + hand[1]) / 2)] // extended: straight-ish arm
      : [Math.round((sx + hand[0]) / 2) - 1, Math.min(shoulderY, hand[1]) - 4]; // guard: elbow tucked
  const has = (l: keyof Limbs) => b.limbs[l] || sk.forceLimb === l;
  const backHip = sk.lean - 3;
  const frontHip = sk.lean + 3;
  const backShoulder = sk.lean - (tw >> 1) + 3;
  const frontShoulder = sk.lean + (tw >> 1) - 3;
  // Back limbs first (darker), then torso and head, then front limbs.
  if (has('right_leg')) limb([backHip, hip], sk.backFoot, knee(backHip, sk.backFoot), p.legW, 'dark');
  if (has('right_arm')) limb([backShoulder, shoulderY], sk.backHand, elbow(backShoulder, sk.backHand), p.arm, 'dark');
  add(sk.lean - (tw >> 1), hip, tw, p.torso, 'base');
  add(sk.lean - (p.headW >> 1) + 1, hip + p.torso, p.headW, p.head, 'light');
  if (has('left_leg')) limb([frontHip, hip], sk.frontFoot, knee(frontHip, sk.frontFoot), p.legW, 'base');
  if (has('left_arm')) limb([frontShoulder, shoulderY], sk.frontHand, elbow(frontShoulder, sk.frontHand), p.arm, 'light');
  return outline(out);
}

/** Put a 1-pixel outline behind every rectangle. */
function outline(rects: PoseRect[]): PoseRect[] {
  return [...rects.map((r) => ({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2, shade: 'outline' as const })), ...rects];
}
