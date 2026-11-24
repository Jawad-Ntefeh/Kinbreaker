/**
 * `npm run art-requests`: writes the image prompts for each art batch (docs/art_requests/) and a
 * pre-filled manifest (art_src/<char>/raw/<batch>/manifest.json), from the art spec and move data.
 * Sheets hold at most 6 poses: the anchor (the reference stance) plus up to 5 frames.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMoveFiles, type Move } from '../../src/combat/move_data';
import { movePoses, STATE_SPECS } from '../../src/view/anim_layout';
import type { SheetManifest } from './pipeline';

const ROOT = process.cwd();
const MAX_POSES = 6;

interface Design {
  name: string;
  lock: string;
  body_height_px: number;
  front_arm: string;
  /** How to name each limb in prompts, in viewer terms ("the FAR arm"): models flip left/right. */
  arm_words?: Record<string, string>;
  /** Repeated at the end of every prompt (e.g. which side of the body has no arm). */
  near_side_rule?: string;
  /** The reference stance, as used for the anchor pose. */
  guard?: string;
}

const SHEET_RULES = (n: number) =>
  `Make ONE image: a single horizontal row of exactly ${n} full-body poses of this character, left to right. Side view, facing RIGHT, the same camera angle and the same pixel-art style as the reference. Every pose at exactly the same scale. All feet rest on one shared, straight ground line, apart from a pose described as airborne. Even spacing, with wide white gaps between the figures, so each figure, with its braid and coat tails, stands clearly apart. A plain, pure white background (#FFFFFF) filling the whole image: just the figures on flat white.`;

const ANCHOR = (d: Design) => `Pose 1 (scale anchor): exactly the stance from the reference image, unchanged: ${d.guard ?? 'side-on fighting stance, weight on the back foot, fist raised at chin height, chin down'}.`;

/**
 * Image models act on every noun they read: "no right arm" draws a right arm. Prompts describe
 * only what is visible; this rejects negative wording in any text sent to the model.
 */
