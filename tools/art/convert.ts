/**
 * Converter: image-model pose sheets → clean game sprites.
 *
 *   1. background removal: flood-fill from the edges through near-white (or use the alpha channel
 *      when the image has one), so pale areas inside the character are kept; soft floor shadows go;
 *   2. split the sheet into figures (connected regions; small detached bits merge into the nearest
 *      figure), ordered left to right;
 *   3. one scale factor per sheet from the anchor pose (first figure) → 108 px tall;
 *   4. area-averaging downscale;
 *   5. palette snap in CIELAB, no dithering; < 50% opacity → transparent;
 *   6. cleanup: orphan pixels, tiny islands, 1 px outside outline, doubled outline corners;
 *   7. placement: the supporting foot's lowest pixel on the floor line, pivot x at its centre
 *      (or the manifest's pivot_x).
 * All functions here are pure (RGBA buffers in, buffers out) and tested in tests/converter.test.ts.
 */

export interface Rgba {
  w: number;
  h: number;
  /** RGBA bytes, row-major. */
  data: Uint8ClampedArray;
}

export function rgba(w: number, h: number): Rgba {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

// ---------------------------------------------------------------- 1. background

export interface BackgroundOptions {
  /** How close to white (0-255 per channel distance) a pixel must be to count as background. */
  whiteTolerance: number;
  /** Pale, low-saturation greys connected to the background below the feet count as shadow. */
  shadowTolerance: number;
  /** Enclosed near-white regions at least this many pixels are background holes. */
  minHole: number;
}

export const DEFAULT_BG: BackgroundOptions = { whiteTolerance: 28, shadowTolerance: 70, minHole: 12 };

/** True if the image uses its alpha channel for the background (any clearly transparent edge pixel). */
export function hasAlphaBackground(img: Rgba): boolean {
  let transparent = 0;
  let edge = 0;
  const check = (x: number, y: number) => {
    edge++;
    if (img.data[(y * img.w + x) * 4 + 3]! < 128) transparent++;
  };
  for (let x = 0; x < img.w; x++) {
    check(x, 0);
    check(x, img.h - 1);
  }
  for (let y = 0; y < img.h; y++) {
    check(0, y);
    check(img.w - 1, y);
  }
  return transparent > edge / 2;
}

/**
 * Foreground mask (1 = character). With an alpha background, alpha >= 50% is foreground.
 * Otherwise background = everything reachable from the image edges through near-white pixels,
 * so white or pale areas inside the character (cloth wraps, highlights) are kept.
 */
export function foregroundMask(img: Rgba, opts: BackgroundOptions = DEFAULT_BG): Uint8Array {
  const { w, h, data } = img;
  const mask = new Uint8Array(w * h).fill(1);
  if (hasAlphaBackground(img)) {
    for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3]! >= 128 ? 1 : 0;
    return mask;
  }
  const nearWhite = (i: number, tol: number) => {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    return 255 - Math.min(r, g, b) <= tol;
  };
  const isShadow = (i: number) => {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    return sat <= 18 && 255 - Math.min(r, g, b) <= opts.shadowTolerance;
  };
  const stack: number[] = [];
  const visit = (i: number) => {
    if (mask[i] === 0) return;
    if (!nearWhite(i, opts.whiteTolerance)) return;
    mask[i] = 0;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    visit(x);
    visit((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    visit(y * w);
    visit(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (y > 0) visit(i - w);
    if (y < h - 1) visit(i + w);
  }
  // Enclosed background: white gaps the edge fill can't reach (between a fist and the chin, a
  // braid and the shoulder). Pure-white regions larger than a speck are background; tiny ones
  // (eye glints) and pale cloth (never this close to white) stay.
  const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || mask[i] === 0 || !nearWhite(i, opts.whiteTolerance)) continue;
    const region: number[] = [i];
    seen[i] = 1;
    for (let k = 0; k < region.length; k++) {
      const j = region[k]!;
      const x = j % w;
      const y = (j / w) | 0;
      for (const n of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1]) {
        if (n < 0 || seen[n] || mask[n] === 0 || !nearWhite(n, opts.whiteTolerance)) continue;
        seen[n] = 1;
        region.push(n);
      }
    }
    if (region.length >= opts.minHole) for (const j of region) mask[j] = 0;
  }
  // Soft floor shadows: pale grey pixels touching the background, grown from the background.
  const grow: number[] = [];
  for (let i = 0; i < w * h; i++) if (mask[i] === 0) grow.push(i);
  while (grow.length) {
    const i = grow.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || mask[j] === 0 || !isShadow(j)) continue;
      mask[j] = 0;
      grow.push(j);
    }
  }
  return mask;
}

