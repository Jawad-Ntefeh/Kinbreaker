/**
 * InputBuffer: pure logic. Receives one input snapshot per sim frame and answers questions
 * about recent input (presses, simultaneous presses, motions). Directions are stored in
 * ABSOLUTE numpad notation and converted to facing-relative when queried, so turning
 * around mid-motion works.
 */
import { BUTTON_BIT, BUTTONS, heldMask, toRelative, type Button } from './types';
import { hashInt } from './hash';

export const HISTORY_FRAMES = 30;
const LOG_SIZE = 32;

/** Motions where some (diagonal) steps may be skipped, for keyboard players. */
const OPTIONAL_STEPS: Readonly<Record<string, readonly boolean[]>> = {
  '236': [false, true, false],
  '214': [false, true, false],
  '623': [false, true, false],
};

interface LogEntry {
  dir: number; // absolute
  pressed: number; // mask of buttons pressed on the first frame of the entry
  frames: number;
}

export class InputBuffer {
  /** Number of frames pushed so far. The current frame is frameCount - 1. */
  private frameCount = 0;
  private readonly dirs = new Int8Array(HISTORY_FRAMES);
  private readonly held = new Uint8Array(HISTORY_FRAMES);
  private readonly pressedBits = new Uint8Array(HISTORY_FRAMES);
  private readonly releasedBits = new Uint8Array(HISTORY_FRAMES);
  private readonly consumedBits = new Uint8Array(HISTORY_FRAMES);
  /** Motions may only use frames after this frame (set when a motion move starts). */
  private motionMark = -1;
  private readonly log: LogEntry[] = [];

  constructor() {
    this.dirs.fill(5);
  }

  /** Push one frame of input. `dirAbsolute` is absolute numpad (6 = screen right). */
  push(dirAbsolute: number, held: ReadonlySet<Button> | number): void {
    const mask = typeof held === 'number' ? held : heldMask(held);
    const prevHeld = this.frameCount > 0 ? this.held[this.idx(this.frameCount - 1)]! : 0;
    const i = this.idx(this.frameCount);
    this.dirs[i] = dirAbsolute;
    this.held[i] = mask;
    this.pressedBits[i] = mask & ~prevHeld;
    this.releasedBits[i] = prevHeld & ~mask;
    this.consumedBits[i] = 0;
    this.frameCount++;

    const pressed = this.pressedBits[i]!;
    const last = this.log[this.log.length - 1];
    if (!last || last.dir !== dirAbsolute || pressed !== 0) {
      this.log.push({ dir: dirAbsolute, pressed, frames: 1 });
      if (this.log.length > LOG_SIZE) this.log.shift();
    } else {
      last.frames++;
    }
  }

  get frame(): number {
    return this.frameCount - 1;
  }

  private idx(frame: number): number {
    return ((frame % HISTORY_FRAMES) + HISTORY_FRAMES) % HISTORY_FRAMES;
  }

  /** Frames available to look back on, capped by `window` and the history size. */
  private span(window: number): number {
    return Math.max(0, Math.min(window, HISTORY_FRAMES, this.frameCount));
  }

  isHeld(button: Button): boolean {
    if (this.frameCount === 0) return false;
    return (this.held[this.idx(this.frameCount - 1)]! & BUTTON_BIT[button]) !== 0;
  }

  /** Was `button` pressed exactly on the current frame? */
  pressedNow(button: Button): boolean {
    if (this.frameCount === 0) return false;
    return (this.pressedBits[this.idx(this.frameCount - 1)]! & BUTTON_BIT[button]) !== 0;
  }

  releasedNow(button: Button): boolean {
    if (this.frameCount === 0) return false;
    return (this.releasedBits[this.idx(this.frameCount - 1)]! & BUTTON_BIT[button]) !== 0;
  }

  /**
   * Age (0 = this frame) of the most recent press of `button` within `window` frames,
   * or -1 if none. Consumed presses are skipped unless `includeConsumed`.
   */
  pressAge(button: Button, window = 6, includeConsumed = false): number {
    const bit = BUTTON_BIT[button];
    const n = this.span(window);
    for (let age = 0; age < n; age++) {
      const i = this.idx(this.frameCount - 1 - age);
      if ((this.pressedBits[i]! & bit) === 0) continue;
      if (!includeConsumed && (this.consumedBits[i]! & bit) !== 0) continue;
      return age;
    }
    return -1;
  }

  /** The button went down within the last `window` frames and hasn't been consumed. */
  pressed(button: Button, window = 6): boolean {
    return this.pressAge(button, window) >= 0;
  }

