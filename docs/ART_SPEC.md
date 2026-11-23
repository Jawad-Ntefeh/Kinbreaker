# Kinbreaker art specification

> Generated from the game data by `npm run art-spec`. Do not edit by hand: change the data and regenerate.

## How the art plugs in

- **Sheet:** `public/art/characters/<id>.png`, a grid of equal cells, no padding, read left to right, top to bottom (cell 0 = top left). A plain "Sprite sheet" export.
- **Animation file:** `data/anims/<id>.json` with `sheet`, `cell` [w, h], `pivot` [x, y], optional `sheet_cells` [columns, rows], and `anims`. A complete example for Rook (placeholder cell numbers, correct timing for every move) is in `docs/examples/rook.anims.json`.
- **Pivot:** the point in each cell that sits on the fighter's position: centre between the feet, on the floor line. Sprites are mirrored around it when facing left, so draw every pose facing **right**.
- **Timing:** `dur` is in sim frames (60 per second). Animations are held key poses, not one drawn frame per fixed interval.
- **Move animations** (`"move": "<id>"`) play on the move's own frame counter, so they can never drift from the frame data. The game checks, and refuses files that break, these rules:
  1. exactly one frame has `"impact": true`, and it **starts on the move's first active frame** (durations before it add up to `startup - 1`);
  2. all durations add up to the move's total (`startup + active - 1 + recovery`);
  3. the impact frame lasts at least as long as the active frames;
  4. every cell exists in the sheet.
