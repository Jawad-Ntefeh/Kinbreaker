/**
 * `npm run art`: converts the image-model art in art_src/ into game sprites.
 *
 *   art_src/<char>/reference/<char>_reference.png   approved reference → the canonical sprite
 *   art_src/<char>/raw/<batch>/manifest.json         pose sheets of that batch (+ the images)
 *   art_src/<char>/raw/<batch>/review.json           the reviewer's visual verdicts per pose
 *
 * Writes public/art/characters/<char>.png + data/anims/<char>.json (only animations whose frames
 * have all arrived and none failed review), art_src/<char>/canonical.json, and review images and
 * reports in docs/art_review/. Frame durations and impact frames come from the move data and the
 * art spec, never from the images, so animations pass the validator by construction.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadMoveFiles, type Move } from '../../src/combat/move_data';
import { validateAnimFile } from '../../src/view/anim_data';
import { movePoses, STATE_SPECS } from '../../src/view/anim_layout';
import { anchorChecks, colourDrift, colourShares, currentVerdict, imageId, poseVerdict, TRACKED, type Canonical, type Verdict } from './consistency';
import type { Indexed } from './convert';
import { Canvas, label, writeGif, writePng } from './io';
import { convertReference, convertSheet, loadPalette, ROOT, toHex, type ConvertedPose, type ConvertedSheet, type SheetManifest } from './pipeline';

type Pt = [number, number];
const REVIEW = join(ROOT, 'docs/art_review');
const BG = '#1d1b24';
const FLOOR = '#4a4656';
const SCALE = 3;
const pal = loadPalette();
const problems: string[] = [];
const notes: string[] = [];

const artSpec = JSON.parse(readFileSync(join(ROOT, 'data/art_spec.json'), 'utf8')) as { characters: Record<string, { cell: Pt; pivot: Pt; columns: number }> };

function loadMoves(char: string): Map<string, Move> {
  const def = JSON.parse(readFileSync(join(ROOT, 'data/characters', `${char}.json`), 'utf8')) as { moveset: string };
  const dir = join(ROOT, 'data/moves', def.moveset);
  const files: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) files[`data/moves/${def.moveset}/${f}`] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return new Map(loadMoveFiles(files).sets.get(def.moveset) ?? []);
}

function canvasOf(s: Indexed): Canvas {
  const c = new Canvas(s.w, s.h);
  c.px = toHex(s, pal);
  return c;
}

/** A frame on the game background with the floor line. */
function preview(frame: Indexed, pivot: Pt): Canvas {
  const c = new Canvas(frame.w, frame.h, BG);
  for (let x = 0; x < frame.w; x++) c.set(x, pivot[1], FLOOR);
  c.blit(canvasOf(frame), 0, 0);
  return c;
}

function silhouette(frame: Indexed): Canvas {
  const c = new Canvas(frame.w, frame.h, '#c2b8a6');
  frame.px.forEach((k, i) => {
    if (k >= 0) c.px[i] = '#000000';
  });
  return c;
}

interface BuiltAnim {
  name: string;
  loop: boolean;
  move: Move | null;
  frames: { pose: ConvertedPose; dur: number; impact: boolean; phase: string }[];
}

