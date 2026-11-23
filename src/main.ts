/**
 * Boot and game loop: requestAnimationFrame + accumulator, fixed 1/60 s sim steps.
 */
import { FixedStep } from './fixed_step';
import { InputManager } from './input/input_manager';
import { BossFightScene } from './scenes/boss_fight';
import type { Game, Scene } from './scenes/scene';
import { TitleScene } from './scenes/title';
import { TrainingScene } from './scenes/training';
import { Screen, BASE_HEIGHT, BASE_WIDTH } from './view/screen';
import { dim, font, text } from './view/text';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const screen = new Screen(canvas);
const input = new InputManager();
const loop = new FixedStep();

let scene: Scene;
const game: Game = {
  input,
  screen,
  simFps: 0,
  goTitle: () => (scene = new TitleScene(game)),
  goFight: () => (scene = new BossFightScene(game)),
  goTraining: () => (scene = new TrainingScene(game)),
};
game.goTitle();

// Pause everything while the canvas doesn't have focus.
let focusPaused = false;
canvas.addEventListener('blur', () => {
  focusPaused = true;
  input.keyboard.clear();
  input.clearActions();
});
canvas.addEventListener('focus', () => (focusPaused = false));
canvas.addEventListener('mousedown', () => canvas.focus());
canvas.focus();
if (!document.hasFocus() || document.activeElement !== canvas) focusPaused = true;

let stepsThisSecond = 0;
let secondStart = performance.now();

function tick(now: number): void {
  const steps = loop.advance(now);
  const actions = input.pollActions();
  if (!focusPaused) {
    scene.update(steps, actions);
    stepsThisSecond += steps;
  }
  if (now - secondStart >= 1000) {
    game.simFps = Math.round((stepsThisSecond * 1000) / (now - secondStart));
    stepsThisSecond = 0;
    secondStart = now;
  }
  scene.render();
  if (focusPaused) {
    const o = screen.beginOverlay();
    dim(o, 0.6, BASE_WIDTH, BASE_HEIGHT);
    o.font = font(10);
    text(o, 'Click to resume', BASE_WIDTH / 2, BASE_HEIGHT / 2 - 5, '#fff', 'center');
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