- **Reach:** the impact pose should reach the hitbox (the "reach" column, in px in front of the pivot).
- **Cell size comes from the data:** 40 px behind the pivot, and in front of it the character's furthest hitbox reach + 8 px; the width is rounded up to a multiple of 8. The height is fixed per character. The game refuses an animation file whose cell doesn't contain every hitbox of its moves.
- **Poses:** 3 to 7 per move. Heavy moves (damage 20 or more, or launchers) get one extra **smear** frame immediately before the impact frame: the limb mid-swing, stretched or blurred, so the hit reads at speed. It is part of the wind-up, so it never moves the impact frame.
- **Missing animations** fall back (`hitstun_high` → `hitstun_mid` → `idle`; `blockstun_crouch` → `blockstun_stand` → `block_stand`; anything else → `idle`), so the game runs with a partial sheet. Characters without a sheet use generated placeholder silhouettes.
- **Check your work:** `npm run dev`, open `/sprites.html` to see each sheet with cell numbers, then the game with the debug overlay (`` ` ``): it shows cell bounds, the pivot and `anim  cell  frame  IMPACT`; **H** fades or hides the sprites to compare them with the hitboxes.

## Palette rules

- Rook's accent is **tarnished gold**. Corvane is **iron grey** (skin and wrist bands) with **rust-brown leather** as the secondary colour. The training dummy is Rook's sheet shifted to greys by the game (no separate art).
- **Red is reserved for sweeping-attack glints.** Never use red as a character colour; white glints mean linear attacks. Glints, sparks and other effects are drawn by the game, not on the sprites.
- The world is desaturated; the action is coloured. Whole pixels, no anti-aliasing, no smooth gradients; a dark outline around each silhouette.
- Hit flashes (white), phase-step afterimages (gold) and the dummy's grey are made from the sprite's silhouette by the game, so keep a clean transparent background.

## Rook (`rook`)

- Cell **104x96**, pivot **(40, 92)**, colour: tarnished gold. Hurtbox 24x80 px (crouching 50).
- Cell width: 40 px behind the pivot + furthest reach 50 px + 8 px = 98, rounded up to 104 (64 px in front of the pivot).
- Suggested sheet: **8 columns x 17 rows** (130 cells) at `public/art/characters/rook.png`, 832x1632 px.
- Rook is missing her **right arm** (the back arm when facing right): draw it absent in every pose. `rook_cross` (right arm) is used by the training dummy and later by the Iron Wrist relic.
- The training dummy (`dummy`) uses this sheet, shifted to greys.
- **35 animations, 130 drawn frames** (19 required state animations + 10 moves; the rest are optional).

### State animations

| Animation | Required | Poses | Frames per pose | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| `idle` | yes | 4 | 10 | yes | guard up, breathing |
| `walk_forward` | yes | 6 | 6 | yes |  |
| `walk_back` | yes | 6 | 6 | yes | guard stays up (walking back blocks) |
| `crouch` | yes | 2 | 4 | no | second pose is held |
| `block_stand` | yes | 1 | 8 | no |  |
| `block_crouch` | yes | 1 | 8 | no |  |
| `dash_forward` | optional | 3 | 5 | no |  |
| `backdash` | optional | 3 | 6 | no |  |
| `phase_step` | yes | 3 | 6 | no | readable as a sidestep; afterimages are added by the game |
| `hitstun_high` | yes | 2 | 6 | no | head snaps back |
| `hitstun_mid` | yes | 2 | 6 | no | doubles over |
| `hitstun_low` | optional | 2 | 6 | no | legs knocked; falls back to hitstun_mid |
| `blockstun_stand` | yes | 1 | 8 | no |  |
| `blockstun_crouch` | optional | 1 | 8 | no | falls back to blockstun_stand |
| `airborne` | yes | 3 | 8 | no | launched and juggled |
| `knockdown` | yes | 2 | 6 | no | second pose (lying) is held |
| `wake_up` | yes | 3 | 7 | no | 20 frames, invulnerable |
| `thrown` | optional | 2 | 10 | no |  |
| `throw_break` | yes | 2 | 10 | no |  |
| `wall_splat` | yes | 2 | 10 | no | pinned to the wall while sliding down |
| `stagger` | yes | 4 | 8 | yes | poise broken |
| `guard_break` | yes | 3 | 8 | no |  |
| `ko` | yes | 3 | 8 | no | last pose is held |
| `intro` | yes | 6 | 10 | no | boss intro banner |
| `victory` | optional | 6 | 10 | no |  |

### Move animations

The impact pose must start on the frame in **bold** (the first active frame). "Poses" is the suggested number of drawn frames, with the suggested hold of each (sim frames).

| Move | Name | Input | Height / path | Startup | Active | Recovery | Total | Impact starts on | Reach (px) | Poses | Suggested poses | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rook_cross` | Cross | `2` | mid / linear | 12 | 2 | 18 | 31 | **12** | 46 | 5 | startup 6, startup 5, **impact** 2, recovery 9, recovery 9 |  |
| `rook_high_kick` | High Kick | `4` | high / sweeping | 14 | 3 | 24 | 40 | **14** | 48 | 6 | startup 7, startup 6, **impact** 3, recovery 8, recovery 8, recovery 8 |  |
| `rook_jab` | Jab | `1` | high / linear | 10 | 2 | 13 | 24 | **10** | 44 | 5 | startup 5, startup 4, **impact** 2, recovery 7, recovery 6 |  |
| `rook_jab_2` | Second Jab | `1` | high / linear | 10 | 2 | 16 | 27 | **10** | 44 | 5 | startup 5, startup 4, **impact** 2, recovery 8, recovery 8 | cancel-only |
| `rook_knee` | Knee | `3` | mid / linear | 13 | 3 | 20 | 35 | **13** | 34 | 5 | startup 6, startup 6, **impact** 3, recovery 10, recovery 10 |  |
| `rook_low_jab` | Low Jab | `2:1` | low / linear | 10 | 2 | 14 | 25 | **10** | 42 | 5 | startup 5, startup 4, **impact** 2, recovery 7, recovery 7 |  |
| `rook_palm` | Lunging Palm | `6:1` | mid / linear | 14 | 3 | 22 | 38 | **14** | 44 | 6 | startup 7, startup 6, **impact** 3, recovery 8, recovery 7, recovery 7 |  |
| `rook_rising_kick` | Rising Kick | `3:4` | mid / linear | 15 | 3 | 18 | 35 | **15** | 36 | 6 | startup 6, startup 6, *smear* 2, **impact** 3, recovery 9, recovery 9 | smear frame before impact |
| `rook_sweep` | Sweep | `2:4` | low / sweeping | 16 | 3 | 28 | 46 | **16** | 50 | 7 | startup 5, startup 5, startup 5, **impact** 3, recovery 10, recovery 9, recovery 9 |  |
| `rook_throw` | House Throw | `1+3` | throw / linear | 12 | 2 | 28 | 41 | **12** | range 28 | 7 | startup 5, startup 4, *smear* 2, **impact** 2, recovery 10, recovery 9, recovery 9 | smear frame before impact |

## Corvane, the Iron Wrist (`corvane`)

- Cell **104x104**, pivot **(40, 100)**, colour: iron grey (skin and wrist bands), rust-brown leather (secondary). Hurtbox 32x88 px (crouching 55).
- Cell width: 40 px behind the pivot + furthest reach 56 px + 8 px = 104, rounded up to 104 (64 px in front of the pivot).
- Suggested sheet: **8 columns x 21 rows** (164 cells) at `public/art/characters/corvane.png`, 832x2184 px.
- **41 animations, 164 drawn frames** (20 required state animations + 15 moves; the rest are optional).

### State animations

| Animation | Required | Poses | Frames per pose | Loop | Notes |
| --- | --- | --- | --- | --- | --- |
| `idle` | yes | 4 | 10 | yes | guard up, breathing |
| `walk_forward` | yes | 6 | 6 | yes |  |
| `walk_back` | yes | 6 | 6 | yes | guard stays up (walking back blocks) |
| `crouch` | yes | 2 | 4 | no | second pose is held |
| `block_stand` | yes | 1 | 8 | no |  |
| `block_crouch` | yes | 1 | 8 | no |  |
| `dash_forward` | optional | 3 | 5 | no |  |
| `backdash` | optional | 3 | 6 | no |  |
| `phase_step` | yes | 3 | 6 | no | readable as a sidestep; afterimages are added by the game |
| `hitstun_high` | yes | 2 | 6 | no | head snaps back |
| `hitstun_mid` | yes | 2 | 6 | no | doubles over |
| `hitstun_low` | optional | 2 | 6 | no | legs knocked; falls back to hitstun_mid |
| `blockstun_stand` | yes | 1 | 8 | no |  |
| `blockstun_crouch` | optional | 1 | 8 | no | falls back to blockstun_stand |
| `airborne` | yes | 3 | 8 | no | launched and juggled |
| `knockdown` | yes | 2 | 6 | no | second pose (lying) is held |
| `wake_up` | yes | 3 | 7 | no | 20 frames, invulnerable |
| `thrown` | optional | 2 | 10 | no |  |
| `throw_break` | yes | 2 | 10 | no |  |
| `wall_splat` | yes | 2 | 10 | no | pinned to the wall while sliding down |
| `stagger` | yes | 4 | 8 | yes | poise broken |
| `guard_break` | yes | 3 | 8 | no |  |
| `ko` | yes | 3 | 8 | no | last pose is held |
| `intro` | yes | 6 | 10 | no | boss intro banner |
| `victory` | optional | 6 | 10 | no |  |
| `phase_transition` | yes | 6 | 15 | no | 90 frames, invulnerable |

### Move animations

The impact pose must start on the frame in **bold** (the first active frame). "Poses" is the suggested number of drawn frames, with the suggested hold of each (sim frames).

| Move | Name | Input | Height / path | Startup | Active | Recovery | Total | Impact starts on | Reach (px) | Poses | Suggested poses | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `corvane_bell_ringer` | Bell Ringer | `1+2` | throw / linear | 12 | 2 | 30 | 43 | **12** | range 30 | 7 | startup 5, startup 4, *smear* 2, **impact** 2, recovery 10, recovery 10, recovery 10 | smear frame before impact |
| `corvane_body_hook` | Body Hook | `3:2` | mid / sweeping | 16 | 3 | 22 | 40 | **16** | 44 | 7 | startup 7, startup 6, *smear* 2, **impact** 3, recovery 8, recovery 7, recovery 7 | smear frame before impact |
| `corvane_cross` | Straight Cross | `6:2` | mid / linear | 14 | 3 | 20 | 36 | **14** | 50 | 6 | startup 6, startup 5, *smear* 2, **impact** 3, recovery 10, recovery 10 | smear frame before impact |
| `corvane_grave_punch` | Grave Punch | `2:1+2` | low / linear | 10 | 2 | 24 | 35 | **10** | 42 | 6 | startup 5, startup 4, **impact** 2, recovery 8, recovery 8, recovery 8 |  |
| `corvane_haymaker` | Haymaker | `4:2` | high / sweeping | 26 | 3 | 28 | 56 | **26** | 56 | 7 | startup 8, startup 8, startup 7, *smear* 2, **impact** 3, recovery 14, recovery 14 | smear frame before impact; glint (red) frames 12-20 |
| `corvane_iron_wall` | Iron Wall | `6:1+2` | mid / sweeping | 22 | 3 | 30 | 54 | **22** | 50 | 7 | startup 7, startup 6, startup 6, *smear* 2, **impact** 3, recovery 15, recovery 15 | smear frame before impact; glint (red) frames 8-16; armor 1-21 |
| `corvane_jab_1` | Iron Jab | `1` | high / linear | 10 | 2 | 14 | 25 | **10** | 46 | 5 | startup 5, startup 4, **impact** 2, recovery 7, recovery 7 |  |
| `corvane_jab_2` | Iron Jab 2 | `1` | high / linear | 10 | 2 | 14 | 25 | **10** | 46 | 5 | startup 5, startup 4, **impact** 2, recovery 7, recovery 7 | cancel-only |
| `corvane_jab_3` | Iron Jab 3 | `1` | high / linear | 12 | 2 | 18 | 31 | **12** | 48 | 5 | startup 6, startup 5, **impact** 2, recovery 9, recovery 9 | cancel-only |
| `corvane_last_bell_1` | Last Bell | `236:1+2` | mid / linear | 20 | 2 | 10 | 31 | **20** | 50 | 6 | startup 7, startup 6, startup 6, **impact** 2, recovery 5, recovery 5 | +40 on whiff (hold the last pose); glint (white) frames 6-14 |
| `corvane_last_bell_2` | Last Bell | `236:1+2` | mid / linear | 6 | 2 | 10 | 17 | **6** | 50 | 4 | startup 5, **impact** 2, recovery 5, recovery 5 | cancel-only; automatic part |
| `corvane_last_bell_3` | Last Bell | `236:1+2` | mid / linear | 6 | 2 | 10 | 17 | **6** | 50 | 4 | startup 5, **impact** 2, recovery 5, recovery 5 | cancel-only; automatic part |
| `corvane_last_bell_4` | Last Bell | `236:1+2` | mid / linear | 6 | 2 | 10 | 17 | **6** | 50 | 4 | startup 5, **impact** 2, recovery 5, recovery 5 | cancel-only; automatic part |
| `corvane_last_bell_5` | Last Bell | `236:1+2` | mid / linear | 6 | 2 | 22 | 29 | **6** | 50 | 5 | startup 5, **impact** 2, recovery 8, recovery 7, recovery 7 | cancel-only; automatic part |
| `corvane_liver_shot` | Liver Shot | `2:2` | low / linear | 18 | 3 | 30 | 50 | **18** | 48 | 7 | startup 5, startup 5, startup 5, *smear* 2, **impact** 3, recovery 15, recovery 15 | smear frame before impact |

## Totals

| Character | Animations | Drawn frames | Required animations |
| --- | --- | --- | --- |
| rook | 35 | 130 | 29 |
| corvane | 41 | 164 | 35 |

