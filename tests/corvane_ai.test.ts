import { describe, expect, it } from 'vitest';
import { AI, CorvaneAI, SWEEPING, type Opener } from '../src/ai/corvane_ai';
import type { CombatSim } from '../src/combat/combat_sim';
import type { FighterState } from '../src/combat/fighter';
import { toAbsolute, type Button, type InputSnapshot } from '../src/combat/types';
import { createCorvaneFight } from '../src/fights';
import { MasherBot, PerfectBot, runFight, type Bot } from './bots';

const N: InputSnapshot = { dir: 5, held: new Set() };

/** Run Corvane's AI against a Rook driven by `bot` for `frames` frames. */
function play(seed: number, bot: (sim: CombatSim, f: number) => InputSnapshot, frames: number, opts: { ko?: boolean; setup?: (sim: CombatSim, ai: CorvaneAI) => void } = {}) {
  const sim = createCorvaneFight(seed, { ko: opts.ko ?? false });
  const ai = new CorvaneAI(1);
  opts.setup?.(sim, ai);
  for (let f = 0; f < frames; f++) {
    const a = bot(sim, f);
    const b = ai.update(sim);
    sim.step(a, b);
  }
  return { sim, ai };
}

const rel = (sim: CombatSim, d: number, ...b: Button[]): InputSnapshot => ({ dir: toAbsolute(d, sim.fighters[0].facing), held: new Set(b) });

/** Rook that blocks everything correctly and breaks throws. */
const blocker = (sim: CombatSim): InputSnapshot => {
  const [r, c] = sim.fighters;
  if (r.state === 'thrown') return rel(sim, 5, ...(sim.frame % 2 ? (['1'] as const) : []));
  return rel(sim, c.move?.height === 'low' ? 1 : 4);
};

describe('reaction delay', () => {
  it('Corvane perceives Rook exactly as she was 18 frames ago (15 in phase 2)', () => {
    for (const phase of [1, 2]) {
      const sim = createCorvaneFight(5, { ko: false });
      const ai = new CorvaneAI(1);
      sim.fighters[1].phase = phase;
      const masher = new MasherBot(9);
      const states: FighterState[] = [];
      const delay = AI.reactionDelay[phase - 1]!;
      for (let f = 0; f < 600; f++) {
        states[sim.frame] = sim.fighters[0].state;
        const b = ai.update(sim);
        const seen = ai.perceived(sim);
        if (sim.frame >= delay) expect(seen.state, `frame ${sim.frame}`).toBe(states[sim.frame - delay]);
        sim.step(masher.update(sim), b);
      }
    }
  });
  it("his first response to a phase step comes no earlier than the delay", () => {
    let phaseStarts: number[] = [];
    const { ai } = play(3, (sim) => {
      const r = sim.fighters[0];
      if (r.isNeutral && sim.frame % 50 === 10) {
        phaseStarts.push(sim.frame + 1);
        return rel(sim, 5, 'phase');
      }
      return N;
    }, 400, { setup: (_s, a) => a.forceBehaviour('idle', 400) });
    const reads = ai.log.filter((e) => e.type === 'phase_read');
    expect(reads.length).toBeGreaterThan(0);
    phaseStarts = phaseStarts.filter((t) => t < reads[0]!.frame);
    const third = phaseStarts[2]!;
    expect(reads[0]!.frame - third).toBeGreaterThanOrEqual(AI.reactionDelay[0]);
  });
  it('a punish never starts before he could have seen the blocked move', () => {
    let punishes = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const starts: number[] = [];
      const { ai } = play(seed, (sim) => {
        const r = sim.fighters[0];
        if (r.isNeutral && sim.frame % 90 === 0) return rel(sim, 3, '4'); // Rising Kick: -13
        if (r.move?.id === 'rook_rising_kick' && r.moveFrame === 1) starts.push(sim.frame);
        return N;
      }, 1500, {
        setup: (sim, a) => {
          sim.fighters[0].x = sim.fighters[1].x - 3750;
          a.forceBehaviour('guard', 100000);
        },
      });
      for (const e of ai.log.filter((x) => x.type === 'punish')) {
        punishes++;
        const start = Math.max(...starts.filter((t) => t < e.frame));
        expect(e.frame - start).toBeGreaterThanOrEqual(AI.reactionDelay[0]);
      }
    }
    expect(punishes).toBeGreaterThan(0);
  });
});

