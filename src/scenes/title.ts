/** Title menu: KINBREAKER — Fight Corvane / Training. */
import type { Action } from '../input/input_manager';
import { BASE_HEIGHT, BASE_WIDTH } from '../view/screen';
import { drawMenu, font, text } from '../view/text';
import { type Game, Menu, type Scene } from './scene';

export class TitleScene implements Scene {
  private readonly menu = new Menu(['Fight Corvane', 'Training']);
  private tick = 0;

  constructor(private readonly game: Game) {}

  update(_steps: number, actions: readonly Action[]): void {
    this.tick++;
    const choice = this.menu.handle(actions.filter((a) => a !== 'back'));
    if (choice === 'Fight Corvane') this.game.goFight();
    if (choice === 'Training') this.game.goTraining();
  }

  render(): void {
    const s = this.game.screen;
    const ctx = s.ctx;
    ctx.fillStyle = '#0e0d12';
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);
    // A thin gold line under the title.
    ctx.fillStyle = '#6e5a2a';
    ctx.fillRect(BASE_WIDTH / 2 - 90, 108, 180, 1);
    s.present();
    const o = s.beginOverlay();
    o.font = font(28);
    text(o, 'KINBREAKER', BASE_WIDTH / 2, 70, '#d8b867', 'center');
    drawMenu(o, this.menu.options, this.menu.selected, BASE_WIDTH / 2, 140, 9);
    o.font = font(6);
    const pad = this.game.input.lastDevice === 'gamepad';
    text(o, pad ? 'D-pad to choose · A to select' : 'W/S or arrows to choose · U or Enter to select', BASE_WIDTH / 2, 236, '#77778a', 'center');
    void this.tick;
  }
}
