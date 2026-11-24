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
