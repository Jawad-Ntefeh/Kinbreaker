/**
 * Rig: solves a pose (forward kinematics + two-bone IK) and composites the parts into a layered
 * pixel buffer. Each pixel keeps its material, shade step, bone and group for post-processing.
 */
import { pickVariant, type BoneDef, type Ink, type Legend, type Palette, type Part, type Pose, type Pt, type Skeleton } from './core';
import { rot, rotateGrid } from './rotsprite';

export interface Rig {
  name: string;
  pal: Palette;
  legend: Legend;
  parts: Map<string, Part[]>;
  skeleton: Skeleton;
}

export interface BoneState {
  def: BoneDef;
  index: number;
  /** World angle (degrees). */
  world: number;
  /** Joint position relative to the pivot (screen px, y down). */
  origin: Pt;
  part: Part;
}

/** Bones ordered so parents come first. */
export function orderedBones(sk: Skeleton): BoneDef[] {
  const done = new Set<string>();
  const out: BoneDef[] = [];
  const visit = (b: BoneDef) => {
    if (done.has(b.name)) return;
    if (b.parent) visit(sk.bones.find((p) => p.name === b.parent) ?? (() => { throw new Error(`bone ${b.name}: unknown parent ${b.parent}`); })());
    done.add(b.name);
    out.push(b);
  };
  sk.bones.forEach(visit);
  return out;
}

function variants(rig: Rig, part: string): Part[] {
  const v = rig.parts.get(part);
  if (!v) throw new Error(`${rig.name}: no part "${part}"`);
  return v;
}

/** Where a named tip of a placed part is (screen px relative to the pivot). */
export function tipOf(b: BoneState, tip: string): Pt {
  const t = b.part.tips[tip];
  if (!t) throw new Error(`part ${b.part.name}@${b.part.dir} has no tip "${tip}"`);
  const [dx, dy] = rot([t[0] - b.part.joint[0], t[1] - b.part.joint[1]], b.world - b.part.dir);
  return [b.origin[0] + dx, b.origin[1] + dy];
}

/** Length from a part's joint to one of its tips (rest variant). */
function lengthTo(rig: Rig, part: string, tip: string): number {
  const p = variants(rig, part)[0]!;
  const t = p.tips[tip];
  if (!t) throw new Error(`part ${part} has no tip "${tip}"`);
  return Math.hypot(t[0] - p.joint[0], t[1] - p.joint[1]);
}

const toAngle = ([dx, dy]: Pt) => (Math.atan2(dx, dy) * 180) / Math.PI;

/** Solve all bones for a pose. `extra` adds local angles (secondary motion). */
export function solve(rig: Rig, pose: Pose, extra: Record<string, number> = {}): Map<string, BoneState> {
  const sk = rig.skeleton;
  const bones = orderedBones(sk);
  const out = new Map<string, BoneState>();
  const ikWorld = new Map<string, number>();
  bones.forEach((def, index) => {
    const parent = def.parent ? out.get(def.parent)! : null;
    const origin: Pt = parent ? tipOf(parent, def.at!) : [sk.root[0] + pose.root[0], sk.root[1] + pose.root[1]];
    // Two-bone IK: when this bone starts a chain with a target, solve both bones of the chain.
    for (const [chainName, chain] of Object.entries(sk.ik)) {
      const target = pose.ik[chainName];
      if (!target || chain.upper !== def.name) continue;
      const lower = sk.bones.find((b) => b.name === chain.lower)!;
      const L1 = lengthTo(rig, def.part, lower.at!);
      const L2 = lengthTo(rig, lower.part, chain.end);
      const tx = target[0] - origin[0];
      const ty = target[1] - origin[1];
      const d = Math.min(L1 + L2 - 0.01, Math.max(Math.abs(L1 - L2) + 0.01, Math.hypot(tx, ty)));
      const base = Math.atan2(ty, tx);
      const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
      const cands = [base + alpha, base - alpha].map((t) => {
        const knee: Pt = [Math.cos(t) * L1, Math.sin(t) * L1];
        const end: Pt = [(tx / Math.hypot(tx, ty)) * d, (ty / Math.hypot(tx, ty)) * d];
        return { knee, upper: toAngle(knee), lower: toAngle([end[0] - knee[0], end[1] - knee[1]]) };
      });
      const pick = cands.sort((a, b) => {
        switch (chain.bend) {
          case 'forward': return b.knee[0] - a.knee[0];
          case 'back': return a.knee[0] - b.knee[0];
          case 'down': return b.knee[1] - a.knee[1];
          case 'up': return a.knee[1] - b.knee[1];
        }
      })[0]!;
      ikWorld.set(def.name, pick.upper);
      ikWorld.set(chain.lower, pick.lower);
    }
    const local = (def.rest ?? 0) + (pose.a[def.name] ?? 0) + (extra[def.name] ?? 0);
    const world = pose.w[def.name] ?? ikWorld.get(def.name) ?? (parent ? parent.world : 0) + local;
    const part = pickVariant(variants(rig, def.part), world, pose.v[def.name]);
    out.set(def.name, { def, index, world, origin, part });
  });
  return out;
}

