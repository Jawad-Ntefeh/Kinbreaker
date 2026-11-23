/**
 * Post-processing of a composed frame:
 *   1. cleanup: remove orphan pixels and single-pixel colour noise left by rotation;
 *   2. lighting from the upper left: each part's upper-left edge one step lighter, lower-right
 *      edge one step darker (fixed details untouched), so light is consistent in every pose;
 *   3. inner lines where one group overlaps another, in the darkest step of the darker colour;
 *   4. a 1 px outline around the whole silhouette (outside edge only, 4-connected, so there are
 *      no doubled corners), then a pass that removes any outline pixel not touching the body.
 * The result uses palette colours only, fully opaque or fully transparent.
 */
import { hexToRgb, type Palette } from './core';
import type { Layer } from './rig';

export interface Frame {
  w: number;
  h: number;
  /** Hex colour per pixel, '' = transparent. */
  px: string[];
}

const N4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function cleanup(l: Layer): number {
  let fixedCount = 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= l.w || y >= l.h ? -1 : y * l.w + x);
  // Orphans: a pixel with no 4-neighbours.
  for (let y = 0; y < l.h; y++) {
    for (let x = 0; x < l.w; x++) {
      const i = at(x, y);
      if (l.ramp[i]! < 0) continue;
      if (N4.every(([dx, dy]) => {
        const j = at(x + dx, y + dy);
        return j < 0 || l.ramp[j]! < 0;
      })) {
        l.ramp[i] = -1;
        l.bone[i] = -1;
        fixedCount++;
      }
    }
  }
  // Noise: a non-fixed pixel whose four neighbours agree with each other but not with it.
  for (let y = 1; y < l.h - 1; y++) {
    for (let x = 1; x < l.w - 1; x++) {
      const i = at(x, y);
      if (l.ramp[i]! < 0 || l.fixed[i]) continue;
      const ns = N4.map(([dx, dy]) => at(x + dx, y + dy));
      const key = (j: number) => `${l.ramp[j]}:${l.step[j]}:${l.bone[j]}`;
      const k0 = key(ns[0]!);
      if (l.ramp[ns[0]!]! >= 0 && ns.every((j) => key(j) === k0) && key(i) !== k0) {
        const j = ns[0]!;
        l.ramp[i] = l.ramp[j]!;
        l.step[i] = l.step[j]!;
        l.min[i] = l.min[j]!;
        l.max[i] = l.max[j]!;
        l.bone[i] = l.bone[j]!;
        l.group[i] = l.group[j]!;
        l.z[i] = l.z[j]!;
        fixedCount++;
      }
    }
  }
  return fixedCount;
}

/** Upper-left light: edges facing up/left are lit, edges facing down/right are shaded. */
export function light(l: Layer): void {
  // Regions are parts: an edge is lit or shaded where it meets empty space or another part,
  // not where two materials of the same part meet (a face doesn't get lit against its own hair).
  const region = (i: number) => (l.ramp[i]! < 0 ? -1 : l.bone[i]!);
  const steps = new Int8Array(l.step);
  for (let y = 0; y < l.h; y++) {
    for (let x = 0; x < l.w; x++) {
      const i = y * l.w + x;
      if (l.ramp[i]! < 0 || l.fixed[i]) continue;
      const r = region(i);
      const other = (dx: number, dy: number) => {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= l.w || yy >= l.h) return true;
        return region(yy * l.w + xx) !== r;
      };
      const lit = other(-1, 0) || other(0, -1);
      const shade = other(1, 0) || other(0, 1);
      let s = l.step[i]!;
      if (lit && !shade) s += 1;
      else if (shade && !lit) s -= 1;
      steps[i] = Math.max(l.min[i]!, Math.min(l.max[i]!, s));
    }
  }
  l.step.set(steps);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Inner lines where a part overlaps a part of another group behind it. */
export function innerLines(l: Layer, pal: Palette): void {
  const marks: [number, number][] = [];
  for (let y = 0; y < l.h; y++) {
    for (let x = 0; x < l.w; x++) {
      const i = y * l.w + x;
      if (l.ramp[i]! < 0) continue;
      for (const [dx, dy] of N4) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= l.w || yy >= l.h) continue;
        const j = yy * l.w + xx;
        if (l.ramp[j]! < 0 || l.group[j] === l.group[i] || l.z[j]! >= l.z[i]!) continue;
        // This pixel is the front part's edge over a part behind it.
        const a = pal.hex(l.ramp[i]!, l.step[i]!);
        const b = pal.hex(l.ramp[j]!, l.step[j]!);
        marks.push([i, luminance(a) <= luminance(b) ? l.ramp[i]! : l.ramp[j]!]);
        break;
      }
    }
  }
  for (const [i, ramp] of marks) {
    l.ramp[i] = ramp;
    l.step[i] = 0;
    l.fixed[i] = 1;
  }
}

export function toFrame(l: Layer, pal: Palette): Frame {
  const px = new Array<string>(l.w * l.h).fill('');
  for (let i = 0; i < px.length; i++) if (l.ramp[i]! >= 0) px[i] = pal.hex(l.ramp[i]!, l.step[i]!);
  // Outline: transparent pixels 4-adjacent to the body.
  const body = (x: number, y: number) => x >= 0 && y >= 0 && x < l.w && y < l.h && l.ramp[y * l.w + x]! >= 0;
  for (let y = 0; y < l.h; y++) {
    for (let x = 0; x < l.w; x++) {
      if (body(x, y)) continue;
      if (N4.some(([dx, dy]) => body(x + dx, y + dy))) px[y * l.w + x] = pal.outline;
    }
  }
  return { w: l.w, h: l.h, px };
}

/** Problems a finished frame must not have. */
export function checkFrame(f: Frame, pal: Palette): string[] {
  const allowed = new Set(Object.values(pal.ramps).flat());
  const problems: string[] = [];
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? '' : f.px[y * f.w + x]!);
  let orphans = 0;
  let badOutline = 0;
  let open = 0;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const c = at(x, y);
      if (!c) continue;
      if (!allowed.has(c)) problems.push(`colour ${c} at ${x},${y} is not in the palette`);
      const ns = N4.map(([dx, dy]) => at(x + dx, y + dy));
      if (c === pal.outline) {
        if (!ns.some((n) => n && n !== pal.outline)) badOutline++;
      } else {
        if (ns.every((n) => !n || n === pal.outline) && ns.filter((n) => n === pal.outline).length === 4) orphans++;
        if (ns.some((n) => !n)) open++; // body pixel touching transparency = broken outline
      }
    }
  }
  if (orphans) problems.push(`${orphans} orphan pixels`);
  if (badOutline) problems.push(`${badOutline} outline pixels not touching the body (double outline)`);
  if (open) problems.push(`${open} body pixels without an outline`);
  if (f.px[0] || f.px[f.w - 1] || f.px[(f.h - 1) * f.w]) problems.push('touches the cell corners');
  return problems;
}

export function finish(l: Layer, pal: Palette): Frame {
  cleanup(l);
  light(l);
  innerLines(l, pal);
  return toFrame(l, pal);
}