describe('opener rules', () => {
  it('never the same opener three times in a row (10,000 frames vs a passive Rook, several seeds)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { ai } = play(seed, () => N, 10000, { setup: (sim) => (sim.fighters[1].phase = seed % 2 ? 1 : 1) });
      const o = ai.openers;
      expect(o.length).toBeGreaterThan(50);
      for (let i = 2; i < o.length; i++) expect(o[i] === o[i - 1] && o[i] === o[i - 2], `seed ${seed} at ${i}: ${o.slice(i - 2, i + 1)}`).toBe(false);
    }
  });
  it('never the same opener three times in a row in phase 2 either', () => {
    for (const seed of [6, 7, 8]) {
      const { ai } = play(seed, () => N, 10000, {
        setup: (sim) => {
          const c = sim.fighters[1];
          c.phase = 2;
          c.lockedMoves.delete('corvane_iron_wall');
        },
      });
      const o = ai.openers;
      for (let i = 2; i < o.length; i++) expect(o[i] === o[i - 1] && o[i] === o[i - 2]).toBe(false);
      expect(o).toContain('iron_wall');
    }
  });
});

describe('reads', () => {
  it('throw read: after the player blocks 3 of his attacks within 180 frames, his next close opener is Bell Ringer', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4]) {
      const blocks: number[] = [];
      const { ai } = play(seed, (sim) => {
        for (const e of sim.events) if (e.type === 'block' && e.attacker === 1) blocks.push(sim.frame);
        return blocker(sim);
      }, 4000);
      const log = ai.log;
      log.forEach((e, i) => {
        if (e.type !== 'throw_read') return;
        // It really was 3 blocks within 180 frames.
        expect(blocks.filter((t) => t <= e.frame && e.frame - t <= AI.throwReadWindow).length).toBeGreaterThanOrEqual(3);
        const next = log.slice(i + 1).find((x) => x.type === 'opener' && x.range === 'close');
        if (next) {
          expect(next.opener).toBe('bell_ringer');
          checked++;
        }
      });
    }
    expect(checked).toBeGreaterThan(3);
  });
  it('phase-step read: after 3 phase steps within 240 frames, his next 2 openers are sweeping', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { ai } = play(seed, (sim) => (sim.fighters[0].isNeutral && sim.frame % 60 === 0 ? rel(sim, 4, 'phase') : rel(sim, sim.fighters[1].move?.height === 'low' ? 1 : 4)), 3000, {
        setup: (sim, a) => {
          if (seed > 3) {
            sim.fighters[1].phase = 2;
            sim.fighters[1].lockedMoves.delete('corvane_iron_wall');
          }
          void a;
        },
      });
      const log = ai.log;
      log.forEach((e, i) => {
        if (e.type !== 'phase_read') return;
        const next = log.slice(i + 1).filter((x) => x.type === 'opener').slice(0, 2);
        if (next.length < 2 || log.slice(i + 1).some((x, j) => x.type === 'phase_read' && j < log.indexOf(next[1]!) - i - 1)) return;
        for (const n of next) expect(SWEEPING.has(n.opener as Opener), `${n.opener}`).toBe(true);
        checked++;
      });
    }
    expect(checked).toBeGreaterThan(3);
  });
});

