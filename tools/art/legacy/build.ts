/**
 * LEGACY (Part A, retired): `npm run art:legacy` builds every character's sprite sheet and animation file from art_src/, runs
 * the checks (palette only, outlines, cells, hitbox alignment) and the game's animation
 * validator, and writes review images to docs/art_review/. Never edit the generated PNGs.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMoveFiles, type Move } from '../../../src/combat/move_data';
import { validateAnimFile } from '../../../src/view/anim_data';
import { buildAnim, hitboxCheck, loadAnimDefs, renderPose, secondaryAngles, type BuiltAnim } from './anim';
import { loadLegend, loadPalette, loadParts, loadPoses, loadSkeleton, ROOT, SRC, type Pose, type Pt } from './core';
import { Canvas, label, writeGif, writePng } from '../io';
import { checkFrame, finish, type Frame } from './post';
import { compose, type Rig } from './rig';

const pal = loadPalette();
/** Legacy output goes to an ignored folder so it can never replace the game's art. */
const OUT = join(ROOT, 'tools/art/legacy/out');
const REVIEW = join(OUT, 'review');
const BG = '#1d1b24';
const FLOOR = '#4a4656';
const errors: string[] = [];
const notes: string[] = [];

function loadMoves(moveset: string): Map<string, Move> {
  const dir = join(ROOT, 'data/moves', moveset);
  const files: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) files[`data/moves/${moveset}/${f}`] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const { sets, errors: e } = loadMoveFiles(files);
  if (e.length) throw new Error(e.map((x) => `${x.file}: ${x.field}: ${x.problem}`).join('\n'));
  return new Map(sets.get(moveset) ?? []);
}

function loadRig(char: string): Rig {
  return { name: char, pal, legend: loadLegend(char, pal), parts: loadParts(char), skeleton: loadSkeleton(char) };
}

const artSpec = JSON.parse(readFileSync(join(ROOT, 'data/art_spec.json'), 'utf8')) as { characters: Record<string, { cell: Pt; pivot: Pt; columns: number }> };
const characters = JSON.parse(JSON.stringify(Object.fromEntries(readdirSync(join(ROOT, 'data/characters')).map((f) => [f.replace('.json', ''), JSON.parse(readFileSync(join(ROOT, 'data/characters', f), 'utf8'))])))) as Record<string, { moveset: string; name: string }>;

/** A frame on a background with the floor line, for previews. */
function preview(f: Frame, pivot: Pt): Canvas {
  const c = new Canvas(f.w, f.h, BG);
  for (let x = 0; x < f.w; x++) c.set(x, pivot[1], FLOOR);
  c.blit(f, 0, 0);
  return c;
}

function silhouette(f: Frame): Canvas {
  const c = new Canvas(f.w, f.h, '#c2b8a6');
  for (let i = 0; i < f.px.length; i++) if (f.px[i]) c.px[i] = '#000000';
  return c;
}

function contactSheet(anim: BuiltAnim, pivot: Pt): Canvas {
  const [w, h] = [anim.frames[0]!.frame.w, anim.frames[0]!.frame.h];
  const pad = 2;
  const c = new Canvas((w + pad) * anim.frames.length + pad, (h + pad) * 2 + 10 + pad, '#111015');
  anim.frames.forEach((fr, i) => {
    const x = pad + i * (w + pad);
    const p = preview(fr.frame, pivot);
    // Hitbox on the impact frame (yellow), so the striking limb can be checked against it.
    if (fr.impact && anim.move && anim.move.hitboxes.length) {
      const hb = anim.move.hitboxes[0]!;
      const x0 = pivot[0] + Math.round(hb.x / 100);
      const x1 = pivot[0] + Math.round((hb.x + hb.w) / 100) - 1;
      const y0 = pivot[1] - Math.round((hb.y + hb.h) / 100);
      const y1 = pivot[1] - Math.round(hb.y / 100) - 1;
      for (let xx = x0; xx <= x1; xx++) { if (!fr.frame.px[y0 * w + xx]) p.set(xx, y0, '#ffd23b'); if (!fr.frame.px[y1 * w + xx]) p.set(xx, y1, '#ffd23b'); }
      for (let yy = y0; yy <= y1; yy++) { if (!fr.frame.px[yy * w + x0]) p.set(x0, yy, '#ffd23b'); if (!fr.frame.px[yy * w + x1]) p.set(x1, yy, '#ffd23b'); }
    }
    c.blit(p, x, pad);
    c.blit(silhouette(fr.frame), x, pad + h + pad);
    label(c, `${i + 1} ${fr.phase === 'state' ? '' : fr.phase} ${fr.dur}f${fr.impact ? ' *' : ''}`, x + 1, pad + 2 * (h + pad) + 2, fr.impact ? '#d9bf6a' : '#9a8f80');
  });
  return c;
}

/** Each part variant drawn by hand, lit and outlined, laid out in a row. */
function partsSheet(rig: Rig, cellH: number): Canvas {
  const items: { name: string; frame: Frame }[] = [];
  for (const [name, variants] of rig.parts) {
    for (const v of variants.filter((x) => x.drawn)) {
      const w = v.grid.w + 4;
      const h = v.grid.h + 4;
      const bone = { def: { name, part: name, z: 0, group: name }, index: 0, world: v.dir, origin: [0, 0] as Pt, part: v };
      const { layer } = compose(rig, new Map([[name, bone]]), w, h, [v.joint[0] + 2, v.joint[1] + 2]);
      items.push({ name: `${name}@${v.dir}`, frame: finish(layer, pal) });
    }
  }
  const gap = 6;
  let width = gap;
  for (const it of items) width += Math.max(it.frame.w, it.name.length * 4) + gap;
  const c = new Canvas(width, cellH, BG);
  let x = gap;
  for (const it of items) {
    c.blit(it.frame, x, 4);
    label(c, it.name, x, cellH - 8, '#9a8f80');
    x += Math.max(it.frame.w, it.name.length * 4) + gap;
  }
  return c;
}

