/**
 * Generates docs/ART_SPEC.md from the game data (characters, moves, art_spec.json), so the art
 * specification never goes out of date. Pure logic; written by `npm run art-spec`.
 */
import { loadAllCharacters } from '../combat/character_data';
import { loadAllMoves, type Move } from '../combat/move_data';
import { CELL_BEHIND, CELL_MARGIN, CELL_ROUND, computeCell, defaultLayout, hasSmear, maxReach, movePoses, sheetSpec, STATE_SPECS } from './anim_layout';

export interface ArtTotals {
  id: string;
  animations: number;
  drawnFrames: number;
  required: number;
}

function moveRow(m: Move): string {
  const poses = movePoses(m);
  const plan = poses.map((p) => `${p.phase === 'impact' ? '**impact**' : p.phase === 'smear' ? '*smear*' : p.phase} ${p.dur}`).join(', ');
  const reach = m.height === 'throw' ? `range ${m.throwRange / 100}` : `${Math.max(...m.hitboxes.map((h) => (h.x + h.w) / 100))}`;
  const extra = [hasSmear(m) ? 'smear frame before impact' : '', m.cancelOnly ? 'cancel-only' : '', m.continueOn.length ? 'automatic part' : '', m.whiffRecovery ? `+${m.whiffRecovery} on whiff (hold the last pose)` : '', m.glint ? `glint (${m.path === 'sweeping' ? 'red' : 'white'}) frames ${m.startup - 14}-${m.startup - 6}` : '', m.armorFrames ? `armor ${m.armorFrames[0]}-${m.armorFrames[1]}` : '']
    .filter(Boolean)
    .join('; ');
  return `| \`${m.id}\` | ${m.name} | \`${m.inputText}\` | ${m.height} / ${m.path} | ${m.startup} | ${m.active} | ${m.recovery} | ${m.total} | **${m.startup}** | ${reach} | ${poses.length} | ${plan} | ${extra} |`;
}

