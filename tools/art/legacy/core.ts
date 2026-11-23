/**
 * Art toolkit core: palette, legends, parts, skeletons and poses (all loaded from art_src/).
 *
 * Angles: 0 = pointing down (the way limbs hang), 90 = pointing forward (+x, the way the
 * character faces), 180 = up, -90 = back. A vector (x, y) in screen space (y down) rotated by
 * `a` degrees becomes (x cos a + y sin a, -x sin a + y cos a), so (0, 1) → (sin a, cos a).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type Pt = [number, number];

export const ROOT = process.cwd();
/** Legacy (Part A) rig sources. */
export const SRC = join(ROOT, 'tools/art/legacy/art_src');

// ---------------------------------------------------------------- palette

export interface Palette {
  ramps: Record<string, string[]>;
  /** Index of each ramp name (stable order). */
  rampIds: Map<string, number>;
  rampNames: string[];
  hex(ramp: number, step: number): string;
  outline: string;
}

export function loadPalette(): Palette {
  const raw = JSON.parse(readFileSync(join(SRC, 'palette.json'), 'utf8')) as { ramps: Record<string, string[]> };
  const rampNames = Object.keys(raw.ramps);
  const rampIds = new Map(rampNames.map((n, i) => [n, i]));
  return {
    ramps: raw.ramps,
    rampIds,
    rampNames,
    hex: (r, s) => {
      const ramp = raw.ramps[rampNames[r]!]!;
      return ramp[Math.max(0, Math.min(ramp.length - 1, s))]!;
    },
    outline: raw.ramps.outline![0]!,
  };
}

export function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- legend

/** What one character in a part map means. */
export interface Ink {
  ramp: number;
  step: number;
  /** Shading stays within [min, max] of the ramp. */
  min: number;
  max: number;
  /** Fixed details (eyes, scar, rivets) are never re-lit. */
  fixed: boolean;
  /** Material key for lighting regions (ramp name + min/max). */
  mat: string;
}

export type Legend = Map<string, Ink>;

export function loadLegend(char: string, pal: Palette): Legend {
  const raw = JSON.parse(readFileSync(join(SRC, char, 'legend.json'), 'utf8')) as Record<string, { ramp: string; step: number; min?: number; max?: number; fixed?: boolean }>;
  const out: Legend = new Map();
  for (const [ch, e] of Object.entries(raw)) {
    if (ch.startsWith('_')) continue;
    const r = pal.rampIds.get(e.ramp);
    if (r === undefined) throw new Error(`art_src/${char}/legend.json: "${ch}" uses unknown ramp "${e.ramp}"`);
    const len = pal.ramps[e.ramp]!.length;
    const min = e.min ?? 0;
    const max = e.max ?? len - 1;
    out.set(ch, { ramp: r, step: e.step, min, max, fixed: e.fixed ?? false, mat: `${e.ramp}:${min}-${max}` });
  }
  return out;
}

// ---------------------------------------------------------------- parts

/** A pixel grid of legend characters ('.' = transparent). */
export interface Grid {
  w: number;
  h: number;
  px: string[]; // row-major, one char per pixel
}

export interface Part {
  /** Base name, e.g. "forearm_l". */
  name: string;
  /** Direction the part was drawn pointing (see the angle convention). */
  dir: number;
  grid: Grid;
  joint: Pt;
  tips: Record<string, Pt>;
  /** Drawn by hand (false = an exact quarter-turn copy made by the toolkit). */
  drawn: boolean;
}

export function gridAt(g: Grid, x: number, y: number): string {
  return x < 0 || y < 0 || x >= g.w || y >= g.h ? '.' : g.px[y * g.w + x]!;
}

/**
 * Part file: directives, then "---", then the pixel rows.
 *   joint X Y          where the part attaches to its parent
 *   tip NAME X Y       where children attach
 *   quarter            also make exact 90/180/270-degree copies (pixel-perfect, for cylinders)
 * The file name is NAME.txt or NAME@DIR.txt (the direction it was drawn pointing).
 */