function modelSheet(char: string, rig: Rig, pose: Pose, cell: Pt, pivot: Pt): void {
  const rest = secondaryAngles(rig, { poses: [pose], durs: [1], loop: true, speed: 0 }, 0);
  const stance = renderPose(rig, pose, cell, pivot, rest);
  for (const p of checkFrame(stance.frame, pal)) errors.push(`${char} stance: ${p}`);
  if (stance.outside) errors.push(`${char} stance: ${stance.outside} pixels outside the cell`);
  const parts = partsSheet(rig, cell[1]);
  const c = new Canvas(cell[0] * 2 + 12 + parts.w, cell[1] + 12, '#111015');
  c.blit(preview(stance.frame, pivot), 4, 4);
  c.blit(silhouette(stance.frame), cell[0] + 8, 4);
  c.blit(parts, cell[0] * 2 + 12, 4);
  label(c, `${char} stance`, 4, cell[1] + 6, '#9a8f80');
  label(c, 'silhouette', cell[0] + 8, cell[1] + 6, '#9a8f80');
  writePng(join(REVIEW, `${char}_model_1x.png`), c);
  writePng(join(REVIEW, `${char}_model_4x.png`), c.scaled(4));
}

function buildCharacter(char: string): void {
  if (!existsSync(join(SRC, char, 'skeleton.json'))) return;
  const rig = loadRig(char);
  const poses = loadPoses(char);
  const spec = artSpec.characters[char]!;
  const { cell, pivot, columns } = spec;
  const moves = loadMoves(characters[char]!.moveset);
  modelSheet(char, rig, poses.get('stance')!, cell, pivot);

  const defs = existsSync(join(SRC, char, 'anims.json')) ? loadAnimDefs(char) : {};
  if (!Object.keys(defs).length) {
    notes.push(`${char}: model sheet only (no animations yet)`);
    return;
  }
  const anims: BuiltAnim[] = [];
  for (const [name, def] of Object.entries(defs)) {
    const a = buildAnim(rig, name, def, poses, moves, cell, pivot);
    a.frames.forEach((f, i) => {
      for (const p of checkFrame(f.frame, pal)) errors.push(`${char} ${name} frame ${i + 1}: ${p}`);
      if (f.outside) errors.push(`${char} ${name} frame ${i + 1}: ${f.outside} pixels outside the ${cell[0]}x${cell[1]} cell`);
    });
    const hit = hitboxCheck(rig, a, pivot);
    if (hit) errors.push(`${char} ${hit}`);
    anims.push(a);
    // Review images: 4x GIF (real timing) and 4x contact sheet with silhouettes.
    writeGif(join(REVIEW, `${char}_${name}_4x.gif`), a.frames.map((f) => ({ canvas: preview(f.frame, pivot).scaled(4), dur: f.dur })), BG);
    writePng(join(REVIEW, `${char}_${name}_sheet_4x.png`), contactSheet(a, pivot).scaled(4));
  }

  // Pack the sheet: one cell per key pose, left to right, top to bottom.
  const total = anims.reduce((n, a) => n + a.frames.length, 0);
  const rows = Math.ceil(total / columns);
  const sheet = new Canvas(cell[0] * columns, cell[1] * rows);
  const json: { sheet: string; cell: Pt; pivot: Pt; sheet_cells: Pt; anims: Record<string, unknown> } = {
    sheet: `art/characters/${char}.png`,
    cell,
    pivot,
    sheet_cells: [columns, rows],
    anims: {},
  };
  let n = 0;
  for (const a of anims) {
    const frames = a.frames.map((f) => {
      sheet.blit(f.frame, (n % columns) * cell[0], Math.floor(n / columns) * cell[1]);
      return f.impact ? { cell: n++, dur: f.dur, impact: true } : { cell: n++, dur: f.dur };
    });
    json.anims[a.name] = { ...(a.loop ? { loop: true } : {}), ...(a.move ? { move: a.move.id } : {}), frames };
  }
  writePng(join(OUT, 'characters', `${char}.png`), sheet);
  mkdirSync(join(OUT, 'anims'), { recursive: true });
  const text = `{\n  "_comment": "Generated by npm run art from art_src/${char}/. Do not edit.",\n  "sheet": ${JSON.stringify(json.sheet)},\n  "cell": ${JSON.stringify(cell)},\n  "pivot": ${JSON.stringify(pivot)},\n  "sheet_cells": ${JSON.stringify(json.sheet_cells)},\n  "anims": {\n${Object.entries(json.anims).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n  }\n}\n`;
  writeFileSync(join(OUT, 'anims', `${char}.json`), text);
  // The game's own validator.
  const { errors: v } = validateAnimFile(`data/anims/${char}.json`, JSON.parse(text), moves, columns * rows);
  errors.push(...v);
  notes.push(`${char}: ${anims.length} animations, ${total} frames → tools/art/legacy/out/characters/${char}.png (${sheet.w}x${sheet.h})`);
}

for (const char of readdirSync(SRC).filter((d) => existsSync(join(SRC, d, 'skeleton.json')))) buildCharacter(char);
for (const n of notes) console.log(n);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('art OK');
