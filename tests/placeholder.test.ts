import { describe, expect, it } from 'vitest';
import { getCharacter } from '../src/combat/character_data';
import { getMoveSet } from '../src/combat/move_data';
import { defaultLayout } from '../src/view/anim_layout';
import { posePlaceholder } from '../src/view/placeholder';

function body(id: string) {
  const def = getCharacter(id);
  const { json } = defaultLayout(def, getMoveSet(def.moveset));
  return { def, json, body: { height: def.body.height / 100, width: (def.body.halfWidth * 2) / 100, crouch: def.body.crouchHeight / 100, limbs: def.limbs, cell: json.cell, pivot: json.pivot } };
}

describe('placeholder silhouettes', () => {
  it('during the impact pose the attacking limb reaches toward the hitbox (or the cell edge)', () => {
    for (const id of ['rook', 'corvane']) {
      const { def, json, body: b } = body(id);
      const { cells } = defaultLayout(def, getMoveSet(def.moveset));
      for (const key of cells.filter((k) => k.phase === 'impact' && k.move!.height !== 'throw')) {
        const rects = posePlaceholder(key, b);
        const front = Math.max(...rects.map((r) => r.x + r.w)) - json.pivot[0];
        const hb = key.move!.hitboxes[0]!;
        const want = Math.min(Math.round((hb.x + hb.w) / 100), json.cell[0] - json.pivot[0] - 5);
        expect(front, key.anim).toBeGreaterThanOrEqual(want - 2);
      }
    }
  });
  it('stays inside its cell', () => {
    for (const id of ['rook', 'corvane']) {
      const { def, json, body: b } = body(id);
      for (const key of defaultLayout(def, getMoveSet(def.moveset)).cells) {
        for (const r of posePlaceholder(key, b)) {
          expect(r.x, key.anim).toBeGreaterThanOrEqual(0);
          expect(r.y, key.anim).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w, key.anim).toBeLessThanOrEqual(json.cell[0]);
          expect(r.y + r.h, key.anim).toBeLessThanOrEqual(json.cell[1]);
        }
      }
    }
  });
  it("Rook's placeholder has no right arm at rest (missing limb), Corvane's does", () => {
    const rook = body('rook');
    const corv = body('corvane');
    const idle = (x: ReturnType<typeof body>) => defaultLayout(x.def, getMoveSet(x.def.moveset)).cells.find((c) => c.anim === 'idle')!;
    const darkArmRook = posePlaceholder(idle(rook), rook.body).filter((r) => r.shade === 'dark').length;
    const darkArmCorv = posePlaceholder(idle(corv), corv.body).filter((r) => r.shade === 'dark').length;
    expect(darkArmCorv - darkArmRook).toBe(4); // two segments (upper and lower arm) of two rects each
  });
});