// ---------------------------------------------------------------- 2. split into figures

export interface Box {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

export interface Figure {
  box: Box;
  /** Pixel indices (into the source image) that belong to the figure. */
  pixels: number[];
}

/** Connected regions (8-connected) of the mask; small bits join the nearest big figure. */
export function splitFigures(mask: Uint8Array, w: number, h: number, minShare = 0.02): Figure[] {
  const label = new Int32Array(w * h).fill(-1);
  const comps: Figure[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start]! >= 0) continue;
    const id = comps.length;
    const fig: Figure = { box: { x0: w, y0: h, x1: 0, y1: 0 }, pixels: [] };
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      const y = (i / w) | 0;
      fig.pixels.push(i);
      fig.box.x0 = Math.min(fig.box.x0, x);
      fig.box.y0 = Math.min(fig.box.y0, y);
      fig.box.x1 = Math.max(fig.box.x1, x + 1);
      fig.box.y1 = Math.max(fig.box.y1, y + 1);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const j = yy * w + xx;
          if (mask[j] && label[j]! < 0) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
    comps.push(fig);
  }
  if (!comps.length) return [];
  const largest = Math.max(...comps.map((c) => c.pixels.length));
  const big = comps.filter((c) => c.pixels.length >= largest * minShare);
  const small = comps.filter((c) => c.pixels.length < largest * minShare);
  const boxDist = (a: Box, b: Box) => {
    const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
    const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
    return Math.hypot(dx, dy);
  };
  for (const s of small) {
    const target = big.reduce((best, b) => (boxDist(s.box, b.box) < boxDist(s.box, best.box) ? b : best));
    target.pixels.push(...s.pixels);
    target.box = {
      x0: Math.min(target.box.x0, s.box.x0),
      y0: Math.min(target.box.y0, s.box.y0),
      x1: Math.max(target.box.x1, s.box.x1),
      y1: Math.max(target.box.y1, s.box.y1),
    };
  }
  return big.sort((a, b) => a.box.x0 + a.box.x1 - (b.box.x0 + b.box.x1));
}

/** Crop a figure out of the image (pixels outside it transparent). */
export function cropFigure(img: Rgba, fig: Figure): Rgba {
  const { x0, y0, x1, y1 } = fig.box;
  const out = rgba(x1 - x0, y1 - y0);
  for (const i of fig.pixels) {
    const x = (i % img.w) - x0;
    const y = ((i / img.w) | 0) - y0;
    const o = (y * out.w + x) * 4;
    out.data[o] = img.data[i * 4]!;
    out.data[o + 1] = img.data[i * 4 + 1]!;
    out.data[o + 2] = img.data[i * 4 + 2]!;
    out.data[o + 3] = img.data[i * 4 + 3]!;
  }
  return out;
}

/**
 * Defringe: image-model edges are blended into the white background, so the outer rim of a
 * figure is lighter than the figure (a pale halo after downscaling). Pixels within `ring` pixels
 * of the background take the colour of the nearest pixel deeper inside; the silhouette keeps its
 * shape. Thin parts with no deeper pixel keep their colour.
 */
