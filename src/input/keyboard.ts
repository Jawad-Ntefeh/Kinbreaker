/** Keyboard device: tracks held keys by KeyboardEvent.code. */
import type { Bindings } from './bindings';
import type { Button } from '../combat/types';
import { BUTTONS } from '../combat/types';
import type { DeviceReading, DirFlags } from './input_core';

export class Keyboard {
  private held = new Set<string>();
  /** Keys pressed since the last sample, so taps shorter than a frame still register. */
  private latched = new Set<string>();
  private readonly bound: Set<string>;
  /** Called on every bound keydown (not repeats) — used for last-device tracking and meta keys. */
  onKeyDown: ((code: string) => void) | null = null;
  lastActivity = 0;

  constructor(
    private readonly bindings: Bindings,
    target: Window = window,
  ) {
    const k = bindings.keyboard;
    this.bound = new Set<string>([
      ...Object.values(k.dirs).flat(),
      ...Object.values(k.buttons).flat(),
      ...Object.values(k.meta).flat(),
      ...Object.values(k.menu).flat(),
      ...Object.values(k.debug).flat(),
    ]);
    target.addEventListener('keydown', (e) => {
      if (!this.bound.has(e.code)) return;
      e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.latched.add(e.code);
      this.lastActivity = performance.now();
      this.onKeyDown?.(e.code);
    });
    target.addEventListener('keyup', (e) => {
      if (!this.bound.has(e.code)) return;
      e.preventDefault();
      this.held.delete(e.code);
    });
    target.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  /** Forget presses that haven't been sampled yet (e.g. menu presses when a scene changes). */
  clearLatched(): void {
    this.latched.clear();
  }

  clear(): void {
    this.held.clear();
    this.latched.clear();
  }

  private isDown(codes: readonly string[]): boolean {
    return codes.some((c) => this.held.has(c) || this.latched.has(c));
  }

  /** Read the current state once per sim frame. */
  sample(): DeviceReading {
    const k = this.bindings.keyboard;
    const dirs: DirFlags = {
      up: this.isDown(k.dirs.up),
      down: this.isDown(k.dirs.down),
      left: this.isDown(k.dirs.left),
      right: this.isDown(k.dirs.right),
    };
    const held = new Set<Button>();
    for (const b of BUTTONS) if (this.isDown(k.buttons[b])) held.add(b);
    this.latched.clear();
    return { dirs, held };
  }
}
