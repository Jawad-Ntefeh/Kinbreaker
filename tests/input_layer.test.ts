import { describe, expect, it } from 'vitest';
import {
  flagsToNumpad,
  mergeReadings,
  NO_DIRS,
  socdClean,
  stickToFlags,
  type DirFlags,
} from '../src/input/input_core';
import type { Button } from '../src/combat/types';

const f = (p: Partial<DirFlags>): DirFlags => ({ ...NO_DIRS, ...p });

describe('SOCD cleaning', () => {
  it('left + right = neutral', () => {
    expect(flagsToNumpad(socdClean(f({ left: true, right: true })))).toBe(5);
  });
  it('up + down = neutral', () => {
    expect(flagsToNumpad(socdClean(f({ up: true, down: true })))).toBe(5);
  });
  it('left + right + down = down', () => {
    expect(flagsToNumpad(socdClean(f({ left: true, right: true, down: true })))).toBe(2);
  });
  it('maps all 8 directions to numpad', () => {
    expect(flagsToNumpad(f({ down: true, left: true }))).toBe(1);
    expect(flagsToNumpad(f({ down: true }))).toBe(2);
    expect(flagsToNumpad(f({ down: true, right: true }))).toBe(3);
    expect(flagsToNumpad(f({ left: true }))).toBe(4);
    expect(flagsToNumpad(f({}))).toBe(5);
    expect(flagsToNumpad(f({ right: true }))).toBe(6);
    expect(flagsToNumpad(f({ up: true, left: true }))).toBe(7);
    expect(flagsToNumpad(f({ up: true }))).toBe(8);
    expect(flagsToNumpad(f({ up: true, right: true }))).toBe(9);
  });
});

describe('gamepad stick', () => {
  it('respects the 0.5 deadzone', () => {
    expect(stickToFlags(0.3, 0.3, 0.5)).toEqual(NO_DIRS);
  });
  it('maps to 8 directions (y down-positive)', () => {
    expect(flagsToNumpad(stickToFlags(1, 0, 0.5))).toBe(6);
    expect(flagsToNumpad(stickToFlags(0, 1, 0.5))).toBe(2);
    expect(flagsToNumpad(stickToFlags(0.7, 0.7, 0.5))).toBe(3);
    expect(flagsToNumpad(stickToFlags(-0.7, -0.7, 0.5))).toBe(7);
    expect(flagsToNumpad(stickToFlags(-1, 0.1, 0.5))).toBe(4);
  });
});

describe('merging keyboard and gamepad', () => {
  const set = (...b: Button[]) => new Set<Button>(b);
  it('unions buttons and directions', () => {
    const s = mergeReadings([
      { dirs: f({ down: true }), held: set('1') },
      { dirs: f({ right: true }), held: set('4') },
    ]);
    expect(s.dir).toBe(3);
    expect([...s.held].sort()).toEqual(['1', '4']);
  });
  it('applies SOCD across devices', () => {
    const s = mergeReadings([
      { dirs: f({ left: true }), held: set() },
      { dirs: f({ right: true }), held: set() },
    ]);
    expect(s.dir).toBe(5);
  });
  it('one idle device does not mask the other', () => {
    const s = mergeReadings([
      { dirs: f({}), held: set() },
      { dirs: f({ up: true }), held: set('phase') },
    ]);
    expect(s.dir).toBe(8);
    expect(s.held.has('phase')).toBe(true);
  });
});
