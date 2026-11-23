import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../src/input/bindings';
import type { Action, InputManager } from '../src/input/input_manager';
import { BossFightScene, FLOW } from '../src/scenes/boss_fight';
import type { Game } from '../src/scenes/scene';
import { NEUTRAL_INPUT } from '../src/combat/types';

function fakeGame() {
  const calls: string[] = [];
  const input = { sample: () => NEUTRAL_INPUT, lastDevice: 'keyboard', bindings: DEFAULT_BINDINGS } as unknown as InputManager;
  const game: Game = {
    input,
    screen: null as never,
    simFps: 60,
    goTitle: () => calls.push('title'),
    goFight: () => calls.push('fight'),
    goTraining: () => calls.push('training'),
  };
  return { game, calls };
}
const step = (s: BossFightScene, n: number, actions: Action[] = []) => {
  for (let i = 0; i < n; i++) s.update(1, i === 0 ? actions : []);
};

describe('boss fight flow', () => {
  it('intro: 60 frames with the sim frozen, then the fight starts', () => {
    const { game } = fakeGame();
    const s = new BossFightScene(game);
    step(s, FLOW.introFrames - 1);
    expect(s.stage).toBe('intro');
    expect(s.sim.frame).toBe(0);
    step(s, 1);
    expect(s.stage).toBe('fight');
  });
  it('defeat: sim runs 60 more frames, prompt after 90, confirm restarts from the intro', () => {
    const { game } = fakeGame();
    const s = new BossFightScene(game);
    step(s, FLOW.introFrames + 5);
    s.sim.fighters[0].health = 0;
    step(s, 1);
    expect(s.stage).toBe('defeat');
    const f = s.sim.frame;
    step(s, FLOW.defeatRunFrames + 20);
    expect(s.sim.frame - f).toBe(FLOW.defeatRunFrames);
    step(s, 1, ['confirm']); // too early: ignored
    expect(s.stage).toBe('defeat');
    step(s, FLOW.defeatPromptFrames);
    step(s, 1, ['confirm']);
    expect(s.stage).toBe('intro');
    expect(s.sim.frame).toBe(0);
  });
  it('victory: 30-frame freeze, then the prompt; confirm goes back to the title', () => {
    const { game, calls } = fakeGame();
    const s = new BossFightScene(game);
    step(s, FLOW.introFrames + 5);
    s.sim.fighters[1].health = 0;
    step(s, 1);
    expect(s.stage).toBe('victory');
    const f = s.sim.frame;
    step(s, FLOW.victoryFreezeFrames);
    expect(s.sim.frame).toBe(f);
    step(s, FLOW.victoryPromptFrames);
    step(s, 1, ['confirm']);
    expect(calls).toEqual(['title']);
  });
  it('Esc opens the pause menu (Resume, Restart fight, Quit to title) and freezes the fight', () => {
    const { game, calls } = fakeGame();
    const s = new BossFightScene(game);
    step(s, FLOW.introFrames + 5);
    step(s, 1, ['pause']);
    expect(s.pauseMenu?.options).toEqual(['Resume', 'Restart fight', 'Quit to title']);
    const f = s.sim.frame;
    step(s, 30);
    expect(s.sim.frame).toBe(f);
    step(s, 1, ['down']);
    step(s, 1, ['confirm']);
    expect(s.stage).toBe('intro');
    step(s, 1, ['pause']);
    step(s, 1, ['up']);
    step(s, 1, ['confirm']);
    expect(calls).toEqual(['title']);
  });
});
