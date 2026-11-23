import { describe, expect, it } from 'vitest';
import { CombatSim, type CombatEvent } from '../src/combat/combat_sim';
import { fighterConfig } from '../src/combat/character_data';
import { getArena } from '../src/combat/arena_data';
import { createCorvaneFight } from '../src/fights';
import { dummyConfig, inp, N, pointBlank, rookConfig, run, runUntil } from './helpers';
import type { InputSnapshot } from '../src/combat/types';

/** Run until an event of `type` is emitted; return it. */
function until(sim: CombatSim, type: CombatEvent['type'], p1: InputSnapshot | (() => InputSnapshot) = N, p2: InputSnapshot | (() => InputSnapshot) = N, max = 200): CombatEvent {
  let found: CombatEvent | undefined;
  runUntil(sim, () => !!(found = sim.events.find((e) => e.type === type)), p1, p2, max);
  return found!;
}

describe('sim events (for the view)', () => {
  it('hit: at the contact point, with the move height', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '1'), N);
    const e = until(sim, 'hit');
    expect(e).toMatchObject({ attacker: 0, defender: 1, moveId: 'rook_jab', height: 'high', damage: 7 });
    const d = sim.fighters[1];
    expect(e.x).toBeGreaterThanOrEqual(d.x - d.halfWidth);
    expect(e.x).toBeLessThanOrEqual(d.x + d.halfWidth);
    expect(e.y).toBeGreaterThanOrEqual(6900);
    expect(e.y).toBeLessThanOrEqual(8200);
  });
  it('block', () => {
    const sim = pointBlank();
    sim.step(inp(2, 1, '1'), inp(1, -1));
    expect(until(sim, 'block', N, inp(1, -1))).toMatchObject({ moveId: 'rook_low_jab', height: 'low' });
  });
  it('counter_hit', () => {
    const sim = pointBlank();
    sim.step(N, inp(5, -1, '3'));
    sim.step(inp(5, 1, '1'), N);
    expect(until(sim, 'counter_hit')).toMatchObject({ moveId: 'rook_jab' });
  });
  it('launch, then land and knockdown at the landing point', () => {
    const sim = pointBlank();
    sim.step(inp(3, 1, '4'), N);
    expect(until(sim, 'launch')).toMatchObject({ moveId: 'rook_rising_kick', height: 'mid' });
    const land = until(sim, 'land');
    expect(land.y).toBe(0);
    expect(sim.events.map((e) => e.type)).toContain('knockdown');
  });
  it('knockdown from a sweep', () => {
    const sim = pointBlank();
    sim.step(inp(2, 1, '4'), N);
    expect(until(sim, 'knockdown')).toMatchObject({ moveId: 'rook_sweep' });
  });
  it('wall_splat at the wall', () => {
    const wall = getArena('training').width / 100;
    const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: wall - 59, p2X: wall - 27 });
    sim.step(inp(3, 1, '4'), N);
    const e = until(sim, 'wall_splat');
    expect(e.x).toBe(sim.arenaRight);
    expect(e.y).toBeGreaterThan(0);
  });
  it('ground_hit', () => {
    const sim = pointBlank();
    sim.step(inp(3, 1, '4'), N);
    runUntil(sim, () => sim.fighters[1].state === 'knockdown', N, N, 120);
    sim.step(inp(2, 1, '1'), N);
    expect(until(sim, 'ground_hit')).toMatchObject({ moveId: 'rook_low_jab', damage: 2 });
  });
  it('throw_break', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '1', '3'), N);
    runUntil(sim, () => sim.fighters[1].state === 'thrown');
    sim.step(N, inp(5, -1, '1'));
    expect(sim.events.map((e) => e.type)).toContain('throw_break');
  });
  it('armor_absorb', () => {
    const sim = new CombatSim({ p1: fighterConfig('corvane'), p2: fighterConfig('rook'), p1X: 400, p2X: 437.5, arenaWidth: 1600 });
    sim.fighters[0].lockedMoves.clear();
    sim.step(inp(6, 1, '1', '2'), inp(5, -1, '1'));
    expect(until(sim, 'armor_absorb')).toMatchObject({ attacker: 1, defender: 0, moveId: 'rook_jab' });
  });
  it('wall_break and ko', () => {
    const sim = createCorvaneFight(1);
    const [rook, c] = sim.fighters;
    c.health = 232;
    rook.x = c.x - 3750;
    sim.step(inp(5, 1, '1'), N);
    const wb = until(sim, 'wall_break', N, N, 200);
    expect(wb.x).toBe(0);
    c.health = 3;
    runUntil(sim, () => c.isNeutral && rook.isNeutral, N, N, 200);
    rook.x = c.x - 3750;
    sim.step(inp(5, 1, '1'), N);
    expect(until(sim, 'ko', N, N, 40)).toMatchObject({ defender: 1 });
  });
  it('whiff, glint, phase_step and dash', () => {
    const sim = pointBlank({ p2X: 700 });
    sim.step(inp(5, 1, '1'), N);
    expect(until(sim, 'whiff')).toMatchObject({ moveId: 'rook_jab', attacker: 0 });
    run(sim, 30);
    sim.step({ dir: 5, held: new Set(['phase']) }, N);
    expect(sim.events.map((e) => e.type)).toContain('phase_step');
    run(sim, 30);
    for (const d of [6, 5]) sim.step(inp(d, 1), N);
    sim.step(inp(6, 1), N);
    expect(sim.events.map((e) => e.type)).toContain('dash');
    const c = new CombatSim({ p1: fighterConfig('corvane'), p2: fighterConfig('rook'), p1X: 400, p2X: 800, arenaWidth: 1600 });
    c.step(inp(4, 1, '2'), N); // Haymaker: glint from frame 12
    const g = until(c, 'glint', N, N, 20);
    expect(g.moveId).toBe('corvane_haymaker');
    expect(c.fighters[0].moveFrame).toBe(12);
  });
});

describe('determinism with the view running', () => {
  it('stateHash is identical with and without the effects system reading the sim', async () => {
    const { Effects } = await import('../src/view/effects');
    const { CorvaneAI } = await import('../src/ai/corvane_ai');
    const { MasherBot } = await import('./bots');
    const hashes = (withFx: boolean) => {
      const sim = createCorvaneFight(9, { ko: false });
      const ai = new CorvaneAI(1);
      const bot = new MasherBot(4);
      const fx = withFx ? new Effects() : null;
      const out: number[] = [];
      for (let i = 0; i < 1500; i++) {
        sim.step(bot.update(sim), ai.update(sim));
        fx?.onStep(sim);
        fx?.shake();
        fx?.afterimages(0);
        out.push(sim.stateHash());
      }
      return out;
    };
    expect(hashes(true)).toEqual(hashes(false));
  });
});
