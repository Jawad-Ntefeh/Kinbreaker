# Kinbreaker — project guide for Claude Code

Kinbreaker is a single-player 2D action RPG for PC: Dark Souls exploration and progression combined with Tekken-style, frame-based duels. The player is Rook, last heir of House Vael, fighting a cursed tournament of her undead ancestors and taking back her body one relic limb at a time.

It is built as a browser game (TypeScript + HTML canvas) and will later be wrapped as a desktop app for a PC release.

Read this file at the start of every session. If a task conflicts with a rule here, stop and ask before deviating.

## Design pillars (decide trade-offs with these)

1. Every fight is a duel: every enemy has a real move list with frame data.
2. Your moveset is your loot: each of the 4 attack buttons is a limb; relics replace limbs and their moves.
3. Power has a price: relics raise Kinship (the curse meter).
4. Learn, don't grind: frame data, readability and fairness come first.

## Tech stack

- TypeScript (strict mode), Vite, plain Canvas 2D. No game framework (no Phaser, no Pixi) unless asked: the combat sim is custom and rendering is simple pixel art.
- Tests: Vitest (`npm test`).
- Base resolution 640x360 (since Prompt 04B; characters are about 108 px tall), drawn to an offscreen canvas and scaled by the largest whole number that fits the window (x3 at 1920x1080), with `imageSmoothingEnabled = false` and CSS `image-rendering: pixelated`. Letterbox the rest in black.
- Deployment: GitHub Pages via a GitHub Actions workflow on every push to `main`, so the latest build is always playable in a browser.
- Future desktop release: keep the game fully static (no server, all assets local, no network calls), so it can be wrapped with Tauri or Electron later without changes.

## Input: keyboard first, controller supported

Keyboard is the primary input; every feature must be fully playable on keyboard, and on-screen prompts show keyboard keys by default. Controllers are fully supported through the Gamepad API (standard mapping), and prompts switch to controller buttons when a controller was the last device used.

- Read keys with `KeyboardEvent.code` (physical key position), never `KeyboardEvent.key`, so the game works the same on any keyboard layout, including Arabic and AZERTY.
- Call `preventDefault()` on game keys so Space and the arrow keys don't scroll the page.
- **SOCD cleaning** (opposite directions held together on a keyboard): left + right = neutral; up + down = neutral.
- Key bindings live in one config object (`src/input/bindings.ts`) so a rebinding menu can be added later. No key codes hard-coded anywhere else.
- Input is sampled once per sim frame into a snapshot; the sim never reads the keyboard or gamepad directly.

## Architecture rules (non-negotiable)

1. **The combat sim is pure logic.** It lives in `src/combat/`, imports nothing from the DOM, canvas or input code, and owns all combat state: positions, velocities, fighter states, frame counters, health, poise, stamina, hitboxes, hurtboxes. It must run in Node for tests.
2. **Fixed 60 Hz simulation.** The game loop uses `requestAnimationFrame` with an accumulator and advances the sim in fixed 1/60 s steps (correct on 60, 120 and 144 Hz screens). If more than 3 steps are pending (e.g. the tab was in the background), drop the backlog instead of fast-forwarding.
3. **Deterministic.** Same inputs → same result, every time.
   - Integer math only in the sim. Positions and velocities are integers in **subpixels: 1 px = 100 units**. Use `Math.trunc` or `| 0` after any division; never store floats in sim state.
   - Never use `Math.random()`, `Date.now()`, `performance.now()` or frame delta in the sim. If randomness is needed, use a seeded RNG owned by the sim.
   - Iterate arrays in a fixed order when order affects outcomes.
   - `CombatSim.stateHash(): number` hashes the full sim state; tests use it to check determinism.
4. **Views never change game state.** Renderers, HUD and debug overlay only read the sim.
5. **AI uses the same input path as the player.** AI produces input snapshots fed into an `InputBuffer`; it never sets fighter state directly.
6. **Moves are data.** Every move is a JSON file in `data/moves/<character>/`, loaded with `import.meta.glob`. No frame numbers hard-coded in code.

## Resolution migration (480x270 → 640x360)

