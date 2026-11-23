/**
 * All key and controller bindings live here, so a rebinding menu can be added later.
 * Keyboard bindings use KeyboardEvent.code (physical key position), never .key.
 */
import type { Button } from '../combat/types';

export type DirAction = 'up' | 'down' | 'left' | 'right';
export type MetaAction = 'pause';
export type MenuAction = 'up' | 'down' | 'confirm' | 'back';
export type DebugAction = 'toggleOverlay' | 'debugPause' | 'frameStep' | 'cycleDummy' | 'cycleSprites';

export interface Bindings {
  keyboard: {
    dirs: Record<DirAction, string[]>;
    buttons: Record<Button, string[]>;
    meta: Record<MetaAction, string[]>;
    menu: Record<MenuAction, string[]>;
    /** Training-scene only. Never F1–F12 (the browser uses them). */
    debug: Record<DebugAction, string[]>;
  };
  /** Standard Gamepad mapping button indices (Xbox layout names in comments). */
  gamepad: {
    dirs: Record<DirAction, number[]>;
    buttons: Record<Button, number[]>;
    meta: Record<MetaAction, number[]>;
    menu: Record<MenuAction, number[]>;
    /** Left stick deadzone (0..1), mapped to 8 directions. */
    stickDeadzone: number;
  };
}

export const DEFAULT_BINDINGS: Bindings = {
  keyboard: {
    dirs: {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
    },
    buttons: {
      '1': ['KeyU'],
      '2': ['KeyI'],
      '3': ['KeyJ'],
      '4': ['KeyK'],
      phase: ['Space', 'KeyL'],
    },
    meta: {
      pause: ['Escape'],
    },
    menu: {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      confirm: ['KeyU', 'Enter'],
      back: ['Escape'],
    },
    debug: {
      toggleOverlay: ['Backquote'],
      debugPause: ['KeyP'],
      frameStep: ['KeyO'],
      cycleDummy: ['KeyT'],
      cycleSprites: ['KeyH'],
    },
  },
  gamepad: {
    dirs: {
      up: [12],
      down: [13],
      left: [14],
      right: [15],
    },
    buttons: {
      '1': [2], // X
      '2': [3], // Y
      '3': [0], // A
      '4': [1], // B
      phase: [5], // RB
    },
    meta: {
      pause: [9], // Start
    },
    menu: {
      up: [12],
      down: [13],
      confirm: [0], // A
      back: [1], // B
    },
    stickDeadzone: 0.5,
  },
};

/** Short labels for on-screen prompts. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Backquote') return '`';
  return code;
}
