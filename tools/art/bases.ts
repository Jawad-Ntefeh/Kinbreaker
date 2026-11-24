/**
 * Edit bases: for attack sheets the image model is asked to EDIT a ready-made sheet instead of
 * drawing new figures (new figures tend to grow a second arm). The base is the approved reference
 * stance repeated once per pose, spaced on one ground line, with room in front of each figure for
 * the strike. Pose 1 stays untouched and is the scale anchor, so the manifest and checks are the
 * same as for a generated sheet.
 */
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { cropFigure, downscale, foregroundMask, splitFigures } from './convert';
import { readPng } from './pipeline';

/** Figure height in the base, in image pixels (about what the image model draws). */
const FIGURE_H = 560;
const MARGIN = 110;
const GAP = 70;

/**
 * Write a base with `poses` copies of the reference figure. `reach` is the strike's furthest point
 * in front of the pivot, in character pixels (the character is `height` px tall).
 */
export function writeEditBase(referenceFile: string, out: string, poses: number, reach: number, height: number): { w: number; h: number } {
  const img = readPng(referenceFile);
  // Leftmost figure (pose 1 of a sheet, or the only figure of a reference).
  const fig = splitFigures(foregroundMask(img), img.w, img.h)[0]!;
  const crop = cropFigure(img, fig);
  const f = downscale(crop, FIGURE_H / crop.h);
  const front = Math.max(f.w / 2, Math.round((reach * FIGURE_H) / height)) + 40;
  const slot = Math.ceil(f.w / 2 + front + GAP);
  const w = MARGIN * 2 + slot * poses - GAP;
  const h = FIGURE_H + MARGIN * 2;
  const png = new PNG({ width: w, height: h });
  png.data.fill(255);
  for (let p = 0; p < poses; p++) {
    const ox = MARGIN + p * slot;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const s = (y * f.w + x) * 4;
        // Like the converter: under 50% opacity (the soft floor shadow) is background.
        if (f.data[s + 3]! < 128) continue;
        const d = ((MARGIN + y) * w + ox + x) * 4;
        for (let c = 0; c < 3; c++) png.data[d + c] = f.data[s + c]!;
      }
  }
  writeFileSync(out, PNG.sync.write(png));
  return { w, h };
}