export function defringe(img: Rgba, ring = 2): Rgba {
  const { w, h, data } = img;
  const out: Rgba = { w, h, data: new Uint8ClampedArray(data) };
  const opaque = (i: number) => data[i * 4 + 3]! >= 128;
  const nbrs = (i: number) => {
    const x = i % w;
    const y = (i / w) | 0;
    return [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
  };
  // Distance (4-connected steps) from the background; the image border counts as background.
  const dist = new Int32Array(w * h).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!opaque(i)) dist[i] = 0;
    else if (nbrs(i).includes(-1)) dist[i] = 1;
    else continue;
    queue.push(i);
  }
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!;
    if (dist[i]! > ring) continue;
    for (const n of nbrs(i)) if (n >= 0 && dist[n] === -1) {
      dist[n] = dist[i]! + 1;
      queue.push(n);
    }
  }
  // Bleed colours outward from the first pixels deeper than the ring.
  let src: number[] = [];
  for (let i = 0; i < w * h; i++) if (opaque(i) && (dist[i] === -1 || dist[i]! > ring)) src.push(i);
  const done = new Uint8Array(w * h);
  for (const i of src) done[i] = 1;
  while (src.length) {
    const next: number[] = [];
    for (const i of src) for (const n of nbrs(i)) {
      if (n < 0 || done[n] || !opaque(n)) continue;
      done[n] = 1;
      out.data[n * 4] = out.data[i * 4]!;
      out.data[n * 4 + 1] = out.data[i * 4 + 1]!;
      out.data[n * 4 + 2] = out.data[i * 4 + 2]!;
      next.push(n);
    }
    src = next;
  }
  return out;
}

/**
 * Floor lines: image models often draw a near-black ground line or shadow band under the figures
 * (sometimes one band joining all of them). Within `maxRows` of the figure's bottom, a row is
 * line-like when it spans at least 50% of the figure's width, at least 85% of its pixels are
 * near-black or grey, and it covers 1.5 times the width of the row 8% of the figure's height above
 * (only feet touch the floor; a body lying there is as wide higher up); ragged rows are allowed (scanning stops after 3 rows in a row
 * that aren't line-like). From the highest line-like row down, the near-black and grey pixels
 * leave the mask (boot colours stay). Returns the number of rows cleared.
 */
export function stripFloorLine(img: Rgba, mask: Uint8Array, fig: Figure, maxRows: number): number {
  const { x0, x1, y0, y1 } = fig.box;
  const lineLike = (i: number) => {
    const r = img.data[i * 4]!;
    const g = img.data[i * 4 + 1]!;
    const b = img.data[i * 4 + 2]!;
    return Math.max(r, g, b) <= 70 || Math.max(r, g, b) - Math.min(r, g, b) <= 16;
  };
  const coverage = (y: number) => {
    let n = 0;
    let like = 0;
    let lo = x1;
    let hi = x0 - 1;
    for (let x = x0; x < x1; x++) {
      const i = y * img.w + x;
      if (!mask[i]) continue;
      n++;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
      if (lineLike(i)) like++;
    }
    return { n, like, lo, hi };
  };
  /** Does row y stick out past everything in the `ref` rows above it (a line drawn wider than the figure)? */
  const juts = (y: number, lo: number, hi: number) => {
    let alo = x1;
    let ahi = x0 - 1;
    for (let yy = Math.max(y0, y - ref); yy < y; yy++) {
      const c = coverage(yy);
      alo = Math.min(alo, c.lo);
      ahi = Math.max(ahi, c.hi);
    }
    const m = Math.max(2, Math.round((x1 - x0) * 0.03));
    return lo < alo - m || hi > ahi + m;
  };
  // A band is much wider than what stands on it (only feet touch the floor); a body lying on the
  // floor is as wide at its bottom as a little higher up. Ragged rows must show that contrast.
  const ref = Math.max(2, Math.round((y1 - y0) * 0.08));
  let top = -1;
  let misses = 0;
  for (let y = y1 - 1; y >= Math.max(y0, y1 - maxRows); y--) {
    const { n, like, lo, hi } = coverage(y);
    const base = n >= (x1 - x0) * 0.5 && like >= n * 0.85;
    const wider = base && y - ref >= y0 && (n >= coverage(y - ref).n * 1.5 || juts(y, lo, hi));
    if (base && wider) {
      top = y;
      misses = 0;
    } else {
      if (top >= 0 && ++misses >= 3) break;
      if (top < 0 && y1 - y > 6) break;
    }
  }
  if (top < 0) return 0;
  for (let y = top; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * img.w + x;
      if (mask[i] && lineLike(i)) mask[i] = 0;
    }
  return y1 - top;
}