// ---------------------------------------------------------------- layered buffer

export interface Layer {
  w: number;
  h: number;
  /** -1 = empty. */
  ramp: Int16Array;
  step: Int8Array;
  min: Int8Array;
  max: Int8Array;
  fixed: Uint8Array;
  bone: Int16Array;
  z: Int16Array;
  group: Int16Array;
}

export function newLayer(w: number, h: number): Layer {
  const n = w * h;
  return {
    w,
    h,
    ramp: new Int16Array(n).fill(-1),
    step: new Int8Array(n),
    min: new Int8Array(n),
    max: new Int8Array(n),
    fixed: new Uint8Array(n),
    bone: new Int16Array(n).fill(-1),
    z: new Int16Array(n).fill(-32768),
    group: new Int16Array(n).fill(-1),
  };
}

/** Composite a solved pose into a layer of size w x h with the pivot at `pivot`. */
export function compose(rig: Rig, bones: Map<string, BoneState>, w: number, h: number, pivot: Pt, hide: string[] = []): { layer: Layer; outside: number } {
  const layer = newLayer(w, h);
  const groups = [...new Set(rig.skeleton.bones.map((b) => b.group))];
  let outside = 0;
  const list = [...bones.values()].filter((b) => !hide.includes(b.def.name)).sort((a, b) => a.def.z - b.def.z || a.index - b.index);
  for (const b of list) {
    const { grid, joint } = rotateGrid(b.part.grid, b.part.joint, b.world - b.part.dir);
    const ox = Math.round(b.origin[0]) + pivot[0] - joint[0];
    const oy = Math.round(b.origin[1]) + pivot[1] - joint[1];
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const ch = grid.px[y * grid.w + x]!;
        if (ch === '.') continue;
        const ink: Ink | undefined = rig.legend.get(ch);
        if (!ink) throw new Error(`${rig.name}: part ${b.part.name} uses "${ch}", which is not in the legend`);
        const px = ox + x;
        const py = oy + y;
        if (px < 0 || py < 0 || px >= w || py >= h) {
          outside++;
          continue;
        }
        const i = py * w + px;
        layer.ramp[i] = ink.ramp;
        layer.step[i] = Math.max(ink.min, ink.step - (b.def.far && !ink.fixed ? 1 : 0));
        layer.min[i] = ink.min;
        layer.max[i] = ink.max;
        layer.fixed[i] = ink.fixed ? 1 : 0;
        layer.bone[i] = b.index;
        layer.z[i] = b.def.z;
        layer.group[i] = groups.indexOf(b.def.group);
      }
    }
  }
  return { layer, outside };
}
