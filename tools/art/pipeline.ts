/**
 * Sheet conversion pipeline: a raw pose sheet + manifest → cleaned, placed frames (see convert.ts
 * for the individual steps), plus the canonical character from the approved reference.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { CATEGORY, TRACKED } from './consistency';
import { PNG } from 'pngjs';
import {
  addOutline,
  defringe,
  anchorScale,
  cleanup,
  cropFigure,
  downscale,
  foregroundMask,
  opaqueBox,
  paletteEntries,
  place,
  snapToPalette,
  splitFigures,
  stripFloorLine,
  dropLineFragments,
  supportingFoot,
  type Indexed,
  type PaletteEntry,
  type Rgba,
} from './convert';

export const ROOT = process.cwd();
export const CHARACTER_HEIGHT = 108;

/** The character's sprite height in px (design.json "height_px"; Rook 108). */
export function characterHeight(char: string): number {
  const f = join(ROOT, 'art_src', char, 'design.json');
  return (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { height_px?: number }).height_px : undefined) ?? CHARACTER_HEIGHT;
}

export interface Palette {
  ramps: Record<string, string[]>;
  entries: PaletteEntry[];
  outline: number;
  /** Ramps this character never uses (design.json "ramps" lists the ones it does). */
  exclude: Set<string>;
  /** Ramp → colour category for the consistency checks (design.json "categories", else Rook's). */
  categories: Record<string, string>;
  /** Categories whose share is checked against the canonical (design.json "tracked"). */
  tracked: readonly string[];
}

export function loadPalette(char?: string): Palette {
  const ramps = (JSON.parse(readFileSync(join(ROOT, 'art_src/palette.json'), 'utf8')) as { ramps: Record<string, string[]> }).ramps;
  const entries = paletteEntries(ramps);
  const designFile = char ? join(ROOT, 'art_src', char, 'design.json') : '';
  const design = designFile && existsSync(designFile) ? (JSON.parse(readFileSync(designFile, 'utf8')) as { ramps?: string[]; categories?: Record<string, string>; tracked?: string[] }) : {};
  const used = design.ramps;
  const exclude = new Set(used ? Object.keys(ramps).filter((r) => r !== 'outline' && !used.includes(r)) : []);
  return { ramps, entries, outline: entries.findIndex((e) => e.ramp === 'outline'), exclude, categories: design.categories ?? CATEGORY, tracked: design.tracked ?? TRACKED };
}

/** Read a PNG or JPEG (image models and browsers often save JPEG). */
export function readPng(path: string): Rgba {
  if (/\.jpe?g$/i.test(path)) {
    const jpg = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: true });
    return { w: jpg.width, h: jpg.height, data: new Uint8ClampedArray(jpg.data) };
  }
  const png = PNG.sync.read(readFileSync(path));
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
}

/** The file for a sheet named in a manifest: the name as given, or the same name saved as JPEG. */
export function findSheetFile(dir: string, sheet: string): string | null {
  const base = sheet.replace(/\.(png|jpe?g)$/i, '');
  for (const ext of [sheet.slice(base.length), '.png', '.jpg', '.jpeg', '.PNG', '.JPG', '.JPEG']) {
    const f = join(dir, base + ext);
    if (ext && existsSync(f)) return f;
  }
  return null;
}

export interface PoseEntry {
  role?: 'anchor';
  anim?: string;
  index?: number;
  /** Pivot x inside the converted pose (px from its left edge), instead of the supporting foot. */
  pivot_x?: number;
}

export interface SheetManifest {
  sheet: string;
  poses: PoseEntry[];
}

export interface ConvertedPose {
  entry: PoseEntry;
  /** Cleaned, outlined sprite (tight). */
  sprite: Indexed;
  /** Placed in the character's cell. */
  frame: Indexed;
  pivotX: number;
  outside: number;
  meanError: number;
  p95Error: number;
  width: number;
  height: number;
}

