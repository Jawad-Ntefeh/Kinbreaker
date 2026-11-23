import { describe, expect, it } from 'vitest';
import { parsePart, quarterTurn, type Grid } from '../tools/art/legacy/core';
import { rotateGrid, scale2x } from '../tools/art/legacy/rotsprite';

const grid = (rows: string[]): Grid => ({ w: rows[0]!.length, h: rows.length, px: rows.join('').split('') });

describe('legacy Part A rig (retired)', () => {
  it('Scale2x doubles and keeps hard edges (no new colours)', () => {
    const g = scale2x(grid(['ab', 'ba']));
    expect(g.w).toBe(4);
    expect(new Set(g.px)).toEqual(new Set(['a', 'b']));
  });
  it('RotSprite: 0 degrees is the identity; any angle uses only existing colours', () => {
    const g = grid(['.cc.', 'cggc', 'cggc', '.cc.']);
    expect(rotateGrid(g, [1, 1], 0).grid).toBe(g);
    const r = rotateGrid(g, [1, 1], 30).grid;
    expect([...new Set(r.px)].every((c) => '.cg'.includes(c))).toBe(true);
  });
  it('quarter turns are exact and move the joint and tips with the pixels', () => {
    const [p] = parsePart('arm@0.txt', 'joint 1 0\ntip end 1 3\n---\n.a.\n.a.\n.a.\n.b.\n');
    const q = quarterTurn(p!, 1);
    expect(q.dir).toBe(90);
    expect([q.grid.w, q.grid.h]).toEqual([4, 3]);
    // Pointing down → pointing forward: the far end (b) is now on the right.
    const end = q.tips.end!;
    expect(q.grid.px[end[1] * q.grid.w + end[0]]).toBe('b');
    expect(end[0]).toBeGreaterThan(q.joint[0]);
  });
});
