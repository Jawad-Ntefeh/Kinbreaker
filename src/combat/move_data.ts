/**
 * Move data: types, validation and loading of data/moves/<character>/*.json.
 * Pixel values in the files are converted to subpixels (1 px = 100 units) on load.
 * Pure logic apart from the import.meta.glob call (resolved by Vite/Vitest at build time).
 */
import type { Button } from './types';

export const SUBPX = 100;
/** A glint shows from frame startup-14; a glinted move needs a startup longer than this to show it. */
const SYSTEM_GLINT_MIN_STARTUP = 6;

export const LIMBS = ['left_arm', 'right_arm', 'left_leg', 'right_leg', 'core', 'none'] as const;
export const HEIGHTS = ['high', 'mid', 'low', 'throw'] as const;
export const PATHS = ['linear', 'sweeping'] as const;
export const PROPERTIES = ['launcher', 'knockdown', 'wall_splat', 'armor', 'counter_hit_launch', 'ground_hit'] as const;
export const CANCEL_ON = ['hit', 'block', 'whiff'] as const;
export const OUTCOME_WORDS = ['knockdown', 'launch'] as const;

export type Limb = (typeof LIMBS)[number];
export type Height = (typeof HEIGHTS)[number];
export type Path = (typeof PATHS)[number];
export type MoveProperty = (typeof PROPERTIES)[number];
export type CancelOn = (typeof CANCEL_ON)[number];
/** Frame advantage, or a non-numeric outcome for moves that knock down or launch. */
export type Outcome = number | (typeof OUTCOME_WORDS)[number];

/** A box in subpixels, written for a fighter facing right. y is the bottom edge above the ground. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FramedBox extends Box {
  frames: readonly [number, number];
}
export interface Hitbox extends FramedBox {
  /** A move hits the same target at most once per group. */
  group: number;
}
export interface MovementStep {
  frame: number;
  /** Subpixels per frame, forward-positive. */
  dx: number;
}

export interface ParsedInput {
  /** Multi-step motion such as "236" or "66", relative to facing. */
  motion: string | null;
  /** Single held direction such as 2 or 6, relative to facing. */
  dir: number | null;
  buttons: readonly Button[];
}

export interface Move {
  id: string;
  name: string;
  character: string;
  limb: Limb;
  inputText: string;
  input: ParsedInput;
  startup: number;
  active: number;
  recovery: number;
  /** Total frames: startup - 1 + active + recovery. */
  total: number;
  /** Last active frame: startup + active - 1. */
  lastActive: number;
  damage: number;
  poiseDamage: number;
  height: Height;
  path: Path;
  onBlock: number | null;
  onHit: Outcome;
  onCounterHit: Outcome;
  properties: readonly MoveProperty[];
  hitboxes: readonly Hitbox[];
  hurtboxOverrides: readonly FramedBox[];
  movement: readonly MovementStep[];
  cancelInto: readonly string[];
  cancelWindow: readonly [number, number] | null;
  cancelOn: readonly CancelOn[];
  /** Only reachable as a cancel from another move (e.g. the second hit of a string). */
  cancelOnly: boolean;
  /** Telegraphed attack: shows a glint before it becomes active. */
  glint: boolean;
  /** Frames during which hits don't interrupt the move. */
  armorFrames: readonly [number, number] | null;
  /** Extra recovery when the move hits nothing. */
  whiffRecovery: number;
  /**
   * Linked part of a multi-hit move: starts automatically (no input) at the first frame of the
   * previous part's cancel window, but only if the previous part connected in one of these ways.
   */
  continueOn: readonly CancelOn[];
  throwBreak: Button | null;
  /** Throw range in subpixels, measured from the thrower's origin to the target's front edge. */
  throwRange: number;
}

export type MoveSet = ReadonlyMap<string, Move>;

export interface MoveError {
  file: string;
  field: string;
  problem: string;
}

export function formatError(e: MoveError): string {
  return `${e.file}: ${e.field}: ${e.problem}`;
}

const KNOWN_FIELDS = new Set([
  'id', 'name', 'limb', 'input', 'startup', 'active', 'recovery', 'damage', 'poise_damage',
  'height', 'path', 'on_block', 'on_hit', 'on_counter_hit', 'properties', 'hitboxes',
  'hurtbox_overrides', 'movement', 'cancel_into', 'cancel_window', 'cancel_on', 'cancel_only',
  'break', 'range', 'glint', 'armor_frames', 'whiff_recovery', 'continue_on',
]);

/**
 * Parse an input string: optional direction/motion in numpad digits, ":", then buttons joined by "+".
 * Returns the parsed input or an error message.
 */
