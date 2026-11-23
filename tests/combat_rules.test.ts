import { describe, expect, it } from 'vitest';
import { CombatSim } from '../src/combat/combat_sim';
import type { Move, MoveSet } from '../src/combat/move_data';
import { SYSTEM, scaledDamage } from '../src/combat/system';
import { dummyConfig, inp, N, pointBlank, rookConfig, rookMoves, run, runUntil } from './helpers';

const types = (sim: CombatSim) => sim.events.map((e) => e.type);

/** Rook performs a move (relative dir + buttons) against a dummy holding `dummyDir`; collect all events. */
function perform(rookDir: number, buttons: ('1' | '2' | '3' | '4')[], dummyDir: number, frames = 60) {
  const sim = pointBlank();
  const d = inp(dummyDir, -1);
  const events: string[] = [];
  sim.step(inp(rookDir, 1, ...buttons), d);
  for (let i = 0; i < frames; i++) {
    sim.step(inp(rookDir, 1), d);
    events.push(...types(sim));
  }
  return { sim, events };
}

describe('heights', () => {
  it('a high whiffs on a crouching dummy', () => {
    const { events, sim } = perform(5, ['1'], 2);
    expect(events).toEqual([]);
    expect(sim.fighters[1].health).toBe(sim.fighters[1].maxHealth);
  });
  it('a sweeping high also whiffs on a crouching dummy', () => {
    expect(perform(5, ['4'], 2).events).toEqual([]);
  });
  it('a low is blocked by crouch block', () => {
    expect(perform(2, ['1'], 1).events).toEqual(['block']);
  });
  it('a low hits a stand-blocking dummy', () => {
    expect(perform(2, ['1'], 4).events).toEqual(['hit']);
  });
  it('a mid hits a crouch-blocking dummy', () => {
    expect(perform(5, ['3'], 1).events).toEqual(['hit']);
  });
  it('a mid is blocked by stand block and a high is blocked by stand block', () => {
    expect(perform(5, ['3'], 4).events).toEqual(['block']);
    expect(perform(5, ['1'], 4).events).toEqual(['block']);
  });
  it('blocking costs stamina equal to damage', () => {
    const { sim } = perform(5, ['3'], 4, 2 + 13);
    const knee = rookMoves().get('rook_knee')!;
    // Stamina refills 1/frame only while not blocking; it is still in blockstun here.
    expect(sim.fighters[1].stamina).toBe(SYSTEM.staminaMax - knee.damage);
  });
});

describe('phase step', () => {
  /** Rook phase steps; the dummy's attack becomes active on Rook's phase frame `phaseFrame`. */
  function phaseVs(button: '1' | '4', phaseFrame: number) {
    const sim = pointBlank();
    const move = rookMoves().get(button === '1' ? 'rook_jab' : 'rook_high_kick')!;
    // Time the starts so the dummy's first active frame lands on Rook's phase frame `phaseFrame`.
    const lead = Math.max(0, move.startup - phaseFrame);
    const dummyStart = Math.max(0, phaseFrame - move.startup);
    const events: string[] = [];
    for (let f = 0; f < 70; f++) {
      const dummy = f === dummyStart ? inp(5, -1, button) : N;
      const rook = f === lead ? inp(5, 1) : N;
      const rookIn = f === lead ? { dir: 5, held: new Set(['phase'] as const) } : rook;
      sim.step(rookIn, dummy);
      if (f === lead) expect(sim.fighters[0].state).toBe('phase_step');
      events.push(...types(sim));
    }
    return events;
  }
  for (const pf of [4, 8, 12]) {
    it(`rook_jab (linear) passes through phase frame ${pf}`, () => {
      const ev = phaseVs('1', pf);
      expect(ev).toContain('whiff_phase');
      expect(ev).not.toContain('hit');
    });
  }
  it('rook_jab hits outside the invulnerable frames (frame 2)', () => {
    expect(phaseVs('1', 2)).toContain('hit');
  });
  for (const pf of [4, 8, 13]) {
    it(`rook_high_kick (sweeping) hits phase frame ${pf}`, () => {
      expect(phaseVs('4', pf)).toContain('hit');
    });
  }
  it('costs 20 stamina and cannot start below 20', () => {
    const sim = pointBlank();
    const r = sim.fighters[0];
    r.stamina = 10;
    sim.step({ dir: 5, held: new Set(['phase']) }, N);
    expect(r.state).not.toBe('phase_step');
    run(sim, 8);
    expect(r.state).not.toBe('phase_step');
    r.stamina = 50;
    sim.step({ dir: 5, held: new Set(['phase']) }, N);
    expect(r.state).toBe('phase_step');
    expect(r.stamina).toBe(30);
  });
  it('drifts forward or back 1 px/frame with the held direction', () => {
    for (const [dir, sign] of [[6, 1], [4, -1], [5, 0]] as const) {
      const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: 300, p2X: 600 });
      sim.step({ dir, held: new Set(['phase']) }, N);
      const x0 = sim.fighters[0].x;
      run(sim, 10, { dir, held: new Set(['phase']) });
      expect(sim.fighters[0].x - x0).toBe(sign * 10 * 100);
    }
  });
});