All pixel distances were multiplied by 4/3 by `tools/migrate_640.ts` (data files; it refuses to run twice) and by hand for code constants (AI ranges in `src/ai/corvane_ai.ts`, view layout, effect sizes, background placeholders, test bots and test positions). Frame data did not change. Rook's hurtbox is 32x107 (crouch 67), Corvane's 43x117 (crouch 73); the Colosseum is 1600 px wide (1920 after the 320 px wall break).

## Coordinates and conventions

- Sim space: x increases to the right, y is height above the ground (up is positive). The renderer converts to canvas space.
- Facing: `1` = facing right, `-1` = facing left. Hitbox `x` values in move data are written for a fighter facing right and mirrored by facing.
- Directions use **numpad notation relative to facing**: 6 = forward, 4 = back, 2 = down, 8 = up, 3 = down-forward, 1 = down-back, 5 = neutral.
- Buttons: `1` left punch, `2` right punch, `3` left kick, `4` right kick, plus `phase` (phase step).
- Frame counting: frame 1 is the first frame of a move. `startup` = the number of the first active frame (a 10f jab hits on frame 10).
- Frame advantage: `on_block` and `on_hit` are authored in the data; the sim derives blockstun/hitstun from them so the authored advantage is exactly what happens when the hit lands on the first active frame.

## Move data schema (`data/moves/<character>/<move_id>.json`)

```json
{
  "id": "rook_jab",
  "name": "Jab",
  "limb": "left_arm",
  "input": "1",
  "startup": 10,
  "active": 2,
  "recovery": 13,
  "damage": 7,
  "poise_damage": 4,
  "height": "high",
  "path": "linear",
  "on_block": 1,
  "on_hit": 8,
  "on_counter_hit": 8,
  "properties": [],
  "hitboxes": [{ "frames": [10, 11], "x": 18, "y": 52, "w": 26, "h": 10 }],
  "hurtbox_overrides": [],
  "movement": [],
  "cancel_into": ["rook_jab_2"],
  "cancel_window": [12, 20],
  "cancel_on": ["hit", "block"]
}
```

- `limb`: `left_arm` | `right_arm` | `left_leg` | `right_leg` | `core` | `none`. A move whose limb is missing cannot be performed.
- `input` grammar: an optional direction or motion in numpad digits, then `:`, then the buttons joined by `+`. Examples: `"1"` (button 1), `"3:4"` (hold down-forward, press 4), `"2:4"` (hold down, press 4), `"236:2"` (motion down, down-forward, forward, then 2), `"1+3"` (buttons 1 and 3 together).
- `height`: `high` | `mid` | `low` | `throw`.
- `path`: `linear` | `sweeping`.
- `properties`: any of `launcher`, `knockdown`, `wall_splat`, `armor`, `counter_hit_launch`, `ground_hit`.
- Hitbox/hurtbox units are **pixels** in the data (converted to subpixels on load); `x` is distance in front of the fighter's origin, `y` is height above the ground of the box's bottom edge.
- `movement`: optional list of `{ "frame": n, "dx": px_per_frame }` steps for advancing or retreating moves.
- Throws additionally have `"break": "1"` or `"break": "2"` and `"range": px` (measured from the thrower's origin to the target's front edge), and `"on_block": null`.
- `on_hit` / `on_counter_hit` are a number, or `"knockdown"` / `"launch"` for moves that don't leave the opponent standing. `on_counter_hit` defaults to `on_hit`.
- `cancel_only: true` marks a move that can only be reached as a cancel (e.g. the second hit of a string), never from neutral.
- `glint: true` marks a big telegraphed attack: the fighter shows a glint from frame `startup - 14` to `startup - 6`, white for `linear`, red for `sweeping` (`fighter.glint` in the sim; the view draws it).
- `armor_frames: [first, last]`: hits landing in those frames deal damage and poise damage but cause no hitstun, no hitstop for the armored fighter and don't interrupt the move. Throws, launchers and poise breaks still beat armor.
- `whiff_recovery`: extra recovery frames added when the move hits nothing.
- `continue_on` (e.g. `["hit", "block"]`): marks a linked part of a multi-hit move. The previous part lists it in `cancel_into`; it starts automatically (no input) on the first frame of the previous part's `cancel_window`, only if the previous part connected in one of the listed ways.
- Hitboxes may have a `"group"` (default 0); a move hits the same target at most once per group.
- System-wide combat values (hitstop, knockdown/stagger lengths, juggle physics, damage scaling) live in `data/system.json`, not in code.

## Character files (`data/characters/<id>.json`)