const NEGATIVE = /\b(no|not|never|none|nothing|without|don't|doesn't|isn't|avoid|missing|instead of)\b/i;
export function negativeWords(text: string): string[] {
  return text.split(/(?<=[.;:])\s+/).filter((sentence) => NEGATIVE.test(sentence));
}

const TIPS = [
  'If it goes wrong:',
  '- A second arm or a fist appears on her near side: reply "Keep her one-armed and southpaw: the punch comes from her left arm on the far side of her body; her near shoulder shows the flat folded sleeve with the round gold pin, with the coat hanging smooth down that side." and regenerate.',
  '- Still wrong after two tries: attach your idle sheet (rook_idle_01.png, which came out right) as well as the reference, and ask it to edit pose 1 of that sheet into each pose instead of drawing new figures.',
].join('\n');

/** Body landmark for a height above the floor, for a character `h` px tall. */
function landmark(y: number, h: number): string {
  const r = y / h;
  if (r < 0.12) return 'ankle height';
  if (r < 0.3) return 'shin height';
  if (r < 0.48) return 'knee-to-thigh height';
  if (r < 0.58) return 'hip height';
  if (r < 0.7) return 'stomach height';
  if (r < 0.8) return 'chest height';
  if (r < 0.9) return 'shoulder-to-chin height';
  return 'head height';
}

const LIMB_WORDS: Record<string, { limb: string; end: string; joint: string }> = {
  left_arm: { limb: 'left arm', end: 'fist', joint: 'shoulder' },
  right_arm: { limb: 'right arm', end: 'fist', joint: 'shoulder' },
  left_leg: { limb: 'left (front) leg', end: 'foot', joint: 'hip' },
  right_leg: { limb: 'right (back) leg', end: 'foot', joint: 'hip' },
  core: { limb: 'whole body', end: 'hand', joint: 'shoulders' },
};

/** Fighting-game animator notes for each pose of a move, from its data. */
function movePoseNotes(m: Move, d: Design): string[] {
  const plan = movePoses(m);
  const base = LIMB_WORDS[m.limb] ?? LIMB_WORDS.core!;
  const L = { ...base, limb: d.arm_words?.[m.limb] ? 'far arm' : base.limb };
  const intro = d.arm_words?.[m.limb] ? ` (${d.arm_words[m.limb]})` : '';
  // Big strikes load up; quick linear strikes start from the guard without pulling back.
  const big = m.damage >= 20 || !!m.glint || m.path === 'sweeping';
  const h = d.body_height_px;
  const hb = m.hitboxes[0];
  const lo = hb ? Math.round(hb.y / 100) : 0;
  const hi = hb ? Math.round((hb.y + hb.h) / 100) : 0;
  const reach = hb ? Math.round((hb.x + hb.w) / 100) : Math.round(m.throwRange / 100);
  const where = m.height === 'throw' ? 'grabbing forward at chest height' : `${landmark((lo + hi) / 2, h)} (the hit lands ${lo}–${hi} px above the floor, ${Math.round((lo / h) * 100)}–${Math.round((hi / h) * 100)}% of her height)`;
  const extended = reach > h * 0.45 ? 'fully extended' : reach > h * 0.3 ? 'well extended' : 'extended';
  const arc = m.path === 'sweeping' ? 'in a wide horizontal arc (a sweeping strike)' : 'straight along a line (a linear strike)';
  const startups = plan.filter((p) => p.phase === 'startup').length;
  const recoveries = plan.filter((p) => p.phase === 'recovery').length;
  let s = 0;
  let r = 0;
  return plan.map((p) => {
    if (p.phase === 'startup') {
      s++;
      return s === 1 && startups > 1
        ? big
          ? `Wind-up: the ${L.limb}${intro} draws back to load the strike, ${L.end} close to the body; weight shifts onto the back foot; the guard stays tight. Coat tails and braid still settle from the stance.`
          : `Anticipation, small and quick: the stance with the knees bent a little more, body slightly lower; the ${L.limb}${intro} stays in the guard in front of the chin.`
        : `Wind-up, about to strike: the ${L.limb}${s === 1 ? intro : ''} starts moving toward the target ${arc}; shoulders and hips begin to turn into the blow; weight moving forward. The braid lags slightly behind the head.`;
    }
    if (p.phase === 'smear') return `Smear frame: the ${L.limb} whipping through mid-swing, stretched and slightly blurred along its path ${arc}; the body nearly at full extension. The coat tails flare behind her.`;
    if (p.phase === 'impact') {
      const body = m.limb.endsWith('leg') ? `standing on the other leg, the ${L.limb} ${extended} with the ${L.end} at ${where}` : `the ${L.limb} ${extended} ${m.height === 'throw' ? 'and the hand clutching' : 'straight forward'} at ${where}, the ${L.end} in line with the ${L.joint}`;
      const extra = [
        m.properties.includes('launcher') ? 'The strike drives upward, as if lifting the opponent off the ground.' : '',
        m.properties.includes('knockdown') ? 'The strike is meant to take the opponent off their feet.' : '',
        m.path === 'sweeping' ? 'The arc is wide and readable.' : '',
      ].filter(Boolean).join(' ');
      return `IMPACT (the hit): ${body}; weight on the front foot, back heel lifted; chin tucked behind the shoulder. The coat tails swing back behind her and the braid trails behind her head. ${extra}`.trim();
    }
    r++;
    return r < recoveries
      ? `Recovery: the ${L.limb} pulling back, halfway between the strike and the guard; weight returning to the middle. Coat tails and braid swinging back the other way.`
      : `Recovery, nearly back in stance: ${L.end} almost back in the guard position, weight settling onto the back foot. Coat tails and braid settling.`;
  });
}

const STATE_NOTES: Record<string, (i: number, n: number) => string> = {
  idle: (i) =>
    [
      'Idle 1: the reference stance, breathing out: shoulders relaxed, guard up.',
      'Idle 2: breathing in: chest and shoulders rise about 1 px, guard rises slightly; the braid sways a little backward.',
      'Idle 3: fully breathed in: shoulders at their highest, fist a pixel higher; coat tails sway slightly back.',
      'Idle 4: breathing out again, between poses 2 and 3 and the stance; braid and coat tails swinging back forward.',
    ][i] ?? 'Idle.',
  walk_forward: (i) =>
    [
      'Walk 1 (start of a forward shuffle step): the stance, weight shifting onto the back foot, front foot about to lift.',
      'Walk 2: the front foot lifts and slides forward a short step, toes low; guard stays up; coat tails swing back.',
      'Walk 3: the front foot plants further forward; feet at their widest; weight moving forward, body lowered slightly.',
      'Walk 4: the back foot lifts and slides forward toward the front foot; coat tails swing back the other way.',
      'Walk 5: the back foot plants; feet back to stance width; body rising.',
      'Walk 6: settling into the stance again, weight on the back foot, ready to repeat.',
    ][i] ?? 'Walk.',
};

function stateNotes(name: string, n: number): string[] {
  const f = STATE_NOTES[name];
  return Array.from({ length: n }, (_, i) => (f ? f(i, n) : `${name} ${i + 1}/${n}.`));
}

/** Hand-written pose notes per move (art_src/<char>/pose_notes.json) replace the generated ones. */
function loadPoseNotes(char: string): Record<string, string[]> {
  const f = join(ROOT, 'art_src', char, 'pose_notes.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, string[]>) : {};
}

function loadMoves(char: string): Map<string, Move> {
  const def = JSON.parse(readFileSync(join(ROOT, 'data/characters', `${char}.json`), 'utf8')) as { moveset: string };
  const dir = join(ROOT, 'data/moves', def.moveset);
  const files: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) files[`data/moves/${def.moveset}/${f}`] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  return new Map(loadMoveFiles(files).sets.get(def.moveset) ?? []);
}

for (const char of readdirSync(join(ROOT, 'art_src')).filter((d) => existsSync(join(ROOT, 'art_src', d, 'batches.json')))) {
  const design = JSON.parse(readFileSync(join(ROOT, 'art_src', char, 'design.json'), 'utf8')) as Design;
  const batches = JSON.parse(readFileSync(join(ROOT, 'art_src', char, 'batches.json'), 'utf8')) as Record<string, string[]>;
  const moves = loadMoves(char);
  const custom = loadPoseNotes(char);
  for (const [batch, anims] of Object.entries(batches)) {
    if (batch.startsWith('_')) continue;
    const sheets: { manifest: SheetManifest; notes: string[]; anim: string; part: number; parts: number }[] = [];
    for (const anim of anims) {
      const move = moves.get(anim);
      const generated = move ? movePoseNotes(move, design) : stateNotes(anim, STATE_SPECS.find((s) => s.name === anim)?.poses ?? 1);
      const notes = custom[anim] ?? generated;
      if (notes.length !== generated.length) throw new Error(`art_src/${char}/pose_notes.json: ${anim} has ${notes.length} notes, the animation has ${generated.length} poses`);
      const per = MAX_POSES - 1;
      const parts = Math.ceil(notes.length / per);
      for (let p = 0; p < parts; p++) {
        const chunk = notes.slice(p * per, (p + 1) * per);
        const sheet = `${char}_${anim.replace(`${char}_`, "")}_${String(p + 1).padStart(2, "0")}.png`;
        sheets.push({
          anim,
          part: p + 1,
          parts,
          notes: chunk,
          manifest: { sheet, poses: [{ role: 'anchor' }, ...chunk.map((_, i) => ({ anim, index: p * per + i }))] },
        });
      }
    }
    const lines: string[] = [
      `# ${design.name}: ${batch}`,
      '',
      `> Generated by \`npm run art-requests\` from the art spec and move data. For each sheet below: attach the approved reference image (\`art_src/${char}/reference/\`), paste the prompt, and save the result as the file name given, in \`art_src/${char}/raw/${batch}/\`. The manifest is already there.`,
      '',
      `Animations: ${anims.map((a) => `\`${a}\``).join(', ')}. ${sheets.length} sheets.`,
      '',
    ];
    for (const s of sheets) {
      const m = moves.get(s.anim);
      const n = s.manifest.poses.length;
      lines.push(`## \`${s.manifest.sheet}\`: ${s.anim}${s.parts > 1 ? ` (part ${s.part} of ${s.parts})` : ''}`, '');
      if (m) lines.push(`Frame data: startup ${m.startup}, active ${m.active}, recovery ${m.recovery} (${m.total} frames); ${m.height} / ${m.path}; limb: ${m.limb.replace('_', ' ')}.`, '');
      const prompt = [design.lock, SHEET_RULES(n), ANCHOR(design), ...s.notes, design.near_side_rule ?? ''].join(' ');
      const bad = negativeWords(prompt);
      if (bad.length) throw new Error(`${s.manifest.sheet}: negative wording in the prompt (image models draw what they read):\n  ${bad.join('\n  ')}`);
      lines.push('```text', design.lock, '', SHEET_RULES(n), '', ANCHOR(design), ...s.notes.map((t, i) => `Pose ${i + 2}: ${t}`), ...(design.near_side_rule ? ['', design.near_side_rule] : []), '```', '');
      if (m && design.arm_words?.[m.limb]) lines.push(TIPS, '');
    }
    lines.push('## Manifest (already saved)', '', '```json', JSON.stringify({ sheets: sheets.map((s) => s.manifest) }, null, 2), '```', '');
    mkdirSync(join(ROOT, 'docs/art_requests'), { recursive: true });
    writeFileSync(join(ROOT, 'docs/art_requests', `${char}_${batch}.md`), lines.join('\n'));
    const dir = join(ROOT, 'art_src', char, 'raw', batch);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ sheets: sheets.map((s) => s.manifest) }, null, 2) + '\n');
    console.log(`docs/art_requests/${char}_${batch}.md: ${sheets.length} sheets (${sheets.map((s) => s.manifest.sheet).join(', ')})`);
  }
}