describe('counter hit', () => {
  it('hitting during startup frames is a counter hit and uses on_counter_hit', () => {
    // Give the jab a distinct counter-hit value to prove which one is used.
    const base = rookMoves();
    const moves: MoveSet = new Map([...base].map(([k, m]) => [k, k === 'rook_jab' ? ({ ...m, onCounterHit: 12 } as Move) : m]));
    const sim = new CombatSim({ p1: rookConfig(moves), p2: dummyConfig(moves), p1X: 400, p2X: 424 });
    // Dummy starts a knee (13f startup); Rook's jab (10f) starts 1 frame later and lands on knee frame 11.
    sim.step(N, inp(5, -1, '3'));
    sim.step(inp(5, 1, '1'), N);
    const ev = runUntil(sim, () => sim.events.length > 0);
    expect(ev).toBeGreaterThan(0);
    expect(types(sim)).toEqual(['counter']);
    runUntil(sim, () => sim.lastAdvantage !== null);
    expect(sim.lastAdvantage).toMatchObject({ kind: 'COUNTER', moveId: 'rook_jab', value: 12 });
  });
  it('a hit during recovery is not a counter hit', () => {
    const sim = pointBlank();
    // Dummy's high kick (active 14-16) whiffs over crouching Rook; Rook jabs into its recovery.
    sim.step(inp(2, 1), inp(5, -1, '4'));
    run(sim, 17, inp(2, 1));
    sim.step(inp(5, 1, '1'), N);
    const all: string[] = [];
    for (let i = 0; i < 15; i++) {
      sim.step(N, N);
      all.push(...types(sim));
    }
    expect(all).toEqual(['hit']);
  });
  it('trades: both fighters get hit on the same frame', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '1'), inp(5, -1, '1'));
    runUntil(sim, () => sim.events.length > 0);
    expect(types(sim).sort()).toEqual(['hit', 'hit']);
    expect(sim.fighters[0].state).toBe('hitstun');
    expect(sim.fighters[1].state).toBe('hitstun');
  });
});

describe('juggles', () => {
  it('rook_rising_kick launches; follow-ups keep the dummy airborne; damage scales', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    sim.step(inp(3, 1, '4'), N);
    runUntil(sim, () => sim.events.some((e) => e.type === 'launch'));
    expect(d.state).toBe('airborne');
    // Mash jab: the jab comes out as soon as Rook recovers, then cancels into the second jab.
    let k = 0;
    const mash = () => inp(5, 1, ...(k++ % 2 === 0 ? (['1'] as const) : []));
    const hits: number[] = [];
    for (let i = 0; i < 120 && d.state === 'airborne'; i++) {
      sim.step(mash(), N);
      for (const e of sim.events) if (e.type === 'hit') hits.push(e.damage);
      if (sim.events.some((e) => e.type === 'hit')) expect(d.state).toBe('airborne');
    }
    // Launch (15) + jab (7) + second jab (8 * 80%).
    expect(hits).toEqual([7, scaledDamage(8, 3)]);
    expect(d.juggleCount).toBe(2);
    runUntil(sim, () => d.state === 'knockdown');
    expect(d.comboHits).toBe(3);
    expect(d.comboDamage).toBe(15 + 7 + 6);
  });
  it('gravity increases with each juggle hit', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    sim.step(inp(3, 1, '4'), N);
    runUntil(sim, () => d.state === 'airborne');
    const g0 = d.gravity;
    let k = 0;
    runUntil(sim, () => d.juggleCount === 1, () => inp(5, 1, ...(k++ % 2 === 0 ? (['1'] as const) : [])));
    expect(d.gravity).toBeGreaterThan(g0);
  });
  it('damage scaling table: 100, 100, 80, 70, 60, 50, 40...', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 12].map((n) => scaledDamage(100, n))).toEqual([100, 100, 80, 70, 60, 50, 40, 40, 40]);
    expect(scaledDamage(7, 3)).toBe(5); // Math.trunc(5.6)
  });
  it('combo counter resets when the defender returns to neutral', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '1'), N);
    runUntil(sim, () => sim.fighters[1].comboHits === 1);
    runUntil(sim, () => sim.fighters[1].isNeutral);
    run(sim, 20);
    sim.step(inp(5, 1, '1'), N);
    runUntil(sim, () => sim.events.some((e) => e.type === 'hit'));
    expect(sim.fighters[1].comboHits).toBe(1);
    expect(sim.events[0]!.damage).toBe(7);
  });
});

