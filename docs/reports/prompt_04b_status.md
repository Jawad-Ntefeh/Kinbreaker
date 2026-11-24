# Kinbreaker: Prompt 04B status report (art pipeline, Rook Batch 01)

Play: https://jawad-ntefeh.github.io/Kinbreaker/ (Training: WASD move, U jab, P pause, O step one frame, ` debug overlay)
Review images: https://jawad-ntefeh.github.io/Kinbreaker/art_review/ (e.g. `rook_rook_jab_3x.gif`, `rook_walk_forward_sheet_3x.png`, `rook_halo_before_after.png`)
Tests: 253 passed, 1 skipped; `npm run build` passes. Branch `claude/confident-galileo-1mk1na` and `main` are in sync.

## Where Prompt 04B stands

| Step | Status |
| --- | --- |
| 0. Retire the Part A code rig to `tools/art/legacy/` | Done |
| 1. Resolution 480x270 → 640x360 (`tools/migrate_640.ts`, ×4/3, frame data unchanged) | Done; balance checked with `npm run stats` (200 fights before/after) |
| 2. Canonical Rook from the approved reference, palette check | Done; ramps added: `wraps_warm`, `trousers`, `bronze` (her tarnished-gold trim) |
| 3. Converter (`npm run art`) | Done, plus later fixes below |
| 4. Consistency checks + visual review | Done, gate tightened (below) |
| 5. Prompt generator (`npm run art-requests`) | Done, rewritten twice (below) |
| 6. Look test, Batch 01 = idle, walk_forward, rook_jab | **Approved by the user.** All three are in the game (training and the Corvane fight) |

## What happened in Batch 01 (lessons that shape the next batches)

1. **ChatGPT drew stances and movement well** (idle, walk). The first walk sheets drew the gold trim pale tan (same colour as skin), so the colour checks failed them; regenerated with explicit colour wording, they passed.
2. **ChatGPT could not draw the one-armed jab.** Facing right, Rook's only arm (left) is the far arm; the model kept drawing the punch from the near shoulder (where the missing right arm is). Things tried, all failed: naming the "far arm"; positive-only wording ("one-armed, southpaw", never "no right arm"); an "edit base" (the stance repeated 6 times, edited one figure at a time).
3. **Solution: composed sheets (`npm run art-compose`).** Code takes figure 1 of an approved model-drawn sheet (the idle stance), cuts her own arm pixels into two segments (sleeve; cuff + wrapped forearm + fist) and rotates them about shoulder and elbow per pose, far arm behind the body. Every pixel is still model-drawn; only the placement is code. Spec: `art_src/rook/compose/rook_jab_01.json` (polygons, pivots, angles per pose). The result is an ordinary raw sheet that goes through the same converter, checks and review. A test checks the committed sheet matches its spec. This is a recorded deviation from "art comes from an image model" (documented in CLAUDE.md).
4. **Pale halo removed.** Image-model edges are blended with the white background, giving a light rim. The converter now defringes (the 2 px rim takes colours from deeper inside), removes enclosed white gaps of 12+ px (fist–chin, braid–shoulder), and snaps only to the character's own ramps (`ramps` in `art_src/<char>/design.json`).

## Pipeline features added during Batch 01

- Review gate: a frame goes into the game only with clean automatic checks AND a recorded visual pass; each verdict carries the image's fingerprint, so a replaced image needs a new review (both with regression tests).
- Review GIFs/contact sheets are written for every complete animation, including ones pending review.
- Sheets may be PNG or JPEG.
- Prompts use positive wording only (`npm run art-requests` and a test reject "no / not / never / without / missing …"); hand-written pose notes per move in `art_src/<char>/pose_notes.json`.
- Edit bases for attacks (`docs/art_requests/bases/`) — available, but did not work for the jab.
- Art URLs carry a content hash (`?v=…`), so regenerated sheets are never served from browser/CDN cache.

## Open points / decisions for next steps

- **Jab trim colour:** the jab is composed from the first idle sheet (paler trim); walk has the corrected bronze. Option: recompose from a walk sheet's figure 1 (needs the arm polygons re-fitted).
- **Jab body:** only the arm moves (no lean or step).
- **Anchors don't block:** the anchor (pose 1) of the idle, walk and jab sheets fails a size or colour check (e.g. walk's stance is 8 px narrower than the reference); anchors only set the scale and are not game frames, so they are reported but don't block. Confirm or make them blocking.
- **Placeholders still show** for every animation not yet drawn, including `intro` (so the Corvane fight opens with the placeholder Rook).
- **Corvane** has no art yet.

## Remaining Rook work

Moves (data/moves/rook): `rook_jab_2` (cancel-only 2nd jab), `rook_low_jab` (2:1), `rook_palm` (6:1), `rook_throw` (1+3) — left-arm moves, likely composed; `rook_knee` (left leg), `rook_high_kick`, `rook_rising_kick` (launcher, gets a smear frame), `rook_sweep` (knockdown) — kicks, ChatGPT may manage them; `rook_cross` (right arm — needs the Iron Wrist relic design first).

States (`STATE_SPECS` in `src/view/anim_layout.ts`): walk_back, crouch, block_stand, block_crouch, dash_forward, backdash, phase_step, hitstun_high/mid/low, blockstun_stand/crouch, airborne, knockdown, wake_up, thrown, throw_break, wall_splat, stagger, guard_break, ko, intro, victory (optional).

Suggested loop per batch: ChatGPT draws stances, movement, kicks and reactions (prompts from `npm run art-requests`); arm attacks are composed (`npm run art-compose`); everything is converted, checked and reviewed with `npm run art`; approval gate per batch. Then Corvane with the same loop.

## Key files

`CLAUDE.md` (rules, updated) · `tools/art/` (convert, pipeline, consistency, build, prompts, bases, compose) · `art_src/rook/` (reference, canonical.json, design.json, batches.json, pose_notes.json, compose/, raw/batch_01/ with manifest.json + review.json) · `docs/art_requests/rook_batch_01.md` · `docs/art_review/rook_batch_01.md` (consistency report).
