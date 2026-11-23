import { describe, expect, it } from 'vitest';
import { CombatSim } from '../src/combat/combat_sim';
import { fighterConfig } from '../src/combat/character_data';
import { getMoveSet, type Move } from '../src/combat/move_data';
import type { Button, InputSnapshot } from '../src/combat/types';
import { inp, N, runUntil } from './helpers';

/** Corvane (p1, facing right) at point blank against Rook (p2). Phase locks removed for move tests. */
export function corvaneVsRook(): CombatSim {
  const sim = new CombatSim({ p1: fighterConfig('corvane'), p2: fighterConfig('rook'), p1X: 400, p2X: 428, arenaWidth: 1200 });
  sim.fighters[0].lockedMoves.clear();
  return sim;
}

const corvane = getMoveSet('corvane');
const LAST_BELL: InputSnapshot[] = [inp(2, 1), inp(3, 1), inp(6, 1, '1', '2')];

function startMove(sim: CombatSim, m: Move, rook: InputSnapshot): void {
  if (m.input.motion) {
    for (const s of LAST_BELL) sim.step(s, rook);
    return;
  }
  sim.step(inp(m.input.dir ?? 5, 1, ...(m.input.buttons as Button[])), rook);
}

describe("Corvane's measured frame advantage matches the data", () => {
  const simple = [...corvane.values()].filter((m) => m.height !== 'throw' && !m.cancelOnly && m.continueOn.length === 0 && !m.id.startsWith('corvane_last_bell'));
  for (const m of simple) {
    it(`${m.id} on block = ${m.onBlock}`, () => {
      const sim = corvaneVsRook();
      const rook = inp(m.height === 'low' ? 1 : 4, -1);
      startMove(sim, m, rook);
      runUntil(sim, () => sim.lastAdvantage !== null, N, rook);
      expect(sim.lastAdvantage).toMatchObject({ kind: 'BLOCK', moveId: m.id, value: m.onBlock });
    });
    if (typeof m.onHit === 'number') {
      it(`${m.id} on hit = ${m.onHit}`, () => {
        const sim = corvaneVsRook();
        startMove(sim, m, N);
        runUntil(sim, () => sim.lastAdvantage !== null);
        expect(sim.lastAdvantage).toMatchObject({ kind: 'HIT', moveId: m.id, value: m.onHit });
      });
    }
  }

  for (const [id, chain] of [['corvane_jab_2', 1], ['corvane_jab_3', 2]] as const) {
    const m = corvane.get(id)!;
    for (const [rookDir, kind, expected] of [[4, 'BLOCK', m.onBlock], [5, 'HIT', m.onHit]] as const) {
      it(`${id} (cancel) ${kind.toLowerCase()} = ${expected}`, () => {
        const sim = corvaneVsRook();
        const rook = inp(rookDir, -1);
        sim.step(inp(5, 1, '1'), rook);
        for (let i = 0; i < chain; i++) {
          runUntil(sim, () => sim.fighters[0].moveFrame === 12, N, rook);
          sim.step(inp(5, 1, '1'), rook);
        }
        runUntil(sim, () => sim.lastAdvantage?.moveId === id, N, rook);
        expect(sim.lastAdvantage).toMatchObject({ kind, value: expected });
      });
    }
  }

  it('Haymaker knocks down on hit', () => {
    const sim = corvaneVsRook();
    startMove(sim, corvane.get('corvane_haymaker')!, N);
    runUntil(sim, () => sim.fighters[1].state === 'knockdown', N, N, 60);
  });

  it('Bell Ringer is a throw broken with 1', () => {
    const sim = corvaneVsRook();
    sim.step(inp(5, 1, '1', '2'), inp(4, -1));
    runUntil(sim, () => sim.fighters[1].state === 'thrown', N, inp(4, -1), 30);
    sim.step(N, inp(5, -1, '1'));
    expect(sim.fighters[1].state).toBe('throw_break');
  });
});

