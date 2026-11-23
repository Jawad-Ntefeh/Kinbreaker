import { FixedStep } from './fixed_step';
import { Screen } from './view/screen';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const screen = new Screen(canvas);
const loop = new FixedStep();
let frame = 0;
let stepsThisSecond = 0;
let simFps = 0;
let secondStart = performance.now();

function tick(now: number): void {
  const steps = loop.advance(now);
  for (let i = 0; i < steps; i++) {
    frame++;
    stepsThisSecond++;
  }
  if (now - secondStart >= 1000) {
    simFps = stepsThisSecond;
    stepsThisSecond = 0;
    secondStart = now;
  }
  const ctx = screen.ctx;
  ctx.fillStyle = '#101018';
  ctx.fillRect(0, 0, 480, 270);
  ctx.fillStyle = '#b8963e';
  ctx.fillRect(228 + Math.round(Math.sin(frame / 30) * 100), 160, 24, 80);
  screen.present();
  const o = screen.beginOverlay();
  o.fillStyle = '#fff';
  o.font = '6px monospace';
  o.fillText(`sim ${simFps} fps`, 4, 8);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
