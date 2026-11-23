/**
 * One-off migration: base resolution 480x270 → 640x360. Every distance measured in pixels is
 * multiplied by 4/3; frame counts (startup, active, recovery, advantage, durations, hitstop,
 * stun) are not touched.
 *
 * Rounding: positions and sizes (boxes, ranges, widths, gaps, pushback) to the nearest whole
 * pixel; speeds and accelerations (px per frame, px per frame²) to the nearest subpixel (0.01 px).
 *
 * Data files are migrated here. Pixel constants in code (AI ranges, view layout, test bots) were
 * converted by hand in the same commit; see CLAUDE.md. Refuses to run twice: it records
 * "base_resolution" in data/system.json.
 *
 *   npx tsx tools/migrate_640.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const K = 4 / 3;
const px = (v: number) => Math.round(v * K);
const speed = (v: number) => Math.round(v * K * 100) / 100;
const ROOT = process.cwd();

type Json = Record<string, unknown>;
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as Json;
const write = (p: string, j: unknown) => writeFileSync(join(ROOT, p), JSON.stringify(j, null, 2) + '\n');
const changed: string[] = [];
const note = (file: string, what: string, a: unknown, b: unknown) => changed.push(`${file}: ${what} ${JSON.stringify(a)} → ${JSON.stringify(b)}`);

const system = read('data/system.json');
if (system.base_resolution) {
  console.error(`Already migrated (data/system.json base_resolution = ${JSON.stringify(system.base_resolution)}).`);
  process.exit(1);
}

// ---------------------------------------------------------------- moves
for (const ch of readdirSync(join(ROOT, 'data/moves'))) {
  for (const f of readdirSync(join(ROOT, 'data/moves', ch)).filter((f) => f.endsWith('.json'))) {
    const p = `data/moves/${ch}/${f}`;
    const m = read(p);
    const box = (b: Json) => {
      for (const k of ['x', 'y', 'w', 'h']) b[k] = px(b[k] as number);
    };
    (m.hitboxes as Json[]).forEach(box);
    ((m.hurtbox_overrides as Json[]) ?? []).forEach(box);
    for (const s of (m.movement as Json[]) ?? []) s.dx = speed(s.dx as number);
    if (typeof m.range === 'number') {
      note(p, 'range', m.range, px(m.range));
      m.range = px(m.range);
    }
    write(p, m);
  }
}

// ---------------------------------------------------------------- characters
for (const f of readdirSync(join(ROOT, 'data/characters')).filter((f) => f.endsWith('.json'))) {
  const p = `data/characters/${f}`;
  const c = read(p);
  const hb = c.hurtbox as Json;
  const before = { ...hb };
  for (const k of ['width', 'height', 'crouch_height']) hb[k] = px(hb[k] as number);
  note(p, 'hurtbox', before, hb);
  c.walk_forward = speed(c.walk_forward as number);
  c.walk_back = speed(c.walk_back as number);
  for (const k of ['dash', 'backdash']) (c[k] as Json).speed = speed((c[k] as Json).speed as number);
  if (c.boss) (c.boss as Json).transition_pushback = px((c.boss as Json).transition_pushback as number);
  write(p, c);
}

// ---------------------------------------------------------------- arenas
for (const f of readdirSync(join(ROOT, 'data/arenas')).filter((f) => f.endsWith('.json'))) {
  const p = `data/arenas/${f}`;
  const a = read(p);
  const before = [a.width, a.start_gap, a.breakable_left_wall];
  for (const k of ['width', 'start_gap', 'breakable_left_wall']) a[k] = px(a[k] as number);
  for (const l of (a.layers as Json[]) ?? []) l.y = px(l.y as number);
  note(p, 'width, start_gap, breakable_left_wall', before, [a.width, a.start_gap, a.breakable_left_wall]);
  write(p, a);
}

// ---------------------------------------------------------------- system
const s = system as Record<string, Json & number>;
s.body.knockdown_height = px(s.body.knockdown_height as number);
s.phase_step.drift = speed(s.phase_step.drift as number);
s.pushback = px(s.pushback) as never;
s.throw.break_separation = px(s.throw.break_separation as number);
for (const k of ['vy', 'vx', 'gravity']) s.launch[k] = speed(s.launch[k] as number);
for (const k of ['vy', 'vx', 'gravity_step']) s.juggle[k] = speed(s.juggle[k] as number);
system.base_resolution = [640, 360];
write('data/system.json', system);

// ---------------------------------------------------------------- art spec (heights and pivot y;
// widths and pivot x are recomputed by `npm run art-spec` from the new hitboxes)
const art = read('data/art_spec.json');
for (const c of Object.values(art.characters as Record<string, Json>)) {
  const cell = c.cell as number[];
  const pivot = c.pivot as number[];
  c.cell = [cell[0], px(cell[1]!)];
  c.pivot = [pivot[0], px(pivot[1]!)];
}
write('data/art_spec.json', art);

console.log(changed.join('\n'));
console.log('migrated data to 640x360');
