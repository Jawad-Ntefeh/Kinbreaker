import { describe, expect, it } from 'vitest';
import { loadAllArenas } from '../src/combat/arena_data';
import { createCorvaneFight } from '../src/fights';
import { inp, N, run, runUntil } from './helpers';

describe('arenas', () => {
  it('every arena file loads', () => {
    expect(loadAllArenas().errors).toEqual([]);
  });
  it('the Sunken Colosseum is 1600 px; fighters start 213 px apart in the middle, Rook on the left', () => {
    const sim = createCorvaneFight(1);
    const [rook, corvane] = sim.fighters;
    expect(sim.arenaRight - sim.arenaLeft).toBe(160000);
    expect(corvane.x - rook.x).toBe(21300);
    expect((rook.x + corvane.x) / 2).toBe(80000);
    expect(rook.name).toBe('Rook');
  });
});

describe('Corvane phase 2', () => {
  /** A fight with Corvane at `hp` and Rook point blank to his left. */
  function nearHalf(hp: number) {
    const sim = createCorvaneFight(1);
    const [rook, c] = sim.fighters;
    c.health = hp;
    rook.x = c.x - 3750;
    return { sim, rook, c };
  }

  it('triggers at 50% health', () => {
    const { sim, c } = nearHalf(232);
    sim.step(inp(5, 1, '1'), N); // jab: 7 damage → 225 = 50%
    runUntil(sim, () => c.phase2Pending, N, N, 30);
    runUntil(sim, () => c.state === 'phase_transition', N, N, 60);
    expect(c.phase).toBe(2);
  });
  it('does not trigger above 50%', () => {
    const { sim, c } = nearHalf(233);
    sim.step(inp(5, 1, '1'), N);
    run(sim, 80);
    expect(c.health).toBe(226);
    expect(c.phase).toBe(1);
    expect(c.state).not.toBe('phase_transition');
  });
  it('waits for the end of a combo, then breaks the left wall and extends the arena to 1920 px', () => {
    const { sim, rook, c } = nearHalf(230);
    sim.step(inp(3, 1, '4'), N); // Rising Kick launches him
    runUntil(sim, () => c.state === 'airborne', N, N, 30);
    expect(c.phase2Pending).toBe(true);
    // Juggle him: no transition while he is airborne, down or waking up.
    let k = 0;
    const mash = () => inp(5, 1, ...(k++ % 2 === 0 ? (['1'] as const) : []));
    const states: string[] = [];
    runUntil(sim, () => {
      states.push(c.state);
      return c.state === 'phase_transition';
    }, mash, N, 400);
    expect(states).toContain('knockdown');
    expect(states).toContain('wake_up');
    expect(states.slice(0, -1)).not.toContain('phase_transition');
    // Invulnerable and pushes Rook back 60 px.
    expect(c.isHittable).toBe(false);
    expect(Math.abs(c.x - rook.x)).toBeGreaterThanOrEqual(6000);
    expect(sim.wallBroken).toBe(false);
    const len = runUntil(sim, () => sim.wallBroken, N, N, 90);
    expect(sim.arenaLeft).toBe(-32000);
    expect(sim.arenaRight - sim.arenaLeft).toBe(192000);
    const rest = runUntil(sim, () => c.state !== 'phase_transition', N, N, 90);
    expect(len + rest).toBe(90);
    expect(c.lockedMoves.has('corvane_iron_wall')).toBe(false);
    expect(c.lockedMoves.has('corvane_last_bell_1')).toBe(false);
  });
  it('the broken side has a solid wall again at -320 px', () => {
    const { sim, rook } = nearHalf(232);
    sim.step(inp(5, 1, '1'), N);
    runUntil(sim, () => sim.wallBroken, N, N, 200);
    run(sim, 600, inp(4, 1));
    expect(rook.x).toBe(-32000 + rook.halfWidth);
  });
});

describe('KO', () => {
  it('a fighter at 0 health is defeated and the other wins', () => {
    const sim = createCorvaneFight(1);
    const [rook, c] = sim.fighters;
    c.health = 5;
    rook.x = c.x - 3750;
    sim.step(inp(5, 1, '1'), N);
    runUntil(sim, () => sim.winner !== null, N, N, 30);
    expect(sim.winner).toBe(0);
    expect(c.state).toBe('defeated');
    expect(c.isHittable).toBe(false);
  });
});
