/**
 * Animation files: data/anims/<character>.json. Pure logic (no DOM): types, validation, loading.
 *
 * A move animation is synced to the sim: its playhead is the move's own frame counter. So:
 *   1. the impact frame starts on the move's first active frame (durations before it = startup - 1),
 *   2. durations add up to the move's total length (startup + active - 1 + recovery),
 *   3. the impact frame lasts at least as long as the active frames,
 *   4. every cell exists in the sheet.
 */
import { loadAllCharacters } from '../combat/character_data';
import { loadAllMoves, type MoveSet } from '../combat/move_data';

export interface AnimFrame {
  cell: number;
  /** Sim frames (60 per second). */
  dur: number;
  impact: boolean;
}

export interface Anim {
  name: string;
  loop: boolean;
  /** Move id this animation is synced to, or null for a state animation. */
  move: string | null;
  frames: readonly AnimFrame[];
  /** Sum of all durations. */
  total: number;
}

export interface AnimFile {
  /** Character id (file name). */
  id: string;
  /** Sheet path relative to public/ (e.g. "art/characters/rook.png"). */
  sheet: string;
  cell: readonly [number, number];
  pivot: readonly [number, number];
  /** Sheet grid [columns, rows] as written in the file (checked in Node; the real image is checked at load). */
  sheetCells: readonly [number, number] | null;
  anims: ReadonlyMap<string, Anim>;
}

export function cellCount(f: AnimFile): number | null {
  return f.sheetCells ? f.sheetCells[0] * f.sheetCells[1] : null;
}

const pair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0);

/**
 * Validate an animation file against the character's moves. `cells` overrides the sheet size
 * (used once the real image has loaded). Messages: "<file>: <anim>: <problem>".
 */
export function validateAnimFile(
  file: string,
  raw: unknown,
  moves: MoveSet,
  cells?: number,
): { def: AnimFile | null; errors: string[] } {
  const errors: string[] = [];
  const err = (where: string, problem: string) => errors.push(`${file}: ${where}: ${problem}`);
  if (typeof raw !== 'object' || raw === null) {
    err('(root)', 'must be a JSON object');
    return { def: null, errors };
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.sheet !== 'string' || !o.sheet.endsWith('.png')) err('sheet', 'must be a .png path relative to public/');
  if (!pair(o.cell) || o.cell[0] === 0 || o.cell[1] === 0) err('cell', 'must be [width, height] in pixels');
  if (!pair(o.pivot)) err('pivot', 'must be [x, y] inside the cell');
  else if (pair(o.cell) && (o.pivot[0] >= o.cell[0] || o.pivot[1] >= o.cell[1])) err('pivot', `[${o.pivot}] is outside the ${o.cell[0]}x${o.cell[1]} cell`);
  let sheetCells: [number, number] | null = null;
  if (o.sheet_cells !== undefined) {
    if (!pair(o.sheet_cells) || o.sheet_cells[0] === 0 || o.sheet_cells[1] === 0) err('sheet_cells', 'must be [columns, rows]');
    else sheetCells = o.sheet_cells;
  }
  const maxCells = cells ?? (sheetCells ? sheetCells[0] * sheetCells[1] : null);

  const anims = new Map<string, Anim>();
  if (typeof o.anims !== 'object' || o.anims === null) err('anims', 'missing');
  else {
    for (const [name, a] of Object.entries(o.anims as Record<string, unknown>)) {
      const ar = a as Record<string, unknown>;
      if (typeof ar !== 'object' || ar === null || !Array.isArray(ar.frames) || ar.frames.length === 0) {
        err(name, 'needs a non-empty "frames" list');
        continue;
      }
      const frames: AnimFrame[] = [];
      ar.frames.forEach((fr: unknown, i: number) => {
        const f = fr as Record<string, unknown>;
        if (!Number.isInteger(f?.cell) || (f.cell as number) < 0) err(name, `frame ${i + 1}: "cell" must be an integer >= 0`);
        else if (maxCells !== null && (f.cell as number) >= maxCells) err(name, `frame ${i + 1}: cell ${f.cell} does not exist (the sheet has ${maxCells} cells)`);
        if (!Number.isInteger(f?.dur) || (f.dur as number) < 1) err(name, `frame ${i + 1}: "dur" must be an integer >= 1 (sim frames)`);
        frames.push({ cell: Number(f?.cell) | 0, dur: Number(f?.dur) | 0, impact: f?.impact === true });
      });
      const total = frames.reduce((s, f) => s + f.dur, 0);
      const move = typeof ar.move === 'string' ? ar.move : null;
      if (ar.move !== undefined && move === null) err(name, '"move" must be a move id');
      if (move) {
        const m = moves.get(move);
        if (!m) err(name, `move "${move}" does not exist`);
        else {
          const impacts = frames.map((f, i) => (f.impact ? i : -1)).filter((i) => i >= 0);
          if (impacts.length !== 1) err(name, `needs exactly one frame with "impact": true, found ${impacts.length}`);
          else {
            const idx = impacts[0]!;
            const start = frames.slice(0, idx).reduce((s, f) => s + f.dur, 0) + 1;
            if (start !== m.startup) err(name, `impact starts on frame ${start}, move is active on frame ${m.startup}`);
            if (frames[idx]!.dur < m.active) err(name, `impact lasts ${frames[idx]!.dur} frames, the move is active for ${m.active}`);
          }
          if (total !== m.total) err(name, `durations add up to ${total} frames, the move lasts ${m.total}`);
          // Every hitbox must fit in the cell: in front of the pivot, and below the cell's top.
          if (pair(o.cell) && pair(o.pivot)) {
            const front = o.cell[0] - o.pivot[0];
            for (const h of m.hitboxes) {
              const reach = Math.ceil((h.x + h.w) / 100);
              const top = Math.ceil((h.y + h.h) / 100);
              if (reach > front) err(name, `hitbox reaches ${reach} px in front of the pivot, the cell has ${front} px (widen the cell: reach + 8, rounded up to a multiple of 8)`);
              if (top > o.pivot[1]) err(name, `hitbox reaches ${top} px above the floor, the cell has ${o.pivot[1]} px above the pivot`);
            }
          }
        }
      } else if (frames.some((f) => f.impact)) err(name, '"impact" is only for move animations');
      anims.set(name, { name, loop: ar.loop === true, move, frames, total });
    }
  }
  if (errors.length) return { def: null, errors };
  return {
    def: {
      id: file.split('/').pop()!.replace(/\.json$/, ''),
      sheet: o.sheet as string,
      cell: o.cell as [number, number],
      pivot: o.pivot as [number, number],
      sheetCells,
      anims,
    },
    errors,
  };
}

