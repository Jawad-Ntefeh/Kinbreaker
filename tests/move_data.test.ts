import { describe, expect, it } from 'vitest';
import { formatError, loadAllMoves } from '../src/combat/move_data';

describe('data/moves', () => {
  it('every move file loads and validates with no errors', () => {
    const { sets, errors } = loadAllMoves();
    expect(errors.map(formatError)).toEqual([]);
    expect(sets.get('rook')!.size).toBe(10);
  });
  it("Rook's design targets are kept exactly", () => {
    const rook = loadAllMoves().sets.get('rook')!;
    const t: [string, string, number, number | null, number | string][] = [
      ['rook_jab', '1', 10, 1, 8],
      ['rook_jab_2', '1', 10, -2, 6],
      ['rook_low_jab', '2:1', 10, -5, 4],
      ['rook_palm', '6:1', 14, -9, 5],
      ['rook_knee', '3', 13, -6, 4],
      ['rook_high_kick', '4', 14, -9, 7],
      ['rook_sweep', '2:4', 16, -14, 'knockdown'],
      ['rook_rising_kick', '3:4', 15, -13, 'launch'],
      ['rook_throw', '1+3', 12, null, 'knockdown'],
      ['rook_cross', '2', 12, -3, 6],
    ];
    for (const [id, input, startup, onBlock, onHit] of t) {
      const m = rook.get(id)!;
      expect([m.inputText, m.startup, m.onBlock, m.onHit], id).toEqual([input, startup, onBlock, onHit]);
    }
  });
});