function contactSheet(a: BuiltAnim, pivot: Pt): Canvas {
  const [w, h] = [a.frames[0]!.pose.frame.w, a.frames[0]!.pose.frame.h];
  const pad = 2;
  const c = new Canvas((w + pad) * a.frames.length + pad, (h + pad) * 2 + 10 + pad, '#111015');
  a.frames.forEach((f, i) => {
    const x = pad + i * (w + pad);
    const p = preview(f.pose.frame, pivot);
    if (f.impact && a.move?.hitboxes.length) {
      // The move's hitbox (yellow) on the impact frame.
      const hb = a.move.hitboxes[0]!;
      const x0 = pivot[0] + Math.round(hb.x / 100);
      const x1 = pivot[0] + Math.round((hb.x + hb.w) / 100) - 1;
      const y0 = pivot[1] - Math.round((hb.y + hb.h) / 100);
      const y1 = pivot[1] - Math.round(hb.y / 100) - 1;
      for (let xx = x0; xx <= x1; xx++) for (const yy of [y0, y1]) if (f.pose.frame.px[yy * w + xx]! < 0) p.set(xx, yy, '#ffd23b');
      for (let yy = y0; yy <= y1; yy++) for (const xx of [x0, x1]) if (f.pose.frame.px[yy * w + xx]! < 0) p.set(xx, yy, '#ffd23b');
    }
    c.blit(p, x, pad);
    c.blit(silhouette(f.pose.frame), x, pad + h + pad);
    label(c, `${i + 1} ${f.phase} ${f.dur}f${f.impact ? ' *' : ''}`, x + 1, pad + 2 * (h + pad) + 2, f.impact ? '#d9bf6a' : '#9a8f80');
  });
  return c;
}