Health, poise, walk speeds (px/frame), dash and backdash (`frames`, `speed`), hurtbox (`width`, `height`, `crouch_height` in px), limbs, and the `moveset` folder in `data/moves/` the character uses (the training dummy uses `rook`). Bosses add a `boss` section: `phase2_health_percent`, `transition_frames`, `wall_break_frame`, `transition_pushback` (px), `phase2_moves` and `once_per_fight`. Validated on load like move files.

The move loader validates every file (a TypeScript type plus runtime checks) and reports clear errors: file, field, problem. Invalid data fails the tests.

## Folder structure

```
index.html
package.json, tsconfig.json, vite.config.ts
CLAUDE.md
.github/workflows/deploy.yml
data/moves/<character>/*.json
data/system.json      # system-wide combat constants
data/characters/*.json
data/arenas/*.json
data/anims/*.json     # animation files (one per character with real art)
data/art_spec.json    # sheet layout per character
docs/ART_SPEC.md      # generated: npm run art-spec
src/main.ts           # boot, game loop
src/combat/           # CombatSim, fighters, InputBuffer, move data, hit resolution (pure logic, no DOM)
src/ai/               # AI controllers (produce input snapshots)
src/scenes/           # title menu, training, boss fights (flow and UI; never change sim rules)
src/fights.ts         # factories for each fight (shared by scenes and tests)
src/input/            # keyboard + gamepad → input snapshot; bindings
src/view/             # canvas renderer, camera, HUD, debug overlay
tests/                # Vitest tests
art_src/              # palette, approved references, raw image-model batches + manifests and reviews
tools/art/            # the converter and checks (npm run art); legacy/ = retired Part A rig
docs/art_requests/    # image prompts per batch (npm run art-requests)
public/art/           # generated sprite sheets (npm run art) and art
```

## Art pipeline (sprites, animation, effects)

