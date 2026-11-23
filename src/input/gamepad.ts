/** Gamepad device: polls navigator.getGamepads() (standard mapping only). */
import type { Bindings, MetaAction } from './bindings';
import type { Button } from '../combat/types';
import { BUTTONS } from '../combat/types';
import { NO_DIRS, orFlags, stickToFlags, type DeviceReading, type DirFlags } from './input_core';

export class GamepadInput {
  private prevMeta = new Map<MetaAction, boolean>();
  private prevAnyDown = false;
  lastActivity = 0;
  connected = false;

  constructor(private readonly bindings: Bindings) {}

  private pads(): Gamepad[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return navigator.getGamepads().filter((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard');
  }

  /** Poll once per sim frame. Merges all connected standard pads. */
  sample(): DeviceReading {
    const g = this.bindings.gamepad;
    let dirs: DirFlags = { ...NO_DIRS };
    const held = new Set<Button>();
    const pads = this.pads();
    this.connected = pads.length > 0;
    let anyDown = false;
    for (const pad of pads) {
      const down = (idx: number[]) => idx.some((i) => pad.buttons[i]?.pressed ?? false);
      dirs = orFlags(dirs, {
        up: down(g.dirs.up),
        down: down(g.dirs.down),
        left: down(g.dirs.left),
        right: down(g.dirs.right),
      });
      dirs = orFlags(dirs, stickToFlags(pad.axes[0] ?? 0, pad.axes[1] ?? 0, g.stickDeadzone));
      for (const b of BUTTONS) if (down(g.buttons[b])) held.add(b);
      if (pad.buttons.some((b) => b.pressed)) anyDown = true;
    }
    if (dirs.up || dirs.down || dirs.left || dirs.right) anyDown = true;
    if (anyDown && !this.prevAnyDown) this.lastActivity = performance.now();
    this.prevAnyDown = anyDown;
    return { dirs, held };
  }

  /** Edge-triggered meta actions (e.g. Start → pause). Poll once per animation frame. */
  metaPressed(action: MetaAction): boolean {
    const idx = this.bindings.gamepad.meta[action];
    const now = this.pads().some((p) => idx.some((i) => p.buttons[i]?.pressed ?? false));
    const was = this.prevMeta.get(action) ?? false;
    this.prevMeta.set(action, now);
    return now && !was;
  }
}
