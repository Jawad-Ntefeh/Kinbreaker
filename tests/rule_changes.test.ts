import { describe, expect, it } from 'vitest';
import { CombatSim } from '../src/combat/combat_sim';
import type { Move, MoveSet } from '../src/combat/move_data';
import { getArena } from '../src/combat/arena_data';
const TRAINING_W = getArena('training').width;
import { SYSTEM } from '../src/combat/system';
import { dummyConfig, inp, N, pointBlank, rookConfig, rookMoves, runUntil } from './helpers';

describe('move priority: more buttons first', () => {
  it('holding forward and pressing U + J gives the throw, not Lunging Palm', () => {
    const sim = pointBlank();
    sim.step(inp(6, 1, '1', '3'), N);
    expect(sim.fighters[0].move?.id).toBe('rook_throw');
  });
  it('holding forward and pressing only U still gives Lunging Palm', () => {
    const sim = pointBlank();
    sim.step(inp(6, 1, '1'), N);
    expect(sim.fighters[0].move?.id).toBe('rook_palm');
  });
});

/** Launch the dummy into the right wall; return the sim once it is splatted. */
function splat(): CombatSim {
  const wall = TRAINING_W / 100;
  const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: wall - 44, p2X: wall - 20 });
  sim.step(inp(3, 1, '4'), N);
  runUntil(sim, () => sim.fighters[1].state === 'wall_splat', N, N, 120);
  return sim;
}

describe('wall splat', () => {
  it('lasts 50 frames and slides down to the floor, reaching it on the last frame', () => {
    expect(SYSTEM.wallSplatFrames).toBe(50);
    const sim = splat();
    const d = sim.fighters[1];
    const y0 = d.y;
    expect(y0).toBeGreaterThan(0);
    const ys: number[] = [];
    while (d.state === 'wall_splat') {
      sim.step(N, N);
      if (d.state === 'wall_splat') ys.push(d.y);
    }
    expect(ys.length).toBe(50);
    expect(ys[ys.length - 1]).toBe(0);
    expect(ys.slice(0, -1).every((y) => y > 0)).toBe(true);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThanOrEqual(ys[i - 1]!);
    expect(ys.every((y) => Number.isInteger(y))).toBe(true);
    expect(d.state).toBe('knockdown');
  });
  it('can be hit at any height during the slide', () => {
    const sim = splat();
    const d = sim.fighters[1];
    // Let it slide low, then hit with a low jab.
    runUntil(sim, () => d.y < 1500, N, N, 60);
    sim.step(inp(2, 1, '1'), N);
    runUntil(sim, () => sim.events.some((e) => e.type === 'hit'), N, N, 20);
    expect(d.wallHits).toBe(1);
  });
});

describe('ground hits', () => {
  /** Launch the dummy and wait for it to land in a knockdown. */
  function downed(): CombatSim {
    const sim = pointBlank();
    sim.step(inp(3, 1, '4'), N);
    runUntil(sim, () => sim.fighters[1].state === 'knockdown', N, N, 120);
    return sim;
  }
  function knockdownLength(sim: CombatSim, rookIn: () => typeof N): number {
    let n = 1;
    while (sim.fighters[1].state === 'knockdown') {
      sim.step(rookIn(), N);
      n++;
    }
    return n;
  }

  it('a low hits a knocked-down fighter for 50% damage (after combo scaling)', () => {
    const sim = downed();
    const d = sim.fighters[1];
    const before = d.health;
    sim.step(inp(2, 1, '1'), N);
    runUntil(sim, () => sim.events.some((e) => e.type === 'ground_hit'), N, N, 20);
    expect(d.comboHits).toBe(2);
    expect(before - d.health).toBe(Math.trunc(5 / 2));
  });
  it('does not reset or extend the knockdown timer', () => {
    const plain = knockdownLength(downed(), () => N);
    let k = 0;
    const sim = downed();
    const before = sim.fighters[1].health;
    const withHit = knockdownLength(sim, () => (k++ === 0 ? inp(2, 1, '1') : N));
    expect(sim.fighters[1].health).toBeLessThan(before); // the ground hit landed
    expect(withHit).toBe(plain);
  });
  it('only one ground hit per knockdown', () => {
    const sim = downed();
    const d = sim.fighters[1];
    d.stateLength = 300; // keep the dummy down long enough for two attempts
    let hits = 0;
    for (let i = 0; i < 2; i++) {
      sim.step(inp(2, 1, '1'), N);
      for (let f = 0; f < 45; f++) {
        sim.step(N, N);
        hits += sim.events.filter((e) => e.type === 'ground_hit').length;
      }
    }
    expect(hits).toBe(1);
  });
  it('mids and highs do not hit a knocked-down fighter; ground_hit moves do', () => {
    const base = rookMoves();
    const knee = base.get('rook_knee')!;
    const groundKnee: Move = { ...knee, properties: ['ground_hit'], hitboxes: [{ ...knee.hitboxes[0]!, y: 0 }] };
    const moves: MoveSet = new Map([...base].map(([k, m]) => [k, k === 'rook_knee' ? groundKnee : m]));
    for (const [set, expected] of [[base, 0], [moves, 1]] as const) {
      const sim = new CombatSim({ p1: rookConfig(set), p2: dummyConfig(set), p1X: 400, p2X: 424 });
      sim.step(inp(3, 1, '4'), N);
      runUntil(sim, () => sim.fighters[1].state === 'knockdown', N, N, 120);
      sim.step(inp(5, 1, '3'), N);
      let hits = 0;
      for (let f = 0; f < 25; f++) {
        sim.step(N, N);
        hits += sim.events.filter((e) => e.type === 'ground_hit').length;
      }
      expect(hits).toBe(expected);
    }
  });
  it('wake-up stays invulnerable to ground hits', () => {
    const sim = downed();
    const d = sim.fighters[1];
    runUntil(sim, () => d.state === 'knockdown' && d.stateFrame === SYSTEM.knockdownFrames - 5, N, N, 60);
    sim.step(inp(2, 1, '1'), N); // low jab becomes active during wake_up
    const ev: string[] = [];
    for (let f = 0; f < 25; f++) {
      sim.step(N, N);
      if (f === 12) expect(d.state).toBe('wake_up');
      ev.push(...sim.events.map((e) => e.type));
    }
    expect(ev).not.toContain('ground_hit');
    expect(ev).not.toContain('hit');
  });
});
