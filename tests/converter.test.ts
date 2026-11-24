import { describe, expect, it } from 'vitest';
import {
  addOutline,
  anchorScale,
  cleanup,
  cropFigure,
  defringe,
  dropLineFragments,
  stripFloorLine,
  deltaE,
  downscale,
  foregroundMask,
  paletteEntries,
  place,
  rgba,
  rgbToLab,
  snapToPalette,
  splitFigures,
  supportingFoot,
  type Indexed,
  type Rgba,
} from '../tools/art/convert';

/** Paint a rectangle (opaque colour) into an image. */
function rect(img: Rgba, x0: number, y0: number, w: number, h: number, [r, g, b]: number[]): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * img.w + x) * 4;
    img.data[i] = r!;
    img.data[i + 1] = g!;
    img.data[i + 2] = b!;
    img.data[i + 3] = 255;
  }
}
function whiteSheet(w: number, h: number): Rgba {
  const img = rgba(w, h);
  rect(img, 0, 0, w, h, [255, 255, 255]);
  return img;
}

describe('background removal', () => {
  it('flood-fills near-white from the edges but keeps pale areas inside the character', () => {
    const img = whiteSheet(40, 40);
    rect(img, 10, 5, 20, 30, [80, 20, 30]); // coat
    rect(img, 15, 15, 6, 6, [228, 222, 210]); // pale cloth wrap inside the figure (pure-white gaps are holes)
    const m = foregroundMask(img);
    expect(m[0]).toBe(0);
    expect(m[18 * 40 + 18]).toBe(1); // inner pale cloth kept
    expect(m[6 * 40 + 12]).toBe(1);
  });
  it('removes soft grey floor shadows connected to the background', () => {
    const img = whiteSheet(40, 40);
    rect(img, 15, 5, 10, 25, [80, 20, 30]);
    rect(img, 8, 30, 24, 3, [205, 205, 208]); // pale shadow under the feet
    const m = foregroundMask(img);
    expect(m[31 * 40 + 10]).toBe(0);
    expect(m[20 * 40 + 20]).toBe(1);
  });
  it('treats large enclosed white gaps as background (the gap between a fist and the chin)', () => {
    const img = whiteSheet(60, 60);
    rect(img, 10, 5, 40, 50, [80, 20, 30]);
    rect(img, 20, 15, 12, 12, [255, 255, 255]); // enclosed gap, 144 px
    rect(img, 38, 40, 2, 2, [255, 255, 255]); // eye glint, 4 px
    const m = foregroundMask(img);
    expect(m[20 * 60 + 25]).toBe(0);
    expect(m[40 * 60 + 38]).toBe(1);
  });
  it('defringe: rim pixels blended with the white background take the colour from deeper inside', () => {
    const img = rgba(20, 20);
    rect(img, 4, 4, 12, 12, [80, 20, 30]);
    // A light 1 px rim (anti-aliasing against white) around the figure.
    for (let i = 4; i < 16; i++) for (const [x, y] of [[i, 4], [i, 15], [4, i], [15, i]] as const) {
      const k = (y * 20 + x) * 4;
      img.data.set([200, 170, 175, 255], k);
    }
    const out = defringe(img);
    expect([...out.data.slice((4 * 20 + 10) * 4, (4 * 20 + 10) * 4 + 4)]).toEqual([80, 20, 30, 255]);
    expect(out.data[(0 * 20 + 0) * 4 + 3]).toBe(0); // the silhouette keeps its shape
    expect(out.data[(4 * 20 + 4) * 4 + 3]).toBe(255);
  });
  it('uses the alpha channel when the background is transparent', () => {
    const img = rgba(20, 20);
    rect(img, 5, 5, 10, 10, [255, 255, 255]); // a white figure on transparency
    const m = foregroundMask(img);
    expect(m[10 * 20 + 10]).toBe(1);
    expect(m[0]).toBe(0);
  });
});

