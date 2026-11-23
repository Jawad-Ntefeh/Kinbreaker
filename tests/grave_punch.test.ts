import { describe, expect, it } from 'vitest';
import { CorvaneAI } from '../src/ai/corvane_ai';
import { createCorvaneFight } from '../src/fights';
import type { InputSnapshot } from '../src/combat/types';

const N: InputSnapshot = { dir: 5, held: new Set() };

describe('Grave Punch', () => {
  it('in a scripted fight Corvane lands ground hits with Grave Punch after knockdowns in range', () => {
    let landed = 0;
    let rolls = 0;
    for (const seed of [1, 2, 3]) {
      const sim = createCorvaneFight(seed, { ko: false });
      const ai = new CorvaneAI(1);
      for (let f = 0; f < 4000; f++) {
        // Rook stands still near Corvane, so throws and Haymakers knock her down.
        sim.step(N, ai.update(sim));
        for (const e of sim.events) {
          if (e.type === 'ground_hit' && e.attacker === 1 && e.moveId === 'corvane_grave_punch') {
            landed++;
            expect(e.damage).toBe(8);
          }
        }
      }
      for (const e of ai.log) if (e.type === 'ground_hit') {
        rolls++;
        expect(e.move).toBe('corvane_grave_punch');
      }
    }
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThanOrEqual(rolls);
  });
});
