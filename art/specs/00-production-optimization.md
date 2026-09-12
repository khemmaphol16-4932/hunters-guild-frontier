# Production Optimization Pass

**Status:** PROPOSED, 2026-09-12
**Applies to:** every category in `art/ASSET_REGISTRY.md`
**Result:** **~2,630 authored files → ~720.** A 73% reduction with no loss of visual variety.

The first registry pass counted assets the naive way: every subject × every state × every
facing × every tier × every scale, hand-authored. That number is not a plan, it is a warning.
This document is the pass that turns it into a plan.

**The principle:** author what is *visually unique*; generate everything that is a
transformation of it. Every rule below is a rule about which of those two a file is.

---

## 1. The seven techniques

### O-1 — Generate `@1x` from `@2x` at build time

The registry counted `@1x` and `@2x` as separate work. They are not. Author `@2x`, generate
`@1x` with nearest-neighbour downsampling in the build step, hand-fix only the assets that
fail review.

- **Saves:** 50% of all files, everywhere.
- **Cost:** one Vite plugin (~40 lines) plus a hand-fix budget of ~5% of assets.
- **Risk:** pixel art does not always halve cleanly. Mitigated by authoring `@2x` on an even
  grid so every 2×2 block maps to one `@1x` pixel — which the 64×32 tile lock already guarantees.

### O-2 — Generate contact shadows from sprite alpha

`ART_BIBLE.md` §8.2 requires a separate `_shadow` sprite per grounded asset. The registry
counted those as authored art. They are not: a contact shadow is a function of the sprite's
alpha footprint — project the silhouette's bottom 15% to the ground plane, blur, slate-blue `#3e4a5c` at 35% (`ART_BIBLE.md` §8.2).

- **Saves:** ~300 files.
- **Cost:** one build-time image step.
- **Exception:** buildings with a hollow footprint (`palisade`, `market_stall`) get a hand
  shadow. That is 4 files, not 300.

### O-3 — Mirror the second pair of facings

`ART_BIBLE.md` §4.2 already allows `se↔sw` and `ne↔nw` mirroring for symmetric subjects.
Extend the same logic to buildings: a bilaterally symmetric building's `E` rotation is the
horizontal mirror of its `W` rotation.

- **Saves:** ~50% of buildings and ~40% of characters and monsters.
- **Hard exception, non-negotiable:** any subject with an asymmetric read is authored in all
  four. In this project that is `HUN_SKEL_RANGER` (fixed quiver side), `smithy` (chimney and
  attached forge), `watchtower` (stair side), `market_stall` (counter face), and `guild_hall`
  (bell tower and entry stair). Mirroring
  those flips the quiver to the wrong shoulder and the forge to the wrong wall.

### O-4 — Overlay states instead of authoring them

`_damaged` and `_construction` were counted per building × tier × rotation — 240 and 80 files.
They are not per-building information. They are the same visual idea applied to any building.

- **Damage** → a set of **12 decal overlays** (scorch, hole, splintered beam, collapsed
  corner, soot, broken shutter) composited by footprint size, seeded by `instanceId` so the
  same building always shows the same damage. `REQ-TWN-008` is satisfied — the building
  visibly took a hit — without 240 files.
- **Construction** → **3 scaffold overlays**, one per footprint class (1×1, 2×2, 3×3).
- **Saves:** ~305 files.

### O-5 — Palette swap instead of re-authoring

Three places where the naive count multiplied by a colour axis:

| Axis | Naive | With swap |
|---|---|---|
| Hair: 10 styles × 6 colours | 60 | **10** + a 6-ramp table |
| Region tiles: 4 regions × 24 tiles | 96 | **24 templates** + 4 palette definitions, then hand-pass the 6 tiles per region that carry region identity |
| Rarity frames: 6 | 6 | **1** + a 6-hue table |

- **Saves:** ~120 files.
- **Limit:** this works for *material colour*, not for *form*. Ashfall Barrows needs genuinely
  different rock shapes, not grey grass — hence the per-region hand-pass above.

### O-6 — Modular kit for buildings

The single largest saving. Instead of 37 unique tier-variants × 4 rotations of whole
buildings, author a **shared modular kit** — wall segments, roof pieces, corners, doors,
windows, chimneys, banners, foundations — in three material tiers, and compose each building
from it.

- **Naive:** ~640 files.
- **Kit:** ~96 kit parts + 37 composition recipes (JSON, not art).
- **Saves:** ~440 files, and buys something the naive plan could not: new buildings become
  free. Adding a 21st building is a recipe, not an art order.
- **Full spec:** `specs/04-buildings.md`.

### O-7 — Cut what the camera cannot see

`ART_BIBLE.md` §5 puts a hunter at 56 px tall at `@1x`, and `worldView.ts` clamps zoom to a
0.55 floor. At that floor a hunter is 31 px. Gauntlets, boots, and trinkets occupy 2–4 px.

- `EQP_HANDS`, `EQP_FEET`, `EQP_TRINKET` ship as **inventory icons only**, with no
  paper-doll world layer. Already flagged in the registry; now it is a rule with a number
  behind it.
- Facial detail below two pixels is not authored at all.
- **Saves:** ~180 files, and removes a whole class of "why does this look muddy" review.

---

## 2. Before and after

