/**
 * The only thing in the game that reads devices. Produces one InputSnapshot per sim frame
 * by merging keyboard and gamepad, and tracks the last device used for button prompts.
 */
import { DEFAULT_BINDINGS, type Bindings, type DebugAction, type MenuAction } from './bindings';
import { GamepadInput } from './gamepad';
import { Keyboard } from './keyboard';
import { mergeReadings } from './input_core';
import type { InputSnapshot } from '../combat/types';

export type Device = 'keyboard' | 'gamepad';

/** Edge-triggered actions for menus, pause and debug keys, collected once per animation frame. */
export type Action = MenuAction | 'pause' | DebugAction;

export class InputManager {
  readonly keyboard: Keyboard;
  readonly gamepad: GamepadInput;

  private readonly keyQueue: string[] = [];
  private readonly codeActions = new Map<string, Action[]>();

  constructor(readonly bindings: Bindings = DEFAULT_BINDINGS) {
    this.keyboard = new Keyboard(bindings);
    this.gamepad = new GamepadInput(bindings);
    this.keyboard.onKeyDown = (code) => this.keyQueue.push(code);
    const k = bindings.keyboard;
    const add = (codes: string[], a: Action) => {
      for (const c of codes) this.codeActions.set(c, [...(this.codeActions.get(c) ?? []), a]);
    };
    for (const [a, codes] of Object.entries(k.menu)) add(codes, a as Action);
    for (const [a, codes] of Object.entries(k.debug)) add(codes, a as Action);
    add(k.meta.pause, 'pause');
  }

  /** All actions triggered since the last call (keyboard and controller). Call once per animation frame. */
  pollActions(): Action[] {
    const out: Action[] = [];
    for (const code of this.keyQueue.splice(0)) out.push(...(this.codeActions.get(code) ?? []));
    for (const a of ['up', 'down', 'confirm', 'back'] as const) if (this.gamepad.menuPressed(a)) out.push(a);
    if (this.gamepad.metaPressed('pause')) out.push('pause');
    return out;
  }

  /** Discard queued presses (e.g. when focus is lost). */
  clearActions(): void {
    this.keyQueue.length = 0;
  }

  get lastDevice(): Device {
    return this.gamepad.lastActivity > this.keyboard.lastActivity ? 'gamepad' : 'keyboard';
  }

  /** Call exactly once per sim frame. */
  sample(): InputSnapshot {
    return mergeReadings([this.keyboard.sample(), this.gamepad.sample()]);
  }
}