export function parsePart(file: string, text: string): Part[] {
  const base = file.replace(/\.txt$/, '');
  const [name, dirS] = base.split('@');
  const [head, body] = text.split(/^---\s*$/m);
  if (body === undefined) throw new Error(`${file}: missing "---" before the pixel rows`);
  const rows = body.split('\n').map((r) => r.replace(/\s+$/, ''));
  while (rows.length && rows[0] === '') rows.shift();
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  const w = Math.max(...rows.map((r) => r.length));
  const px = rows.flatMap((r) => r.padEnd(w, '.').split(''));
  let joint: Pt | null = null;
  const tips: Record<string, Pt> = {};
  let quarter = false;
  for (const line of head!.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))) {
    const p = line.split(/\s+/);
    if (p[0] === 'joint') joint = [Number(p[1]), Number(p[2])];
    else if (p[0] === 'tip') tips[p[1]!] = [Number(p[2]), Number(p[3])];
    else if (p[0] === 'quarter') quarter = true;
    else throw new Error(`${file}: unknown directive "${line}"`);
  }
  if (!joint) throw new Error(`${file}: needs a "joint X Y" line`);
  const part: Part = { name: name!, dir: dirS ? Number(dirS) : 0, grid: { w, h: rows.length, px }, joint, tips, drawn: true };
  const out = [part];
  if (quarter) for (const q of [1, 2, 3]) out.push(quarterTurn(part, q));
  return out;
}

/** Exact rotation by q quarter turns in the angle convention (+90 each), with points mapped. */
export function quarterTurn(p: Part, q: number): Part {
  let g = p.grid;
  let pts: Pt[] = [p.joint, ...Object.values(p.tips)];
  for (let i = 0; i < q; i++) {
    // (x, y) → (y, w-1-x): turns a down-pointing image to point forward (+90).
    const ng: Grid = { w: g.h, h: g.w, px: new Array(g.w * g.h) };
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) ng.px[(g.w - 1 - x) * ng.w + y] = gridAt(g, x, y);
    pts = pts.map(([x, y]) => [y, g.w - 1 - x]);
    g = ng;
  }
  const names = Object.keys(p.tips);
  return {
    name: p.name,
    dir: (((p.dir + 90 * q) % 360) + 540) % 360 - 180,
    grid: g,
    joint: pts[0]!,
    tips: Object.fromEntries(names.map((n, i) => [n, pts[i + 1]!])),
    drawn: false,
  };
}

/** All parts of a character, grouped by base name (variants sorted by direction). */
export function loadParts(char: string): Map<string, Part[]> {
  const dir = join(SRC, char, 'parts');
  const out = new Map<string, Part[]>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
    for (const p of parsePart(f, readFileSync(join(dir, f), 'utf8'))) {
      const list = out.get(p.name) ?? [];
      // A hand-drawn variant always wins over a generated quarter turn in the same direction.
      const same = list.findIndex((o) => angleDiff(o.dir, p.dir) === 0);
      if (same >= 0) {
        if (p.drawn) list[same] = p;
      } else list.push(p);
      out.set(p.name, list);
    }
  }
  return out;
}

export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** The variant drawn closest to the wanted direction. */
export function pickVariant(variants: Part[], world: number, forced?: number): Part {
  if (forced !== undefined) {
    const f = variants.find((v) => angleDiff(v.dir, forced) === 0);
    if (f) return f;
  }
  return variants.reduce((best, v) => (angleDiff(v.dir, world) < angleDiff(best.dir, world) ? v : best));
}

// ---------------------------------------------------------------- skeleton and poses

export interface BoneDef {
  name: string;
  part: string;
  parent?: string;
  /** Tip of the parent part this bone attaches to. */
  at?: string;
  z: number;
  /** Inner lines are drawn where one group overlaps another. */
  group: string;
  /** Far-side limbs are drawn one shade darker. */
  far?: boolean;
  /** Rest local angle (degrees). */
  rest?: number;
  /** Secondary motion (coat tails, braid): angle follows the body with a lag. */
  secondary?: Secondary;
}