describe('sheet splitting', () => {
  it('finds figures left to right and merges small detached bits into the nearest figure', () => {
    const img = whiteSheet(100, 50);
    rect(img, 60, 10, 10, 30, [80, 20, 30]); // second figure
    rect(img, 10, 10, 10, 30, [80, 20, 30]); // first figure
    rect(img, 22, 12, 2, 2, [30, 20, 30]); // a detached braid tip next to figure 1
    const figs = splitFigures(foregroundMask(img), img.w, img.h);
    expect(figs.length).toBe(2);
    expect(figs[0]!.box.x0).toBe(10);
    expect(figs[0]!.box.x1).toBe(24); // the braid tip joined figure 1
    expect(figs[1]!.box.x0).toBe(60);
  });
});

describe('anchor-based scaling', () => {
  it('one factor per sheet from the anchor: a crouching pose stays smaller', () => {
    const img = whiteSheet(200, 220);
    rect(img, 10, 4, 30, 216, [80, 20, 30]); // anchor, 216 px tall
    rect(img, 100, 112, 40, 108, [80, 20, 30]); // crouch, half as tall
    const figs = splitFigures(foregroundMask(img), img.w, img.h);
    const k = anchorScale(figs[0]!, 108);
    expect(k).toBeCloseTo(0.5);
    const anchor = downscale(cropFigure(img, figs[0]!), k);
    const crouch = downscale(cropFigure(img, figs[1]!), k);
    expect(anchor.h).toBe(108);
    expect(crouch.h).toBe(54);
  });
  it('area-averaging: a 2x2 checker of black and white becomes mid grey', () => {
    const img = rgba(2, 2);
    rect(img, 0, 0, 2, 2, [255, 255, 255]);
    rect(img, 0, 0, 1, 1, [0, 0, 0]);
    rect(img, 1, 1, 1, 1, [0, 0, 0]);
    const d = downscale(img, 0.5);
    expect(Math.abs(d.data[0]! - 127.5)).toBeLessThanOrEqual(1);
  });
});

describe('palette snapping', () => {
  const pal = paletteEntries({ outline: ['#1a1418'], coat: ['#4a1c24', '#6b2a32'], gold: ['#b8963f'] });
  it('maps every pixel to the nearest palette colour in CIELAB, with no new colours', () => {
    const img = rgba(3, 1);
    rect(img, 0, 0, 1, 1, [110, 44, 52]);
    rect(img, 1, 0, 1, 1, [180, 150, 60]);
    rect(img, 2, 0, 1, 1, [20, 20, 24]);
    const r = snapToPalette(img, pal);
    expect([...r.sprite.px].map((k) => pal[k]!.hex)).toEqual(['#6b2a32', '#b8963f', '#1a1418']);
    expect(r.meanError).toBeGreaterThan(0);
  });
  it('pixels under 50% opacity become transparent', () => {
    const img = rgba(2, 1);
    rect(img, 0, 0, 2, 1, [110, 44, 52]);
    img.data[3] = 100;
    const r = snapToPalette(img, pal);
    expect(r.sprite.px[0]).toBe(-1);
    expect(r.sprite.px[1]).toBeGreaterThanOrEqual(0);
  });
  it('CIELAB distance: identical colours are 0 apart', () => {
    expect(deltaE(rgbToLab(10, 20, 30), rgbToLab(10, 20, 30))).toBe(0);
  });
});

