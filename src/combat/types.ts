/** Shared input types. Pure data, no DOM. */

export type Button = '1' | '2' | '3' | '4' | 'phase';
export const BUTTONS: readonly Button[] = ['1', '2', '3', '4', 'phase'];

/** Bit for each button, used for compact storage in the sim. */
export const BUTTON_BIT: Readonly<Record<Button, number>> = {
  '1': 1,
  '2': 2,
  '3': 4,
  '4': 8,
  phase: 16,
};

/** One frame of input. `dir` is ABSOLUTE numpad notation (6 = screen right). */
export interface InputSnapshot {
  dir: number;
  held: ReadonlySet<Button>;
}

export const NEUTRAL_INPUT: InputSnapshot = { dir: 5, held: new Set() };

export function heldMask(held: ReadonlySet<Button>): number {
  let m = 0;
  for (const b of BUTTONS) if (held.has(b)) m |= BUTTON_BIT[b];
  return m;
}

/** Convert an absolute numpad direction to one relative to facing (and back: the mapping is its own inverse). */
export function toRelative(dir: number, facing: number): number {
  if (facing >= 0) return dir;
  switch (dir) {
    case 1: return 3;
    case 3: return 1;
    case 4: return 6;
    case 6: return 4;
    case 7: return 9;
    case 9: return 7;
    default: return dir;
  }
}
export const toAbsolute = toRelative;
