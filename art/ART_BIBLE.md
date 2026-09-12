# Hunter's Guild: Frontier — Art Bible

**Status:** PROPOSED, 2026-09-12. Foundations for asset production.
**Authority:** Subordinate to `docs/DESIGN_BIBLE.md` and `docs/CONTINUOUS_WORLD_ARCHITECTURE.md`.
Expands, never contradicts, `art/ART_DIRECTION.md`.

**Rule:** No asset may be produced until its category spec cites the rules in this file.
Every asset carries an ID, a path, a pivot, a scale, and an acceptance checklist. An asset
without those is concept art, not a game asset, and does not enter `art/`.

---

## 0. Reconciliations and pending approvals

This document resolves three conflicts found while reading the repository. AR-3 is settled
(DL-065). AR-1 and AR-2 are recorded as **DL-068, PENDING APPROVAL**, and must be approved before
assets are ordered.

| # | Conflict | Resolution proposed here |
|---|---|---|
| AR-1 | `REQ-UX-007` and `ART_DIRECTION.md` lock **pixel art**. Later handoff language describes **painterly low-poly**. | **Pixel art wins.** The reconciliation is the one `ART_DIRECTION.md` already states: *"premium hand-crafted pixel art with clean readable silhouettes, soft ambient shading"*. Read "painterly" as **soft ambient shading inside a hand-placed pixel grid**, not as brushwork or 3D render. No asset ships as a smooth painted render. |
| AR-2 | `worldView.ts` projects at `(x−y)·33, (x+y)·18` — a **66×36** tile diamond (28.6°), which is not a standard isometric ratio and not cleanly pixel-authorable. | Lock art to **true 2:1 dimetric, 64×32 tile** (26.565°) and change the projection constants to `32`/`16`. Art is expensive; a projection constant is one line. See §4. |
| AR-3 | `CONTINUOUS_WORLD_ARCHITECTURE.md` locked time controls as **Pause / 1× / 2× / 4×**; the design owner has since removed Pause. | **Settled by DL-065**; the amendment now shows the change. Art impact: **no "paused world" visual state** is authored. Every animation loops continuously; there is no frozen-world treatment, vignette, or desaturation pass. |

---

## 1. What the art has to prove

> **A world worth living in, and a frontier worth risking it for.**

The art carries three load-bearing jobs. Every asset is judged against them.

1. **Legibility of the simulation.** `REQ-PRIME-008` and `REQ-CW-007`: if a system can be
   read from the world, it must be. A hunter's fatigue, a building's damage, a region's
   danger tier, a hunter's role — all must be visible before any menu opens.
2. **Continuity of identity.** `REQ-CW-001`/`002`: a hunter is *the same person* in town, on
   the road, and mid-fight. There is no battle sprite, no portrait-versus-field split, no
   card art that looks like a different character.
3. **Accumulated history.** `REQ-CHR-002`, `REQ-TWN-002`: the town visibly remembers.
   Trophies, plaques, repaired walls, banners, monuments. Growth never resets.

**Anti-goals, from `DESIGN_BIBLE.md` §129, restated visually:** no spreadsheet UI dressed as
a game, no hero-collector character cards, no life-sim crowd, no grim-dark survival palette.
Target tone is **casual tycoon + RPG flavour**: death matters, the game stays warm.

---

## 2. Master style prompt

Prepend this to every generation request. It is the invariant; the per-asset prompt supplies
only subject, pose, view, and kit.

```
Hand-crafted isometric pixel art for a 2.5D management RPG, in the style of premium
modern pixel art: crisp hand-placed pixels on a strict grid, clean readable silhouette
first, soft ambient shading with limited dithering, no anti-aliasing on the outer
silhouette edge. True 2:1 dimetric projection, camera fixed, viewed from above at
26.565 degrees. Grounded frontier fantasy: timber, stone, leather, iron, wool, rope.
Lived-in and practical, warm and inhabited rather than heroic or ornate. Restrained
palette, strong value separation between silhouette and ground. Fully transparent
background. Single subject, centred, feet or footprint aligned to the ground plane.
No text, no numbers, no UI, no frame, no border, no watermark, no signature,
no drop shadow baked into the sprite.
```

## 3. Master negative prompt

