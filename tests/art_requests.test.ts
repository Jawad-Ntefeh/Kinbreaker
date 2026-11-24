import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Image models act on every noun they read ("no right arm" draws a right arm), so the prompts
// in docs/art_requests/ describe only what is visible.
const NEGATIVE = /\b(no|not|never|none|nothing|without|don't|doesn't|isn't|avoid|missing|instead of)\b/i;

describe('image prompts', () => {
  const files = readdirSync('docs/art_requests').filter((f) => f.endsWith('.md'));
  it('exist', () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(`${f}: prompts use positive wording only`, () => {
      const md = readFileSync(`docs/art_requests/${f}`, 'utf8');
      const prompts = [...md.matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1]!);
      expect(prompts.length).toBeGreaterThan(0);
      const bad = prompts.flatMap((p) => p.split(/(?<=[.;:])\s+/)).filter((s) => NEGATIVE.test(s));
      expect(bad).toEqual([]);
    });
  }
});