export function generateArtSpec(): { markdown: string; totals: ArtTotals[] } {
  const chars = loadAllCharacters().defs;
  const sets = loadAllMoves().sets;
  const totals: ArtTotals[] = [];
  const out: string[] = [];
  const p = (s = '') => out.push(s);

  p('# Kinbreaker art specification');
  p();
  p('> Generated from the game data by `npm run art-spec`. Do not edit by hand: change the data and regenerate.');
  p();
  p('## How the art plugs in');
  p();
  p('- **Sheet:** `public/art/characters/<id>.png`, a grid of equal cells, no padding, read left to right, top to bottom (cell 0 = top left). A plain "Sprite sheet" export.');
  p('- **Animation file:** `data/anims/<id>.json` with `sheet`, `cell` [w, h], `pivot` [x, y], optional `sheet_cells` [columns, rows], and `anims`. A complete example for Rook (placeholder cell numbers, correct timing for every move) is in `docs/examples/rook.anims.json`.');
  p('- **Pivot:** the point in each cell that sits on the fighter\'s position: centre between the feet, on the floor line. Sprites are mirrored around it when facing left, so draw every pose facing **right**.');
  p('- **Timing:** `dur` is in sim frames (60 per second). Animations are held key poses, not one drawn frame per fixed interval.');
  p('- **Move animations** (`"move": "<id>"`) play on the move\'s own frame counter, so they can never drift from the frame data. The game checks, and refuses files that break, these rules:');
  p('  1. exactly one frame has `"impact": true`, and it **starts on the move\'s first active frame** (durations before it add up to `startup - 1`);');
  p('  2. all durations add up to the move\'s total (`startup + active - 1 + recovery`);');
  p('  3. the impact frame lasts at least as long as the active frames;');
  p('  4. every cell exists in the sheet.');
  p('- **Reach:** the impact pose should reach the hitbox (the "reach" column, in px in front of the pivot).');
  p(`- **Cell size comes from the data:** ${CELL_BEHIND} px behind the pivot, and in front of it the character\'s furthest hitbox reach + ${CELL_MARGIN} px; the width is rounded up to a multiple of ${CELL_ROUND}. The height is fixed per character. The game refuses an animation file whose cell doesn\'t contain every hitbox of its moves.`);
  p('- **Poses:** 3 to 7 per move. Heavy moves (damage 20 or more, or launchers) get one extra **smear** frame immediately before the impact frame: the limb mid-swing, stretched or blurred, so the hit reads at speed. It is part of the wind-up, so it never moves the impact frame.');
  p('- **Missing animations** fall back (`hitstun_high` → `hitstun_mid` → `idle`; `blockstun_crouch` → `blockstun_stand` → `block_stand`; anything else → `idle`), so the game runs with a partial sheet. Characters without a sheet use generated placeholder silhouettes.');
  p('- **Check your work:** `npm run dev`, open `/sprites.html` to see each sheet with cell numbers, then the game with the debug overlay (`` ` ``): it shows cell bounds, the pivot and `anim  cell  frame  IMPACT`; **H** fades or hides the sprites to compare them with the hitboxes.');
  p();
  p('## Palette rules');
  p();
  p("- Rook's accent is **tarnished gold**. Corvane is **iron grey** (skin and wrist bands) with **rust-brown leather** as the secondary colour. The training dummy is Rook's sheet shifted to greys by the game (no separate art).");
  p('- **Red is reserved for sweeping-attack glints.** Never use red as a character colour; white glints mean linear attacks. Glints, sparks and other effects are drawn by the game, not on the sprites.');
  p('- The world is desaturated; the action is coloured. Whole pixels, no anti-aliasing, no smooth gradients; a dark outline around each silhouette.');
  p('- Hit flashes (white), phase-step afterimages (gold) and the dummy\'s grey are made from the sprite\'s silhouette by the game, so keep a clean transparent background.');
  p();

  const ids = [...chars.keys()].filter((id) => sheetSpec(id)?.sheetOf === id).sort((a, b) => (a === 'rook' ? -1 : b === 'rook' ? 1 : a < b ? -1 : 1));
  for (const id of ids) {
    const def = chars.get(id)!;
    const moves = sets.get(def.moveset)!;
    const { spec } = sheetSpec(id)!;
    const layout = defaultLayout(def, moves);
    const states = STATE_SPECS.filter((s) => !s.bossOnly || def.boss);
    const moveList = [...moves.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    const drawn = layout.cells.length;
    totals.push({ id, animations: states.length + moveList.length, drawnFrames: drawn, required: states.filter((s) => s.required).length + moveList.length });
    const reach = maxReach(moves);
    p(`## ${def.name} (\`${id}\`)`);
    p();
    p(`- Cell **${spec.cell[0]}x${spec.cell[1]}**, pivot **(${spec.pivot[0]}, ${spec.pivot[1]})**, colour: ${spec.color}. Hurtbox ${(def.body.halfWidth * 2) / 100}x${def.body.height / 100} px (crouching ${def.body.crouchHeight / 100}).`);
    p(`- Cell width: ${CELL_BEHIND} px behind the pivot + furthest reach ${reach} px + ${CELL_MARGIN} px = ${CELL_BEHIND + reach + CELL_MARGIN}, rounded up to ${spec.cell[0]} (${spec.cell[0] - spec.pivot[0]} px in front of the pivot).`);
    p(`- Suggested sheet: **${layout.json.sheet_cells[0]} columns x ${layout.json.sheet_cells[1]} rows** (${drawn} cells) at \`public/art/characters/${id}.png\`, ${layout.json.sheet_cells[0] * spec.cell[0]}x${layout.json.sheet_cells[1] * spec.cell[1]} px.`);
    if (id === 'rook') p('- Rook is missing her **right arm** (the back arm when facing right): draw it absent in every pose. `rook_cross` (right arm) is used by the training dummy and later by the Iron Wrist relic.');
    if (id === 'rook') p('- The training dummy (`dummy`) uses this sheet, shifted to greys.');
    p(`- **${states.length + moveList.length} animations, ${drawn} drawn frames** (${states.filter((s) => s.required).length} required state animations + ${moveList.length} moves; the rest are optional).`);
    p();
    p('### State animations');
    p();
    p('| Animation | Required | Poses | Frames per pose | Loop | Notes |');
    p('| --- | --- | --- | --- | --- | --- |');
    for (const s of states) p(`| \`${s.name}\` | ${s.required ? 'yes' : 'optional'} | ${s.poses} | ${s.dur} | ${s.loop ? 'yes' : 'no'} | ${s.note} |`);
    p();
    p('### Move animations');
    p();
    p('The impact pose must start on the frame in **bold** (the first active frame). "Poses" is the suggested number of drawn frames, with the suggested hold of each (sim frames).');
    p();
    p('| Move | Name | Input | Height / path | Startup | Active | Recovery | Total | Impact starts on | Reach (px) | Poses | Suggested poses | Notes |');
    p('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const m of moveList) p(moveRow(m));
    p();
  }
  p('## Totals');
  p();
  p('| Character | Animations | Drawn frames | Required animations |');
  p('| --- | --- | --- | --- |');
  for (const t of totals) p(`| ${t.id} | ${t.animations} | ${t.drawnFrames} | ${t.required} |`);
  p();
  return { markdown: out.join('\n'), totals };
}

/** The example animation file for the artist (Rook, placeholder cell numbers, correct timing). */
export function sampleRookAnims(): string {
  const def = loadAllCharacters().defs.get('rook')!;
  const { json } = defaultLayout(def, loadAllMoves().sets.get('rook')!);
  // One animation per line keeps the example readable.
  const anims = Object.entries(json.anims)
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  return `{\n  "sheet": ${JSON.stringify(json.sheet)},\n  "cell": ${JSON.stringify(json.cell)},\n  "pivot": ${JSON.stringify(json.pivot)},\n  "sheet_cells": ${JSON.stringify(json.sheet_cells)},\n  "anims": {\n${anims}\n  }\n}\n`;
}

/**
 * data/art_spec.json with each character's cell width and pivot x recomputed from the hitboxes
 * (cell height and pivot y are kept). `current` is the file's parsed contents.
 */
export function computeArtSpecJson(current: { characters: Record<string, { cell: number[]; pivot: number[] }> }): unknown {
  const chars = loadAllCharacters().defs;
  const sets = loadAllMoves().sets;
  const out = JSON.parse(JSON.stringify(current)) as typeof current;
  for (const [id, c] of Object.entries(out.characters)) {
    const def = chars.get(id);
    if (!def) throw new Error(`data/art_spec.json: no character "${id}"`);
    const { cell, pivot } = computeCell(sets.get(def.moveset)!, c.cell[1]!, c.pivot[1]!);
    c.cell = cell;
    c.pivot = pivot;
  }
  return out;
}