/**
 * Line fragments: small detached marks the image model adds (dashes of a floor line under an
 * airborne figure, motion lines by a snapping head). A detached piece with at least 85% of its
 * pixels near-black or grey is dropped when it is smaller than 1% of the largest piece, or a thin
 * strip (at most 2% of the image tall, at least 4 times as wide). Returns the count.
 */
export function dropLineFragments(img: Rgba, mask: Uint8Array): number {
  const { w, h } = img;
  const label = new Int32Array(w * h).fill(-1);
  const comps: number[][] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    const c: number[] = [i];
    label[i] = comps.length;
    for (let k = 0; k < c.length; k++) {
      const j = c[k]!;
      const x = j % w;
      const y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (mask[n] && label[n] === -1) {
            label[n] = comps.length;
            c.push(n);
          }
        }
    }
    comps.push(c);
  }
  const largest = Math.max(0, ...comps.map((c) => c.length));
  let dropped = 0;
  for (const c of comps) {
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    for (const i of c) {
      const x = i % w;
      const y = (i / w) | 0;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const strip = y1 - y0 + 1 <= h * 0.02 && x1 - x0 + 1 >= (y1 - y0 + 1) * 4;
    if (c.length >= largest * 0.01 && !strip) continue;
    const like = c.filter((i) => {
      const r = img.data[i * 4]!;
      const g = img.data[i * 4 + 1]!;
      const b = img.data[i * 4 + 2]!;
      return Math.max(r, g, b) <= 70 || Math.max(r, g, b) - Math.min(r, g, b) <= 16;
    }).length;
    if (like < c.length * 0.85) continue;
    for (const i of c) mask[i] = 0;
    dropped++;
  }
  return dropped;
}

export interface Accent {
  /** Palette ramp of the accent (e.g. "spirit" for an eye glow, "gold" for a band). */
  ramp: string;
  /** Source pixels within this ΔE of the ramp count as the accent. */
  max_de: number;
  /** A sprite pixel whose source block is at least this share accent takes the accent colour. */
  min_share: number;
}

/**
 * Feature-preserving downscale for accents: area averaging dilutes small high-contrast details (a
 * one-pixel eye glow averages into the face, a thin gold band into the skin). After `downscale`,
 * every output pixel whose source block holds at least `min_share` accent pixels takes the mean
 * colour of those accent pixels instead of the block average. Everything else stays averaged.
 */