  /** Marks the button's buffered presses as used, so one press can't trigger two moves. */
  consume(button: Button): void {
    const bit = BUTTON_BIT[button];
    const n = this.span(HISTORY_FRAMES);
    for (let age = 0; age < n; age++) {
      const i = this.idx(this.frameCount - 1 - age);
      if (this.pressedBits[i]! & bit) this.consumedBits[i]! |= bit;
    }
  }

  /**
   * Both buttons pressed (unconsumed) within `window` frames of each other, and both
   * within the last `recent` frames.
   */
  together(a: Button, b: Button, window = 2, recent = 6): boolean {
    const ages = (btn: Button): number[] => {
      const bit = BUTTON_BIT[btn];
      const out: number[] = [];
      const n = this.span(recent);
      for (let age = 0; age < n; age++) {
        const i = this.idx(this.frameCount - 1 - age);
        if ((this.pressedBits[i]! & bit) && !(this.consumedBits[i]! & bit)) out.push(age);
      }
      return out;
    };
    const aa = ages(a);
    const bb = ages(b);
    for (const x of aa) for (const y of bb) if (Math.abs(x - y) <= window) return true;
    return false;
  }

  /** Current facing-relative direction. */
  heldDir(facing: number): number {
    if (this.frameCount === 0) return 5;
    return toRelative(this.dirs[this.idx(this.frameCount - 1)]!, facing);
  }

  /** Facing-relative direction `age` frames ago. */
  dirAt(age: number, facing: number): number {
    if (age >= this.frameCount || age >= HISTORY_FRAMES) return 5;
    return toRelative(this.dirs[this.idx(this.frameCount - 1 - age)]!, facing);
  }

  /**
   * Detect a motion such as 236, 214, 623, 66, 44, 22 within the last `window` frames.
   * Keyboard-friendly: the diagonal in 236/214 may be skipped, and 623 accepts 6 then 3.
   */
  motion(sequence: string, facing: number, window = 12): boolean {
    // Compress the relative direction history (oldest first) into runs.
    const n = Math.min(this.span(window), this.frameCount - 1 - this.motionMark);
    if (n <= 0) return false;
    const runs: number[] = [];
    for (let age = n - 1; age >= 0; age--) {
      const d = this.dirAt(age, facing);
      if (runs[runs.length - 1] !== d) runs.push(d);
    }
    const steps = sequence.split('').map(Number);

    // Double taps (66, 44, 22): d, then something else, then d again (still held now).
    if (steps.length === 2 && steps[0] === steps[1]) {
      const d = steps[0]!;
      const L = runs.length;
      return L >= 3 && runs[L - 1] === d && runs[L - 2] !== d && runs.slice(0, L - 2).includes(d);
    }

    const optional = OPTIONAL_STEPS[sequence] ?? steps.map(() => false);
    return matchSubsequence(runs, steps, optional);
  }

  /** Prevent the directions entered so far from being reused for another motion. */
  consumeMotions(): void {
    this.motionMark = this.frameCount - 1;
  }

  /** Recent distinct inputs, newest first, in facing-relative numpad notation. */
  historyEntries(n: number, facing = 1): string[] {
    const out: string[] = [];
    for (let k = this.log.length - 1; k >= 0 && out.length < n; k--) {
      const e = this.log[k]!;
      const parts = [String(toRelative(e.dir, facing))];
      for (const b of BUTTONS) if (e.pressed & BUTTON_BIT[b]) parts.push(b === 'phase' ? 'P' : b);
      out.push(parts.join('+'));
    }
    return out;
  }

  historyString(n: number, facing = 1): string {
    return this.historyEntries(n, facing).join('  ');
  }

  hashInto(h: number): number {
    h = hashInt(h, this.frameCount);
    h = hashInt(h, this.motionMark);
    for (let i = 0; i < HISTORY_FRAMES; i++) {
      h = hashInt(h, this.dirs[i]!);
      h = hashInt(h, this.held[i]!);
      h = hashInt(h, this.pressedBits[i]!);
      h = hashInt(h, this.consumedBits[i]!);
    }
    return h;
  }
}

/** Ordered subsequence match where optional steps may be skipped. */
function matchSubsequence(runs: readonly number[], steps: readonly number[], optional: readonly boolean[]): boolean {
  // Try from each starting run; greedy works because steps are distinct digits.
  let si = 0;
  for (let ri = 0; ri < runs.length && si < steps.length; ri++) {
    const r = runs[ri]!;
    if (r === steps[si]) {
      si++;
      continue;
    }
    // Allow skipping optional steps if the run matches a later required step.
    let sj = si;
    while (sj < steps.length && optional[sj] && r !== steps[sj]) sj++;
    if (sj > si && sj < steps.length && r === steps[sj] && si > 0) si = sj + 1;
  }
  return si >= steps.length;
}