```
photorealistic, 3D render, octane, unreal engine, smooth vector art, flat vector,
anti-aliased soft edges, blurry, airbrushed, oil painting, watercolour, concept art
sketch, line art, cel shaded anime, chibi, super-deformed, generic fantasy MMO,
World of Warcraft style, glossy plate armour, chrome, neon, glowing runes everywhere,
excessive ornament, filigree, spikes, oversized pauldrons, heroic superhero anatomy,
exaggerated muscles, cleavage, modern clothing, zippers, denim, guns, sci-fi,
grim-dark, horror gore, blood spatter, top-down 90-degree view, front-on orthographic
view, side-scroller view, character card, portrait frame, trading card layout,
background scenery, ground plate, shadow ellipse, text, logo, watermark, signature,
UI elements, health bar, multiple characters, collage, sprite sheet grid lines
```

**Per-category additions** are defined in each category spec. They never replace this list.

---

## 4. Camera, projection, and view rules

### 4.1 Locked projection

| Property | Value |
|---|---|
| Projection | True 2:1 dimetric ("isometric" by game convention) |
| Angle from horizontal | 26.565° (`atan(1/2)`) |
| Base tile, @1x | **64 × 32 CSS px** |
| Base tile, @2x | **128 × 64 px** |
| Screen delta per +1 grid X | `(+32, +16)` @1x |
| Screen delta per +1 grid Y | `(−32, +16)` @1x |
| Camera rotation | **None.** The camera never rotates. |
| Camera zoom range | `0.55 – 1.8` (from `worldView.ts` `changeZoom` clamp) |

> **Code change required (AR-2):** `worldView.ts` currently uses `33`/`18`. Change to
> `32`/`16`. Until that lands, every authored asset will sit ~3% wrong on the horizontal.

### 4.2 Facing

The camera cannot rotate, so the world needs only **four facings**, named by compass:

`SE` (toward viewer-right-down) · `SW` (viewer-left-down) · `NE` (viewer-right-up) · `NW` (viewer-left-up)

- **Characters and monsters:** front and back views are separate work. `NE`/`NW` are authored separately
  (back views differ — packs, hair, quivers, cloaks), **never** produced by horizontal flip
  of the front views. Horizontal mirroring *is* permitted between `SE↔SW` and `NE↔NW`,
  which halves the work: author `SE` and `NE`, mirror for `SW` and `NW`.
  **Exception:** any asset with a deliberately asymmetric read — a sword always on the left
  hip, an eyepatch, a scar — is authored in all four facings and never mirrored.