export function preserveAccents(src: Rgba, small: Rgba, entries: PaletteEntry[], accents: readonly Accent[]): number {
  if (!accents.length) return 0;
  const sx = src.w / small.w;
  const sy = src.h / small.h;
  const cache = new Map<number, number>();
  /** Which accent a source pixel belongs to (index), or -1. */
  const accentOf = (i: number): number => {
    const r = src.data[i * 4]!;
    const g = src.data[i * 4 + 1]!;
    const b = src.data[i * 4 + 2]!;
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (hit === undefined) {
      const lab = rgbToLab(r, g, b);
      hit = accents.findIndex((a) => entries.some((e) => e.ramp === a.ramp && deltaE(lab, e.lab) <= a.max_de));
      cache.set(key, hit);
    }
    return hit;
  };
  let changed = 0;
  for (let oy = 0; oy < small.h; oy++)
    for (let ox = 0; ox < small.w; ox++) {
      const o = (oy * small.w + ox) * 4;
      if (small.data[o + 3]! < 128) continue;
      const sums = accents.map(() => [0, 0, 0, 0]);
      let opaque = 0;
      for (let y = Math.floor(oy * sy); y < Math.min(src.h, Math.ceil((oy + 1) * sy)); y++)
        for (let x = Math.floor(ox * sx); x < Math.min(src.w, Math.ceil((ox + 1) * sx)); x++) {
          const i = y * src.w + x;
          if (src.data[i * 4 + 3]! < 128) continue;
          opaque++;
          const a = accentOf(i);
          if (a < 0) continue;
          const t = sums[a]!;
          t[0] += src.data[i * 4]!;
          t[1] += src.data[i * 4 + 1]!;
          t[2] += src.data[i * 4 + 2]!;
          t[3]!++;
        }
      // The accent with the largest share wins, if it reaches its threshold.
      let best = -1;
      accents.forEach((a, k) => {
        const n = sums[k]![3]!;
        if (opaque && n / opaque >= a.min_share && (best < 0 || n > sums[best]![3]!)) best = k;
      });
      if (best < 0) continue;
      const t = sums[best]!;
      small.data[o] = Math.round(t[0]! / t[3]!);
      small.data[o + 1] = Math.round(t[1]! / t[3]!);
      small.data[o + 2] = Math.round(t[2]! / t[3]!);
      changed++;
    }
  return changed;
}

// ---------------------------------------------------------------- 3-4. scale

/** One factor per sheet: the anchor figure's height becomes `targetHeight`. */
export function anchorScale(anchor: Figure, targetHeight: number): number {
  return targetHeight / (anchor.box.y1 - anchor.box.y0);
}

