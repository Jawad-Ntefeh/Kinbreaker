/**
 * `npm run art-compose`: builds raw pose sheets for moves the image model can't draw (Rook's
 * one-armed attacks) from ONE compose base: figure 1 of an approved model-drawn sheet
 * (art_src/<char>/compose/base.json). Every pixel is model-drawn; code only places them:
 *   - arm segments (polygons) rotate about their pivots, chained (the forearm hangs from the
 *     upper arm's end); the far arm is drawn behind the body;
 *   - body_dx / body_dy shift everything above the waist line (blended over `waist_blend` rows
 *     so the belt has no step), head_dy shifts the head on top of that;
 *   - lagging parts (braid, coat tail) bend from their root: the root follows what it hangs from,
 *     the tip follows the body shift of 2 frames earlier.
 * Pose 1 of the output is the untouched base figure (the scale anchor). The output is an
 * ordinary raw sheet: same converter, checks and review. Specs: art_src/<char>/compose/*.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { imageId } from './consistency';
import { cropFigure, foregroundMask, splitFigures, type Rgba } from './convert';
import { readPng, ROOT } from './pipeline';

type Pt = [number, number];
const SPRITE_HEIGHT = 108;
/** Lagging parts follow the body shift of this many frames (poses) earlier. */
export const LAG_FRAMES = 2;

interface Segment {
  polygon: Pt[];
  pivot: Pt;
  end: Pt;
  /** Cut out of the body (else the body keeps its pixels and the moved copy is drawn behind). */
  remove: boolean;
}
interface Lagging {
  polygon: Pt[];
  root: Pt;
  tip: Pt;
  /** What the root is attached to: "head" (moves with the head) or "none" (lower body, still). */
  follows: 'head' | 'none';
}
export interface ComposeBase {
  source: string;
  figure: number;
  image: string;
  waist_y: number;
  waist_blend: number;
  neck_y: number;
  head: Pt[];
  lag: Record<string, Lagging>;
  arm: Record<string, Segment>;
}
export interface ComposePose {
  name: string;
  /** Angle per arm segment, degrees (0 = forward, positive = down). */
  [segment: string]: unknown;
  body_dx?: number;
  body_dy?: number;
  head_dy?: number;
}
export interface ComposeSpec {
  base: string;
  out: string;
  /** A looping animation: the lag wraps around (the first frames lag behind the last ones). */
  loop?: boolean;
  poses: ComposePose[];
}

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const deg = (a: number) => (a * Math.PI) / 180;
const angleOf = (a: Pt, b: Pt) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const blank = (w: number, h: number): Rgba => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });

/** Move a polygon's pixels out of `from` into a new layer (or copy them when `remove` is false). */
function cut(from: Rgba, poly: Pt[], remove: boolean, skipPale = false): Rgba {
  const out = blank(from.w, from.h);
  for (let y = 0; y < from.h; y++)
    for (let x = 0; x < from.w; x++) {
      if (!inside([x + 0.5, y + 0.5], poly)) continue;
      const i = (y * from.w + x) * 4;
      if (from.data[i + 3]! < 128) continue;
      // Near-white edge pixels belong to the old background.
      if (!(skipPale && Math.min(from.data[i]!, from.data[i + 1]!, from.data[i + 2]!) > 215)) out.data.set(from.data.subarray(i, i + 4), i);
      if (remove) from.data[i + 3] = 0;
    }
  return out;
}

/** Draw `src` into `dst` through an inverse map: destination (x, y) → source point. */
function drawMapped(dst: Rgba, src: Rgba, map: (x: number, y: number) => Pt): void {
  for (let y = 0; y < dst.h; y++)
    for (let x = 0; x < dst.w; x++) {
      const [sx, sy] = map(x + 0.5, y + 0.5);
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= src.w || iy >= src.h) continue;
      const si = (iy * src.w + ix) * 4;
      if (src.data[si + 3]! < 128) continue;
      dst.data.set(src.data.subarray(si, si + 4), (y * dst.w + x) * 4);
    }
}

export function loadBase(char: string, file: string): ComposeBase {
  return JSON.parse(readFileSync(join(ROOT, 'art_src', char, 'compose', file), 'utf8')) as ComposeBase;
}