export function parseInput(text: string): ParsedInput | string {
  if (typeof text !== 'string' || text.length === 0) return 'must be a non-empty string';
  let dirPart: string | null = null;
  let btnPart = text;
  const colon = text.indexOf(':');
  if (colon >= 0) {
    dirPart = text.slice(0, colon);
    btnPart = text.slice(colon + 1);
    if (!/^[1-9]+$/.test(dirPart)) return `direction "${dirPart}" must be numpad digits 1-9`;
  }
  const buttons = btnPart.split('+');
  const valid: Button[] = [];
  for (const b of buttons) {
    if (b !== '1' && b !== '2' && b !== '3' && b !== '4') return `button "${b}" must be 1, 2, 3 or 4`;
    if (valid.includes(b)) return `button "${b}" is repeated`;
    valid.push(b);
  }
  if (valid.length > 2) return 'at most two buttons can be pressed together';
  let motion: string | null = null;
  let dir: number | null = null;
  if (dirPart !== null) {
    if (dirPart.length === 1) dir = Number(dirPart);
    else motion = dirPart;
  }
  return { motion, dir, buttons: valid };
}

/** Validate one raw move object. Returns the move (or null) and every error found. */
export function validateMove(file: string, character: string, raw: unknown): { move: Move | null; errors: MoveError[] } {
  const errors: MoveError[] = [];
  const err = (field: string, problem: string) => errors.push({ file, field, problem });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    err('(root)', 'must be a JSON object');
    return { move: null, errors };
  }
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KNOWN_FIELDS.has(k)) err(k, 'unknown field');

  const str = (field: string): string => {
    const v = o[field];
    if (v === undefined) err(field, 'missing');
    else if (typeof v !== 'string' || v.length === 0) err(field, 'must be a non-empty string');
    else return v;
    return '';
  };
  const int = (field: string, min: number, required = true): number => {
    const v = o[field];
    if (v === undefined) {
      if (required) err(field, 'missing');
      return 0;
    }
    if (typeof v !== 'number' || !Number.isInteger(v)) err(field, `must be an integer, got ${JSON.stringify(v)}`);
    else if (v < min) err(field, `must be >= ${min}, got ${v}`);
    else return v;
    return 0;
  };
  function oneOf<T extends string>(field: string, allowed: readonly T[]): T {
    const v = o[field];
    if (v === undefined) err(field, 'missing');
    else if (typeof v !== 'string' || !allowed.includes(v as T)) err(field, `unknown value ${JSON.stringify(v)} (expected ${allowed.join(' | ')})`);
    else return v as T;
    return allowed[0]!;
  }
  function list<T extends string>(field: string, allowed: readonly T[] | null, required = true): T[] {
    const v = o[field];
    if (v === undefined) {
      if (required) err(field, 'missing');
      return [];
    }
    if (!Array.isArray(v)) {
      err(field, 'must be an array');
      return [];
    }
    const out: T[] = [];
    v.forEach((x, i) => {
      if (typeof x !== 'string') err(`${field}[${i}]`, 'must be a string');
      else if (allowed && !allowed.includes(x as T)) err(`${field}[${i}]`, `unknown value ${JSON.stringify(x)} (expected ${allowed.join(' | ')})`);
      else out.push(x as T);
    });
    return out;
  }
  const outcome = (field: string, required: boolean): Outcome | null => {
    const v = o[field];
    if (v === undefined || v === null) {
      if (required) err(field, v === null ? 'must not be null' : 'missing');
      return null;
    }
    if (typeof v === 'number' && Number.isInteger(v)) return v;
    if (typeof v === 'string' && (OUTCOME_WORDS as readonly string[]).includes(v)) return v as Outcome;
    err(field, `must be an integer or one of ${OUTCOME_WORDS.join(' | ')}, got ${JSON.stringify(v)}`);
    return null;
  };
  const px = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * SUBPX) : null);

  const id = str('id');
  const fileBase = file.split('/').pop()!.replace(/\.json$/, '');
  if (id && id !== fileBase) err('id', `"${id}" must match the file name "${fileBase}"`);
  const name = str('name');
  const limb = oneOf('limb', LIMBS);
  const inputText = str('input');
  let input: ParsedInput = { motion: null, dir: null, buttons: [] };
  if (inputText) {
    const p = parseInput(inputText);
    if (typeof p === 'string') err('input', `invalid input "${inputText}": ${p}`);
    else input = p;
  }
  const startup = int('startup', 1);
  const active = int('active', 1);
  const recovery = int('recovery', 0);
  const damage = int('damage', 0);
  const poiseDamage = int('poise_damage', 0);
  const height = oneOf('height', HEIGHTS);
  const path = oneOf('path', PATHS);
  const isThrow = height === 'throw';

  let onBlock: number | null = null;
  if (isThrow) {
    if (o.on_block !== undefined && o.on_block !== null) err('on_block', 'throws cannot be blocked: use null');
  } else {
    const ob = outcome('on_block', true);
    if (typeof ob === 'string') err('on_block', 'must be an integer');
    else onBlock = ob;
  }
  const onHit = outcome('on_hit', true) ?? 0;
  const onCounterHit = outcome('on_counter_hit', false) ?? onHit;
  const properties = list('properties', PROPERTIES);

  const total = startup - 1 + active + recovery;
  const lastActive = startup + active - 1;

  const frames = (field: string, v: unknown, lo: number, hi: number, what: string): [number, number] | null => {
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => Number.isInteger(n))) {
      err(field, 'must be [first, last] integers');
      return null;
    }
    const [a, b] = v as [number, number];
    if (a > b) err(field, `first frame ${a} is after last frame ${b}`);
    else if (a < lo || b > hi) err(field, `frames [${a}, ${b}] are outside the ${what} [${lo}, ${hi}]`);
    else return [a, b];
    return null;
  };
  const box = (field: string, v: unknown): Box | null => {
    if (typeof v !== 'object' || v === null) {
      err(field, 'must be an object');
      return null;
    }
    const b = v as Record<string, unknown>;
    const x = px(b.x);
    const y = px(b.y);
    const w = px(b.w);
    const h = px(b.h);
    if (x === null || y === null || w === null || h === null) {
      err(field, 'needs numeric x, y, w, h');
      return null;
    }
    if (w <= 0 || h <= 0) {
      err(field, 'w and h must be positive');
      return null;
    }
    return { x, y, w, h };
  };

  const hitboxes: Hitbox[] = [];
  if (!Array.isArray(o.hitboxes)) err('hitboxes', o.hitboxes === undefined ? 'missing' : 'must be an array');
  else {
    o.hitboxes.forEach((hb: unknown, i: number) => {
      const f = `hitboxes[${i}]`;
      const b = box(f, hb);
      const fr = frames(`${f}.frames`, (hb as Record<string, unknown>)?.frames, startup, lastActive, 'active window');
      const groupRaw = (hb as Record<string, unknown>)?.group;
      if (groupRaw !== undefined && !Number.isInteger(groupRaw)) err(`${f}.group`, 'must be an integer');
      if (b && fr) hitboxes.push({ ...b, frames: fr, group: typeof groupRaw === 'number' ? groupRaw : 0 });
    });
    if (!isThrow && o.hitboxes.length === 0) err('hitboxes', 'attacks need at least one hitbox');
  }

  const hurtboxOverrides: FramedBox[] = [];
  if (o.hurtbox_overrides !== undefined) {
    if (!Array.isArray(o.hurtbox_overrides)) err('hurtbox_overrides', 'must be an array');
    else
      o.hurtbox_overrides.forEach((hb: unknown, i: number) => {
        const f = `hurtbox_overrides[${i}]`;
        const b = box(f, hb);
        const fr = frames(`${f}.frames`, (hb as Record<string, unknown>)?.frames, 1, total, 'move');
        if (b && fr) hurtboxOverrides.push({ ...b, frames: fr });
      });
  } else err('hurtbox_overrides', 'missing (use [])');

  const movement: MovementStep[] = [];
  if (o.movement !== undefined) {
    if (!Array.isArray(o.movement)) err('movement', 'must be an array');
    else
      o.movement.forEach((m: unknown, i: number) => {
        const f = `movement[${i}]`;
        const r = m as Record<string, unknown>;
        if (typeof r !== 'object' || r === null || !Number.isInteger(r.frame) || px(r.dx) === null) {
          err(f, 'must be { "frame": integer, "dx": number }');
          return;
        }
        const frame = r.frame as number;
        if (frame < 1 || frame > total) err(`${f}.frame`, `frame ${frame} is outside the move [1, ${total}]`);
        else if (movement.length && frame <= movement[movement.length - 1]!.frame) err(`${f}.frame`, 'frames must be increasing');
        else movement.push({ frame, dx: px(r.dx)! });
      });
  } else err('movement', 'missing (use [])');

  const cancelInto = list('cancel_into', null);
  const cancelOn = list('cancel_on', CANCEL_ON, false);
  let cancelWindow: [number, number] | null = null;
  if (o.cancel_window !== undefined && o.cancel_window !== null) {
    cancelWindow = frames('cancel_window', o.cancel_window, 1, total, 'move');
  }
  if (cancelInto.length > 0 && !cancelWindow) err('cancel_window', 'required when cancel_into is not empty');

  let cancelOnly = false;
  if (o.cancel_only !== undefined) {
    if (typeof o.cancel_only !== 'boolean') err('cancel_only', 'must be true or false');
    else cancelOnly = o.cancel_only;
  }

  // Derived stun must be at least 1 frame, or the authored advantage can't happen.
  const remainingAfterFirstActive = active - 1 + recovery;
  for (const [field, v] of [['on_block', onBlock], ['on_hit', onHit], ['on_counter_hit', onCounterHit]] as const) {
    if (typeof v === 'number' && v + remainingAfterFirstActive < 1) {
      err(field, `${v} needs at least ${1 - v - (active - 1)} recovery frames (stun = ${field} + active - 1 + recovery must be >= 1), recovery is ${recovery}`);
    }
  }
  let glint = false;
  if (o.glint !== undefined) {
    if (typeof o.glint !== 'boolean') err('glint', 'must be true or false');
    else glint = o.glint;
    if (glint && startup <= SYSTEM_GLINT_MIN_STARTUP) err('glint', `glinted moves need startup > ${SYSTEM_GLINT_MIN_STARTUP} so the glint can show`);
  }
  let armorFrames: [number, number] | null = null;
  if (o.armor_frames !== undefined && o.armor_frames !== null) armorFrames = frames('armor_frames', o.armor_frames, 1, total, 'move');
  const whiffRecovery = int('whiff_recovery', 0, false);
  const continueOn = list('continue_on', CANCEL_ON, false);

  let throwBreak: Button | null = null;
  let throwRange = 0;
  if (isThrow) {
    if (o.break !== '1' && o.break !== '2') err('break', `throws need "break": "1" or "2", got ${JSON.stringify(o.break)}`);
    else throwBreak = o.break;
    const r = px(o.range);
    if (r === null || r <= 0) err('range', 'throws need a positive "range" in px');
    else throwRange = r;
  } else {
    if (o.break !== undefined) err('break', 'only throws can have a break button');
    if (o.range !== undefined) err('range', 'only throws can have a range');
  }

  if (errors.length > 0) return { move: null, errors };
  return {
    move: {
      id, name, character, limb, inputText, input, startup, active, recovery, total, lastActive,
      damage, poiseDamage, height, path, onBlock, onHit, onCounterHit, properties, hitboxes,
      hurtboxOverrides, movement, cancelInto, cancelWindow, cancelOn, cancelOnly, glint, armorFrames,
      whiffRecovery, continueOn, throwBreak, throwRange,
    },
    errors,
  };
}