/** Area-averaging downscale (exact fractional box filter, alpha-weighted colours). */
export function downscale(img: Rgba, factor: number): Rgba {
  const ow = Math.max(1, Math.round(img.w * factor));
  const oh = Math.max(1, Math.round(img.h * factor));
  const out = rgba(ow, oh);
  const sx = img.w / ow;
  const sy = img.h / oh;
  for (let oy = 0; oy < oh; oy++) {
    const fy0 = oy * sy;
    const fy1 = fy0 + sy;
    for (let ox = 0; ox < ow; ox++) {
      const fx0 = ox * sx;
      const fx1 = fx0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
        const wy = Math.min(fy1, y + 1) - Math.max(fy0, y);
        for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
          const wx = Math.min(fx1, x + 1) - Math.max(fx0, x);
          const wgt = wx * wy;
          const i = (y * img.w + x) * 4;
          const al = img.data[i + 3]! / 255;
          r += img.data[i]! * al * wgt;
          g += img.data[i + 1]! * al * wgt;
          b += img.data[i + 2]! * al * wgt;
          a += al * wgt;
          area += wgt;
        }
      }
      const o = (oy * ow + ox) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = (a / area) * 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 5. palette snap (CIELAB)

export type Lab = [number, number, number];

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIE76 distance (ΔE). */
export function deltaE(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export interface PaletteEntry {
  hex: string;
  ramp: string;
  step: number;
  lab: Lab;
}

export function paletteEntries(ramps: Record<string, string[]>): PaletteEntry[] {
  const out: PaletteEntry[] = [];
  for (const [ramp, cols] of Object.entries(ramps)) {
    cols.forEach((hex, step) => {
      const n = parseInt(hex.slice(1), 16);
      out.push({ hex, ramp, step, lab: rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255) });
    });
  }
  return out;
}

/** A sprite: palette index per pixel (-1 = transparent). */
export interface Indexed {
  w: number;
  h: number;
  px: Int16Array;
}

export interface SnapResult {
  sprite: Indexed;
  /** Mean and 95th-percentile ΔE between the downscaled colours and the palette. */
  meanError: number;
  p95Error: number;
  /** Per palette entry, how many pixels and the summed error (for palette checks). */
  usage: { count: number; error: number }[];
}

export function snapToPalette(img: Rgba, palette: PaletteEntry[], exclude: Set<string> = new Set()): SnapResult {
  const px = new Int16Array(img.w * img.h).fill(-1);
  const usage = palette.map(() => ({ count: 0, error: 0 }));
  const errors: number[] = [];
  const cache = new Map<number, [number, number]>();
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.data[i * 4 + 3]! < 128) continue;
    const r = img.data[i * 4]!;
    const g = img.data[i * 4 + 1]!;
    const b = img.data[i * 4 + 2]!;
    const key = (r << 16) | (g << 8) | b;
    let hit = cache.get(key);
    if (!hit) {
      const lab = rgbToLab(r, g, b);
      let best = -1;
      let bestD = Infinity;
      palette.forEach((p, k) => {
        if (exclude.has(p.ramp)) return;
        const d = deltaE(lab, p.lab);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      hit = [best, bestD];
      cache.set(key, hit);
    }
    px[i] = hit[0];
    usage[hit[0]]!.count++;
    usage[hit[0]]!.error += hit[1];
    errors.push(hit[1]);
  }
  errors.sort((a, b) => a - b);
  const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  return { sprite: { w: img.w, h: img.h, px }, meanError: mean, p95Error: errors[Math.floor(errors.length * 0.95)] ?? 0, usage };
}

// ---------------------------------------------------------------- 6. cleanup and outline

const N4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const N8: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function at(s: Indexed, x: number, y: number): number {
  return x < 0 || y < 0 || x >= s.w || y >= s.h ? -1 : s.px[y * s.w + x]!;
}

/** Remove single pixels with no 4-neighbours, and recolour tiny islands of colour to their surroundings. */
/** `keep`: palette indices never replaced as one-pixel islands (accents such as an eye glow). */
export function cleanup(s: Indexed, outline: number, keep: ReadonlySet<number> = new Set()): { orphans: number; islands: number } {
  let orphans = 0;
  let islands = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      if (s.px[i]! < 0) continue;
      if (N4.every(([dx, dy]) => at(s, x + dx, y + dy) < 0)) {
        s.px[i] = -1;
        orphans++;
      }
    }
  }
  const copy = new Int16Array(s.px);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const c = copy[y * s.w + x]!;
      if (c < 0 || c === outline || keep.has(c)) continue;
      const ns = N8.map(([dx, dy]) => (x + dx < 0 || y + dy < 0 || x + dx >= s.w || y + dy >= s.h ? -1 : copy[(y + dy) * s.w + x + dx]!));
      if (ns.some((n) => n === c)) continue;
      // A one-pixel island: take the most common neighbouring colour (ignoring transparency).
      const counts = new Map<number, number>();
      for (const n of ns) if (n >= 0) counts.set(n, (counts.get(n) ?? 0) + 1);
      const best = [...counts].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 5) {
        s.px[y * s.w + x] = best[0];
        islands++;
      }
    }
  }
  return { orphans, islands };
}

/**
 * 1 px outline on the outside edge (4-connected, so corners aren't doubled), then remove any
 * outline pixel that doesn't touch the body (a doubled corner).
 */