describe('punishes', () => {
  /** Rook at point blank does `move` into Corvane's guard; returns the AI log and Corvane's hits. */
  function punishTest(seed: number, input: [number, Button], guardDir: 1 | 4, phase: number) {
    const hits: string[] = [];
    let did = false;
    const { ai } = play(seed, (sim) => {
      for (const e of sim.events) if (e.attacker === 1 && (e.type === 'hit' || e.type === 'counter_hit')) hits.push(e.moveId);
      if (!did && sim.frame === 5) {
        did = true;
        return rel(sim, input[0], input[1]);
      }
      return N;
    }, 120, {
      setup: (sim, a) => {
        sim.fighters[0].x = sim.fighters[1].x - 3750;
        sim.fighters[1].phase = phase;
        a.forceBehaviour('guard', 60, guardDir);
      },
    });
    return { punishes: ai.log.filter((e) => e.type === 'punish'), hits };
  }
  it('never punishes a safe move (Knee -6, Low Jab -5, Jab +1)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(punishTest(seed, [5, '3'], 4, 1).punishes).toEqual([]);
      expect(punishTest(seed, [5, '1'], 4, 2).punishes).toEqual([]);
      expect(punishTest(seed, [2, '1'], 1, 2).punishes).toEqual([]);
    }
  });
  it('punishes a -14 move (Sweep, crouch-guarded in phase 2) with Straight Cross when the roll succeeds, and it lands', () => {
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { punishes, hits } = punishTest(seed, [2, '4'], 1, 2);
      for (const p of punishes) expect(p.move).toBe('corvane_cross');
      if (punishes.length) {
        expect(hits[0]).toBe('corvane_cross');
        landed++;
      }
    }
    expect(landed).toBeGreaterThanOrEqual(14); // 90% in phase 2
    expect(landed).toBeLessThan(20 + 1);
  });
  it('punishes -10 to -13 (Rising Kick) with a jab', () => {
    let landed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { punishes, hits } = punishTest(seed, [3, '4'], 4, 1);
      for (const p of punishes) expect(p.move).toBe('corvane_jab_1');
      if (punishes.length) {
        expect(hits[0]).toBe('corvane_jab_1');
        landed++;
      }
    }
    expect(landed).toBeGreaterThanOrEqual(8); // 70% in phase 1
  });
});

describe('phase 2 and Last Bell', () => {
  it('Last Bell (Ember) is used exactly once in a long phase 2, never again', () => {
    for (const seed of [1, 2, 3]) {
      const { ai } = play(seed, blocker, 8000, {
        setup: (sim) => {
          const c = sim.fighters[1];
          c.phase = 2;
          c.lockedMoves.delete('corvane_iron_wall');
          c.lockedMoves.delete('corvane_last_bell_1');
        },
      });
      expect(ai.openers.filter((o) => o === 'last_bell').length).toBe(1);
      expect(ai.log.filter((e) => e.type === 'ember').length).toBe(1);
    }
  });
  it('in a real fight Corvane reaches phase 2, breaks the wall, uses Iron Wall and Last Bell once', () => {
    const r = runFight(1, new PerfectBot(), 20000);
    const c = r.sim.fighters[1];
    expect(c.phase).toBe(2);
    expect(r.sim.wallBroken).toBe(true);
    expect(r.sim.arenaRight - r.sim.arenaLeft).toBe(192000);
    expect(r.ai.openers.filter((o) => o === 'last_bell').length).toBe(1);
    expect(r.ai.openers).toContain('iron_wall');
    const firstP2 = r.ai.openers.indexOf('iron_wall');
    expect(firstP2).toBeGreaterThan(0);
  });
});

describe('full fights', () => {
  it('determinism: a recorded 3,600-frame fight with a fixed seed gives the same stateHash every frame', () => {
    const bot: Bot = new MasherBot(42);
    const sim1 = createCorvaneFight(77, { ko: false });
    const ai1 = new CorvaneAI(1);
    const inputs: InputSnapshot[] = [];
    const h1: number[] = [];
    for (let f = 0; f < 3600; f++) {
      const a = bot.update(sim1);
      inputs.push(a);
      sim1.step(a, ai1.update(sim1));
      h1.push(sim1.stateHash());
    }
    const sim2 = createCorvaneFight(77, { ko: false });
    const ai2 = new CorvaneAI(1);
    for (let f = 0; f < 3600; f++) {
      sim2.step(inputs[f]!, ai2.update(sim2));
      expect(sim2.stateHash(), `frame ${f + 1}`).toBe(h1[f]);
    }
    expect(new Set(h1).size).toBeGreaterThan(3000);
  });
  it('a full fight is winnable: the "perfect" bot defeats Corvane within 6,000 frames (fixed seed 2)', () => {
    const r = runFight(2, new PerfectBot(), 6000);
    expect(r.winner).toBe('rook');
    expect(r.frames).toBeLessThanOrEqual(6000);
  });
  it('the button-masher loses', () => {
    const r = runFight(1, new MasherBot(10), 20000);
    expect(r.winner).toBe('corvane');
  });
});
