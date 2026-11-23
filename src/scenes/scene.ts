/** Scene plumbing shared by the title, training and boss fight scenes. */
import type { CombatSim } from '../combat/combat_sim';
import type { Action, InputManager } from '../input/input_manager';
import { DebugOverlay } from '../view/debug_overlay';
import { Effects } from '../view/effects';
import { Renderer } from '../view/renderer';
import type { Screen } from '../view/screen';
import { BASE_HEIGHT, BASE_WIDTH } from '../view/screen';
import { dim, drawMenu, font, text } from '../view/text';

export interface Game {
  readonly input: InputManager;
  readonly screen: Screen;
  simFps: number;
  goTitle(): void;
  goFight(): void;
  goTraining(): void;
}

export interface Scene {
  /** Called once per animation frame with the sim steps due and the actions pressed. */
  update(steps: number, actions: readonly Action[]): void;
  render(): void;
}

/** A small vertical menu driven by up/down/confirm/back actions. */
export class Menu {
  selected = 0;
  constructor(readonly options: readonly string[]) {}

  /** Returns the chosen option, 'back', or null. */
  handle(actions: readonly Action[]): string | null {
    for (const a of actions) {
      if (a === 'up') this.selected = (this.selected + this.options.length - 1) % this.options.length;
      if (a === 'down') this.selected = (this.selected + 1) % this.options.length;
      if (a === 'confirm') return this.options[this.selected]!;
      if (a === 'back') return 'back';
    }
    return null;
  }

  draw(o: CanvasRenderingContext2D, title: string, y = 133): void {
    dim(o, 0.6, BASE_WIDTH, BASE_HEIGHT);
    o.font = font(13);
    text(o, title, BASE_WIDTH / 2, y, '#ffffff', 'center');
    drawMenu(o, this.options, this.selected, BASE_WIDTH / 2, y + 29);
  }
}

/** Base for scenes that run a CombatSim: debug overlay, P pause, O frame step, Esc menu. */
export abstract class SimScene implements Scene {
  abstract sim: CombatSim;
  readonly renderer = new Renderer();
  readonly overlay = new DebugOverlay();
  fx = new Effects();
  debugPaused = false;
  pauseMenu: Menu | null = null;

  constructor(protected readonly game: Game) {}

  protected abstract pauseOptions(): string[];
  protected abstract onPauseChoice(choice: string): void;
  /** Advance exactly one sim frame. */
  protected abstract stepOnce(): void;
  /** Whether the sim may run this frame (e.g. not during an intro). */
  protected canStep(): boolean {
    return true;
  }
  protected handleExtra(_a: Action): void {}

  update(steps: number, actions: readonly Action[]): void {
    if (this.pauseMenu) {
      const choice = this.pauseMenu.handle(actions.filter((a) => a !== 'pause'));
      const closing = actions.includes('pause') || choice === 'back' || choice === 'Resume';
      if (closing) this.pauseMenu = null;
      else if (choice) {
        this.pauseMenu = null;
        this.onPauseChoice(choice);
      }
      return;
    }
    for (const a of actions) {
      if (a === 'pause') {
        this.pauseMenu = new Menu(this.pauseOptions());
        return;
      }
      if (a === 'toggleOverlay') this.overlay.visible = !this.overlay.visible;
      if (a === 'debugPause') this.debugPaused = !this.debugPaused;
      if (a === 'frameStep' && this.debugPaused && this.canStep()) this.stepOnce();
      if (a === 'cycleSprites') this.renderer.cycleSpriteMode();
      this.handleExtra(a);
    }
    if (this.debugPaused) return;
    for (let i = 0; i < steps; i++) this.stepOnce();
  }

  abstract render(): void;
}