export function composeSheet(char: string, spec: ComposeSpec, write = true): Buffer {
  const base = loadBase(char, spec.base);
  const srcFile = join(ROOT, 'art_src', char, base.source);
  const bytes = readFileSync(srcFile);
  if (imageId(bytes) !== base.image) throw new Error(`${base.source} changed (fingerprint ${imageId(bytes)}, base.json has ${base.image}): re-fit art_src/${char}/compose/${spec.base}`);
  const img = readPng(srcFile);
  const fig = cropFigure(img, splitFigures(foregroundMask(img), img.w, img.h)[base.figure]!);
  /** Figure pixels per sprite pixel. */
  const k = fig.h / SPRITE_HEIGHT;

  // Layers. Order of cutting matters: lagging parts and the head come out of the body first.
  const body: Rgba = { w: fig.w, h: fig.h, data: new Uint8ClampedArray(fig.data) };
  const armNames = Object.keys(base.arm);
  const arm = Object.fromEntries(armNames.map((n) => [n, cut(body, base.arm[n]!.polygon, base.arm[n]!.remove, true)]));
  const lagNames = Object.keys(base.lag);
  const lag = Object.fromEntries(lagNames.map((n) => [n, cut(body, base.lag[n]!.polygon, true)]));
  const head = cut(body, base.head, true);
  // Upper body = everything left above the waist; lower body = the rest.
  const upper = blank(fig.w, fig.h);
  const lower = blank(fig.w, fig.h);
  for (let i = 0; i < fig.w * fig.h; i++) {
    const y = (i / fig.w) | 0;
    (y < base.waist_y ? upper : lower).data.set(body.data.subarray(i * 4, i * 4 + 4), i * 4);
  }
  /** How much of the body shift a row above the waist gets (1 well above, 0 at the waist). */
  const weight = (y: number) => Math.max(0, Math.min(1, (base.waist_y - y) / base.waist_blend));

  const padL = Math.round(fig.w * 0.15);
  const padR = Math.round(fig.w * 0.9);
  const cellW = fig.w + padL + padR;
  const shifts = spec.poses.map((p) => [Math.round((p.body_dx ?? 0) * k), Math.round((p.body_dy ?? 0) * k)] as Pt);
  const frames: Rgba[] = [fig, ...spec.poses.map((pose, i) => {
    const f = blank(fig.w + padR, fig.h + padL);
    const [bx, by] = shifts[i]!;
    const hy = Math.round((pose.head_dy ?? 0) * k);
    const late = i >= LAG_FRAMES ? shifts[i - LAG_FRAMES]! : spec.loop ? shifts[(i - LAG_FRAMES + shifts.length) % shifts.length]! : ([0, 0] as Pt);
    // Far arm, behind everything: chained segments from the shifted shoulder.
    const first = base.arm[armNames[0]!]!;
    let at: Pt = [first.pivot[0] + bx, first.pivot[1] + by];
    for (const n of armNames) {
      const seg = base.arm[n]!;
      // An arm segment without an angle in the pose stays as drawn in the base.
      const target = (pose[n] as number | undefined) ?? angleOf(seg.pivot, seg.end);
      const rot = deg(-(target - angleOf(seg.pivot, seg.end)));
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const pivotAt = at;
      drawMapped(f, arm[n]!, (x, y) => {
        const dx = x - pivotAt[0];
        const dy = y - pivotAt[1];
        return [seg.pivot[0] + dx * c - dy * s, seg.pivot[1] + dx * s + dy * c];
      });
      const len = Math.hypot(seg.end[0] - seg.pivot[0], seg.end[1] - seg.pivot[1]);
      at = [at[0] + len * Math.cos(deg(target)), at[1] + len * Math.sin(deg(target))];
    }
    // Lower body (still), lagging parts, upper body (shifted, blended at the waist), head.
    drawMapped(f, lower, (x, y) => [x, y]);
    for (const n of lagNames) {
      const L = base.lag[n]!;
      const rootShift: Pt = L.follows === 'head' ? [bx, by + hy] : [0, 0];
      const axis: Pt = [L.tip[0] - L.root[0], L.tip[1] - L.root[1]];
      const len2 = axis[0] * axis[0] + axis[1] * axis[1];
      drawMapped(f, lag[n]!, (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - L.root[0]) * axis[0] + (y - L.root[1]) * axis[1]) / len2));
        return [x - (rootShift[0] + (late[0] - rootShift[0]) * t), y - (rootShift[1] + (late[1] - rootShift[1]) * t)];
      });
    }
    drawMapped(f, upper, (x, y) => {
      // Solve y = y' + by * w(y') for the source row y' (two fixed-point steps are plenty).
      let sy = y - by * weight(y);
      sy = y - by * weight(sy);
      return [x - bx * weight(sy), sy];
    });
    drawMapped(f, head, (x, y) => [x - bx, y - by - hy]);
    return f;
  })];

  const W = frames.length * cellW + padL;
  const H = fig.h + padL * 2;
  // Transparent background: gaps the moved parts open inside the silhouette stay empty.
  const png = new PNG({ width: W, height: H });
  png.data.fill(0);
  const dst = png.data as unknown as Uint8ClampedArray;
  frames.forEach((fr, n) => {
    for (let y = 0; y < fr.h; y++)
      for (let x = 0; x < fr.w; x++) {
        const i = (y * fr.w + x) * 4;
        if (fr.data[i + 3]! < 128) continue;
        const X = padL + n * cellW + x;
        const Y = padL + y;
        if (X < W && Y < H) dst.set(fr.data.subarray(i, i + 4), (Y * W + X) * 4);
      }
  });
  const out = PNG.sync.write(png);
  if (write) writeFileSync(join(ROOT, 'art_src', char, spec.out), out);
  return out;
}

/** Every compose spec (base.json excluded): [character, file name, spec]. */
export function composeSpecs(): [string, string, ComposeSpec][] {
  const out: [string, string, ComposeSpec][] = [];
  for (const char of readdirSync(join(ROOT, 'art_src')).filter((d) => existsSync(join(ROOT, 'art_src', d, 'compose'))))
    for (const f of readdirSync(join(ROOT, 'art_src', char, 'compose')).filter((f) => f.endsWith('.json') && f !== 'base.json'))
      out.push([char, f, JSON.parse(readFileSync(join(ROOT, 'art_src', char, 'compose', f), 'utf8')) as ComposeSpec]);
  return out;
}

if (process.argv[1]?.endsWith('compose.ts')) {
  for (const [char, f, spec] of composeSpecs()) {
    composeSheet(char, spec);
    console.log(`${char}: ${f} → art_src/${char}/${spec.out}`);
  }
}
