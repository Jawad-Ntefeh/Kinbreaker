/**
 * The default animation layout for a character: every state and move animation, how many key
 * poses each has and how long each pose is held. Pure logic. Used by the placeholder sprites, the
 * sample animation file for the artist, and docs/ART_SPEC.md, so all three always agree with the
 * frame data.
 */
import type { CharacterDef } from '../combat/character_data';
import type { Move, MoveSet } from '../combat/move_data';
import artSpec from '../../data/art_spec.json';
import type { StateAnim } from './anim_select';

export interface SheetSpec {
  cell: [number, number];
  pivot: [number, number];
  columns: number;
  color: string;
}

/** Cell layout rule: this much room behind the pivot, and this much past the furthest hitbox. */
export const CELL_BEHIND = 53;
export const CELL_MARGIN = 11;
/** Cell widths are rounded up to a multiple of this. */
export const CELL_ROUND = 8;

/** Furthest hitbox reach in front of the pivot, in px, over all of a move set. */
export function maxReach(moves: MoveSet): number {
  let r = 0;
  for (const m of moves.values()) for (const h of m.hitboxes) r = Math.max(r, Math.ceil((h.x + h.w) / 100));
  return r;
}

/**
 * Cell size from the data: front of the cell = furthest hitbox reach + 8 px, behind the pivot = 40 px,
 * width rounded up to a multiple of 8. Height and the pivot's height are kept from data/art_spec.json.
 */
export function computeCell(moves: MoveSet, height: number, pivotY: number): { cell: [number, number]; pivot: [number, number] } {
  const width = Math.ceil((CELL_BEHIND + maxReach(moves) + CELL_MARGIN) / CELL_ROUND) * CELL_ROUND;
  return { cell: [width, height], pivot: [CELL_BEHIND, pivotY] };
}

/** Sheet layout for a character; characters listed in "shared" use another character's sheet. */
export function sheetSpec(id: string): { spec: SheetSpec; sheetOf: string } | null {
  const shared = (artSpec.shared as Record<string, string>)[id];
  const sheetOf = shared ?? id;
  const spec = (artSpec.characters as unknown as Record<string, SheetSpec>)[sheetOf];
  return spec ? { spec, sheetOf } : null;
}

export interface StateSpec {
  name: StateAnim;
  poses: number;
  /** Sim frames per pose. */
  dur: number;
  loop: boolean;
  required: boolean;
  /** Only for characters with a boss section. */
  bossOnly?: boolean;
  note: string;
}

export const STATE_SPECS: readonly StateSpec[] = [
  { name: 'idle', poses: 4, dur: 10, loop: true, required: true, note: 'guard up, breathing' },
  { name: 'walk_forward', poses: 6, dur: 6, loop: true, required: true, note: '' },
  { name: 'walk_back', poses: 6, dur: 6, loop: true, required: true, note: 'guard stays up (walking back blocks)' },
  { name: 'crouch', poses: 2, dur: 4, loop: false, required: true, note: 'second pose is held' },
  { name: 'block_stand', poses: 1, dur: 8, loop: false, required: true, note: '' },
  { name: 'block_crouch', poses: 1, dur: 8, loop: false, required: true, note: '' },
  { name: 'dash_forward', poses: 3, dur: 5, loop: false, required: false, note: '' },
  { name: 'backdash', poses: 3, dur: 6, loop: false, required: false, note: '' },
  { name: 'phase_step', poses: 3, dur: 6, loop: false, required: true, note: 'readable as a sidestep; afterimages are added by the game' },
  { name: 'hitstun_high', poses: 2, dur: 6, loop: false, required: true, note: 'head snaps back' },
  { name: 'hitstun_mid', poses: 2, dur: 6, loop: false, required: true, note: 'doubles over' },
  { name: 'hitstun_low', poses: 2, dur: 6, loop: false, required: false, note: 'legs knocked; falls back to hitstun_mid' },
  { name: 'blockstun_stand', poses: 1, dur: 8, loop: false, required: true, note: '' },
  { name: 'blockstun_crouch', poses: 1, dur: 8, loop: false, required: false, note: 'falls back to blockstun_stand' },
  { name: 'airborne', poses: 3, dur: 8, loop: false, required: true, note: 'launched and juggled' },
  { name: 'knockdown', poses: 2, dur: 6, loop: false, required: true, note: 'second pose (lying) is held' },
  { name: 'wake_up', poses: 3, dur: 7, loop: false, required: true, note: '20 frames, invulnerable' },
  { name: 'thrown', poses: 2, dur: 10, loop: false, required: false, note: '' },
  { name: 'throw_break', poses: 2, dur: 10, loop: false, required: true, note: '' },
  { name: 'wall_splat', poses: 2, dur: 10, loop: false, required: true, note: 'pinned to the wall while sliding down' },
  { name: 'stagger', poses: 4, dur: 8, loop: true, required: true, note: 'poise broken' },
  { name: 'guard_break', poses: 3, dur: 8, loop: false, required: true, note: '' },
  { name: 'ko', poses: 3, dur: 8, loop: false, required: true, note: 'last pose is held' },
  { name: 'intro', poses: 6, dur: 10, loop: false, required: true, note: 'boss intro banner' },
  { name: 'victory', poses: 6, dur: 10, loop: false, required: false, note: '' },
  { name: 'phase_transition', poses: 6, dur: 15, loop: false, required: true, bossOnly: true, note: '90 frames, invulnerable' },
];