describe('cleanup, outline and placement', () => {
  const sprite = (rows: string[]): Indexed => ({ w: rows[0]!.length, h: rows.length, px: Int16Array.from(rows.join('').split('').map((c) => (c === '.' ? -1 : Number(c)))) });
  it('removes orphan pixels and recolours one-pixel islands', () => {
    const s = sprite(['1....', '.....', '..222', '..232', '..222']);
    const r = cleanup(s, 0);
    expect(r.orphans).toBe(1);
    expect(s.px[0]).toBe(-1);
    expect(s.px[3 * 5 + 3]).toBe(2);
  });
  it('adds a 1 px outside outline with no doubled corners', () => {
    const o = addOutline(sprite(['11', '11']), 0);
    expect(o.w).toBe(4);
    expect(o.px[0]).toBe(-1); // corner stays empty (4-connected outline)
    expect(o.px[1]).toBe(0);
    expect(o.px[1 * 4 + 1]).toBe(1);
  });
  it('pivot: the centre between two feet on the floor, or the one supporting foot', () => {
    // Two feet on the floor at x 0-1 and 6-7: pivot between them.
    const stance = sprite(['.1111111.', '.1.....1.', '11.....11']);
    expect(supportingFoot(stance, 0)).toEqual({ x: 4, bottom: 2 });
    // One foot raised (a kick): the pivot is the supporting foot.
    const kick = sprite(['11111111', '11....11', '11....11', '11......', '11......', '11......']);
    expect(supportingFoot(kick, 0).x).toBe(1);
  });
  it('places the supporting foot on the floor line and honours a pivot_x override', () => {
    const s = sprite(['11', '11']);
    const { frame, outside } = place(s, [10, 10], [5, 8], 0, 1);
    expect(outside).toBe(0);
    expect(frame.px[7 * 10 + 5]).toBe(1); // bottom row just above the floor line (row 8)
    const moved = place(s, [10, 10], [5, 8], 1, 1).frame;
    expect(moved.px[7 * 10 + 4]).toBe(1);
  });
});

describe('review gate', () => {
  it('only a frame with clean automatic checks and a recorded visual pass goes into the game', async () => {
    const { poseVerdict } = await import('../tools/art/consistency');
    expect(poseVerdict([], { pass: true })).toBe('PASS');
    expect(poseVerdict([], undefined)).toBe('pending review');
    expect(poseVerdict([], { pass: false, note: 'right hand visible' })).toBe('FAIL');
    // Regression: automatic failures used to be ignored until a reviewer had added a verdict.
    expect(poseVerdict(['wraps 24% (reference 10%)'], undefined)).toBe('FAIL');
    expect(poseVerdict(['wraps 24% (reference 10%)'], { pass: true })).toBe('FAIL');
  });
});

describe('review fingerprint', () => {
  it('a verdict only counts for the exact image it was given for', async () => {
    const { currentVerdict, imageId } = await import('../tools/art/consistency');
    const a = imageId(new Uint8Array([1, 2, 3]));
    const b = imageId(new Uint8Array([1, 2, 4]));
    expect(a).not.toBe(b);
    expect(currentVerdict({ pass: true, image: a }, a)).toEqual({ pass: true, image: a });
    // Regression: a replaced sheet inherited the review of the old image with the same name.
    expect(currentVerdict({ pass: true, image: a }, b)).toBeUndefined();
    expect(currentVerdict({ pass: true }, a)).toBeUndefined();
  });
});

describe('anchor checks', () => {
  it('anchor height is blocking; width and colour are warnings', async () => {
    const { anchorChecks } = await import('../tools/art/consistency');
    const ref = { height: 108, width: 79, shares: { coat: 0.24, gold: 0.05, skin: 0.09, darks: 0.49, wraps: 0.1 } };
    const ok = anchorChecks(79, 108, ref.shares, ref);
    expect(ok).toEqual({ blocking: [], warnings: [] });
    const narrow = anchorChecks(71, 107, { ...ref.shares, wraps: 0.2 }, ref);
    expect(narrow.blocking).toEqual([]);
    expect(narrow.warnings.length).toBe(2);
    expect(anchorChecks(79, 103, ref.shares, ref).blocking).toEqual(['anchor height 103 px (canonical 108)']);
  });
});

