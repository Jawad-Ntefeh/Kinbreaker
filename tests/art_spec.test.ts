/**
 * data/art_spec.json (cell sizes), docs/ART_SPEC.md and docs/examples/rook.anims.json are generated
 * from the data. `npm run art-spec` rewrites them (cells first, then the docs); this test fails if
 * any of them is out of date.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getCharacter } from '../src/combat/character_data';
import { getMoveSet } from '../src/combat/move_data';
import { validateAnimFile } from '../src/view/anim_data';
import { defaultLayout, MAX_MOVE_POSES, MIN_MOVE_POSES, movePoses, sheetSpec } from '../src/view/anim_layout';
import { computeArtSpecJson, generateArtSpec, sampleRookAnims } from '../src/view/art_spec';

const SPEC = 'docs/ART_SPEC.md';
const SAMPLE = 'docs/examples/rook.anims.json';
const CELLS = 'data/art_spec.json';
const MODE = process.env.ART_SPEC_WRITE;

const cellsJson = () => JSON.stringify(computeArtSpecJson(JSON.parse(readFileSync(CELLS, 'utf8'))), null, 2) + '\n';

if (MODE === 'cells') {
  writeFileSync(CELLS, cellsJson());
  const spec = JSON.parse(readFileSync(CELLS, 'utf8'));
  process.stdout.write(`wrote ${CELLS}: ${Object.entries(spec.characters as Record<string, { cell: number[]; pivot: number[] }>).map(([id, c]) => `${id} cell ${c.cell.join('x')} pivot (${c.pivot.join(', ')})`).join('; ')}\n`);
}

describe.skipIf(MODE === 'cells')('art spec', () => {
  const { markdown, totals } = generateArtSpec();
  const sample = sampleRookAnims();
  if (MODE === 'docs') {
    mkdirSync('docs/examples', { recursive: true });
    writeFileSync(SPEC, markdown + '\n');
    writeFileSync(SAMPLE, sample);
    process.stdout.write(`wrote ${SPEC} and ${SAMPLE}\n${totals.map((t) => `${t.id}: ${t.animations} animations, ${t.drawnFrames} drawn frames, ${t.required} required`).join('\n')}\n`);
  }
  it('data/art_spec.json cell sizes follow the reach rule (run `npm run art-spec`)', () => {
    expect(readFileSync(CELLS, 'utf8')).toBe(cellsJson());
  });
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
  it('every hitbox fits inside its character\'s cell', () => {
    for (const id of ['rook', 'corvane']) {
      const { spec } = sheetSpec(id)!;
      for (const m of getMoveSet(getCharacter(id).moveset).values()) {
        for (const h of m.hitboxes) expect((h.x + h.w) / 100, m.id).toBeLessThanOrEqual(spec.cell[0] - spec.pivot[0]);
      }
    }
  });
  it('3 to 7 poses per move; heavy moves have a smear frame right before the impact frame', () => {
    for (const id of ['rook', 'corvane']) {
      for (const m of getMoveSet(getCharacter(id).moveset).values()) {
        const poses = movePoses(m);
        expect(poses.length, m.id).toBeGreaterThanOrEqual(MIN_MOVE_POSES);
        expect(poses.length, m.id).toBeLessThanOrEqual(MAX_MOVE_POSES);
        const impact = poses.findIndex((p) => p.phase === 'impact');
        const heavy = m.damage >= 20 || m.properties.includes('launcher');
        expect(poses[impact - 1]?.phase === 'smear', m.id).toBe(heavy);
        expect(poses.filter((p) => p.phase === 'smear').length, m.id).toBe(heavy ? 1 : 0);
      }
    }
  });
  it('intro, stagger, guard_break and throw_break are required; victory stays optional', () => {
    for (const name of ['intro', 'stagger', 'guard_break', 'throw_break']) expect(markdown).toMatch(new RegExp(`\\| \`${name}\` \\| yes \\|`));
    expect(markdown).toMatch(/\| `victory` \| optional \|/);
    void defaultLayout;
  });
});
