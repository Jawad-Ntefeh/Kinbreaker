import { describe, expect, it } from 'vitest';
import { inp, N, pointBlank, rookMoves, runUntil } from './helpers';
import type { Move } from '../src/combat/move_data';
import type { CombatSim } from '../src/combat/combat_sim';
import type { Button } from '../src/combat/types';

/** Perform `m` from neutral at point blank, the dummy holding `dummyDir` (relative). Returns the measured advantage. */
function measure(m: Move, dummyDir: number, setup?: (sim: CombatSim) => void): { kind: string; value: number; moveId: string } {
  const sim = pointBlank();
  setup?.(sim);
  const dummyIn = inp(dummyDir, sim.fighters[1].facing);
  // A cancel-only move is reached through the move that cancels into it.
  const press = (dir: number, btns: readonly Button[]) => sim.step(inp(dir, 1, ...btns), dummyIn);
  const dir = m.input.dir ?? 5;
  press(dir, m.input.buttons);
  runUntil(sim, () => sim.lastAdvantage !== null, inp(dir, 1), dummyIn);
  return sim.lastAdvantage!;
}

describe('measured frame advantage equals the data (point blank, first active frame)', () => {
  const moves = [...rookMoves().values()].filter((m) => m.height !== 'throw' && !m.cancelOnly && m.limb !== 'right_arm');
  const blockDir = (m: Move) => (m.height === 'low' ? 1 : 4);

  for (const m of moves) {
    if (typeof m.onBlock === 'number') {
      it(`${m.id} on block = ${m.onBlock}`, () => {
        const a = measure(m, blockDir(m));
        expect(a.kind).toBe('BLOCK');
        expect(a.moveId).toBe(m.id);
        expect(a.value).toBe(m.onBlock);
      });
    }
    if (typeof m.onHit === 'number') {
      it(`${m.id} on hit = ${m.onHit}`, () => {
        const a = measure(m, 5);
        expect(a.kind).toBe('HIT');
        expect(a.value).toBe(m.onHit);
      });
    }
  }

  it('rook_jab_2 (cancel from rook_jab) on block = -2 and on hit = +6', () => {
    for (const [dummyDir, kind, expected] of [[4, 'BLOCK', -2], [5, 'HIT', 6]] as const) {
      const sim = pointBlank();
      const d = inp(dummyDir, -1);
      sim.step(inp(5, 1, '1'), d);
      runUntil(sim, () => sim.fighters[0].moveFrame === 12, N, d);
      sim.step(inp(5, 1, '1'), d);
      runUntil(sim, () => sim.lastAdvantage?.moveId === 'rook_jab_2', N, d);
      expect(sim.lastAdvantage).toMatchObject({ kind, value: expected });
    }
  });

  it('rook_cross (dummy, all limbs) on block = -3 and on hit = +6', () => {
    for (const [rookDir, kind, expected] of [[4, 'BLOCK', -3], [5, 'HIT', 6]] as const) {
      const sim = pointBlank();
      const r = inp(rookDir, 1);
      sim.step(r, inp(5, -1, '2'));
      runUntil(sim, () => sim.lastAdvantage !== null, r, N);
      expect(sim.lastAdvantage).toMatchObject({ kind, moveId: 'rook_cross', value: expected });
    }
  });
});
