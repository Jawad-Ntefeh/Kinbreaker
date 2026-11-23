/**
 * Pure input helpers (no DOM): SOCD cleaning, direction flags → numpad, stick → flags,
 * and merging keyboard + gamepad readings into one snapshot.
 */
import type { Button, InputSnapshot } from '../combat/types';

export interface DirFlags {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** A device reading before cleaning: raw direction flags plus held buttons. */
export interface DeviceReading {
  dirs: DirFlags;
  held: ReadonlySet<Button>;
}

export const NO_DIRS: DirFlags = { up: false, down: false, left: false, right: false };

/** SOCD cleaning: left + right = neutral horizontal, up + down = neutral vertical. */
export function socdClean(f: DirFlags): DirFlags {
  const lr = f.left && f.right;
  const ud = f.up && f.down;
  return {
    left: f.left && !lr,
    right: f.right && !lr,
    up: f.up && !ud,
    down: f.down && !ud,
  };
}

/** Absolute numpad direction from cleaned flags (6 = screen right). */
export function flagsToNumpad(f: DirFlags): number {
  const x = f.right ? 1 : f.left ? -1 : 0;
  const y = f.up ? 1 : f.down ? -1 : 0;
  return 5 + x + y * 3;
}

/** Left stick (x right-positive, y down-positive as in the Gamepad API) to 8-way flags. */
export function stickToFlags(x: number, y: number, deadzone: number): DirFlags {
  const mag = Math.hypot(x, y);
  if (mag < deadzone) return { ...NO_DIRS };
  // 8 sectors of 45°, sector 0 centred on "right".
  const angle = Math.atan2(-y, x); // up-positive
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  const table: [number, number][] = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  const [sx, sy] = table[sector]!;
  return { right: sx > 0, left: sx < 0, up: sy > 0, down: sy < 0 };
}

export function orFlags(a: DirFlags, b: DirFlags): DirFlags {
  return {
    up: a.up || b.up,
    down: a.down || b.down,
    left: a.left || b.left,
    right: a.right || b.right,
  };
}

/** Merge any number of device readings into one cleaned snapshot. */
export function mergeReadings(readings: readonly DeviceReading[]): InputSnapshot {
  let dirs = { ...NO_DIRS };
  const held = new Set<Button>();
  for (const r of readings) {
    dirs = orFlags(dirs, r.dirs);
    for (const b of r.held) held.add(b);
  }
  return { dir: flagsToNumpad(socdClean(dirs)), held };
}