- **Buildings:** four rotations, `N`/`E`/`S`/`W`, required by `REQ-CW-006` ("buildings
  rotate four ways"). Bilaterally symmetric buildings author two and mirror two (O-3); any
  building with a sided feature — chimney, stair, counter, bell tower — is authored in all
  four, because mirroring would move it. The list is in `specs/04-buildings.md` §1.4.
- **Props:** one facing unless the prop has a functional front (doors, signs, market stalls).

### 4.3 What the camera never does

`REQ-CW-002`/`003`: **there is no combat camera.** No asset may assume a framed battle
stage, an arena floor, a versus layout, or a zoom-in. Combat assets are authored to work at
the same scale as town assets, in the same world, at any zoom in the 0.55–1.8 range.

### 4.4 The 0.55 zoom test

Every character, monster, and prop must pass: **downscale to 55% and the silhouette still
reads.** For a 56 px hunter this means the sprite must be identifiable at 31 px. This test
is in every acceptance checklist and is the single most common reason to reject an asset.

---

## 5. Scale rules

All figures @1x. Author at @2x and export both (see §9.4).

| Subject | Height (@1x) | Canvas (@1x) | Footprint |
|---|---|---|---|
| Base tile | 32 | 64 × 32 | 1 × 1 |
| **Hunter, adult standing** | **56** | 64 × 80 | 1 × 1 |
| Service NPC | 52 | 64 × 80 | 1 × 1 |
| Monster, `trash` | 28 – 44 | 64 × 64 | 1 × 1 |
| Monster, `elite` | 48 – 64 | 96 × 96 | 1 × 1 |
| Monster, `boss` | 88 – 120 | 192 × 160 | 2 × 2 |
| World Boss | 140 – 200 | 320 × 256 | 3 × 3 |
| Building, `w × h` tiles | see §5.2 | `(w+h)·32` wide | `w × h` |
| Small prop (barrel, crate) | 14 – 22 | 64 × 48 | 1 × 1 |
| Tree | 60 – 96 | 96 × 128 | 1 × 1 |
| Ground / terrain tile | 32 | 64 × 32 | 1 × 1 |
| Loot drop (world) | 12 – 16 | 32 × 32 | — |
| UI icon | 24 / 32 / 48 | square | — |
| Map marker | 32 | 32 × 40 | — |

### 5.1 Human proportion

**Head-to-height ratio 1 : 6.** Not 1:8 (heroic — fails the 0.55 zoom test), not 1:3
(chibi — contradicts the grounded tone). Head ≈ 9 px at @1x. Eyes are **two pixels, or
implied by a shadow** — never rendered features. Personality comes from silhouette, stance,
and kit, per `ART_DIRECTION.md`.

### 5.2 Building height by tier

`REQ-TWN-002` and `ART_DIRECTION.md`: tier reads from **silhouette, material, banners, and
lighting — never a floating level label.**

| Tier | Wall height (@1x) | Material read | Additions |
|---|---|---|---|
| T1 | 28 – 36 | rough timber, thatch, canvas, raw log | none |
| T2 | 40 – 56 | dressed timber, plank, shingle, banded iron | shutters, chimney, banner, lantern |
| T3 | 60 – 80 | timber + cut stone, tile roof, iron fittings | second storey, guild banner, glazed windows, trophy mount |

Total canvas height = `(w+h)·16 + wallHeight + 24` px of headroom.

---

## 6. Colour system

### 6.1 Functional palette — LOCKED, do not redefine

The codebase already reuses **one six-hue functional palette** across three unrelated
systems. It is locked by `src/data/items/rarities.json`, `src/data/world/regions.json`, and
`src/ui/style.css`. Reuse the exact hex values.

| Hex | Rarity | Zone tier | Combat role |
|---|---|---|---|
| `#8c98a8` | Common | — | (muted / UI) |
| `#dde3ea` | Refined | — | (text / UI) |
| `#5b8dd6` | Rare | **Blue** (no death) | Tank |
| `#d9a441` | Ancient | **Yellow** (injury) | (accent) |
| `#d4685f` | Legendary | **Red** (severe injury) | Damage |
| `#b58bd6` | Epic | — | Support |
| `#8c5fd6` | — | **Black** (death possible) | — |
| `#5fbf87` | — | — | Healer |
| `#4fb0b8` | — | — | Control |

> **Hard rule.** These nine hues are *functional signal*. They may never be used as
> incidental decoration in environment or prop art. A purple flower in a Blue-zone meadow
> reads as Black-zone danger. Environment art uses the natural palettes in §6.2 only.

### 6.2 Environmental palettes

Sampled from the approved `art/generated/` anchors and `ART_DIRECTION.md`.

**Guild / town — warm, inhabited.** Honey lantern gold `#e8b45a`, warm timber `#8a5c3b`,
dark timber `#54382a`, faded brick red `#9c5347`, thatch `#c2a05e`, moss green `#6f7f4e`,
slate-blue shadow `#3e4a5c`, stone `#8d8a80`, canvas `#ccbfa3`.

**Verdant Reach (Blue) — safe, generous.** Land gradient `#415845` → `#859061`, grass
detail `#82905b`, water `#4c8589` with `#a1baa4` bank and `#86b1ad` highlight, canopy
`#4e6b45`, trail dust `#9b9070`.

**Coldwater Quarry (Yellow) — exposed, mineral.** Cut stone `#7f8791`, slate `#5a626d`,
cold water `#476a78`, rust `#a6683f`, sparse scrub `#6b7355`.

**Ashfall Barrows (Black) — wrong, not gory.** Ash `#6b6560`, scorched earth `#3a332e`,
bone `#c9c0ae`, ember `#c0563a`, and **violet `#8c5fd6` used sparingly and only as the
Black-zone signal** — on threat sources, never on terrain.

**The Sunken Choirhouse (Red) — drowned, still.** Deep water `#2f4a52`, wet stone `#6d7a76`,
pale algae `#8fa58a`, silt `#7a6f5c`.

### 6.3 Ramp discipline

Every material uses a **5-step ramp**: shadow, core shadow, base, light, highlight. Ramps
shift hue as they shift value — shadows go cooler and slightly blue, highlights warmer.
Pure black (`#000000`) and pure white (`#ffffff`) are forbidden anywhere in the art.

Maximum unique colours per asset: **32 for characters and monsters, 48 for buildings,
24 for props, 16 for UI icons.** A shared 96-colour master ramp file lives at
`art/reference-sheets/palette_master.png` and `palette_master.gpl`.

---

## 7. Lighting rules

| Rule | Value |
|---|---|
| Key light | Directional, warm, from **upper-left**, elevation ≈ 45° |
| Fill | Cool sky bounce from upper-right, low intensity |
| Bounce | Warm ground bounce on undersides, very low intensity |
| Baked shadow | **Never.** Contact shadow is a separate layer/sprite (§8.2) |
| Time of day | **Fixed.** Golden-hour-leaning neutral day. No day/night variants in v1 |
| Self-illumination | Only for authored light sources: lanterns, forge fire, shrine glow, Black-zone threat |

**Consistency is enforced mechanically, not by eye:** every asset is checked against
`art/reference-sheets/lighting_ball.png` — a sphere and a cube lit by the rules above.
If the asset's shading disagrees with the ball, the asset is wrong.

World Boss arrivals may shift weather, lighting, and sound (`REQ-CW-013`) — that is a
**runtime tint/overlay pass**, not re-authored assets. Terrain stays intact.

---

## 8. Silhouette rules

### 8.1 The silhouette gate

Every character and monster must pass **all four**:

1. **Black-fill test.** Filled 100% black on white, the subject is identifiable.
2. **0.55 zoom test.** At 55% scale the silhouette still reads (§4.4).
3. **Role read.** From silhouette alone a player can tell Vanguard (broad, grounded,
   shield mass low) from Adept (tall, robed, vertical stave line) from Ranger (lean,
   asymmetric, bow arc + pack).
4. **Line-up test.** Placed in a row with every other hunter in its category, no two
   silhouettes are confusable.

### 8.2 Contact shadow

Shadows are **never baked into the sprite**. Each grounded asset gets a paired shadow
sprite: a soft ellipse in slate-blue shadow `#3e4a5c` at 35% opacity (never black, §6.3), width = 0.7 × silhouette width,
height = 0.35 × width, centred on the pivot. Filename suffix `_shadow`. These are **generated
at build time from the sprite's alpha** (O-2), not authored; only hollow-footprint buildings
get a hand-made one.

This is what lets the same hunter sprite sit correctly on grass, road, stone, and water.

### 8.3 Readability aids

- Outer edge is a **hard 1 px darker-than-base outline** — the local base colour darkened
  by two ramp steps, never a black outline.
- Interior detail is suppressed below the waist; the eye reads head, shoulders, and weapon.
- Kit silhouette carries identity: pack, quiver, scabbard, tool. Ornament does not.

---

## 9. Naming, ID, and export rules

### 9.1 Asset ID grammar

```
<CATEGORY>_<SUBJECT>_<VARIANT>_<STATE>
```

Uppercase, underscore-separated, ASCII only. The `<SUBJECT>` segment **must** equal the
content `id` from `src/data/**` wherever one exists — `moss_crawler`, `guild_hall`,
`verdant_reach`, `iron`. Inventing a new subject name for an existing content id is a
rejection.

Category prefixes:

| Prefix | Category | Folder |
|---|---|---|
| `ENV` | World environment | `art/environment/` |
| `HUN` | Hunter characters | `art/characters/` |
| `NPC` | Service NPCs | `art/characters/` |
| `MON` | Monsters and bosses | `art/monsters/` |
| `BLD` | Buildings | `art/buildings/` |
| `PRP` | Props and decorations | `art/props/` |
| `EQP` | Weapons and equipment | `art/equipment/` |
| `RES` | Resources and loot | `art/resources/` |
| `VFX` | Visual effects | `art/vfx/` |
| `ICO` | UI icons | `art/ui/` |
| `MRK` | Map markers | `art/ui/` |
| `PRM` | Loading and promotional art | `art/promotional/` |
| `REF` | Reference sheets | `art/reference-sheets/` |

### 9.2 Filename grammar

```
<category>_<subject>_<variant>_<state>_<facing>_<frame>@<scale>.<ext>
```

Lowercase, underscore-separated. Omit segments that do not apply. Frames are zero-padded
to two digits and **1-indexed**.

```
hunter_vanguard_t1_idle_se_01@2x.png
hunter_vanguard_t1_walk_se_05@2x.png
monster_moss_crawler_attack_sw_03@2x.png
building_bunkhouse_t1_n@2x.png
building_bunkhouse_t2_damaged_n@2x.png
resource_iron_common@2x.png
icon_status_bleed@2x.png
marker_zone_black@2x.png
env_verdant_reach_ground_grass_01@2x.png
```

Reserved state tokens: `idle` `walk` `run` `attack` `cast` `hit` `downed` `death`
`rescue` `carry` `work` `rest` `gather` `sell` `celebrate` `damaged` `construction`
`shadow`.

Reserved facing tokens: `se` `sw` `ne` `nw` (characters) · `n` `e` `s` `w` (buildings).

### 9.3 Folder structure

```
art/
  ART_DIRECTION.md        # existing north star — unchanged
  ART_BIBLE.md            # this file
  ASSET_REGISTRY.md       # every asset ID, status, owner
  specs/                  # one spec file per category
  characters/
  monsters/
  buildings/
  props/
  equipment/
  resources/
  vfx/
  ui/
  environment/
  promotional/
  reference-sheets/
  generated/              # existing raw generations — unchanged
```

### 9.4 Export rules

| Rule | Value |
|---|---|
| Format | PNG-8 with alpha where ≤ 256 colours; PNG-24 otherwise |
| Scales | `@1x` and `@2x`. **Author at @2x**, downsample to @1x with nearest-neighbour, hand-fix |
| Alpha | Fully transparent background. **Binary alpha on the silhouette edge** — no soft feather |
| Colour profile | sRGB, no embedded ICC |
| Sprite sheets | Horizontal strip, uniform cell, 0 px padding, frame 01 leftmost. Sidecar `.json` with `{frameWidth, frameHeight, frames, fps, pivotX, pivotY, loop}` |
| Atlases | Per category, max 2048 × 2048 @2x, power-of-two |
| Optimisation | `oxipng -o4 --strip all`. **Never** lossy-quantise an asset with functional colour |
| Source files | `.ase` / `.aseprite`, layers named, committed beside the export |

**Budget:** the repo already ships two ~3 MB PNGs (6 MB total) from `art/generated/`. That
is a real problem for a web target. Hard budget for the shipped `dist/` art payload:
**4 MB total @1x, 8 MB @2x**, promotional art excluded and lazy-loaded.

### 9.5 Pivot and layering

**Pivot origin is bottom-centre of the ground footprint**, not bottom-centre of the canvas.
For a 1×1 character sprite on a 64×80 canvas: pivot = `(32, 72)` — the feet, with 8 px of
canvas below for overhang. Every sprite sheet's sidecar JSON declares its pivot explicitly.

Draw order is `zIndex = round(screenY)` — already implemented in `worldView.ts`. Layer
bands, low to high:

| Band | Contents |
|---|---|
| 0 | Ground tiles, roads, water |
| 100 | Ground decals — trail dust, scorch, blood, spill |
| 200 | Contact shadows |
| `round(screenY)` | Buildings, characters, monsters, props, trees — sorted by screen Y |
| 9000 | Ground-anchored VFX |
| 9500 | Overhead VFX, floating numbers, status pips |
| 10000 | Map markers, selection rings, UI |

---

## 10. Animation rules

### 10.1 Global

| Rule | Value |
|---|---|
| Frame rate | **12 fps** for all character and monster animation |
| Timing | Hand-timed, no tweening, no interpolation |
| Loop | `idle` `walk` `run` `work` `rest` loop seamlessly; `attack` `hit` `death` do not |
| Squash/stretch | Minimal. Grounded tone, not cartoon |
| Idle | Always animated. A static hunter reads as a bug, and contradicts `REQ-CW-001` |

### 10.2 State priority tiers

Production order. Tier A is the MVP proof cycle from `CONTINUOUS_WORLD_ARCHITECTURE.md`:
*service → road → Blue field → combat in place → loot → return → sale → recovery.*

| Tier | States | Frames | Justification |
|---|---|---|---|
| **A** | `idle` | 4 | Every agent, always |
| **A** | `walk` | 8 | `REQ-TWN-001` hunters physically walk |
| **A** | `attack` | 6 | `REQ-CBT-001` combat staged in the world |
| **A** | `hit` | 2 | Combat legibility |
| **A** | `downed` | 3 + hold | `REQ-CBT-012` downed → rescue → death |
| **B** | `gather` | 6 | `REQ-CW-011` physical loot pickup |
| **B** | `work` | 8 | 13 town jobs, `REQ-TWN-009` |
| **B** | `rest` | 4 | Fatigue/recovery legibility, `REQ-HUN-011` |
| **B** | `cast` | 6 | Adept / ranged distinction |
| **B** | `run` | 8 | `REQ-CW-010` retreat travels home |
| **C** | `death` | 6 | Black zone only, `REQ-ZON-001` |
| **C** | `rescue` / `carry` | 6 / 8 | `REQ-CBT-013` |
| **C** | `sell` | 4 | `REQ-CW-008` sale to Guild |
| **C** | `celebrate` | 6 | Chronicle moments |
| **C** | `injured_walk` | 8 | `REQ-CW-015` visible delay explanation |

### 10.3 Cost control

Full Tier A–C × 4 facings × every hunter is unaffordable. The lock:

- **Animation is authored per archetype skeleton, not per hunter.** Three skeletons —
  `vanguard`, `adept`, `ranger` — matching `src/data/archetypes.json`.
- **Hunter identity is a paper-doll layer set** over the skeleton: body, hair, outfit,
  weapon, pack. Layers are composited at runtime (§12.3), not pre-baked per hunter.
- Monsters are authored whole, not paper-dolled — there are only 11.

---

## 11. Reference sheet requirements

Produced **before** any production asset. Each is a committed, versioned gate.

| ID | File | Contents |
|---|---|---|
| `REF_PALETTE_MASTER` | `palette_master.png` / `.gpl` | 96-colour master ramp, grouped by material, hex-labelled |
| `REF_LIGHTING_BALL` | `lighting_ball.png` | Sphere + cube + cylinder under the §7 key/fill/bounce rig |
| `REF_GRID_PROJECTION` | `grid_projection.png` | 8×8 tile grid at 64×32, with 1×1 / 2×2 / 3×3 footprints marked |
| `REF_SCALE_LINEUP` | `scale_lineup.png` | Tile, hunter, NPC, trash/elite/boss monster, world boss, T1/T2/T3 building, tree, barrel — one baseline |
| `REF_SILHOUETTE_SHEET` | `silhouette_sheet.png` | Every character and monster, 100% black, at 100% and 55% |
| `REF_HUNTER_TURNAROUND` | `hunter_turnaround.png` | One hunter per archetype × 4 facings, neutral pose, layers separated |
| `REF_MATERIAL_STUDY` | `material_study.png` | Timber, thatch, cut stone, leather, iron, cloth, rope, water, ash — each as a 5-step ramp |
| `REF_ZONE_MOOD` | `zone_mood.png` | Same 4×4 tile clearing rendered in Blue / Yellow / Red / Black palettes |
| `REF_BUILDING_TIERS` | `building_tiers.png` | `guild_hall` T1/T2/T3 side by side, proving tier reads without a label |

**Gate:** `REF_PALETTE_MASTER`, `REF_LIGHTING_BALL`, `REF_GRID_PROJECTION`, and
`REF_SCALE_LINEUP` must be approved before the first production asset is ordered.

---

## 12. Web implementation notes

Target is web (Vite + TypeScript, no engine). There is no Unity in this repository, and
none is planned — `package.json` and `vite.config.ts` are the whole build.

### 12.1 Rendering

Current `worldView.ts` builds the scene from **DOM elements plus inline SVG**. That is fine
for ~20 buildings and a static scene. It will not hold once every hunter animates at 12 fps
while walking a road.

**Recommendation (needs a DL entry):** move the world scene to a single `<canvas>` with a
2D context, keeping the DOM for the drawer, inspector, dock, and all menus. This preserves
the existing accessibility work — which is real and should not be thrown away — because
the interactive surfaces stay DOM. Add an offscreen hit-test layer so map buildings remain
keyboard-reachable, mirroring today's `aria-label` buttons.

### 12.2 Pixel integrity

```css
canvas, .map-building, .dock-hunter img {
  image-rendering: pixelated;
}
```

Snap the camera translate to whole device pixels — `Math.round(x * dpr) / dpr` — or every
sprite shimmers while panning. `worldView.ts` `transform()` currently writes fractional
translates; it must round.

Pick `@2x` assets when `devicePixelRatio >= 1.5`, `@1x` otherwise. Never upscale `@1x`.

### 12.3 Paper-doll compositing

Composite each hunter once into an offscreen canvas, cache by a key of
`skeleton|body|hair|outfit|weapon|pack|state|facing`, invalidate on equipment change. Do not
composite per frame. Equipment changes are rare; walking is constant.

### 12.4 Respect the existing accessibility contract

`src/ui/a11y.ts` and `preferences.ts` already implement `reducedMotion`, `highContrast`, and
`largeText`, and `worldView.refresh()` deliberately avoids stealing focus during autonomous
ticks. Art must not break this:

- **`reducedMotion`:** every looping animation holds on frame 01. Author frame 01 of every
  loop as a **valid standalone pose**, never a mid-stride in-between.
- **`highContrast`:** ships a per-sprite 1 px outline variant, not a CSS filter — filters
  destroy pixel art.
- Functional colour (§6.1) is **always paired with a shape**: zone markers differ by
  silhouette as well as hue, so the four danger tiers survive colour-blindness.

### 12.5 Loading

Ground tiles, the town atlas, and Tier A hunter animations load eagerly. Monster, boss,
VFX, and region atlases lazy-load per region on approach. Promotional art never enters the
main bundle. `vite build` already warns at 533 kB of JS; art must not compound it.

---

## 13. Acceptance criteria — global gate

Every asset, every category. Category specs add to this list; they never subtract.

- [ ] Filename and asset ID match §9.1 / §9.2 exactly
- [ ] `<subject>` matches a real content `id` in `src/data/**` where one exists
- [ ] Lands in the §9.3 folder
- [ ] `@1x` and `@2x` both exported; `@2x` is exactly 2× in both dimensions
- [ ] Background fully transparent; binary alpha on the silhouette edge
- [ ] No baked shadow (the `_shadow` sprite is generated at build time, O-2)
- [ ] Colour count within the §6.3 cap
- [ ] No §6.1 functional hue used decoratively
- [ ] Shading agrees with `REF_LIGHTING_BALL`
- [ ] Sits correctly on `REF_GRID_PROJECTION` at its declared footprint
- [ ] Scale agrees with `REF_SCALE_LINEUP`
- [ ] Pivot declared in the sidecar JSON and verified against the ground plane
- [ ] Passes the black-fill silhouette test
- [ ] Passes the 0.55 zoom test
- [ ] Frame 01 of every loop is a valid standalone pose (`reducedMotion`)
- [ ] No text, UI, frame, border, watermark, or signature
- [ ] Source `.aseprite` committed with named layers
- [ ] Reviewed in-engine, in the world, at zoom 0.55 / 1.0 / 1.8 — not only in isolation

---

## 14. Category index

Full asset enumeration lives in `art/ASSET_REGISTRY.md`. Detailed per-asset specifications
live in `art/specs/`.

| # | Category | Spec file | Anchored to |
|---|---|---|---|
| 00 | Production optimization | `specs/00-production-optimization.md` | Cross-cutting — read before any category |
| 01 | World environment | `specs/01-world-environment.md` | `src/data/world/regions.json` — 4 regions, 4 zone tiers |
| 02 | Hunter characters | `specs/02-hunter-characters.md` | `src/data/archetypes.json` — 3 archetypes |
| 03 | Monsters and bosses | `specs/03-monsters.md` | `src/data/combat/monsters.json` — 11 monsters |
| 04 | Buildings | `specs/04-buildings.md` | `src/data/town/buildings.json` — 20 buildings, 10 categories |
| 05 | Props and decorations | `specs/05-props.md` | `REQ-CW-006`, `REQ-TWN-002` stage dressing |
| 06 | Weapons and equipment | `specs/06-equipment.md` | `src/data/items/item-types.json` — 15 types, 7 slots |
| 07 | Resources and loot | `specs/07-resources.md` | `src/data/economy/resources.json` — 8 resources |
| 08 | VFX | `specs/08-vfx.md` | `src/data/combat/statuses.json`, skills, `REQ-BOS-001` telegraphs |
| 09 | UI icons | `specs/09-ui-icons.md` | Attributes, roles, jobs, notification kinds |
| 10 | Map markers | `specs/10-map-markers.md` | Zone tiers, knowledge tiers, node kinds |
| 11 | Animations | `specs/11-animations.md` | §10, per-skeleton state machines |
| 12 | Loading and promotional | `specs/12-promotional.md` | `ART_DIRECTION.md` MVP asset sequence |
