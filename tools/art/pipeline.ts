/**
 * Sheet conversion pipeline: a raw pose sheet + manifest → cleaned, placed frames (see convert.ts
 * for the individual steps), plus the canonical character from the approved reference.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  addOutline,
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
  supportingFoot,
  type Indexed,
  type PaletteEntry,
  type Rgba,
} from './convert';

export const ROOT = process.cwd();
export const CHARACTER_HEIGHT = 108;

export interface Palette {
  ramps: Record<string, string[]>;
  entries: PaletteEntry[];
  outline: number;
}

export function loadPalette(): Palette {
  const ramps = (JSON.parse(readFileSync(join(ROOT, 'art_src/palette.json'), 'utf8')) as { ramps: Record<string, string[]> }).ramps;
  const entries = paletteEntries(ramps);
  return { ramps, entries, outline: entries.findIndex((e) => e.ramp === 'outline') };
}

export function readPng(path: string): Rgba {
  const png = PNG.sync.read(readFileSync(path));
  return { w: png.width, h: png.height, data: new Uint8ClampedArray(png.data) };
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
  const small = downscale(cropFigure(img, fig), scale);
  const snap = snapToPalette(small, pal.entries);
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
export function convertSheet(dir: string, manifest: SheetManifest, pal: Palette, cell: readonly [number, number], pivot: readonly [number, number]): ConvertedSheet {
  const file = join(dir, manifest.sheet);
  const errors: string[] = [];
  if (!existsSync(file)) return { manifest, file, scale: 0, poses: [], errors: [], waiting: true };
  const img = readPng(file);
  const figs = splitFigures(foregroundMask(img), img.w, img.h);
  if (figs.length !== manifest.poses.length) {
    return { manifest, file, scale: 0, poses: [], errors: [`${manifest.sheet}: found ${figs.length} figures, the manifest lists ${manifest.poses.length} poses`] };
  }
  if (manifest.poses[0]?.role !== 'anchor') errors.push(`${manifest.sheet}: the first pose must be the anchor`);
  const scale = anchorScale(figs[0]!, CHARACTER_HEIGHT);
  const poses = figs.map((f, i) => convertFigure(img, f, scale, pal, cell, pivot, manifest.poses[i]!));
  for (const p of poses) if (p.outside) errors.push(`${manifest.sheet}: ${p.entry.anim ?? 'anchor'} #${p.entry.index ?? 0}: ${p.outside} pixels outside the ${cell[0]}x${cell[1]} cell`);
  return { manifest, file, scale, poses, errors };
}

/** Convert the approved reference image (a single figure) into the canonical sprite. */
export function convertReference(file: string, pal: Palette, cell: readonly [number, number], pivot: readonly [number, number]): ConvertedPose {
  const img = readPng(file);
  const figs = splitFigures(foregroundMask(img), img.w, img.h);
  if (!figs.length) throw new Error(`${file}: no figure found`);
  const main = figs.reduce((a, b) => (b.pixels.length > a.pixels.length ? b : a));
  return convertFigure(img, main, anchorScale(main, CHARACTER_HEIGHT), pal, cell, pivot, { role: 'anchor' });
}

/** Indexed sprite → hex canvas rows (for io.ts). */
export function toHex(s: Indexed, pal: Palette): string[] {
  return Array.from(s.px, (k) => (k < 0 ? '' : pal.entries[k]!.hex));
}
