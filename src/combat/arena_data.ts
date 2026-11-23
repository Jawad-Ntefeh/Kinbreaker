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
  const def: ArenaDef = {
    id: str('id'),
    name: str('name'),
    width: num('width', 100),
    startGap: num('start_gap', 0),
    breakableLeftWall: num('breakable_left_wall', 0),
  };
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
