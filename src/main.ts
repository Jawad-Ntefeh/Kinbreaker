/**
 * Boot and game loop: requestAnimationFrame + accumulator, fixed 1/60 s sim steps.
 */
import { FixedStep } from './fixed_step';
import { InputManager } from './input/input_manager';
import { TrainingScene } from './training';
import { Screen } from './view/screen';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const screen = new Screen(canvas);
const input = new InputManager();
const scene = new TrainingScene(input, canvas);
const loop = new FixedStep();

let stepsThisSecond = 0;
let simFps = 0;
let secondStart = performance.now();

function tick(now: number): void {
  scene.pollMeta();
  const steps = loop.advance(now);
  if (!scene.paused) {
    for (let i = 0; i < steps; i++) {
      scene.stepOnce();
      stepsThisSecond++;
    }
  }
  if (now - secondStart >= 1000) {
    simFps = Math.round((stepsThisSecond * 1000) / (now - secondStart));
    stepsThisSecond = 0;
    secondStart = now;
  }
  scene.render(screen, simFps);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
