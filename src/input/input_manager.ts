/**
 * The only thing in the game that reads devices. Produces one InputSnapshot per sim frame
 * by merging keyboard and gamepad, and tracks the last device used for button prompts.
 */
import { DEFAULT_BINDINGS, type Bindings } from './bindings';
import { GamepadInput } from './gamepad';
import { Keyboard } from './keyboard';
import { mergeReadings } from './input_core';
import type { InputSnapshot } from '../combat/types';

export type Device = 'keyboard' | 'gamepad';

export class InputManager {
  readonly keyboard: Keyboard;
  readonly gamepad: GamepadInput;

  constructor(readonly bindings: Bindings = DEFAULT_BINDINGS) {
    this.keyboard = new Keyboard(bindings);
    this.gamepad = new GamepadInput(bindings);
  }

  get lastDevice(): Device {
    return this.gamepad.lastActivity > this.keyboard.lastActivity ? 'gamepad' : 'keyboard';
  }

  /** Call exactly once per sim frame. */
  sample(): InputSnapshot {
    return mergeReadings([this.keyboard.sample(), this.gamepad.sample()]);
  }
}
