/**
 * docs/ART_SPEC.md and docs/examples/rook.anims.json are generated from the data.
 * `npm run art-spec` rewrites them; this test fails if they are out of date.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMoveSet } from '../src/combat/move_data';
import { validateAnimFile } from '../src/view/anim_data';
import { generateArtSpec, sampleRookAnims } from '../src/view/art_spec';

const SPEC = 'docs/ART_SPEC.md';
const SAMPLE = 'docs/examples/rook.anims.json';

describe('art spec', () => {
  const { markdown, totals } = generateArtSpec();
  const sample = sampleRookAnims();
  if (process.env.ART_SPEC_WRITE) {
    mkdirSync('docs/examples', { recursive: true });
    writeFileSync(SPEC, markdown + '\n');
    writeFileSync(SAMPLE, sample);
    process.stdout.write(`wrote ${SPEC} and ${SAMPLE}\n${totals.map((t) => `${t.id}: ${t.animations} animations, ${t.drawnFrames} drawn frames`).join('\n')}\n`);
  }
  it('docs/ART_SPEC.md is up to date (run `npm run art-spec`)', () => {
    expect(existsSync(SPEC)).toBe(true);
    expect(readFileSync(SPEC, 'utf8')).toBe(markdown + '\n');
  });
  it('the sample Rook animation file is up to date and passes validation for every Rook move', () => {
    expect(readFileSync(SAMPLE, 'utf8')).toBe(sample);
    const raw = JSON.parse(sample);
    const moves = getMoveSet('rook');
    expect(validateAnimFile('docs/examples/rook.anims.json', raw, moves).errors).toEqual([]);
    for (const m of moves.values()) expect(raw.anims[m.id].move).toBe(m.id);
  });
  it('lists every animation needed for Rook and Corvane', () => {
    expect(markdown).toContain('`corvane_last_bell_5`');
    expect(markdown).toContain('`phase_transition`');
    expect(totals.map((t) => t.id)).toEqual(['rook', 'corvane']);
  });
});