export type MovePhase = 'startup' | 'smear' | 'impact' | 'recovery';

export interface PoseKey {
  anim: string;
  /** Pose index within the animation and the number of poses. */
  index: number;
  of: number;
  move: Move | null;
  phase: MovePhase | null;
  state: StateAnim | null;
}

export interface LayoutFrame {
  cell: number;
  dur: number;
  impact?: true;
}

/** Split `total` frames into `n` poses as evenly as possible (earlier poses get the remainder). */
function split(total: number, n: number): number[] {
  const base = Math.trunc(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

export const MIN_MOVE_POSES = 3;
export const MAX_MOVE_POSES = 7;

/** Heavy moves get a smear frame right before the impact frame. */
export function hasSmear(m: Move): boolean {
  return m.damage >= 20 || m.properties.includes('launcher');
}

/**
 * Key poses for a move: wind-up poses, a smear frame for heavy moves (damage >= 20 or launcher),
 * one impact pose (held for the active frames), recovery poses. 3 to 7 poses in total.
 */
export function movePoses(m: Move): { phase: MovePhase; dur: number }[] {
  const s = m.startup - 1;
  const smear = hasSmear(m) && s >= 2;
  const smearDur = smear ? (s >= 6 ? 2 : 1) : 0;
  const wind = s - smearDur;
  let startupPoses = wind <= 0 ? 0 : wind <= 6 ? 1 : wind <= 14 ? 2 : 3;
  const r = m.recovery;
  let recoveryPoses = r <= 0 ? 0 : r <= 8 ? 1 : r <= 20 ? 2 : 3;
  // Keep within 7 poses: drop recovery poses first, then wind-up poses (never below one).
  while (startupPoses + (smear ? 1 : 0) + 1 + recoveryPoses > MAX_MOVE_POSES) {
    if (recoveryPoses > 1) recoveryPoses--;
    else if (startupPoses > 1) startupPoses--;
    else break;
  }
  return [
    ...split(wind, startupPoses).map((dur) => ({ phase: 'startup' as const, dur })),
    ...(smear ? [{ phase: 'smear' as const, dur: smearDur }] : []),
    { phase: 'impact', dur: m.active },
    ...split(r, recoveryPoses).map((dur) => ({ phase: 'recovery' as const, dur })),
  ];
}

export interface DefaultLayout {
  /** A complete animation file (as written to JSON). */
  json: {
    sheet: string;
    cell: [number, number];
    pivot: [number, number];
    sheet_cells: [number, number];
    anims: Record<string, { loop?: true; move?: string; frames: LayoutFrame[] }>;
  };
  /** What each cell shows, for drawing placeholders. */
  cells: PoseKey[];
}

/** Every animation the character needs, with one cell per key pose. */
export function defaultLayout(def: CharacterDef, moves: MoveSet): DefaultLayout {
  const sheet = sheetSpec(def.id);
  if (!sheet) throw new Error(`data/art_spec.json has no sheet for "${def.id}"`);
  const { spec } = sheet;
  const cells: PoseKey[] = [];
  const anims: DefaultLayout['json']['anims'] = {};
  for (const st of STATE_SPECS) {
    if (st.bossOnly && !def.boss) continue;
    const frames: LayoutFrame[] = [];
    for (let i = 0; i < st.poses; i++) {
      frames.push({ cell: cells.length, dur: st.dur });
      cells.push({ anim: st.name, index: i, of: st.poses, move: null, phase: null, state: st.name });
    }
    anims[st.name] = st.loop ? { loop: true, frames } : { frames };
  }
  const sorted = [...moves.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const m of sorted) {
    const poses = movePoses(m);
    const frames: LayoutFrame[] = poses.map((p, i) => {
      cells.push({ anim: m.id, index: i, of: poses.length, move: m, phase: p.phase, state: null });
      return p.phase === 'impact' ? { cell: cells.length - 1, dur: p.dur, impact: true } : { cell: cells.length - 1, dur: p.dur };
    });
    anims[m.id] = { move: m.id, frames };
  }
  const rows = Math.ceil(cells.length / spec.columns);
  return {
    json: { sheet: `art/characters/${def.id}.png`, cell: spec.cell, pivot: spec.pivot, sheet_cells: [spec.columns, rows], anims },
    cells,
  };
}
