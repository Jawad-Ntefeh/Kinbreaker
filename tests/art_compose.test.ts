import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeSheet, composeSpecs } from '../tools/art/compose';

describe('composed sheets', () => {
  const specs = composeSpecs();
  it('exist', () => expect(specs.length).toBeGreaterThan(0));
  for (const [char, f, spec] of specs) {
    it(`${char}/${f}: the committed raw sheet matches its spec (run npm run art-compose)`, () => {
      const bytes = composeSheet(char, spec, false);
      expect(Buffer.compare(bytes, readFileSync(join('art_src', char, spec.out)))).toBe(0);
    });
  }
});

describe('derived animations', () => {
  it('walk_back is walk_forward in reverse, reusing its cells', () => {
    const file = JSON.parse(readFileSync('data/anims/rook.json', 'utf8')) as { anims: Record<string, { frames: { cell: number }[] }> };
    const fwd = file.anims.walk_forward?.frames.map((f) => f.cell);
    if (!fwd) return; // walk_forward not built yet
    expect(file.anims.walk_back?.frames.map((f) => f.cell)).toEqual([...fwd].reverse());
  });
});