describe('throws', () => {
  function throwSim(breakAt: number | null, dummyHold = 4) {
    const sim = pointBlank();
    const d = sim.fighters[1];
    sim.step(inp(5, 1, '1', '3'), inp(dummyHold, -1));
    runUntil(sim, () => d.state === 'thrown', N, inp(dummyHold, -1));
    for (let f = 1; f <= 60; f++) {
      sim.step(N, f === breakAt ? inp(5, -1, '1') : N);
    }
    return sim;
  }
  it('is unblockable (connects on a stand-blocking and a crouch-blocking dummy)', () => {
    for (const hold of [4, 1]) {
      const sim = pointBlank();
      sim.step(inp(5, 1, '1', '3'), inp(hold, -1));
      runUntil(sim, () => sim.fighters[1].state === 'thrown', N, inp(hold, -1), 30);
    }
  });
  it('pressing the break button within 20 frames breaks it at 0 advantage', () => {
    for (const at of [1, 10, 20]) {
      const sim = throwSim(at);
      expect(sim.lastAdvantage).toMatchObject({ kind: 'BREAK', value: 0 });
      expect(sim.fighters[1].health).toBe(sim.fighters[1].maxHealth);
    }
  });
  it('pressing too late does not break it: damage and knockdown', () => {
    const sim = throwSim(25);
    expect(sim.fighters[1].health).toBe(sim.fighters[1].maxHealth - 30);
    expect(['knockdown', 'wake_up']).toContain(sim.fighters[1].state);
  });
  it('the wrong button does not break it', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    sim.step(inp(5, 1, '1', '3'), N);
    runUntil(sim, () => d.state === 'thrown');
    sim.step(N, inp(5, -1, '2'));
    run(sim, 30);
    expect(d.health).toBe(d.maxHealth - 30);
  });
  it('keyboard-friendly: U then J one frame later still throws', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '1'), N);
    sim.step(inp(5, 1, '1', '3'), N);
    runUntil(sim, () => sim.fighters[1].state === 'thrown', N, N, 30);
  });
  it('a throw loses to an attack connecting on the same frame', () => {
    // Throw (12f) and jab (10f) started 2 frames apart connect on the same frame.
    const sim = pointBlank();
    sim.step(inp(5, 1, '1', '3'), N);
    sim.step(N, N);
    sim.step(N, inp(5, -1, '1'));
    runUntil(sim, () => sim.events.length > 0);
    expect(types(sim)).toEqual(['hit']);
    expect(sim.fighters[0].state).toBe('hitstun');
  });
  it('cannot throw an airborne opponent', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    d.state = 'airborne';
    d.y = 5000;
    d.vy = 0;
    d.gravity = 0;
    sim.step(inp(5, 1, '1', '3'), N);
    run(sim, 20);
    expect(sim.events.map((e) => e.type)).not.toContain('throw');
    expect(d.state).toBe('airborne');
  });
});

