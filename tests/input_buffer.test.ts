import { describe, expect, it } from 'vitest';
import { InputBuffer } from '../src/combat/input_buffer';
import type { Button } from '../src/combat/types';

/** Push a sequence of [absoluteDir, frames, buttons?] steps. */
function feed(buf: InputBuffer, steps: [number, number, Button[]?][]): void {
  for (const [dir, frames, buttons] of steps) {
    for (let i = 0; i < frames; i++) buf.push(dir, new Set(buttons ?? []));
  }
}

describe('InputBuffer motions (facing right)', () => {
  it('detects 236 with the diagonal', () => {
    const b = new InputBuffer();
    feed(b, [[5, 3], [2, 2], [3, 2], [6, 2]]);
    expect(b.motion('236', 1)).toBe(true);
  });
  it('detects 236 with the diagonal skipped (S then D)', () => {
    const b = new InputBuffer();
    feed(b, [[5, 3], [2, 2], [6, 2]]);
    expect(b.motion('236', 1)).toBe(true);
    const c = new InputBuffer();
    feed(c, [[5, 3], [2, 2], [5, 1], [6, 2]]);
    expect(c.motion('236', 1)).toBe(true);
  });
  it('detects 214 with and without the diagonal', () => {
    const b = new InputBuffer();
    feed(b, [[2, 2], [1, 2], [4, 2]]);
    expect(b.motion('214', 1)).toBe(true);
    const c = new InputBuffer();
    feed(c, [[2, 2], [4, 2]]);
    expect(c.motion('214', 1)).toBe(true);
  });
  it('detects 623 as 6,2,3 and as 6 then 3', () => {
    const b = new InputBuffer();
    feed(b, [[6, 2], [2, 2], [3, 2]]);
    expect(b.motion('623', 1)).toBe(true);
    const c = new InputBuffer();
    feed(c, [[6, 2], [3, 2]]);
    expect(c.motion('623', 1)).toBe(true);
  });
  it('rejects wrong order and stale motions', () => {
    const b = new InputBuffer();
    feed(b, [[6, 2], [3, 2], [2, 2]]);
    expect(b.motion('236', 1)).toBe(false);
    const c = new InputBuffer();
    feed(c, [[2, 2], [3, 2], [6, 2], [5, 20]]);
    expect(c.motion('236', 1, 12)).toBe(false);
  });
  it('detects double taps 66, 44, 22', () => {
    const b = new InputBuffer();
    feed(b, [[6, 2], [5, 2], [6, 1]]);
    expect(b.motion('66', 1)).toBe(true);
    const c = new InputBuffer();
    feed(c, [[4, 2], [5, 2], [4, 1]]);
    expect(c.motion('44', 1)).toBe(true);
    const d = new InputBuffer();
    feed(d, [[2, 2], [5, 2], [2, 1]]);
    expect(d.motion('22', 1)).toBe(true);
    const e = new InputBuffer();
    feed(e, [[5, 2], [6, 6]]);
    expect(e.motion('66', 1)).toBe(false);
  });
  it('consumeMotions prevents reusing a motion', () => {
    const b = new InputBuffer();
    feed(b, [[6, 2], [5, 2], [6, 1]]);
    expect(b.motion('66', 1)).toBe(true);
    b.consumeMotions();
    feed(b, [[6, 1]]);
    expect(b.motion('66', 1)).toBe(false);
  });
});

describe('InputBuffer motions (facing left)', () => {
  it('detects 236 as absolute 2,1,4 when facing left', () => {
    const b = new InputBuffer();
    feed(b, [[2, 2], [1, 2], [4, 2]]);
    expect(b.motion('236', -1)).toBe(true);
    expect(b.motion('214', -1)).toBe(false);
    expect(b.motion('214', 1)).toBe(true);
  });
  it('detects 236 with skipped diagonal when facing left', () => {
    const b = new InputBuffer();
    feed(b, [[2, 2], [4, 2]]);
    expect(b.motion('236', -1)).toBe(true);
  });
  it('detects 623 and 66 when facing left', () => {
    const b = new InputBuffer();
    feed(b, [[4, 2], [2, 2], [1, 2]]);
    expect(b.motion('623', -1)).toBe(true);
    const c = new InputBuffer();
    feed(c, [[4, 2], [5, 2], [4, 1]]);
    expect(c.motion('66', -1)).toBe(true);
  });
  it('turning around mid-motion re-interprets stored absolute directions', () => {
    const b = new InputBuffer();
    feed(b, [[2, 2], [3, 2], [6, 2]]);
    expect(b.motion('236', 1)).toBe(true);
    expect(b.motion('214', -1)).toBe(true);
  });
  it('heldDir is facing-relative', () => {
    const b = new InputBuffer();
    feed(b, [[4, 1]]);
    expect(b.heldDir(1)).toBe(4);
    expect(b.heldDir(-1)).toBe(6);
    feed(b, [[1, 1]]);
    expect(b.heldDir(-1)).toBe(3);
  });
});

describe('InputBuffer presses', () => {
  it('pressed() sees a press within the window', () => {
    const b = new InputBuffer();
    feed(b, [[5, 1, ['1']], [5, 3]]);
    expect(b.pressed('1')).toBe(true);
    feed(b, [[5, 3]]);
    expect(b.pressed('1', 6)).toBe(false);
  });
  it('holding a button is only one press', () => {
    const b = new InputBuffer();
    feed(b, [[5, 10, ['1']]]);
    expect(b.pressed('1')).toBe(false);
    expect(b.isHeld('1')).toBe(true);
  });
  it('together("1","3") within 2 frames is true', () => {
    const b = new InputBuffer();
    feed(b, [[5, 2, ['1']], [5, 1, ['1', '3']]]);
    expect(b.together('1', '3')).toBe(true);
    const c = new InputBuffer();
    feed(c, [[5, 1, ['1', '3']]]);
    expect(c.together('1', '3')).toBe(true);
  });
  it('together("1","3") at 4 frames apart is false', () => {
    const b = new InputBuffer();
    feed(b, [[5, 4, ['1']], [5, 1, ['1', '3']]]);
    expect(b.together('1', '3')).toBe(false);
  });
  it('consumed presses do not trigger twice', () => {
    const b = new InputBuffer();
    feed(b, [[5, 1, ['1']]]);
    expect(b.pressed('1')).toBe(true);
    b.consume('1');
    expect(b.pressed('1')).toBe(false);
    feed(b, [[5, 2, ['1']]]);
    expect(b.pressed('1')).toBe(false);
    feed(b, [[5, 1], [5, 1, ['1']]]);
    expect(b.pressed('1')).toBe(true);
  });
  it('consumed presses do not count for together()', () => {
    const b = new InputBuffer();
    feed(b, [[5, 1, ['1', '3']]]);
    b.consume('1');
    expect(b.together('1', '3')).toBe(false);
  });
  it('historyString lists inputs newest first', () => {
    const b = new InputBuffer();
    feed(b, [[6, 3], [5, 2], [2, 2], [3, 1, ['4']]]);
    expect(b.historyString(4)).toBe('3+4  2  5  6');
    expect(b.historyEntries(2, -1)).toEqual(['1+4', '2']);
  });
});