export function addOutline(s: Indexed, outline: number): Indexed {
  const out: Indexed = { w: s.w + 2, h: s.h + 2, px: new Int16Array((s.w + 2) * (s.h + 2)).fill(-1) };
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out.px[(y + 1) * out.w + x + 1] = s.px[y * s.w + x]!;
  const body = (x: number, y: number) => at(out, x, y) >= 0 && at(out, x, y) !== outline;
  const add: number[] = [];
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      if (at(out, x, y) >= 0) continue;
      if (N4.some(([dx, dy]) => body(x + dx, y + dy))) add.push(y * out.w + x);
    }
  }
  for (const i of add) out.px[i] = outline;
  // Doubled corners: outline pixels with no body pixel 4-adjacent.
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      if (at(out, x, y) !== outline) continue;
      if (!N4.some(([dx, dy]) => body(x + dx, y + dy)) && !N4.some(([dx, dy]) => at(out, x + dx, y + dy) >= 0 && at(out, x + dx, y + dy) !== outline)) {
        // Only remove when it isn't part of an existing outline drawn in the art itself.
        if (N8.filter(([dx, dy]) => body(x + dx, y + dy)).length === 0) out.px[y * out.w + x] = -1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 7. placement

/**
 * Where the pivot goes. Feet are the groups of body pixels on the bottom rows. If two feet are on
 * the floor (both reach within 2 px of the lowest pixel), the pivot is the centre between them
 * (the art spec's "centre between the feet", which keeps the body over its hurtbox); otherwise it
 * is the centre of the one supporting foot. Returns that x and the lowest body row.
 */
export function supportingFoot(s: Indexed, outline: number): { x: number; bottom: number } {
  const body = (x: number, y: number) => at(s, x, y) >= 0 && at(s, x, y) !== outline;
  let bottom = -1;
  for (let y = s.h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < s.w; x++) if (body(x, y)) bottom = y;
  if (bottom < 0) return { x: s.w >> 1, bottom: s.h - 1 };
  // Feet: runs of columns with body pixels in the bottom 4 rows; each foot's lowest row.
  const band = 4;
  const feet: { x0: number; x1: number; low: number }[] = [];
  let cur: { x0: number; x1: number; low: number } | null = null;
  for (let x = 0; x <= s.w; x++) {
    let low = -1;
    if (x < s.w) for (let y = bottom; y > bottom - band && y >= 0; y--) if (body(x, y)) { low = Math.max(low, y); }
    if (low >= 0) {
      if (!cur) cur = { x0: x, x1: x + 1, low };
      else {
        cur.x1 = x + 1;
        cur.low = Math.max(cur.low, low);
      }
    } else if (cur) {
      feet.push(cur);
      cur = null;
    }
  }
  const onFloor = feet.filter((f) => f.low >= bottom - 2 && f.x1 - f.x0 >= 2);
  const centre = (f: { x0: number; x1: number }) => (f.x0 + f.x1 - 1) / 2;
  if (onFloor.length >= 2) {
    const a = onFloor[0]!;
    const b = onFloor[onFloor.length - 1]!;
    return { x: Math.round((centre(a) + centre(b)) / 2), bottom };
  }
  const foot = onFloor[0] ?? feet.reduce((best, f) => (f.low > best.low ? f : best));
  return { x: Math.round(centre(foot)), bottom };
}

/** Place a sprite in a cell: its bottom body row on the pivot row, `pivotX` (sprite px) on the pivot. */
export function place(s: Indexed, cell: readonly [number, number], pivot: readonly [number, number], pivotX: number, bottom: number): { frame: Indexed; outside: number } {
  const frame: Indexed = { w: cell[0], h: cell[1], px: new Int16Array(cell[0] * cell[1]).fill(-1) };
  // The body's bottom row sits just above the floor line; its outline lands on the floor line.
  const ox = pivot[0] - pivotX;
  const oy = pivot[1] - 1 - bottom;
  let outside = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const c = s.px[y * s.w + x]!;
      if (c < 0) continue;
      const fx = x + ox;
      const fy = y + oy;
      if (fx < 0 || fy < 0 || fx >= cell[0] || fy >= cell[1]) {
        outside++;
        continue;
      }
      frame.px[fy * cell[0] + fx] = c;
    }
  }
  return { frame, outside };
}

/** Bounding box of the opaque pixels of a sprite. */
export function opaqueBox(s: Indexed): Box | null {
  let x0 = s.w;
  let y0 = s.h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.px[y * s.w + x]! >= 0) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + 1);
    y1 = Math.max(y1, y + 1);
  }
  return x1 > x0 ? { x0, y0, x1, y1 } : null;
}
