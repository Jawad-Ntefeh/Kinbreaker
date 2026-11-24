/**
 * Consistency checks: image models drift between images, so every converted frame is compared
 * with the canonical character (the converted approved reference).
 *   - colour proportions (coat, gold, skin, hair, wraps, trousers) close to the reference,
 *     with a looser tolerance for action poses than for anchors;
 *   - size: every sheet's anchor within 3 px of the canonical height and width;
 *   - visual review: verdicts recorded by the reviewer in raw/<batch>/review.json.
 */
import { createHash } from 'node:crypto';
import type { Indexed } from './convert';
import type { Palette } from './pipeline';

/** Palette ramp → colour category tracked by the checks. */
export const CATEGORY: Record<string, string> = {
  coat: 'coat',
  gold: 'gold',
  // The reference's gold trim is a warm bronze; both count as the gold accent.
  bronze: 'gold',
  skin: 'skin',
  wraps: 'wraps',
  wraps_warm: 'wraps',
  // Hair, trousers and boots are all warm near-blacks in the reference: one category.
  hair: 'darks',
  trousers: 'darks',
  silver: 'silver',
  leather: 'leather',
  iron: 'iron',
  spirit: 'spirit',
};
export const TRACKED = ['coat', 'gold', 'skin', 'darks', 'wraps'] as const;

export type Shares = Record<string, number>;

/** Share of each colour category among the body pixels (outline excluded). */
export function colourShares(s: Indexed, pal: Palette): Shares {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const k of s.px) {
    if (k < 0 || k === pal.outline) continue;
    const cat = CATEGORY[pal.entries[k]!.ramp] ?? 'other';
    counts[cat] = (counts[cat] ?? 0) + 1;
    total++;
  }
  const out: Shares = {};
  for (const c of [...TRACKED, 'other']) out[c] = total ? (counts[c] ?? 0) / total : 0;
  for (const [c, n] of Object.entries(counts)) if (!(c in out)) out[c] = n / total;
  return out;
}

export interface Canonical {
  height: number;
  width: number;
  shares: Shares;
}

/**
 * Colour drift: a category may move by an absolute amount or a relative amount, whichever is
 * larger; action poses get twice the tolerance (limbs move in and out of view).
 */
export function colourDrift(shares: Shares, ref: Shares, anchor: boolean): string[] {
  const k = anchor ? 1 : 2;
  const out: string[] = [];
  for (const c of TRACKED) {
    const a = shares[c] ?? 0;
    const b = ref[c] ?? 0;
    const tol = Math.max(0.04 * k, b * 0.35 * k);
    if (Math.abs(a - b) > tol) out.push(`${c} ${(a * 100).toFixed(0)}% (reference ${(b * 100).toFixed(0)}%)`);
  }
  if ((shares.other ?? 0) > 0.08 * k) out.push(`${((shares.other ?? 0) * 100).toFixed(0)}% colours that aren't part of the design`);
  return out;
}

export function sizeDrift(w: number, h: number, ref: Canonical, tolerance = 3): string[] {
  const out: string[] = [];
  if (Math.abs(h - ref.height) > tolerance) out.push(`anchor height ${h} px (canonical ${ref.height})`);
  if (Math.abs(w - ref.width) > tolerance) out.push(`anchor width ${w} px (canonical ${ref.width})`);
  return out;
}

/**
 * Anchor checks (pose 1 of a sheet sets the scale for the whole sheet): a height off by more than
 * 3 px is blocking (every frame of the sheet is at the wrong scale); width and colour drift are
 * warnings (a slightly different stance or lighting doesn't change the scale).
 */
export function anchorChecks(w: number, h: number, shares: Shares, ref: Canonical): { blocking: string[]; warnings: string[] } {
  const blocking = Math.abs(h - ref.height) > 3 ? [`anchor height ${h} px (canonical ${ref.height})`] : [];
  const warnings = [...(Math.abs(w - ref.width) > 3 ? [`anchor width ${w} px (canonical ${ref.width})`] : []), ...colourDrift(shares, ref.shares, true)];
  return { blocking, warnings };
}

/** A reviewer's verdict for one pose (key: "<sheet>#<pose number, 1-based>"). */
export interface Verdict {
  pass: boolean;
  note?: string;
  /** Fingerprint of the sheet image the verdict was given for (imageId); a replaced image needs a new review. */
  image?: string;
}

/** Short fingerprint of an image file's bytes. */
export function imageId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

/** The recorded verdict, if it was given for this exact image. */
export function currentVerdict(v: Verdict | undefined, image: string): Verdict | undefined {
  return v && v.image === image ? v : undefined;
}

/**
 * A pose's verdict: it passes only when the automatic checks found nothing AND a reviewer has
 * recorded a visual pass. No verdict yet = pending; pending or failed frames keep their
 * animation out of the game.
 */
export function poseVerdict(auto: readonly string[], v: Verdict | undefined): 'PASS' | 'FAIL' | 'pending review' {
  if (auto.length || v?.pass === false) return 'FAIL';
  return v ? 'PASS' : 'pending review';
}
