/**
 * Character data: data/characters/<id>.json (health, poise, walk speeds, hurtbox, limbs, boss phases).
 * Validated on load; pixel values are converted to subpixels.
 */
import type { FighterConfig, Limbs } from './fighter';
import { getMoveSet, SUBPX } from './move_data';

export interface BossConfig {
  /** Phase 2 starts when a hit takes health to this percent or below. */
  phase2HealthPercent: number;
  transitionFrames: number;
  /** Frame of the transition on which the arena wall breaks. */
  wallBreakFrame: number;
  /** Subpixels the opponent is pushed back at the start of the transition. */
  transitionPushback: number;
  /** Moves only available in phase 2. */
  phase2Moves: readonly string[];
  /** Moves that can be used only once per fight. */
  oncePerFight: readonly string[];
}

export interface CharacterDef {
  id: string;
  name: string;
  moveset: string;
  health: number;
  poise: number;
  walkForward: number;
  walkBack: number;
  dash: { frames: number; speed: number };
  backdash: { frames: number; speed: number };
  body: { halfWidth: number; height: number; crouchHeight: number };
  limbs: Limbs;
  boss: BossConfig | null;
}

export interface CharacterError {
  file: string;
  field: string;
  problem: string;
}

const px = (v: number): number => Math.round(v * SUBPX);

export function validateCharacter(file: string, raw: unknown): { def: CharacterDef | null; errors: CharacterError[] } {
  const errors: CharacterError[] = [];
  const err = (field: string, problem: string) => errors.push({ file, field, problem });
  if (typeof raw !== 'object' || raw === null) {
    err('(root)', 'must be a JSON object');
    return { def: null, errors };
  }
  const o = raw as Record<string, unknown>;
  const get = (path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
  const num = (path: string, min: number, integer = false): number => {
    const v = get(path);
    if (typeof v !== 'number' || !Number.isFinite(v)) err(path, v === undefined ? 'missing' : 'must be a number');
    else if (integer && !Number.isInteger(v)) err(path, 'must be an integer');
    else if (v < min) err(path, `must be >= ${min}`);
    else return v;
    return 0;
  };
  const str = (path: string): string => {
    const v = get(path);
    if (typeof v !== 'string' || !v) err(path, v === undefined ? 'missing' : 'must be a non-empty string');
    else return v;
    return '';
  };
  const strList = (path: string): string[] => {
    const v = get(path);
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
      err(path, 'must be an array of move ids');
      return [];
    }
    return v as string[];
  };

  const id = str('id');
  const fileBase = file.split('/').pop()!.replace(/\.json$/, '');
  if (id && id !== fileBase) err('id', `"${id}" must match the file name "${fileBase}"`);
  const limbs = {} as Limbs;
  for (const l of ['left_arm', 'right_arm', 'left_leg', 'right_leg'] as const) {
    const v = get(`limbs.${l}`);
    if (typeof v !== 'boolean') err(`limbs.${l}`, 'must be true or false');
    limbs[l] = v === true;
  }
  let boss: BossConfig | null = null;
  if (o.boss !== undefined) {
    boss = {
      phase2HealthPercent: num('boss.phase2_health_percent', 1, true),
      transitionFrames: num('boss.transition_frames', 1, true),
      wallBreakFrame: num('boss.wall_break_frame', 1, true),
      transitionPushback: px(num('boss.transition_pushback', 0)),
      phase2Moves: strList('boss.phase2_moves'),
      oncePerFight: strList('boss.once_per_fight'),
    };
  }
  const def: CharacterDef = {
    id,
    name: str('name'),
    moveset: str('moveset'),
    health: num('health', 1, true),
    poise: num('poise', 1, true),
    walkForward: px(num('walk_forward', 0)),
    walkBack: px(num('walk_back', 0)),
    dash: { frames: num('dash.frames', 1, true), speed: px(num('dash.speed', 0)) },
    backdash: { frames: num('backdash.frames', 1, true), speed: px(num('backdash.speed', 0)) },
    body: {
      halfWidth: px(num('hurtbox.width', 2) / 2),
      height: px(num('hurtbox.height', 1)),
      crouchHeight: px(num('hurtbox.crouch_height', 1)),
    },
    limbs,
    boss,
  };
  if (def.body.crouchHeight > def.body.height) err('hurtbox.crouch_height', 'must not be taller than hurtbox.height');
  return { def: errors.length ? null : def, errors };
}

let cached: { defs: Map<string, CharacterDef>; errors: CharacterError[] } | null = null;

export function loadAllCharacters(): { defs: Map<string, CharacterDef>; errors: CharacterError[] } {
  if (!cached) {
    const files = import.meta.glob('../../data/characters/*.json', { eager: true, import: 'default' });
    const defs = new Map<string, CharacterDef>();
    const errors: CharacterError[] = [];
    for (const path of Object.keys(files).sort()) {
      const file = `data/characters/${path.split('/').pop()}`;
      const { def, errors: e } = validateCharacter(file, files[path]);
      errors.push(...e);
      if (def) defs.set(def.id, def);
    }
    cached = { defs, errors };
  }
  return cached;
}

export function getCharacter(id: string): CharacterDef {
  const { defs, errors } = loadAllCharacters();
  if (errors.length) throw new Error(`Invalid character data:\n${errors.map((e) => `${e.file}: ${e.field}: ${e.problem}`).join('\n')}`);
  const def = defs.get(id);
  if (!def) throw new Error(`No character "${id}"`);
  return def;
}

/** Everything the sim needs to create a fighter for this character. */
export function fighterConfig(id: string): FighterConfig {
  const def = getCharacter(id);
  const moves = getMoveSet(def.moveset);
  for (const m of def.boss ? [...def.boss.phase2Moves, ...def.boss.oncePerFight] : []) {
    if (!moves.has(m)) throw new Error(`data/characters/${id}.json: boss move "${m}" does not exist in moveset ${def.moveset}`);
  }
  return { ...def, moves };
}
