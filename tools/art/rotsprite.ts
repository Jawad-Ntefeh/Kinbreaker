/**
 * RotSprite rotation: upscale x8 with Scale2x (three times), rotate with nearest neighbour about
 * the joint, then downscale by taking the most common colour in each 8x8 block. Pixel art keeps
 * clean edges this way; never use smooth or bilinear rotation.
 */
import { gridAt, type Grid, type Pt } from './core';

export function scale2x(g: Grid): Grid {
  const out: Grid = { w: g.w * 2, h: g.h * 2, px: new Array(g.w * g.h * 4) };
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      // Outside the grid counts as the edge pixel itself, so part corners aren't eroded.
      const at = (xx: number, yy: number) => gridAt(g, Math.max(0, Math.min(g.w - 1, xx)), Math.max(0, Math.min(g.h - 1, yy)));
      const P = at(x, y);
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      const e0 = C === A && C !== D && A !== B ? A : P;
      const e1 = A === B && A !== C && B !== D ? B : P;
      const e2 = D === C && D !== B && C !== A ? C : P;
      const e3 = B === D && B !== A && D !== C ? D : P;
      const o = y * 2 * out.w + x * 2;
      out.px[o] = e0;
      out.px[o + 1] = e1;
      out.px[o + out.w] = e2;
      out.px[o + out.w + 1] = e3;
    }
  }
  return out;
}

/** Rotate vector (x, y) by `deg` in the art angle convention. */
export function rot([x, y]: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + y * s, -x * s + y * c];
}

/**
 * Rotate a grid by `deg` about its joint pixel. Returns the rotated grid and where the joint
 * pixel ended up. Quarter turns are exact; anything else goes through RotSprite.
 */
export function rotateGrid(g: Grid, joint: Pt, deg: number): { grid: Grid; joint: Pt } {
  const d = Math.round(deg * 100) / 100;
  if (Math.abs(d) < 0.5) return { grid: g, joint };
  const up = scale2x(scale2x(scale2x(g)));
  const S = 8;
  const cx = joint[0] * S + S / 2;
  const cy = joint[1] * S + S / 2;
  // Bounding box of the rotated part, in output pixels relative to the joint.
  const corners: Pt[] = [
    [-joint[0] - 0.5, -joint[1] - 0.5],
    [g.w - joint[0] - 0.5, -joint[1] - 0.5],
    [-joint[0] - 0.5, g.h - joint[1] - 0.5],
    [g.w - joint[0] - 0.5, g.h - joint[1] - 0.5],
  ].map((p) => rot(p as Pt, d));
  const minX = Math.floor(Math.min(...corners.map((p) => p[0])) - 0.5);
  const maxX = Math.ceil(Math.max(...corners.map((p) => p[0])) + 0.5);
  const minY = Math.floor(Math.min(...corners.map((p) => p[1])) - 0.5);
  const maxY = Math.ceil(Math.max(...corners.map((p) => p[1])) + 0.5);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const out: Grid = { w, h, px: new Array(w * h).fill('.') };
  const counts = new Map<string, number>();
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      counts.clear();
      let center = '.';
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          // Sample point in up-space, relative to the joint centre.
          const qx = (ox + minX) * S + (sx + 0.5 - S / 2);
          const qy = (oy + minY) * S + (sy + 0.5 - S / 2);
          const [ux, uy] = rot([qx, qy], -d);
          const ch = gridAt(up, Math.floor(cx + ux), Math.floor(cy + uy));
          counts.set(ch, (counts.get(ch) ?? 0) + 1);
          if (sx === S / 2 && sy === S / 2) center = ch;
        }
      }
      const empty = counts.get('.') ?? 0;
      if (empty > (S * S) / 2) continue;
      let best = '.';
      let bestN = -1;
      for (const [ch, n] of counts) {
        if (ch === '.') continue;
        if (n > bestN || (n === bestN && ch === center)) {
          best = ch;
          bestN = n;
        }
      }
      out.px[oy * w + ox] = best;
    }
  }
  return { grid: out, joint: [-minX, -minY] };
}
