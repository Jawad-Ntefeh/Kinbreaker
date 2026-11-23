import { describe, expect, it } from 'vitest';
import {
  addOutline,
  anchorScale,
  cleanup,
  cropFigure,
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
  it('flood-fills near-white from the edges but keeps white areas inside the character', () => {
    const img = whiteSheet(40, 40);
    rect(img, 10, 5, 20, 30, [80, 20, 30]); // coat
    rect(img, 15, 15, 6, 6, [250, 250, 248]); // white wrap inside the figure
    const m = foregroundMask(img);
    expect(m[0]).toBe(0);
    expect(m[18 * 40 + 18]).toBe(1); // inner white kept
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