/**
 * Validate and load a set of move files keyed by path (".../moves/<character>/<id>.json").
 * Cross-file checks (cancel_into targets, duplicate ids) happen here.
 */
export function loadMoveFiles(files: Readonly<Record<string, unknown>>): { sets: Map<string, MoveSet>; errors: MoveError[] } {
  const errors: MoveError[] = [];
  const sets = new Map<string, Map<string, Move>>();
  // Sort paths so loading order (and error order) is deterministic.
  for (const path of Object.keys(files).sort()) {
    const m = /moves\/([^/]+)\/([^/]+)\.json$/.exec(path);
    const file = m ? `data/moves/${m[1]}/${m[2]}.json` : path;
    if (!m) {
      errors.push({ file, field: '(path)', problem: 'move files must be data/moves/<character>/<id>.json' });
      continue;
    }
    const character = m[1]!;
    const { move, errors: e } = validateMove(file, character, files[path]);
    errors.push(...e);
    if (!move) continue;
    let set = sets.get(character);
    if (!set) sets.set(character, (set = new Map()));
    if (set.has(move.id)) errors.push({ file, field: 'id', problem: `duplicate move id "${move.id}"` });
    set.set(move.id, move);
  }
  for (const [character, set] of sets) {
    for (const move of set.values()) {
      move.cancelInto.forEach((target, i) => {
        if (!set.has(target)) {
          errors.push({
            file: `data/moves/${character}/${move.id}.json`,
            field: `cancel_into[${i}]`,
            problem: `move "${target}" does not exist for ${character}`,
          });
        }
      });
    }
  }
  return { sets, errors };
}

let cached: { sets: Map<string, MoveSet>; errors: MoveError[] } | null = null;

/** Load every file in data/moves/ (bundled at build time). */
export function loadAllMoves(): { sets: Map<string, MoveSet>; errors: MoveError[] } {
  if (!cached) {
    const files = import.meta.glob('../../data/moves/*/*.json', { eager: true, import: 'default' });
    cached = loadMoveFiles(files);
  }
  return cached;
}

/** The move set for one character; throws with every validation error if any file is invalid. */
export function getMoveSet(character: string): MoveSet {
  const { sets, errors } = loadAllMoves();
  if (errors.length > 0) throw new Error(`Invalid move data:\n${errors.map(formatError).join('\n')}`);
  const set = sets.get(character);
  if (!set) throw new Error(`No moves found for character "${character}"`);
  return set;
}

/** The hitstun/blockstun-producing advantage value, if numeric. */
export function numeric(o: Outcome | null): number | null {
  return typeof o === 'number' ? o : null;
}