describe('floor lines and line fragments', () => {
  it('strips a near-black floor line under the feet but keeps the boots', () => {
    const img = whiteSheet(60, 60);
    rect(img, 20, 5, 20, 40, [90, 20, 30]); // body
    rect(img, 18, 45, 6, 6, [60, 40, 30]); // back boot
    rect(img, 36, 45, 6, 6, [60, 40, 30]); // front boot
    rect(img, 10, 51, 40, 3, [12, 8, 10]); // floor line
    rect(img, 10, 54, 40, 1, [150, 148, 149]); // its grey anti-aliased edge
    const mask = foregroundMask(img);
    const fig = splitFigures(mask, 60, 60)[0]!;
    expect(stripFloorLine(img, mask, fig, 10)).toBe(4);
    expect(mask[52 * 60 + 12]).toBe(0);
    expect(mask[48 * 60 + 20]).toBe(1); // boot kept
  });
  it('drops small detached dark marks and thin dark strips, keeps the figure', () => {
    const img = whiteSheet(100, 100);
    rect(img, 30, 10, 30, 70, [90, 20, 30]); // figure
    rect(img, 20, 15, 2, 2, [20, 15, 18]); // motion mark
    rect(img, 25, 92, 40, 2, [15, 10, 12]); // floor dashes under an airborne figure
    rect(img, 70, 40, 3, 3, [200, 150, 120]); // small skin-coloured piece: kept
    const mask = foregroundMask(img);
    expect(dropLineFragments(img, mask)).toBe(2);
    expect(mask[15 * 100 + 20]).toBe(0);
    expect(mask[92 * 100 + 40]).toBe(0);
    expect(mask[41 * 100 + 71]).toBe(1);
    expect(mask[40 * 100 + 40]).toBe(1);
  });
});

describe('accents', () => {
  it('a small bright detail survives the downscale and the island cleanup', async () => {
    const { preserveAccents } = await import('../tools/art/convert');
    const img = rgba(40, 40);
    rect(img, 0, 0, 40, 40, [112, 96, 102]); // grey face
    rect(img, 13, 13, 4, 4, [207, 230, 255]); // eye glow: 16 of a 10x10 block's 100 px
    const pal = paletteEntries({ outline: ['#1a1418'], ash: ['#706066'], spirit: ['#cfe6ff'] });
    const plain = downscale(img, 0.1);
    const snapPlain = snapToPalette(plain, pal);
    expect(pal[snapPlain.sprite.px[1 * 4 + 1]!]!.ramp).toBe('ash'); // averaged away
    const kept = downscale(img, 0.1);
    expect(preserveAccents(img, kept, pal, [{ ramp: 'spirit', max_de: 14, min_share: 0.15 }])).toBe(1);
    const s = snapToPalette(kept, pal).sprite;
    const eye = s.px[1 * 4 + 1]!;
    expect(pal[eye]!.ramp).toBe('spirit');
    cleanup(s, 0, new Set([eye]));
    expect(s.px[1 * 4 + 1]).toBe(eye);
  });
});

describe('floor bands', () => {
  it('one shadow band joining several figures is stripped, so they split apart', () => {
    const img = whiteSheet(120, 60);
    for (const x0 of [10, 50, 90]) {
      rect(img, x0, 5, 16, 40, [90, 20, 30]);
      rect(img, x0 - 2, 45, 6, 5, [100, 70, 60]); // boots
      rect(img, x0 + 12, 45, 6, 5, [100, 70, 60]);
    }
    rect(img, 4, 50, 112, 4, [35, 25, 30]); // one band under all three
    rect(img, 30, 54, 40, 1, [180, 180, 180]); // ragged grey bottom edge
    const mask = foregroundMask(img);
    expect(splitFigures(mask, 120, 60).length).toBe(1);
    stripFloorLine(img, mask, splitFigures(mask, 120, 60)[0]!, 10);
    expect(splitFigures(mask, 120, 60).length).toBe(3);
  });
  it('a dark body lying on the floor keeps its underside', () => {
    const img = whiteSheet(80, 40);
    rect(img, 10, 20, 60, 6, [90, 20, 30]); // lying coat
    rect(img, 10, 26, 60, 4, [40, 30, 35]); // dark trousers and hair along the floor
    const mask = foregroundMask(img);
    stripFloorLine(img, mask, splitFigures(mask, 80, 40)[0]!, 10);
    expect(mask[27 * 80 + 30]).toBe(1);
  });
});