describe('Last Bell', () => {
  function lastBell(rook: () => InputSnapshot) {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    const parts: string[] = [];
    for (const s of LAST_BELL) sim.step(s, rook());
    for (let i = 0; i < 200 && !c.isNeutral; i++) {
      sim.step(N, rook());
      if (c.move && c.moveFrame === 1 && !parts.includes(c.move.id)) parts.push(c.move.id);
    }
    return { sim, parts };
  }
  it('blocking it gives -20 after the last part, all 5 parts connect', () => {
    const { sim, parts } = lastBell(() => inp(4, -1));
    expect(parts.length).toBe(4); // parts 2-5 start automatically
    expect(sim.lastAdvantage).toMatchObject({ kind: 'BLOCK', moveId: 'corvane_last_bell_5', value: -20 });
    expect(sim.fighters[1].health).toBe(sim.fighters[1].maxHealth);
  });
  it('on hit: 60 damage before scaling and +2 after the last part', () => {
    const { sim } = lastBell(() => N);
    runUntil(sim, () => sim.lastAdvantage !== null);
    expect(sim.lastAdvantage).toMatchObject({ kind: 'HIT', moveId: 'corvane_last_bell_5', value: 2 });
    expect(sim.fighters[1].comboHits).toBe(5);
  });
  it('phase-stepping the first part stops the string and adds 40 whiff recovery frames', () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    const total = corvane.get('corvane_last_bell_1')!.total;
    for (const s of LAST_BELL) sim.step(s, N);
    // Part 1 hits on its frame 20; start the phase step so that frame lands mid-invulnerability.
    runUntil(sim, () => c.moveFrame === 12);
    sim.step(N, { dir: 5, held: new Set(['phase']) });
    const seen = new Set<string>();
    let lastFrame = 0;
    const events: string[] = [];
    while (c.state === 'attack') {
      lastFrame = c.moveFrame;
      sim.step(N, N);
      seen.add(c.move?.id ?? '');
      events.push(...sim.events.map((e) => e.type));
    }
    expect(events).toContain('whiff_phase');
    expect(events).not.toContain('hit');
    expect([...seen].filter((x) => x.startsWith('corvane_last_bell')).sort()).toEqual(['corvane_last_bell_1']);
    expect(c.extraRecovery).toBe(0); // reset once he recovers
    expect(lastFrame).toBe(total + 40);
  });
  it('can only be used once per fight', () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    for (const s of LAST_BELL) sim.step(s, inp(4, -1));
    runUntil(sim, () => c.isNeutral, N, inp(4, -1), 300);
    for (let i = 0; i < 20; i++) sim.step(N, N);
    for (const s of LAST_BELL) sim.step(s, N);
    expect(c.move?.id ?? 'none').not.toBe('corvane_last_bell_1');
  });
});

describe('glint', () => {
  it('Haymaker glints red from frame 12 to frame 20 and is null otherwise', () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    sim.step(inp(4, 1, '2'), N);
    const seen: [number, string | null][] = [];
    while (c.state === 'attack') {
      seen.push([c.moveFrame, c.glint]);
      sim.step(N, N);
    }
    for (const [frame, g] of seen) expect(g, `frame ${frame}`).toBe(frame >= 12 && frame <= 20 ? 'red' : null);
    expect(seen.filter(([, g]) => g).length).toBe(9);
  });
  it("Last Bell's first part shows a white glint", () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    for (const s of LAST_BELL) sim.step(s, N);
    runUntil(sim, () => c.moveFrame === 6);
    expect(c.glint).toBe('white');
    runUntil(sim, () => c.moveFrame === 15);
    expect(c.glint).toBe(null);
  });
  it('Iron Wall glints red; moves without glint never glint', () => {
    expect(corvane.get('corvane_iron_wall')!.glint).toBe(true);
    const sim = corvaneVsRook();
    sim.step(inp(5, 1, '1'), N);
    for (let i = 0; i < 20; i++) {
      expect(sim.fighters[0].glint).toBe(null);
      sim.step(N, N);
    }
  });
});

describe('armor', () => {
  it('a jab landing on Iron Wall during its armor frames deals damage but does not interrupt it', () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    sim.step(inp(6, 1, '1', '2'), inp(5, -1, '1'));
    expect(c.move?.id).toBe('corvane_iron_wall');
    const ev = runUntil(sim, () => sim.events.some((e) => e.type === 'armor_absorb'), N, N, 30);
    expect(ev).toBeGreaterThan(0);
    expect(c.moveFrame).toBeLessThanOrEqual(21);
    expect(c.health).toBe(c.maxHealth - 7);
    expect(c.state).toBe('attack');
    expect(c.hitstop).toBe(0);
    // Iron Wall carries on and hits Rook.
    runUntil(sim, () => sim.events.some((e) => e.type === 'hit' && e.attacker === 0), N, N, 40);
    expect(sim.events.find((e) => e.attacker === 0)!.moveId).toBe('corvane_iron_wall');
  });
  it('a throw still beats armor', () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    sim.step(inp(6, 1, '1', '2'), inp(5, -1, '1', '3'));
    runUntil(sim, () => c.state === 'thrown', N, N, 20);
  });
  it('a launcher still beats armor', () => {
    const sim = corvaneVsRook();
    const c = sim.fighters[0];
    sim.step(inp(6, 1, '1', '2'), inp(3, -1, '4'));
    runUntil(sim, () => c.state === 'airborne', N, N, 25);
  });
});
