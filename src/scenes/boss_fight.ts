/**
 * Corvane boss fight: intro banner, the fight, defeat ("FALLEN") and victory ("ANCESTOR LAID TO REST").
 * Stage timers count sim frames (fixed 60 Hz), so they don't depend on the display rate.
 */
import { CorvaneAI } from '../ai/corvane_ai';
import type { CombatSim } from '../combat/combat_sim';
import { NEUTRAL_INPUT } from '../combat/types';
import { createCorvaneFight } from '../fights';
import { keyLabel } from '../input/bindings';
import type { Action } from '../input/input_manager';
import { BossHud } from '../view/hud';
import { BASE_HEIGHT, BASE_WIDTH } from '../view/screen';
import { dim, font, text } from '../view/text';
import { type Game, SimScene } from './scene';

export const FLOW = {
  introFrames: 60,
  defeatRunFrames: 60,
  defeatPromptFrames: 90,
  victoryFreezeFrames: 30,
  victoryPromptFrames: 60,
} as const;

type Stage = 'intro' | 'fight' | 'defeat' | 'victory';

export class BossFightScene extends SimScene {
  sim: CombatSim;
  ai: CorvaneAI;
  readonly hud = new BossHud();
  stage: Stage = 'intro';
  /** Frames spent in the current stage. */
  t = 0;

  constructor(game: Game) {
    super(game);
    this.sim = createCorvaneFight(newSeed());
    this.ai = new CorvaneAI(1);
    this.overlay.visible = false;
  }

  restart(): void {
    this.sim = createCorvaneFight(newSeed());
    this.ai = new CorvaneAI(1);
    this.stage = 'intro';
    this.t = 0;
  }

  protected pauseOptions(): string[] {
    return ['Resume', 'Restart fight', 'Quit to title'];
  }

  protected onPauseChoice(choice: string): void {
    if (choice === 'Restart fight') this.restart();
    if (choice === 'Quit to title') this.game.goTitle();
  }

  protected override canStep(): boolean {
    return this.stage === 'fight';
  }

  override update(steps: number, actions: readonly Action[]): void {
    const confirm = !this.pauseMenu && actions.includes('confirm');
    super.update(steps, actions);
    if (!confirm || this.pauseMenu) return;
    if (this.stage === 'defeat' && this.t >= FLOW.defeatRunFrames + FLOW.defeatPromptFrames) this.restart();
    else if (this.stage === 'victory' && this.t >= FLOW.victoryFreezeFrames + FLOW.victoryPromptFrames) this.game.goTitle();
  }

  protected stepOnce(): void {
    this.t++;
    switch (this.stage) {
      case 'intro':
        // No inputs during the intro; the sim doesn't run.
        this.game.input.sample();
        if (this.t >= FLOW.introFrames) this.enter('fight');
        return;
      case 'fight':
        this.simStep(this.game.input.sample());
        if (this.sim.winner === 1) this.enter('defeat');
        if (this.sim.winner === 0) this.enter('victory');
        return;
      case 'defeat':
        if (this.t <= FLOW.defeatRunFrames) this.simStep(NEUTRAL_INPUT);
        return;
      case 'victory':
        // A short freeze, then the sim settles.
        if (this.t > FLOW.victoryFreezeFrames) this.simStep(NEUTRAL_INPUT);
        return;
    }
  }

  private simStep(p1: typeof NEUTRAL_INPUT): void {
    const p2 = this.ai.update(this.sim);
    this.sim.step(p1, p2);
    this.hud.observe(this.sim);
  }

  private enter(stage: Stage): void {
    this.stage = stage;
    this.t = 0;
  }

  private confirmKey(): string {
    return this.game.input.lastDevice === 'gamepad' ? 'A' : keyLabel(this.game.input.bindings.keyboard.menu.confirm[0]!);
  }

  render(): void {
    const screen = this.game.screen;
    const ctx = screen.ctx;
    this.renderer.draw(ctx, this.sim);
    this.hud.draw(ctx, this.sim);
    this.overlay.drawBoxes(ctx, this.sim, this.renderer);
    screen.present();
    const o = screen.beginOverlay();
    this.hud.drawText(o, this.sim);
    const boss = this.sim.fighters[1];
    this.overlay.drawText(o, this.sim, {
      simFps: this.game.simFps,
      modeLabel: `AI: ${this.ai.behaviour} · phase ${boss.phase}`,
      bossLayout: true,
      paused: this.debugPaused ? 'PAUSED  (P resume · O step one frame)' : null,
      controls: 'WASD move · U I J K attack · Space phase · Esc menu · ` debug · P pause · O step',
    });

    const W = BASE_WIDTH;
    const H = BASE_HEIGHT;
    if (this.stage === 'intro' && !this.pauseMenu) {
      const a = Math.min(1, this.t / 10, (FLOW.introFrames - this.t) / 10);
      o.globalAlpha = Math.max(0, a);
      o.fillStyle = 'rgba(0,0,0,0.6)';
      o.fillRect(0, H / 2 - 18, W, 32);
      o.font = font(12);
      text(o, 'CORVANE, THE IRON WRIST', W / 2, H / 2 - 9, '#d9d4c3', 'center');
      o.globalAlpha = 1;
    }
    if (this.stage === 'defeat' && this.t > FLOW.defeatRunFrames) {
      const k = Math.min(1, (this.t - FLOW.defeatRunFrames) / 30);
      dim(o, 0.7 * k, W, H);
      o.font = font(20);
      o.globalAlpha = k;
      text(o, 'FALLEN', W / 2, H / 2 - 16, '#b9a27a', 'center');
      o.globalAlpha = 1;
      if (this.t >= FLOW.defeatRunFrames + FLOW.defeatPromptFrames) {
        o.font = font(7);
        text(o, `Press ${this.confirmKey()} to rise again`, W / 2, H / 2 + 14, '#cfcfd8', 'center');
      }
    }
    if (this.stage === 'victory' && this.t > FLOW.victoryFreezeFrames) {
      const k = Math.min(1, (this.t - FLOW.victoryFreezeFrames) / 30);
      dim(o, 0.6 * k, W, H);
      o.globalAlpha = k;
      o.font = font(14);
      text(o, 'ANCESTOR LAID TO REST', W / 2, H / 2 - 12, '#d8b867', 'center');
      o.globalAlpha = 1;
      if (this.t >= FLOW.victoryFreezeFrames + FLOW.victoryPromptFrames) {
        o.font = font(7);
        text(o, `Press ${this.confirmKey()} to continue`, W / 2, H / 2 + 12, '#cfcfd8', 'center');
      }
    }
    if (boss.state === 'phase_transition') {
      o.font = font(8);
      text(o, 'The Iron Wrist tightens.', W / 2, 60, '#d9d4c3', 'center');
    }
    this.pauseMenu?.draw(o, 'PAUSED');
  }
}

/** A fresh seed per fight (outside the sim; the sim itself is deterministic given the seed). */
function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0]! || 1;
}