| Category | Naive | Optimized | Technique |
|---|---|---|---|
| Reference sheets | 9 | 9 | — |
| World environment | 200 | 72 | O-5, O-1 |
| Hunter characters | 700 | 214 | O-3, O-5, O-7 |
| Monsters | 420 | 148 | O-3, O-2 |
| Buildings | 640 | 108 | **O-6**, O-3, O-4 |
| Props | 160 | 62 | O-2, O-5 |
| Equipment | 190 | 54 | **O-7** |
| Resources | 30 | 24 | — |
| VFX | 130 | 58 | O-5 |
| UI icons | 100 | 100 | O-5, O-1 (counted exactly in `specs/09`) |
| Map markers | 30 | 27 | Runtime composition (counted in `specs/10`) |
| Promotional | 20 | 14 | — |
| **Total authored `@2x`** | **~2,630** | **~720** | |
| **Plus generated `@1x`** | +2,630 hand | **0 hand** | **O-1** |

**P0 subset: ~700 → ~200 authored files.** That is the difference between a plan that needs
a studio and one a small team can actually finish.

---

## 3. Runtime cost, not just file count

File count is production cost. These are the rules that keep the *game* fast, and they
matter more than the file count because `REQ-TEC-011` ranks rendering below simulation —
the art must not eat the frame budget that the AI needs.

### O-8 — One atlas per concern, not per asset

Current `worldView.ts` builds the scene from DOM nodes plus an inline SVG string rebuilt on
every `renderScene()`. At 20 buildings and 94 decorative trees that is already ~120 DOM nodes
re-created whenever the scene refreshes.

Ship **five atlases**, each ≤ 2048², loaded as one request:

| Atlas | Contents | Load |
|---|---|---|
| `atlas_town` | Building kit, props, ground, roads | Eager |
| `atlas_hunters` | 3 skeletons, layers, Tier A states | Eager |
| `atlas_ui` | Icons, markers, frames | Eager |
| `atlas_region_<id>` | Per-region tiles, props, monsters | Lazy, on approach |
| `atlas_vfx` | Effects | Lazy, on first combat |

Eager payload target: **≤ 1.2 MB** combined at `@1x`.

### O-9 — Canvas for the world, DOM for the interface

Already recommended in `ART_BIBLE.md` §12.1; restated here because it is an optimization,
not only an architecture preference. The 12×9 grid caps the town at 108 tiles, so a single
canvas draws the whole town in one pass. Keep the drawer, inspector, dock, and every menu in
DOM so the existing accessibility work in `a11y.ts` and `preferences.ts` survives intact.

### O-10 — Composite paper-dolls on equipment change, never per frame

`ART_BIBLE.md` §12.3. A 40-hunter guild at 12 fps would otherwise composite 480 sprites per
second from 8 layers each. Cache by
`skeleton|body|hair|outfit|weapon|pack|state|facing`; equipment changes are rare and walking
is constant.

### O-11 — Fix the two 3 MB PNGs

`art/generated/guild-town-overview-v1.png` and `verdant-reach-vista-v1.png` are 3.0 MB each.
Together they exceed the entire 4 MB art budget before a single game asset exists.

- Re-export at the size actually displayed, as WebP with a PNG fallback: **~180 KB each**.
- Lazy-load; they are title and dashboard art, never needed on first paint.
- **Saves ~5.6 MB** — by a wide margin the single largest performance win available today,
  and it can be done before any new art is produced.

### O-12 — Round the camera transform

`worldView.transform()` writes fractional `translate()` values. Every fractional offset makes
pixel art shimmer during a pan, and forces the compositor to resample the whole scene.
Round to whole device pixels: `Math.round(v * dpr) / dpr`. One line, and it is the difference
between "crisp pixel art" and "why does this look blurry".

---

## 4. What was deliberately *not* optimized

Recording these so they are not re-litigated later.

| Not cut | Why |
|---|---|
| 4 authored facings for `HUN_SKEL_RANGER` | Asymmetry *is* the archetype's identity read (`specs/02`). Mirroring destroys it |
| Per-region hand-pass on 6 tiles each | A palette swap cannot make Ashfall Barrows feel wrong. Form has to change |
| 12 fps hand-timed animation | Dropping to 8 fps saves a third of the frames and makes walking read as stuttering |
| `idle` on every agent | A static hunter reads as a bug and contradicts `REQ-CW-001` |
| Separate back views for hair | Mirroring a ponytail to the front is the classic tell |
| Boss telegraph VFX | `REQ-BOS-001` requires a telegraph for every important boss skill. Not optional |

---

## 5. Implementation order

Optimizations that unblock production come first. O-1, O-2, and O-11 are build-pipeline work
that should land **before** the first production asset, because retrofitting them means
re-exporting everything authored in the meantime.

| Step | Work | Blocks |
|---|---|---|
| 1 | **O-11** — re-export the two 3 MB PNGs | Nothing. Do it today |
| 2 | **O-12** — round the camera transform | Nothing. One line |
| 3 | **O-1** + **O-2** build plugin — `@1x` and shadow generation | All asset production |
| 4 | **O-6** building kit spec + recipe schema | Category 04 |
| 5 | **O-5** palette-swap table + tooling | Categories 01, 02, 09, 10 |
| 6 | **O-8** atlas packing step | First playable |
| 7 | **O-9** canvas world renderer | Before hunters animate |
| 8 | **O-10** paper-doll cache | With O-9 |

Steps 1 and 2 are real code changes to shipped files and need no new art at all.
