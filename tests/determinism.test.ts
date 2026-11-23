import { describe, expect, it } from 'vitest';
import { CombatSim } from '../src/combat/combat_sim';
import { BUTTONS, type Button, type InputSnapshot } from '../src/combat/types';
import { dummyConfig, rookConfig } from './helpers';

/** A scripted 600-frame input sequence from a fixed-seed LCG (the test owns its RNG). */
function script(seed: number, frames: number): InputSnapshot[] {
  let s = seed >>> 0;
  const rnd = (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
  const out: InputSnapshot[] = [];
  let dir = 5;
  let held = new Set<Button>();
  for (let i = 0; i < frames; i++) {
    if (rnd(6) === 0) dir = 1 + rnd(9);
    if (rnd(4) === 0) {
      held = new Set<Button>();
      for (const b of BUTTONS) if (rnd(5) === 0) held.add(b);
    }
    out.push({ dir, held: new Set(held) });
  }
  return out;
}

function runScript(): number[] {
  const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: 440, p2X: 500 });
  const a = script(1234, 600);
  const b = script(98765, 600);
  const hashes: number[] = [];
  for (let i = 0; i < 600; i++) {
    sim.step(a[i]!, b[i]!);
    hashes.push(sim.stateHash());
  }
  return hashes;
}

describe('determinism', () => {
  it('the same 600-frame input sequence gives the same stateHash on every frame', () => {
    const first = runScript();
    const second = runScript();
    for (let i = 0; i < 600; i++) expect(second[i], `frame ${i + 1}`).toBe(first[i]);
  });
  it('the scripted fight actually does things (hash changes, hits happen)', () => {
    const hashes = runScript();
    expect(new Set(hashes).size).toBeGreaterThan(500);
    const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: 440, p2X: 500 });
    const a = script(1234, 600);
    const b = script(98765, 600);
    let contacts = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(a[i]!, b[i]!);
      contacts += sim.events.filter((e) => e.type === 'hit' || e.type === 'block' || e.type === 'counter_hit').length;
    }
    expect(contacts).toBeGreaterThan(0);
  });
  it('all sim state stays integer', () => {
    const sim = new CombatSim({ p1: rookConfig(), p2: dummyConfig(), p1X: 440, p2X: 500 });
    const a = script(7, 600);
    const b = script(8, 600);
    for (let i = 0; i < 600; i++) {
      sim.step(a[i]!, b[i]!);
      for (const f of sim.fighters) {
        for (const v of [f.x, f.y, f.vx, f.vy, f.health, f.poise, f.stamina, f.stateFrame, f.moveFrame, f.gravity]) {
          expect(Number.isInteger(v)).toBe(true);
        }
      }
    }
  });
});
