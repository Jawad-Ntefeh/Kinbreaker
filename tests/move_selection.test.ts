import { describe, expect, it } from 'vitest';
import { DummyController, type DummyMode } from '../src/ai/dummy';
import { inp, N, pointBlank, run, runUntil } from './helpers';
import type { Button } from '../src/combat/types';

describe('move selection', () => {
  const cases: [number, Button[], string][] = [
    [5, ['1'], 'rook_jab'],
    [2, ['1'], 'rook_low_jab'],
    [6, ['1'], 'rook_palm'],
    [5, ['3'], 'rook_knee'],
    [5, ['4'], 'rook_high_kick'],
    [2, ['4'], 'rook_sweep'],
    [3, ['4'], 'rook_rising_kick'],
    [5, ['1', '3'], 'rook_throw'],
  ];
  for (const [dir, btns, id] of cases) {
    it(`${dir}+${btns.join('+')} → ${id}`, () => {
      const sim = pointBlank({ p2X: 600 });
      sim.step(inp(dir, 1, ...btns), N);
      expect(sim.fighters[0].move?.id).toBe(id);
    });
  }
  it('forward is relative to facing (Rook facing left)', () => {
    const sim = pointBlank({ p1X: 600, p2X: 400 });
    expect(sim.fighters[0].facing).toBe(-1);
    sim.step(inp(6, -1, '1'), N); // absolute 4 = forward when facing left
    expect(sim.fighters[0].move?.id).toBe('rook_palm');
  });
  it('the second jab cannot be started from neutral', () => {
    const sim = pointBlank({ p2X: 600 });
    sim.step(inp(5, 1, '1'), N);
    expect(sim.fighters[0].move?.id).toBe('rook_jab');
  });
  it('the jab only cancels into the second jab after it hit or was blocked', () => {
    const whiff = pointBlank({ p2X: 600 });
    whiff.step(inp(5, 1, '1'), N);
    runUntil(whiff, () => whiff.fighters[0].moveFrame === 14);
    whiff.step(inp(5, 1, '1'), N);
    expect(whiff.fighters[0].move?.id).toBe('rook_jab');

    const hit = pointBlank();
    hit.step(inp(5, 1, '1'), N);
    runUntil(hit, () => hit.fighters[0].moveFrame === 14);
    hit.step(inp(5, 1, '1'), N);
    expect(hit.fighters[0].move?.id).toBe('rook_jab_2');
  });
  it('a button pressed during the move is buffered into the cancel window', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '1'), N);
    run(sim, 4);
    sim.step(inp(5, 1, '1'), N); // pressed on jab frame 6, long before the window opens
    runUntil(sim, () => sim.fighters[0].move?.id === 'rook_jab_2', N, N, 40);
    expect(sim.fighters[0].moveFrame).toBe(1);
  });
  it('one press cannot trigger two moves', () => {
    const sim = pointBlank({ p2X: 600 });
    sim.step(inp(5, 1, '1'), N);
    runUntil(sim, () => sim.fighters[0].isNeutral);
    run(sim, 3);
    expect(sim.fighters[0].state).toBe('idle');
  });
  it('dashes with 66 and backdashes with 44', () => {
    const sim = pointBlank({ p2X: 700 });
    for (const d of [6, 5, 6]) sim.step(inp(d, 1), N);
    expect(sim.fighters[0].state).toBe('dash_forward');
    runUntil(sim, () => sim.fighters[0].isNeutral, N, N);
    for (const d of [4, 5, 4]) sim.step(inp(d, 1), N);
    expect(sim.fighters[0].state).toBe('backdash');
  });
  it('holding back walks back, holding down-back crouch-blocks', () => {
    const sim = pointBlank({ p2X: 600 });
    sim.step(inp(4, 1), N);
    expect(sim.fighters[0].state).toBe('walk_back');
    sim.step(inp(1, 1), N);
    expect(sim.fighters[0].state).toBe('block_crouch');
    sim.step(inp(2, 1), N);
    expect(sim.fighters[0].state).toBe('crouch');
  });
});

describe('training dummy AI', () => {
  /** Rook performs each attack against the dummy in `mode`; return contact results. */
  function results(mode: DummyMode, script: [number, Button[]][]): string[] {
    const sim = pointBlank();
    const ai = new DummyController(1);
    ai.setMode(mode);
    const out: string[] = [];
    for (const [dir, btns] of script) {
      // Walk back to point blank (blocks push the dummy away).
      for (let i = 0; i < 20; i++) sim.step(inp(6, 1), ai.update(sim));
      sim.step(inp(dir, 1, ...btns), ai.update(sim));
      for (let i = 0; i < 90; i++) {
        sim.step(N, ai.update(sim));
        for (const e of sim.events) if (e.attacker === 0) out.push(e.type);
      }
    }
    return out;
  }
  const attacks: [number, Button[]][] = [[5, ['1']], [2, ['1']], [5, ['3']], [5, ['4']], [2, ['4']], [3, ['4']]];

  it('"block all" blocks every high, mid and low correctly', () => {
    expect(results('block all', attacks)).toEqual(['block', 'block', 'block', 'block', 'block', 'block']);
  });
  it('"block after first" is hit by the first hit, then blocks the rest of the string', () => {
    const sim = pointBlank();
    const ai = new DummyController(1);
    ai.setMode('block after first');
    const out: string[] = [];
    // Jab (hits), then a knee right after the dummy recovers (blocked).
    sim.step(inp(5, 1, '1'), ai.update(sim));
    for (let i = 0; i < 45; i++) {
      sim.step(N, ai.update(sim));
      out.push(...sim.events.map((e) => e.type));
    }
    sim.step(inp(5, 1, '3'), ai.update(sim));
    for (let i = 0; i < 30; i++) {
      sim.step(N, ai.update(sim));
      out.push(...sim.events.map((e) => e.type));
    }
    expect(out).toEqual(['hit', 'block']);
  });
  it('"jab" presses 1 every 60 frames', () => {
    const sim = pointBlank({ p2X: 700 });
    const ai = new DummyController(1);
    ai.setMode('jab');
    let starts = 0;
    for (let i = 0; i < 180; i++) {
      sim.step(N, ai.update(sim));
      if (sim.fighters[1].move?.id === 'rook_jab' && sim.fighters[1].moveFrame === 1) starts++;
    }
    expect(starts).toBe(3);
  });
  it('"high kick" uses rook_high_kick', () => {
    const sim = pointBlank({ p2X: 700 });
    const ai = new DummyController(1);
    ai.setMode('high kick');
    sim.step(N, ai.update(sim));
    expect(sim.fighters[1].move?.id).toBe('rook_high_kick');
  });
  it('cycles through all modes', () => {
    const ai = new DummyController(1);
    const seen = [ai.mode];
    for (let i = 0; i < 6; i++) seen.push(ai.cycleMode());
    expect(seen).toEqual(['stand', 'crouch', 'block all', 'block after first', 'jab', 'high kick', 'stand']);
  });
});