export interface Secondary {
  /** Frames of lag (2-4). */
  lag: number;
  /** Local angle at rest. */
  base: number;
  /** Degrees per px/frame of horizontal root speed (positive = trails backward). */
  speed?: number;
  /** Degrees per px of lagged vertical bob. */
  bob?: number;
  /** Fraction of the parent's lagged angle change that carries over. */
  inherit?: number;
  /** Copy another bone's local angle (e.g. the front coat panel follows the front thigh). */
  copy?: string;
  mix?: number;
}

export interface IkChain {
  upper: string;
  lower: string;
  /** Which way the middle joint bends: knees forward, elbows down/back. */
  bend: 'forward' | 'back' | 'down' | 'up';
  /** Tip of the lower part that reaches the target (ankle, wrist). */
  end: string;
}

export interface Skeleton {
  /** Position of the root bone's joint relative to the pivot (screen px, y down). */
  root: Pt;
  bones: BoneDef[];
  ik: Record<string, IkChain>;
  /** Move-data limb → bones that strike with it (for smears and the hitbox check). */
  limbs?: Record<string, string[]>;
}

export interface Pose {
  root: Pt;
  /** Local angles. */
  a: Record<string, number>;
  /** World angles (override), e.g. feet kept flat. */
  w: Record<string, number>;
  /** IK targets relative to the pivot (screen px). */
  ik: Record<string, Pt>;
  /** Forced variant direction per bone. */
  v: Record<string, number>;
  /** Hide bones. */
  hide: string[];
}

export function loadSkeleton(char: string): Skeleton {
  return JSON.parse(readFileSync(join(SRC, char, 'skeleton.json'), 'utf8')) as Skeleton;
}

type RawPose = Partial<Pose> & { from?: string };

/** Poses with "from" inheritance resolved. */
export function loadPoses(char: string): Map<string, Pose> {
  const file = join(SRC, char, 'poses.json');
  const raw = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, RawPose>) : {};
  const out = new Map<string, Pose>();
  const resolve = (name: string, seen: string[] = []): Pose => {
    const done = out.get(name);
    if (done) return done;
    const r = raw[name];
    if (!r) throw new Error(`art_src/${char}/poses.json: no pose "${name}"`);
    if (seen.includes(name)) throw new Error(`pose inheritance loop: ${[...seen, name].join(' → ')}`);
    const base: Pose = r.from ? resolve(r.from, [...seen, name]) : { root: [0, 0], a: {}, w: {}, ik: {}, v: {}, hide: [] };
    const p: Pose = {
      root: r.root ?? base.root,
      a: { ...base.a, ...(r.a ?? {}) },
      w: { ...base.w, ...(r.w ?? {}) },
      ik: { ...base.ik, ...(r.ik ?? {}) },
      v: { ...base.v, ...(r.v ?? {}) },
      hide: r.hide ?? base.hide,
    };
    out.set(name, p);
    return p;
  };
  for (const k of Object.keys(raw)) if (!k.startsWith('_')) resolve(k);
  return out;
}

/** Linear blend of two poses (angles, root, IK targets). */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const mix = (x: number, y: number) => x + (y - x) * t;
  const keys = (o1: Record<string, unknown>, o2: Record<string, unknown>) => [...new Set([...Object.keys(o1), ...Object.keys(o2)])];
  const ang = (o1: Record<string, number>, o2: Record<string, number>) =>
    Object.fromEntries(keys(o1, o2).map((k) => [k, mix(o1[k] ?? o2[k] ?? 0, o2[k] ?? o1[k] ?? 0)]));
  return {
    root: [mix(a.root[0], b.root[0]), mix(a.root[1], b.root[1])],
    a: ang(a.a, b.a),
    w: ang(a.w, b.w),
    ik: Object.fromEntries(keys(a.ik, b.ik).map((k) => {
      const p = a.ik[k] ?? b.ik[k]!;
      const q = b.ik[k] ?? a.ik[k]!;
      return [k, [mix(p[0], q[0]), mix(p[1], q[1])] as Pt];
    })),
    v: t < 0.5 ? a.v : b.v,
    hide: t < 0.5 ? a.hide : b.hide,
  };
}
