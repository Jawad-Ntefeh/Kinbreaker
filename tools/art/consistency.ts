/**
 * Consistency checks: image models drift between images, so every converted frame is compared
 * with the canonical character (the converted approved reference).
 *   - colour proportions (coat, gold, skin, hair, wraps, trousers) close to the reference,
 *     with a looser tolerance for action poses than for anchors;
 *   - size: every sheet's anchor within 3 px of the canonical height and width;
 *   - visual review: verdicts recorded by the reviewer in raw/<batch>/review.json.
 */
import type { Indexed } from './convert';
import type { Palette } from './pipeline';

/** Palette ramp → colour category tracked by the checks. */
export const CATEGORY: Record<string, string> = {
  coat: 'coat',
  gold: 'gold',
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

/** A reviewer's verdict for one pose (key: "<sheet>#<pose number, 1-based>"). */
export interface Verdict {
  pass: boolean;
  note?: string;
}