/** The frame index shown at a 1-based move frame (frames past the end hold the last one, e.g. whiff recovery). */
export function frameAtMoveFrame(anim: Anim, moveFrame: number): number {
  let t = 0;
  for (let i = 0; i < anim.frames.length; i++) {
    t += anim.frames[i]!.dur;
    if (moveFrame <= t) return i;
  }
  return anim.frames.length - 1;
}

/** The frame index at a tick of a state animation (loops, or holds the last frame). */
export function frameAtTick(anim: Anim, tick: number): number {
  let t = anim.loop ? tick % anim.total : Math.min(tick, anim.total - 1);
  for (let i = 0; i < anim.frames.length; i++) {
    t -= anim.frames[i]!.dur;
    if (t < 0) return i;
  }
  return anim.frames.length - 1;
}

let cachedFiles: { files: Map<string, AnimFile>; errors: string[] } | null = null;

/** Load and validate every data/anims/<character>.json against that character's moves. */
export function loadAnimFiles(): { files: Map<string, AnimFile>; errors: string[] } {
  if (!cachedFiles) {
    const raw = import.meta.glob('../../data/anims/*.json', { eager: true, import: 'default' });
    const chars = loadAllCharacters().defs;
    const moveSets = loadAllMoves().sets;
    const files = new Map<string, AnimFile>();
    const errors: string[] = [];
    for (const path of Object.keys(raw).sort()) {
      const id = path.split('/').pop()!.replace(/\.json$/, '');
      const file = `data/anims/${id}.json`;
      const ch = chars.get(id);
      if (!ch) {
        errors.push(`${file}: (file): no character "${id}" in data/characters/`);
        continue;
      }
      const { def, errors: e } = validateAnimFile(file, raw[path], moveSets.get(ch.moveset) ?? new Map());
      errors.push(...e);
      if (def) files.set(id, def);
    }
    cachedFiles = { files, errors };
  }
  return cachedFiles;
}
