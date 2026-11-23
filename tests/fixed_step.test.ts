import { describe, expect, it } from 'vitest';
import { FixedStep, STEP_MS } from '../src/fixed_step';

describe('FixedStep', () => {
  it('runs one step per 60 Hz frame', () => {
    const l = new FixedStep();
    expect(l.advance(0)).toBe(0);
    expect(l.advance(STEP_MS)).toBe(1);
    expect(l.advance(STEP_MS * 2)).toBe(1);
  });
  it('runs 60 steps per second on a 144 Hz display', () => {
    const l = new FixedStep();
    l.advance(0);
    let steps = 0;
    for (let i = 1; i <= 144; i++) steps += l.advance((i * 1000) / 144);
    expect(steps).toBeGreaterThanOrEqual(59);
    expect(steps).toBeLessThanOrEqual(60);
  });
  it('drops the backlog when more than 3 steps are pending', () => {
    const l = new FixedStep();
    l.advance(0);
    expect(l.advance(5000)).toBe(1);
  });
});
