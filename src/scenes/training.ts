/** Training scene: Rook vs the training dummy, with the debug overlay, pause and frame step. */
import { DummyController } from '../ai/dummy';
import type { CombatSim } from '../combat/combat_sim';
import { createTraining } from '../fights';
import { keyLabel } from '../input/bindings';
import type { Action } from '../input/input_manager';
import { drawVersusHud, drawVersusHudText } from '../view/hud';
import { type Game, SimScene } from './scene';

export class TrainingScene extends SimScene {
  sim: CombatSim = createTraining();
  readonly dummy = new DummyController(1);

  constructor(game: Game) {
    super(game);
  }

  protected pauseOptions(): string[] {
    return ['Resume', 'Reset training', 'Quit to title'];
  }

  protected onPauseChoice(choice: string): void {
    if (choice === 'Reset training') {
      this.sim = createTraining();
      this.dummy.setMode(this.dummy.mode);
    }
    if (choice === 'Quit to title') this.game.goTitle();
  }

  protected override handleExtra(a: Action): void {
    if (a === 'cycleDummy') this.dummy.cycleMode();
  }

  protected stepOnce(): void {
    const p1 = this.game.input.sample();
    const p2 = this.dummy.update(this.sim);
    this.sim.step(p1, p2);
  }

  controlsLine(): string {
    if (this.game.input.lastDevice === 'gamepad') {
      return 'D-pad/stick move · X Y A B attack · RB phase · Start menu · ` debug · P pause · O step · T dummy';
    }
    const k = this.game.input.bindings.keyboard;
    const l = (codes: string[]) => keyLabel(codes[0]!);
    const move = [k.dirs.up, k.dirs.left, k.dirs.down, k.dirs.right].map(l).join('');
    const attack = [k.buttons['1'], k.buttons['2'], k.buttons['3'], k.buttons['4']].map(l).join(' ');
    return `${move} move · ${attack} attack · ${l(k.buttons.phase)} phase · ${l(k.debug.debugPause)} pause · ${l(k.debug.frameStep)} step · ${l(k.debug.cycleDummy)} dummy mode`;
  }

  render(): void {
    const screen = this.game.screen;
    this.renderer.draw(screen.ctx, this.sim);
    drawVersusHud(screen.ctx, this.sim);
    this.overlay.drawBoxes(screen.ctx, this.sim, this.renderer);
    screen.present();
    const o = screen.beginOverlay();
    drawVersusHudText(o, this.sim);
    this.overlay.drawText(o, this.sim, {
      simFps: this.game.simFps,
      modeLabel: `dummy: ${this.dummy.mode}  (T)`,
      bossLayout: false,
      paused: this.debugPaused ? 'PAUSED  (P resume · O step one frame)' : null,
      controls: this.controlsLine(),
    });
    this.pauseMenu?.draw(o, 'PAUSED');
  }
}
