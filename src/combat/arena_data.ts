/** Arena data: data/arenas/<id>.json. Pixel values are converted to subpixels. */
import { SUBPX } from './move_data';

export interface ArenaDef {
  id: string;
  name: string;
  /** Subpixels. */
  width: number;
  /** Distance between the fighters' origins at the start, in subpixels. */
  startGap: number;
  /** How far the left wall moves out when it breaks (0 = it never breaks), in subpixels. */
  breakableLeftWall: number;
  /** Background layers, back to front (view only). */
  layers: readonly ArenaLayer[];
  /** Images for the left wall before and after it breaks (view only). */
  leftWall: { intact: string; broken: string } | null;
}

export interface ArenaLayer {
  /** Path relative to public/ (a placeholder is generated if the file doesn't exist). */
  image: string;
  /** 0 = fixed to the screen, 1 = moves with the camera. */
  parallax: number;
  /** Vertical offset in px. */
  y: number;
  /** Tile horizontally. */
  repeat: boolean;
}

export function validateArena(file: string, raw: unknown): { def: ArenaDef | null; errors: string[] } {
  const errors: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (k: string, min: number): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) {
      errors.push(`${file}: ${k}: ${v === undefined ? 'missing' : `must be a number >= ${min}`}`);
      return 0;
    }
    return Math.round(v * SUBPX);
  };
  const str = (k: string): string => {
    if (typeof o[k] !== 'string' || !o[k]) errors.push(`${file}: ${k}: must be a non-empty string`);
    return String(o[k] ?? '');
  };
  const def: { -readonly [K in keyof ArenaDef]: ArenaDef[K] } = {
    id: str('id'),
    name: str('name'),
    width: num('width', 100),
    startGap: num('start_gap', 0),
    breakableLeftWall: num('breakable_left_wall', 0),
    layers: [],
    leftWall: null,
  };
  if (o.layers !== undefined) {
    if (!Array.isArray(o.layers)) errors.push(`${file}: layers: must be an array`);
    else
      o.layers.forEach((l: unknown, i: number) => {
        const r = (l ?? {}) as Record<string, unknown>;
        const f = `${file}: layers[${i}]`;
        if (typeof r.image !== 'string' || !r.image.endsWith('.png')) errors.push(`${f}.image: must be a .png path relative to public/`);
        if (typeof r.parallax !== 'number' || r.parallax < 0 || r.parallax > 1) errors.push(`${f}.parallax: must be a number from 0 to 1`);
        if (r.y !== undefined && !Number.isInteger(r.y)) errors.push(`${f}.y: must be an integer (px)`);
        if (r.repeat !== undefined && typeof r.repeat !== 'boolean') errors.push(`${f}.repeat: must be true or false`);
        def.layers = [...def.layers, { image: String(r.image), parallax: Number(r.parallax), y: Number(r.y ?? 0), repeat: r.repeat === true }];
      });
  }
  if (o.left_wall !== undefined) {
    const lw = o.left_wall as Record<string, unknown>;
    if (typeof lw?.intact !== 'string' || typeof lw?.broken !== 'string') errors.push(`${file}: left_wall: needs "intact" and "broken" image paths`);
    else def.leftWall = { intact: lw.intact, broken: lw.broken };
  }
  if (def.startGap >= def.width) errors.push(`${file}: start_gap: must be smaller than the width`);
  return { def: errors.length ? null : def, errors };
}

let cached: { defs: Map<string, ArenaDef>; errors: string[] } | null = null;

export function loadAllArenas(): { defs: Map<string, ArenaDef>; errors: string[] } {
  if (!cached) {
    const files = import.meta.glob('../../data/arenas/*.json', { eager: true, import: 'default' });
    const defs = new Map<string, ArenaDef>();
    const errors: string[] = [];
    for (const path of Object.keys(files).sort()) {
      const { def, errors: e } = validateArena(`data/arenas/${path.split('/').pop()}`, files[path]);
      errors.push(...e);
      if (def) defs.set(def.id, def);
    }
    cached = { defs, errors };
  }
  return cached;
}

export function getArena(id: string): ArenaDef {
  const { defs, errors } = loadAllArenas();
  if (errors.length) throw new Error(`Invalid arena data:\n${errors.join('\n')}`);
  const a = defs.get(id);
  if (!a) throw new Error(`No arena "${id}"`);
  return a;
}
