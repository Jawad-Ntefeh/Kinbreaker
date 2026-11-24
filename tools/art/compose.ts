/**
 * `npm run art-compose`: builds a raw pose sheet from figure 1 of a model-drawn sheet by moving
 * that figure's own arm (or other limb) pixels: each segment is a polygon cut from the figure,
 * rotated about its pivot so its pivot→end direction points at the pose's angle; a child segment
 * (listed after its parent) hangs from the parent's end. Used where the image model cannot draw a
 * pose (Rook's one-armed jab). The output is an ordinary raw sheet: pose 1 is the untouched
 * figure (the scale anchor), and it goes through the same converter, checks and review.
 * Specs: art_src/<char>/compose/<sheet>.json.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { cropFigure, foregroundMask, splitFigures, type Rgba } from './convert';
import { readPng, ROOT } from './pipeline';

type Pt = [number, number];
interface Segment {
  polygon: Pt[];
  pivot: Pt;
  end: Pt;
  /** Cut the segment out of the body (else the body keeps its pixels and the moved copy is drawn behind). */
  remove: boolean;
}
interface Pose {
  name: string;
  /** Angle per segment, degrees (0 = forward, positive = down). */
  [segment: string]: unknown;
  /** Whole-figure upper body shift isn't possible; this shifts the moved segments only. */
  shift?: Pt;
}
interface Spec {
  source: string;
  out: string;
  segments: Record<string, Segment>;
  poses: Pose[];
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

/** Cut a segment's pixels into its own transparent image (same size as the figure). */
function cut(fig: Rgba, seg: Segment): Rgba {
  const out: Rgba = { w: fig.w, h: fig.h, data: new Uint8ClampedArray(fig.data.length) };
  for (let y = 0; y < fig.h; y++)
    for (let x = 0; x < fig.w; x++) {
      if (!inside([x + 0.5, y + 0.5], seg.polygon)) continue;
      const i = (y * fig.w + x) * 4;
      // Near-white edge pixels belong to the old background; moved inside the silhouette they
      // would snap to a pale colour.
      if (Math.min(fig.data[i]!, fig.data[i + 1]!, fig.data[i + 2]!) > 215) continue;
      out.data.set(fig.data.subarray(i, i + 4), i);
    }
  return out;
}

/** Draw `src` rotated by `rot` degrees about `from`, landing `from` at `to` (nearest neighbour). */
function drawRotated(dst: Rgba, src: Rgba, from: Pt, to: Pt, rot: number): void {
  const c = Math.cos(deg(-rot));
  const s = Math.sin(deg(-rot));
  for (let y = 0; y < dst.h; y++)
    for (let x = 0; x < dst.w; x++) {
      const dx = x + 0.5 - to[0];
      const dy = y + 0.5 - to[1];
      const sx = Math.floor(from[0] + dx * c - dy * s);
      const sy = Math.floor(from[1] + dx * s + dy * c);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const si = (sy * src.w + sx) * 4;
      if (src.data[si + 3]! < 128) continue;
      dst.data.set(src.data.subarray(si, si + 4), (y * dst.w + x) * 4);
    }
}

/** Draw `top` over `dst` where `top` is opaque. */
function over(dst: Rgba, top: Rgba, ox = 0, oy = 0): void {
  for (let y = 0; y < top.h; y++)
    for (let x = 0; x < top.w; x++) {
      const i = (y * top.w + x) * 4;
      if (top.data[i + 3]! < 128) continue;
      const X = x + ox;
      const Y = y + oy;
      if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
      dst.data.set(top.data.subarray(i, i + 4), (Y * dst.w + X) * 4);
    }
}

export function composeSheet(char: string, spec: Spec, write = true): Buffer {
  const img = readPng(join(ROOT, 'art_src', char, spec.source));
  const figs = splitFigures(foregroundMask(img), img.w, img.h);
  const fig = cropFigure(img, figs[0]!);
  const names = Object.keys(spec.segments);
  const parts = Object.fromEntries(names.map((n) => [n, cut(fig, spec.segments[n]!)]));
  // The body: the figure with the removed segments cut out.
  const body: Rgba = { w: fig.w, h: fig.h, data: new Uint8ClampedArray(fig.data) };
  for (const n of names) {
    if (!spec.segments[n]!.remove) continue;
    const p = parts[n]!;
    for (let i = 0; i < p.data.length; i += 4) if (p.data[i + 3]! >= 128) body.data[i + 3] = 0;
  }
  // Room in front for the strike, behind for the braid.
  const padL = 40;
  const padR = Math.round(fig.w * 0.9);
  const cellW = fig.w + padL + padR;
  const frames: Rgba[] = [fig, ...spec.poses.map((pose) => {
    const f: Rgba = { w: fig.w + padR, h: fig.h, data: new Uint8ClampedArray((fig.w + padR) * fig.h * 4) };
    const shift = pose.shift ?? [0, 0];
    // Segments chain: each one's pivot lands on the previous segment's moved end.
    let at: Pt = [spec.segments[names[0]!]!.pivot[0] + shift[0], spec.segments[names[0]!]!.pivot[1] + shift[1]];
    const arm: Rgba = { w: f.w, h: f.h, data: new Uint8ClampedArray(f.data.length) };
    for (const n of names) {
      const seg = spec.segments[n]!;
      const target = pose[n] as number;
      const rot = target - angleOf(seg.pivot, seg.end);
      drawRotated(arm, parts[n]!, seg.pivot, at, rot);
      const len = Math.hypot(seg.end[0] - seg.pivot[0], seg.end[1] - seg.pivot[1]);
      at = [at[0] + len * Math.cos(deg(target)), at[1] + len * Math.sin(deg(target))];
    }
    // Far arm: behind the body.
    over(f, arm);
    over(f, body);
    return f;
  })];
  const W = frames.length * cellW + padL;
  const H = fig.h + 80;
  // Transparent background: gaps the moved limb opens inside the silhouette stay empty (on white
  // they would be kept as enclosed pale areas).
  const png = new PNG({ width: W, height: H });
  png.data.fill(0);
  frames.forEach((fr, i) => {
    const dst: Rgba = { w: W, h: H, data: png.data as unknown as Uint8ClampedArray };
    over(dst, fr, padL + i * cellW, 40);
  });
  const bytes = PNG.sync.write(png);
  if (write) writeFileSync(join(ROOT, 'art_src', char, spec.out), bytes);
  return bytes;
}

/** Every compose spec: [character, file name, spec]. */
export function composeSpecs(): [string, string, Spec][] {
  const out: [string, string, Spec][] = [];
  for (const char of readdirSync(join(ROOT, 'art_src')).filter((d) => existsSync(join(ROOT, 'art_src', d, 'compose'))))
    for (const f of readdirSync(join(ROOT, 'art_src', char, 'compose')).filter((f) => f.endsWith('.json')))
      out.push([char, f, JSON.parse(readFileSync(join(ROOT, 'art_src', char, 'compose', f), 'utf8')) as Spec]);
  return out;
}

if (process.argv[1]?.endsWith('compose.ts')) {
  for (const [char, f, spec] of composeSpecs()) {
    composeSheet(char, spec);
    console.log(`${char}: ${f} → art_src/${char}/${spec.out}`);
  }
}