function readManifest(dir: string): SheetManifest[] {
  const raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as SheetManifest | { sheets: SheetManifest[] };
  return 'sheets' in raw ? raw.sheets : [raw];
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function buildCharacter(char: string): void {
  // The character's own colours only (design.json "ramps").
  const pal = loadPalette(char);
  const refDir = join(ROOT, 'art_src', char, 'reference');
  const refFile = existsSync(refDir) ? readdirSync(refDir).find((f) => f.endsWith('.png')) : undefined;
  if (!refFile) return;
  const spec = artSpec.characters[char];
  if (!spec) {
    problems.push(`${char}: no entry in data/art_spec.json`);
    return;
  }
  const { cell, pivot, columns } = spec;

  // Canonical: the approved reference, converted. The scale anchor and colour reference.
  const canon = convertReference(join(refDir, refFile), pal, cell, pivot);
  const canonical: Canonical = { height: canon.height, width: canon.width, shares: colourShares(canon.sprite, pal) };
  writeFileSync(join(ROOT, 'art_src', char, 'canonical.json'), JSON.stringify({ ...canonical, meanError: +canon.meanError.toFixed(2), p95Error: +canon.p95Error.toFixed(2), note: 'Generated by npm run art from the approved reference.' }, null, 2) + '\n');
  const canonCanvas = new Canvas(cell[0] * 2 + 6, cell[1], '#111015');
  canonCanvas.blit(preview(canon.frame, pivot), 0, 0);
  canonCanvas.blit(silhouette(canon.frame), cell[0] + 6, 0);
  writePng(join(REVIEW, `${char}_canonical_1x.png`), canonCanvas);
  writePng(join(REVIEW, `${char}_canonical_${SCALE}x.png`), canonCanvas.scaled(SCALE));
  notes.push(`${char}: canonical ${canon.width}x${canon.height} px, colour error mean ${canon.meanError.toFixed(1)} / p95 ${canon.p95Error.toFixed(1)} dE; ${TRACKED.map((c) => `${c} ${pct(canonical.shares[c] ?? 0)}`).join(', ')}`);
  if (canon.outside) problems.push(`${char} canonical: ${canon.outside} pixels outside the cell`);

  // Batches.
  const rawDir = join(ROOT, 'art_src', char, 'raw');
  const byAnim = new Map<string, Map<number, ConvertedPose>>();
  const blocked = new Map<string, string>();
  for (const batch of existsSync(rawDir) ? readdirSync(rawDir).filter((d) => existsSync(join(rawDir, d, 'manifest.json'))).sort() : []) {
    const dir = join(rawDir, batch);
    const reviews: Record<string, Verdict> = existsSync(join(dir, 'review.json')) ? JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8')) : {};
    const sheets: ConvertedSheet[] = readManifest(dir).map((m) => convertSheet(dir, m, pal, cell, pivot));
    const lines: string[] = [`# ${char} ${batch}: conversion and consistency report`, '', '> Generated by `npm run art`. Visual verdicts come from `review.json` in the batch folder.', ''];
    lines.push(`Canonical ${char}: ${canonical.width}x${canonical.height} px; ${TRACKED.map((c) => `${c} ${pct(canonical.shares[c] ?? 0)}`).join(', ')}.`, '');
    for (const sh of sheets) {
      lines.push(`## ${sh.manifest.sheet}`, '');
      if (sh.waiting) {
        lines.push('Waiting for the image.', '');
        notes.push(`${char} ${batch}: waiting for ${sh.manifest.sheet}`);
        continue;
      }
      if (!sh.poses.length) {
        lines.push(...sh.errors.map((e) => `- **Not converted:** ${e}`), '');
        notes.push(`${char} ${batch}: ${sh.errors.join('; ')}`);
        continue;
      }
      const image = imageId(readFileSync(sh.file));
      let stale = false;
      let anchorFailed = '';
      lines.push(`Scale ${sh.scale.toFixed(4)} (anchor → ${108} px). Image \`${image}\` (\`${basename(sh.file)}\`).`, '', '| # | Pose | Size | Colour error (mean / p95 ΔE) | Colours | Checks | Visual | Verdict |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
      sh.poses.forEach((p, i) => {
        const key = `${sh.manifest.sheet}#${i + 1}`;
        const anchor = p.entry.role === 'anchor';
        const shares = colourShares(p.sprite, pal);
        const outside = p.outside ? [`${p.outside} px outside the cell`] : [];
        const a = anchor ? anchorChecks(p.width, p.height, shares, canonical) : { blocking: colourDrift(shares, canonical.shares, false), warnings: [] };
        const auto = [...a.blocking, ...outside];
        const v = currentVerdict(reviews[key], image);
        if (reviews[key] && !v) stale = true;
        // Anchors are scale references, not game frames: only their automatic checks count.
        const verdict = anchor ? (auto.length ? 'FAIL' : 'PASS') : poseVerdict(auto, v);
        if (anchor && auto.length) anchorFailed = auto.join('; ');
        const name = anchor ? 'anchor' : `${p.entry.anim} ${p.entry.index}`;
        const checks = [...auto, ...a.warnings.map((w) => `warning: ${w}`)].join('; ') || 'ok';
        lines.push(`| ${i + 1} | ${name} | ${p.width}x${p.height} | ${p.meanError.toFixed(1)} / ${p.p95Error.toFixed(1)} | ${TRACKED.map((c) => `${c} ${pct(shares[c] ?? 0)}`).join(', ')} | ${checks} | ${v ? (v.pass ? 'ok' : `**${v.note ?? 'fail'}**`) : '—'} | ${verdict} |`);
        if (!anchor && p.entry.anim !== undefined && p.entry.index !== undefined) {
          if (verdict === 'FAIL') blocked.set(p.entry.anim, 'a frame failed review');
          else if (verdict !== 'PASS' && !blocked.has(p.entry.anim)) blocked.set(p.entry.anim, 'frames still waiting for visual review');
          const m = byAnim.get(p.entry.anim) ?? new Map();
          m.set(p.entry.index, p);
          byAnim.set(p.entry.anim, m);
        }
      });
      lines.push('');
      if (anchorFailed) {
        lines.push(`**The anchor fails (${anchorFailed}): the whole sheet is at the wrong scale and none of its frames go into the game.**`, '');
        for (const p of sh.poses) if (p.entry.anim) blocked.set(p.entry.anim, `the anchor of ${sh.manifest.sheet} fails (${anchorFailed})`);
      }
      if (stale) {
        lines.push('The image changed since the last visual review: its frames are waiting for a new review.', '');
        notes.push(`${char} ${batch}: ${sh.manifest.sheet} changed since its review`);
      }
      problems.push(...sh.errors);
    }
    mkdirSync(REVIEW, { recursive: true });
    writeFileSync(join(REVIEW, `${char}_${batch}.md`), lines.join('\n') + '\n');
  }

  // Animations whose frames have all arrived and passed review.
  const moves = loadMoves(char);
  const anims: BuiltAnim[] = [];
  for (const [name, frames] of [...byAnim].sort()) {
    const move = moves.get(name) ?? null;
    const timing = move
      ? movePoses(move).map((p) => ({ dur: p.dur, impact: p.phase === 'impact', phase: p.phase }))
      : (() => {
          const st = STATE_SPECS.find((s) => s.name === name);
          return st ? Array.from({ length: st.poses }, () => ({ dur: st.dur, impact: false, phase: 'state' })) : null;
        })();
    if (!timing) {
      problems.push(`${char}: "${name}" is neither a move nor a state animation`);
      continue;
    }
    if (frames.size !== timing.length || [...frames.keys()].some((k) => k >= timing.length)) {
      notes.push(`${char} ${name}: ${frames.size}/${timing.length} frames so far, not built yet`);
      continue;
    }
    const st = STATE_SPECS.find((s) => s.name === name);
    const anim: BuiltAnim = { name, loop: !!st?.loop, move, frames: timing.map((t, i) => ({ ...t, pose: frames.get(i)! })) };
    // Review images for every complete animation, including ones still waiting for review.
    writeGif(join(REVIEW, `${char}_${name}_${SCALE}x.gif`), anim.frames.map((f) => ({ canvas: preview(f.pose.frame, pivot).scaled(SCALE), dur: f.dur })), BG);
    writePng(join(REVIEW, `${char}_${name}_sheet_${SCALE}x.png`), contactSheet(anim, pivot).scaled(SCALE));
    if (blocked.has(name)) {
      notes.push(`${char} ${name}: not built (${blocked.get(name)})`);
      continue;
    }
    anims.push(anim);
  }

  const sheetFile = join(ROOT, 'public/art/characters', `${char}.png`);
  const animFile = join(ROOT, 'data/anims', `${char}.json`);
  if (!anims.length) {
    // No finished art: the game keeps its placeholders.
    rmSync(sheetFile, { force: true });
    rmSync(animFile, { force: true });
    return;
  }
  const total = anims.reduce((n, a) => n + a.frames.length, 0);
  const rows = Math.ceil(total / columns);
  const sheet = new Canvas(cell[0] * columns, cell[1] * rows);
  const json: Record<string, unknown> = {};
  let n = 0;
  for (const a of anims) {
    json[a.name] = {
      ...(a.loop ? { loop: true } : {}),
      ...(a.move ? { move: a.move.id } : {}),
      frames: a.frames.map((f) => {
        sheet.blit(canvasOf(f.pose.frame), (n % columns) * cell[0], Math.floor(n / columns) * cell[1]);
        return f.impact ? { cell: n++, dur: f.dur, impact: true } : { cell: n++, dur: f.dur };
      }),
    };
  }
  writePng(sheetFile, sheet);
  mkdirSync(join(ROOT, 'data/anims'), { recursive: true });
  const text = `{\n  "_comment": "Generated by npm run art from art_src/${char}/raw/. Do not edit.",\n  "sheet": "art/characters/${char}.png",\n  "cell": ${JSON.stringify(cell)},\n  "pivot": ${JSON.stringify(pivot)},\n  "sheet_cells": ${JSON.stringify([columns, rows])},\n  "anims": {\n${Object.entries(json).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n  }\n}\n`;
  writeFileSync(animFile, text);
  problems.push(...validateAnimFile(`data/anims/${char}.json`, JSON.parse(text), moves, columns * rows).errors);
  notes.push(`${char}: ${anims.length} animations, ${total} frames → public/art/characters/${char}.png`);
}

for (const char of readdirSync(join(ROOT, 'art_src')).filter((d) => existsSync(join(ROOT, 'art_src', d, 'reference')))) buildCharacter(char);
for (const n of notes) console.log(n);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exit(1);
}
console.log('art OK');