- **Character art comes from an image model, converted by code** (since Prompt 04B; the Part A code rig is retired to `tools/art/legacy/`). The user generates pose sheets from an approved reference (`art_src/<char>/reference/`) using the prompts in `docs/art_requests/`, and adds them to `art_src/<char>/raw/<batch>/` with a `manifest.json`. `npm run art` (`tools/art/`) converts them: background removal (alpha, or flood-fill through near-white from the edges so inner whites survive; floor shadows removed), figure splitting, one scale per sheet from the anchor pose (pose 1, the reference stance) so it is 108 px tall, area-average downscale, CIELAB palette snap (no dithering, < 50% opacity → transparent), cleanup, 1 px outline. Pivot: the centre between the feet when both are on the floor, otherwise the supporting foot (manifest `pivot_x` overrides). Durations and impact frames come from the move data and the art spec, never the images.
- The converted reference is the **canonical character** (`art_src/<char>/canonical.json`): the scale anchor and the colour reference. Every converted frame is checked against it (`tools/art/consistency.ts`: colour proportions, anchor size within 3 px) plus a visual review recorded in `raw/<batch>/review.json`; reports go to `docs/art_review/<char>_<batch>.md`. Only animations whose frames have all arrived and none failed review are put in the game. Never edit generated PNGs by hand.
- Palette: `art_src/palette.json` (ramps dark → light; `wraps_warm`, `trousers` and `bronze` were added for Rook's reference; bronze is her tarnished-gold trim and counts as gold in the consistency checks). Rook: oxblood coat (her main colour, a deep muted red-brown, not the glint red) with tarnished-gold accents. `#ff3a2e` is reserved for sweeping glints and never appears on a character.
- When a character has an animation file but not every animation yet, the missing ones use the generated placeholder poses (never a fallback to idle).
- Sprite sheets: `public/art/characters/<id>.png`, a grid of equal cells (cell 0 = top left). Animation files: `data/anims/<id>.json` (`sheet`, `cell`, `pivot`, optional `sheet_cells`, `anims`). Sheet layouts per character (cell size, pivot, columns, colour) live in `data/art_spec.json`; the dummy shares Rook's sheet (shifted to greys).
- **Cell size comes from the data:** 53 px behind the pivot; in front of it, the character's furthest hitbox reach + 11 px; width rounded up to a multiple of 8; height fixed per character. `npm run art-spec` computes it into `data/art_spec.json` (currently Rook 136x128, pivot 53,123; Corvane 144x139, pivot 53,133). The animation validator fails if any hitbox of a move reaches outside its cell, so after changing hitboxes, rerun `npm run art-spec`.
- **Poses per move:** 3 to 7 held key poses. Moves with damage ≥ 20 or the `launcher` property get one extra "smear" frame immediately before the impact frame (taken from the wind-up, so the impact frame never moves).
- **Required state animations** include `intro`, `stagger`, `guard_break` and `throw_break`; `victory` is optional (see `STATE_SPECS` in `src/view/anim_layout.ts`).
- `dur` is in sim frames. A move animation (`"move": "<id>"`) has exactly one `"impact": true` frame that starts on the move's first active frame, and its durations add up to the move's total; the loader rejects anything else. Its playhead is the sim's move frame (never a separate timer), so it freezes during hitstop and can't drift.
- Animation choice is a pure function (`src/view/anim_select.ts`): current move id → state animation → fallback chain → idle. Without an animation file the game generates posed placeholder silhouettes (`src/view/placeholder.ts`).
- The game only requests art files that exist (`virtual:art-manifest`, generated from `public/art/`), so missing art never causes 404s.
- Arena background layers (`layers`: image, parallax 0–1, y, repeat) and the left wall's intact/broken images are listed in `data/arenas/<id>.json`; missing images get generated placeholders.
- The sim emits an event list every frame (hit, block, counter_hit, whiff, launch, wall_splat, knockdown, land, ground_hit, throw_break, armor_absorb, glint, phase_step, dash, wall_break, ko, …) with position, attacker, defender, move id and height. Effects, hit flash and screen shake are built from these events only (`src/view/effects.ts`), use their own unseeded randomness, and never touch the sim.
- `docs/ART_SPEC.md` and `docs/examples/rook.anims.json` are generated from the data: run `npm run art-spec` after changing moves, characters or `data/art_spec.json` (a test fails if they are stale). `npm run dev` then `/sprites.html` previews every sheet with cell numbers.
- Dev URL parameters for the boss fight: `?seed=N`, `?boss_hp=N`.

## Bosses and AI

- Boss phases, arena changes (breaking walls) and once-per-fight moves live in the sim, driven by the character's `boss` section and the arena file (`data/arenas/<id>.json`: `width`, `start_gap`, `breakable_left_wall`).
- Boss AI only uses what a player could see: positions immediately, the player's state and move after a reaction delay. Every random choice uses the sim's seeded RNG (`sim.rng`), so a fight is reproducible from its seed and the player's inputs.
- `npm run stats` plays scripted fights (a "perfect" bot and a button-masher) and prints win rates, fight length and move usage.

## Testing

- Vitest, one file per area (`input_buffer.test.ts`, `frame_advantage.test.ts`, …). `npm test` runs them all once.
- Run the tests after every change to `src/combat/` or `data/moves/`. Never leave tests failing at the end of a task.
- Combat bugs get a regression test before the fix.
- `npm run build` must also pass (type-check + build) before a task is finished.

## Workflow

- Work in small steps; after each, run the tests and the build.
- Use git: commit after each completed step with a clear message, and push so the GitHub Pages build updates.
- At the end of a task, report: what was built, the link to play it, the controls, test results, and anything you were unsure about.

## Game facts to keep consistent

- Rook starts missing her **right arm**: button `2` does nothing until the Iron Wrist relic is equipped.
- Attack glints: white = linear, red = sweeping. Red is never used as a character accent colour; Rook's accent is tarnished gold. Corvane is iron grey (skin and wrist bands) with rust-brown leather as his secondary colour.
- Phase step passes through `linear` attacks only; `sweeping` attacks hit it.
- Stamina is spent only by phase steps and blocking; attacks are free. Empty stamina while blocking = guard break.
- Move priority when several moves match: more buttons first, then a motion input, then a held direction, then a plain button (forward + U + J = throw).
- Wall splat lasts 50 frames; the fighter slides from the height they hit the wall down to the floor, reaching it on the last frame, and can be hit at any height meanwhile.
- Ground hits: `low` moves and moves with `ground_hit` can hit a fighter in `knockdown` for 50% damage (after combo scaling), once per knockdown, without resetting or extending the knockdown. `wake_up` is invulnerable.
- One difficulty, no settings that change combat. All dialogue is text only.