export interface ConvertedSheet {
  manifest: SheetManifest;
  file: string;
  scale: number;
  poses: ConvertedPose[];
  errors: string[];
  /** The image hasn't been added yet. */
  waiting?: boolean;
}

function convertFigure(img: Rgba, fig: Parameters<typeof cropFigure>[1], scale: number, pal: Palette, cell: readonly [number, number], pivot: readonly [number, number], entry: PoseEntry): ConvertedPose {
  const small = downscale(defringe(cropFigure(img, fig)), scale);
  const snap = snapToPalette(small, pal.entries, pal.exclude);
  cleanup(snap.sprite, pal.outline);
  const sprite = addOutline(snap.sprite, pal.outline);
  const foot = supportingFoot(sprite, pal.outline);
  const pivotX = entry.pivot_x ?? foot.x;
  const { frame, outside } = place(sprite, cell, pivot, pivotX, foot.bottom);
  const box = opaqueBox(sprite);
  return {
    entry,
    sprite,
    frame,
    pivotX,
    outside,
    meanError: snap.meanError,
    p95Error: snap.p95Error,
    width: box ? box.x1 - box.x0 - 2 : 0,
    height: box ? box.y1 - box.y0 - 2 : 0,
  };
}

/** Convert one pose sheet: split, scale from the anchor (pose 1), convert every pose. */
export function convertSheet(dir: string, manifest: SheetManifest, pal: Palette, cell: readonly [number, number], pivot: readonly [number, number], height = CHARACTER_HEIGHT): ConvertedSheet {
  const found = findSheetFile(dir, manifest.sheet);
  const file = found ?? join(dir, manifest.sheet);
  const errors: string[] = [];
  if (!found) return { manifest, file, scale: 0, poses: [], errors: [], waiting: true };
  const img = readPng(file);
  const mask = foregroundMask(img);
  // Floor lines under the figures go first (at most 3% of the image height per figure).
  for (const f of splitFigures(mask, img.w, img.h)) stripFloorLine(img, mask, f, Math.ceil(img.h * 0.03));
  dropLineFragments(img, mask);
  const figs = splitFigures(mask, img.w, img.h);
  if (figs.length !== manifest.poses.length) {
    return { manifest, file, scale: 0, poses: [], errors: [`${manifest.sheet}: found ${figs.length} figures, the manifest lists ${manifest.poses.length} poses`] };
  }
  if (manifest.poses[0]?.role !== 'anchor') errors.push(`${manifest.sheet}: the first pose must be the anchor`);
  const scale = anchorScale(figs[0]!, height);
  const poses = figs.map((f, i) => convertFigure(img, f, scale, pal, cell, pivot, manifest.poses[i]!));
  for (const p of poses) if (p.outside) errors.push(`${manifest.sheet}: ${p.entry.anim ?? 'anchor'} #${p.entry.index ?? 0}: ${p.outside} pixels outside the ${cell[0]}x${cell[1]} cell`);
  return { manifest, file, scale, poses, errors };
}

/** Convert the approved reference image (a single figure) into the canonical sprite. */
export function convertReference(file: string, pal: Palette, cell: readonly [number, number], pivot: readonly [number, number], height = CHARACTER_HEIGHT): ConvertedPose {
  const img = readPng(file);
  const figs = splitFigures(foregroundMask(img), img.w, img.h);
  if (!figs.length) throw new Error(`${file}: no figure found`);
  const main = figs.reduce((a, b) => (b.pixels.length > a.pixels.length ? b : a));
  return convertFigure(img, main, anchorScale(main, height), pal, cell, pivot, { role: 'anchor' });
}

/** Indexed sprite → hex canvas rows (for io.ts). */
export function toHex(s: Indexed, pal: Palette): string[] {
  return Array.from(s.px, (k) => (k < 0 ? '' : pal.entries[k]!.hex));
}