describe('missing limbs', () => {
  it('Rook pressing 2 does nothing', () => {
    const sim = pointBlank();
    sim.step(inp(5, 1, '2'), N);
    expect(sim.fighters[0].state).toBe('idle');
    run(sim, 30);
    expect(sim.fighters[1].health).toBe(sim.fighters[1].maxHealth);
  });
  it('the dummy pressing 2 performs rook_cross', () => {
    const sim = pointBlank();
    sim.step(N, inp(5, -1, '2'));
    expect(sim.fighters[1].state).toBe('attack');
    expect(sim.fighters[1].move!.id).toBe('rook_cross');
  });
});

describe('walls', () => {
  it('fighters cannot leave the arena', () => {
    const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: 60, p2X: 900 });
    run(sim, 300, inp(4, 1), inp(4, -1));
    expect(sim.fighters[0].x).toBe(1200);
    expect(sim.fighters[1].x).toBe(SYSTEM.arenaWidth - 1200);
    // And walking into each other never overlaps.
    run(sim, 600, inp(6, 1), inp(6, -1));
    expect(Math.abs(sim.fighters[1].x - sim.fighters[0].x)).toBeGreaterThanOrEqual(2400);
  });
  it('a launched dummy hitting a wall enters wall_splat', () => {
    const wall = SYSTEM.arenaWidth / 100;
    const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: wall - 44, p2X: wall - 20 });
    const d = sim.fighters[1];
    sim.step(inp(3, 1, '4'), N);
    runUntil(sim, () => d.state === 'wall_splat', N, N, 120);
    expect(d.x).toBe(SYSTEM.arenaWidth - 1200);
    expect(d.y).toBeGreaterThan(0);
  });
  it('wall splat: the 3rd hit drops the dummy into a knockdown', () => {
    const wall = SYSTEM.arenaWidth / 100;
    const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: wall - 44, p2X: wall - 20 });
    const d = sim.fighters[1];
    sim.step(inp(3, 1, '4'), N);
    runUntil(sim, () => d.state === 'wall_splat', N, N, 120);
    // Stay stuck after hits 1 and 2, then knockdown on hit 3.
    d.y = 3000; // keep the splat at jab height for this test
    // This test checks the 3rd-hit rule, not the splat duration, so keep the splat alive between hits.
    let k = 0;
    const mash = () => inp(5, 1, ...(k++ % 2 === 0 ? (['1'] as const) : []));
    for (const n of [1, 2]) {
      runUntil(sim, () => { d.stateFrame = 0; return d.wallHits === n; }, mash, N, 120);
      expect(d.state).toBe('wall_splat');
    }
    runUntil(sim, () => { if (d.state === 'wall_splat') d.stateFrame = 0; return d.state === 'knockdown'; }, mash, N, 120);
    expect(d.wallHits).toBe(SYSTEM.wallSplatMaxHits);
  });
});

describe('poise and stamina', () => {
  it('poise at 0 staggers, then resets to full', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    d.poise = 4;
    sim.step(inp(5, 1, '1'), N);
    runUntil(sim, () => sim.events.some((e) => e.type === 'stagger'));
    expect(d.state).toBe('stagger');
    runUntil(sim, () => d.isNeutral);
    expect(d.poise).toBe(d.maxPoise);
  });
  it('empty stamina while blocking = guard break', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    d.stamina = 5;
    sim.step(inp(5, 1, '3'), inp(4, -1));
    runUntil(sim, () => sim.events.length > 0, N, inp(4, -1));
    expect(types(sim)).toContain('guard_break');
    expect(d.state).toBe('guard_break');
  });
  it('stamina refills 1 per frame when not blocking', () => {
    const sim = pointBlank();
    sim.fighters[0].stamina = 50;
    run(sim, 10);
    expect(sim.fighters[0].stamina).toBe(60);
  });
});

describe('knockdown', () => {
  it('sweep knocks down: 30 frames down, then 20 invulnerable wake-up frames', () => {
    const sim = pointBlank();
    const d = sim.fighters[1];
    sim.step(inp(2, 1, '4'), N);
    runUntil(sim, () => d.state === 'knockdown');
    const down = runUntil(sim, () => d.state === 'wake_up');
    expect(down).toBeGreaterThanOrEqual(SYSTEM.knockdownFrames);
    expect(d.isHittable).toBe(false);
    const wake = runUntil(sim, () => d.isNeutral);
    expect(wake).toBe(SYSTEM.wakeUpFrames + 1);
  });
});
