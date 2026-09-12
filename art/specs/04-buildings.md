# Category 04 — Buildings

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/00-production-optimization.md` (technique O-6)
**Scope:** All 20 buildings in `src/data/town/buildings.json` — 37 tier-variants, 10 categories
**Camera:** Fixed 2:1 dimetric, no rotation, zoom 0.55–1.8
**Output style:** Modular kit parts + JSON composition recipes

---

## 0. Why this category is a kit and not 640 sprites

The naive count is brutal: 37 tier-variants × 4 rotations = 148 base sprites, plus 148
damaged, plus construction, plus shadows — ~640 files. And it buys nothing durable: the 21st
building would cost another 32.

**The facts that make a kit obviously correct here:**

| Fact | Source | Consequence |
|---|---|---|
| Grid is **12 × 9** | `balance/town.json` `grid` | The whole town is ≤ 108 tiles. Buildings are small |
| Largest footprint is **3 × 3** | `buildings.json` | No building needs bespoke massing |
| Only **4 distinct footprints** exist | `1×1, 2×1, 2×2, 3×1, 3×2, 3×3, 4×2` | Six, and four cover 32 of 37 variants |
| Tier reads through **material, not shape** | `ART_BIBLE.md` §5.2, `ART_DIRECTION.md` | Tier is a part swap |
| Buildings **rotate four ways** | `REQ-CW-006` | Rotation must be cheap or it dominates cost |
| Buildings **move for gold** | `REQ-CW-006` | Placement is fluid; nothing can be hand-placed art |

A kit turns all of that into an advantage. **96 kit parts + 37 JSON recipes** replaces 640
sprites, and a 21st building becomes a recipe with no new art.

---

## 1. The kit

### 1.1 Part classes

All parts author at `@2x`, on the 64 × 32 `@1x` tile grid, under the `ART_BIBLE.md` §7
lighting rig. Every part is a **half-tile or full-tile module** so recipes snap without
sub-pixel drift.

| Class | Parts | × Tiers | Total | Notes |
|---|---|---|---|---|
| `FND` Foundation | 4 (flat, edge, corner, step) | 3 | 12 | Grounds the building; carries the footprint |
| `WAL` Wall segment | 5 (plain, door, window, shutter, half-timber) | 3 | 15 | The tier workhorse |
| `COR` Corner post | 2 (outer, inner) | 3 | 6 | |
| `ROF` Roof | 6 (gable-L, gable-R, hip, ridge, corner, eave) | 3 | 18 | Thatch → shingle → tile |
| `DTL` Shared detail | 8 (chimney, lantern, banner, sign, barrel rack, woodpile, steps, awning) | 2 | 16 | Tier 2/3 only |
| `IDN` Category identity | 10 (one per `buildings.json` category) | — | 10 | **The silhouette differentiator — see §1.3** |
| `OVR` Damage decal | 12 | — | 12 | O-4. Seeded by `instanceId` |
| `OVR` Scaffold | 3 (1×1, 2×2, 3×3) | — | 3 | O-4 construction state |
| `ANM` Animated detail | 4 (smoke, forge glow, banner sway, water) | — | 4 | 4–6 frame loops |
| | | | **96** | |

Each part is authored in **2 rotations and mirrored to 4** (O-3), except `IDN` parts with a
functional face, which are authored in all four — see §1.4.

### 1.2 Tier materials

`REQ-TWN-002` and `ART_DIRECTION.md`: tier reads from silhouette, material, banners, and
lighting — **never a floating level label**.

| Tier | Wall | Roof | Foundation | Details |
|---|---|---|---|---|
| T1 | Rough log, raw plank, canvas | Thatch, canvas | Packed earth, loose stone | None |
| T2 | Dressed timber, half-timber infill | Wood shingle | Laid stone course | Shutters, chimney, lantern |
| T3 | Timber + cut stone, banded iron | Clay tile | Cut stone plinth, steps | Second storey, guild banner, glazing, trophy mount |

### 1.3 Category identity parts — the most important 10 files in this category

A kit's failure mode is that every building looks like the same shed. `IDN` parts are the
cure, and they are the reason a player can read the town at a glance without labels — which
is `REQ-PRIME-006` and `REQ-CW-007` working as intended.

Each of the 10 categories in `buildings.json` gets **one silhouette-bearing identity part**
that breaks the roofline:

| Category | `IDN` part | Silhouette read |
|---|---|---|
| `management` | Bell tower + map table under awning | Tallest vertical in town |
| `housing` | Row of shuttered windows + washing line | Long, low, repetitive rhythm |
| `services` | Open counter + steam vent | Open front, no solid wall |
| `healing` | Covered porch + hanging herb bundles | Deep eave, shadowed front |
| `revival` | Standing stone + brazier | Asymmetric, stone not timber |
| `crafting` | Forge chimney + tool rack | Chimney breaks the roofline |
| `economy` | Loading platform + crates | Wide flat apron at ground level |
| `research` | Clerestory windows + roof vane | Raised roof lantern |
| `defense` | Crenellation + shield rack | Hard horizontal top edge |
| `recruitment` | Notice board + open gate arch | Framed opening |

**Acceptance gate for this set:** ten buildings placed side by side, black-filled, at 55%
zoom — a player must name all ten categories. If they cannot, the kit has failed and no
amount of texture will save it.

### 1.4 Rotation rules

| Building | Rotations authored | Why |
|---|---|---|
| `smithy` | **4** | Chimney and forge are on one wall; mirroring puts the fire outside |
| `watchtower` | **4** | External stair has a fixed side |
| `market_stall` | **4** | The counter face must face the customer |
| `guild_hall` | **4** | Hero building; bell tower and entry stair are asymmetric |
| All other 16 | **2 + mirror** | Bilaterally symmetric |

---

## 2. Recipe schema

A building tier-variant is **data, not art**. Recipes live beside the content they describe.

```jsonc
// src/data/town/building-art.json
{
  "$comment": "Art composition recipes (O-6). One entry per building tier-variant.
               Parts resolve against art/buildings/kit/. Offsets are in @1x pixels
               from the building's footprint origin (north corner of the grid rect).",
  "recipes": {
    "bunkhouse": {
      "footprint": { "width": 3, "height": 2 },
      "rotationsAuthored": 2,
      "tiers": {
        "1": {
          "material": "t1",
          "parts": [
            { "part": "FND_FLAT",    "repeat": "footprint" },
            { "part": "WAL_PLAIN",   "at": [0, 0], "repeat": 3, "axis": "x" },
            { "part": "WAL_DOOR",    "at": [1, 0] },
            { "part": "ROF_GABLE_L", "at": [0, 0], "repeat": 3, "axis": "x" },
            { "part": "IDN_HOUSING", "at": [2, 0] }
          ]
        },
        "2": {
          "material": "t2",
          "inherits": "1",
          "add": [
            { "part": "DTL_CHIMNEY", "at": [0, 1] },
            { "part": "DTL_LANTERN", "at": [1, 0] },
            { "part": "WAL_SHUTTER", "replaces": "WAL_PLAIN" }
          ]
        }
      }
    }
  }
}
```

`inherits` + `add` + `replaces` is what makes tiering nearly free: T2 is T1 with a material
swap and four added parts, expressed in nine lines of JSON.

**Build step:** recipes bake to flattened sprites at build time and pack into `atlas_town`
(O-8). Nothing composites at runtime — a building changes only when it is built, upgraded,
moved, or damaged.

---

## 3. Asset specifications

---

### `BLD_KIT_WALL`

**1. Name / ID** — Wall segment set · `BLD_KIT_WALL`

**2. Gameplay purpose** — The structural body of every building in the town. Carries tier
legibility (`REQ-TWN-002`) and the door/window placement that tells a player where hunters
physically enter (`REQ-TWN-001`).

**3. Visual description** — One-tile-wide wall modules in three material tiers. Honest
frontier construction: visible joinery, real thickness, boards that do not line up perfectly.
T1 is raw and gappy, T2 is dressed and shuttered, T3 adds a cut-stone base course and iron
banding. Walls are **built**, never decorated.

**4. Views / states** — 5 variants × 3 tiers × 2 authored rotations = **30 sprites**
(mirrored to 4 rotations at build time). No animation.

**5. Style / palette** — `ART_BIBLE.md` §2. Town palette §6.2: warm timber `#8a5c3b`, dark
timber `#54382a`, stone `#8d8a80`, thatch `#c2a05e`. No functional hue (§6.1).

**6. Format / resolution** — PNG-8 + alpha. Cell 128 × 96 `@2x` (64 × 48 `@1x`) — one tile
wide, wall height plus eave clearance.

**7. Transparency** — Fully transparent. Binary alpha on the silhouette edge. No shadow (O-2).

**8. Layering / pivot** — Pivot `(32, 32)` `@1x`: the bottom-centre of the tile diamond the
wall stands on. Draw band = `round(screenY)`. Wall draws above `FND`, below `ROF` and `DTL`.

**9. Naming / path**
```
art/buildings/kit/wall/bld_kit_wal_<variant>_t<N>_<rot>@2x.png
# bld_kit_wal_plain_t1_n@2x.png, bld_kit_wal_door_t2_e@2x.png
```

**10. Variants / tiers** — `plain` `door` `window` `shutter` `halftimber` × T1/T2/T3.

**11. Continuous world** — Every building the player places, rotates, moves, or upgrades is
assembled from these. When a hunter walks to the Cookhouse, `WAL_DOOR` is the pixel they walk
to (`REQ-TWN-001`) — the camera stays outside when they enter
(`CONTINUOUS_WORLD_ARCHITECTURE.md`).

**12. System connections** — `buildings.json` `tiers[].tier` selects material; `footprint`
selects repeat count; `Town.grid.rectFor()` provides placement; `REQ-CW-006` rotation;
`REQ-TWN-008` damage overlays composite on top.

**13. Acceptance criteria** — `ART_BIBLE.md` §13 global gate, plus:
- [ ] Tiles seamlessly with itself along X at any repeat count — no visible seam
- [ ] Three tiers distinguishable **in greyscale** (material and wear, not colour)
- [ ] `WAL_DOOR` reads as an entrance at 0.55 zoom
- [ ] Mirrors cleanly for `E`/`W` with no lighting inversion — **the key kit risk:** a mirrored
      wall must still be lit from upper-left, so lighting is baked to the module, not the pose
- [ ] Composites against all 6 `ROF` parts with no gap or overlap at the eave line
- [ ] Contains no §6.1 functional hue

**14. Generation prompt**
```
<MASTER STYLE PROMPT>

Isometric pixel-art modular wall segment for a frontier town building kit.
One tile wide, tier 2 construction: dressed timber posts with half-timber infill,
a closed wooden shutter, visible joinery and real board thickness. Honest vernacular
carpentry built by people who needed shelter quickly and then improved it —
boards do not line up perfectly, the wood has weathered.
Palette: warm timber brown, dark timber shadow, pale daub infill.
True 2:1 dimetric from above, facing north. Designed to tile seamlessly left and right
with copies of itself, and to meet a roof piece cleanly along the top edge.
64 by 48 pixel cell, wall standing on the bottom tile diamond.
Fully transparent background, single wall module only, no ground, no shadow,
no adjacent buildings, no scenery.

<MASTER NEGATIVE PROMPT> + castle stonework, fantasy tavern, gingerbread trim,
heraldry, stucco, brick, perfectly straight boards, new lumber, whole building
```

**15. Variation prompt**
```
Same module, same tile width, same lighting from upper left, same dimetric angle,
same seam alignment on all four edges.
Change ONLY: [variant to plain / door / window / half-timber] or
[tier to T1 rough logs and gaps | T3 cut stone base course and iron banding].
The piece must still tile seamlessly with every other wall module in the set.
Do not change the wall height, the eave line, or the light direction.
```

**16. Web implementation notes** — Baked into flattened building sprites at build time from
`building-art.json`; packs into `atlas_town` (O-8). Never composited at runtime. When a
building is damaged, the flattened sprite is re-baked once with the seeded damage decals —
not re-composited per frame.

---

### `BLD_KIT_IDENTITY`

**2. Gameplay purpose** — Makes the ten building categories readable from the map without a
label or a click. This is the part set that decides whether the town is legible or a field of
identical sheds, and it is the direct expression of `REQ-PRIME-006` ("the town is a physical,
observable place — never a menu stack").

**3. Visual description** — Ten silhouette-bearing additions per §1.3. Each must **break the
roofline or the ground apron** — an identity part that fits inside the building's box does
not do its job.

**4. Views** — 10 parts, 4 rotations (all authored — every one has a functional face).
Some carry an `ANM` detail: forge glow, chimney smoke, banner sway. **40 sprites + 3 loops.**

**8. Layering** — Draws above `ROF`. Declares its own `zOffset` so a bell tower sorts
correctly against a hunter walking behind the building.

**9. Path** — `art/buildings/kit/identity/bld_kit_idn_<category>_<rot>@2x.png`

**13. Acceptance criteria**
- [ ] **The ten-building line-up test:** all ten black-filled at 55% zoom, a player names
      every category. This is the gate for the entire kit
- [ ] Each part breaks the roofline or ground apron — none fits inside the box
- [ ] Reads correctly on the smallest footprint it is used with (`market_stall` is 2×1)
- [ ] Category colour is **never** the carrier — shape only

**14. Generation prompt** (example: `crafting`)
```
<MASTER STYLE PROMPT>

Isometric pixel-art building identity module for a frontier town kit: a working
smithy's forge chimney with an adjacent open tool rack. Tapered stone-and-brick
chimney rising clearly above the roofline, iron chimney cap, soot staining at the top.
Beside it a simple open timber rack holding tongs, hammers and unfinished stock.
It must read as "things are made here" from a long distance, purely by its shape.
Palette: soot-darkened stone, faded brick red, warm iron, dark timber.
True 2:1 dimetric from above, facing north.
Fully transparent background, module only, no building, no ground, no shadow, no fire.

<MASTER NEGATIVE PROMPT> + whole building, wizard tower, industrial factory,
smokestack, modern brick, gears, steampunk
```

**15. Variation prompt**
```
Same dimetric angle, same lighting from upper left, same palette family,
same scale relative to a one-tile wall module.
Change ONLY the category to [housing / services / healing / revival / economy /
research / defense / recruitment / management].
Each must break the roofline or ground apron differently enough that all ten are
distinguishable as pure black silhouettes at 55 percent scale.
```

---

### `BLD_GUILD_HALL`

**1. ID** — `BLD_GUILD_HALL` · content id `guild_hall`

**2. Gameplay purpose** — The heart of the town (`REQ-TWN-006`), and the only `unique: true`
building that also sets the town's Guild Hall tier
(`providesGuildHallTier: true`), which gates town stage progression in `balance/town.json`.
It is the hero building and the one asset that must carry `ART_DIRECTION.md`'s promise that
the Guild is *worth protecting*.

**3. Visual description** — 3 × 3, the largest and tallest structure in town, with the
`management` identity part (bell tower + map table under awning). Tier names from
`buildings.json` are the brief:

| Tier | Name | The building |
|---|---|---|
| T1 | **Command Post** | *"A table, a map and a ledger. The guild starts here."* Open-sided timber frame, canvas roof, one lantern. Barely a building |
| T2 | **Guild Hall** | *"Departments get rooms of their own."* Enclosed, shuttered, shingled, chimney, guild banner, proper door |
| T3 | **Great Hall** | *"Visible from the treeline."* Two storeys, cut-stone plinth, tile roof, bell tower, glazed windows, trophy mount, banner |

**4. Views / states** — 3 tiers × **4 authored rotations** (asymmetric bell tower and entry
stair) = **12 sprites**, plus 2 `ANM` loops (chimney smoke, banner sway). Damage and
construction come from shared overlays (O-4).

**6. Format** — Baked sprite, `(3+3) × 32 = 192` px wide `@1x`; height `(3+3) × 16 + wall +
24` → T1 ≈ 148, T3 ≈ 200 px.

**8. Pivot** — Bottom-centre of the 3×3 footprint diamond. Declared per tier — T3 is taller,
the pivot does not move.

**10. Variants** — T1/T2/T3 via recipe `inherits`/`add`. Not a separate art order.

**11. Continuous world** — The anchor of every town silhouette from the first minute to
Hunter City. `REQ-TWN-002` forbids a reset: the player must see the Command Post *become* the
Great Hall, with the same footprint and orientation. **The T1→T2→T3 sequence has to read as
the same place improved, never as three different buildings.**

**12. System connections** — `buildings.json` `guild_hall`, `unique`,
`providesGuildHallTier`; `balance/town.json` `stages` requires `guildHallTier` 1/2/3 for
Small Camp → Village → Fortified Town → Hunter City; `REQ-TWN-006` command-center functions;
`Town.stage()` already renders its name in `worldView.renderScene()`.

**13. Acceptance criteria** — global gate, plus:
- [ ] Tallest silhouette in town at every tier
- [ ] **Continuity test:** T1, T2, T3 shown in sequence read as one place improved
- [ ] Tier legible **without** the `T1`/`T2`/`T3` label that `worldView.ts` currently draws —
      the label is a prototype crutch and should be removable once this ships
- [ ] All 4 rotations authored; entry stair and bell tower on the correct side in each
- [ ] `REF_BUILDING_TIERS` reference sheet approved before production

**14. Generation prompt** (T3)
```
<MASTER STYLE PROMPT>

Isometric pixel-art frontier guild hall, the largest building in a small frontier town,
tier 3 "Great Hall". Two storeys of heavy dressed timber on a cut-stone plinth,
clay tile roof, a modest square bell tower breaking the roofline, glazed windows with
iron frames, a broad entry stair, a hanging guild banner, and a mounted monster trophy
above the door. Built up over years by people who kept improving it — additions visible,
not a single unified architectural design. Warm, institutional, and worth defending.
Palette: warm timber brown, dark timber, cut grey stone, faded brick red,
honey lantern gold at the windows, muted banner cloth.
True 2:1 dimetric from above, facing north. Footprint exactly 3 by 3 tiles
on a 64 by 32 pixel tile grid, 192 pixels wide.
Fully transparent background, single building only, no ground beyond its own
foundation, no shadow, no surrounding scenery, no people.

<MASTER NEGATIVE PROMPT> + castle, cathedral, fortress, palace, town hall clocktower,
gothic architecture, stone keep, fantasy guild crest, glowing windows, banners
covering the walls
```

**15. Variation prompt**
```
Same building, same 3 by 3 footprint, same orientation, same palette, same lighting
from upper left, same dimetric angle, same pivot.
Change ONLY the tier:
  T1 "Command Post" — an open-sided timber frame with a canvas roof, a map table,
     a ledger and one lantern. It should look like the beginning of this exact building.
  T2 "Guild Hall" — the same structure enclosed: plank walls, shutters, a shingle roof,
     a chimney, a proper door and a guild banner.
A player must recognise all three as the same place at three points in its life.
Do not move the entrance. Do not change the footprint or the orientation.
```

**16. Web implementation notes** — Baked per tier per rotation into `atlas_town`. Re-baked on
upgrade, which is a rare player-initiated event. `Town.refreshStage()` already runs on
restore and on every change, so the render layer needs only to invalidate the cached sprite
key when `guildHallTier` changes.

---

## 4. Per-building recipe index

All 20, with what each needs beyond the shared kit. `IDN` is implied by `category`.

| Building | Footprint | Tiers | Rot. | Extra parts | Priority |
|---|---|---|---|---|---|
| `guild_hall` | 3×3 | 3 | **4** | Bell tower, entry stair, trophy mount | **P0** |
| `bunkhouse` | 3×2 | 2 | 2 | Washing line | **P0** |
| `granary` | 2×2 | 2 | 2 | Raised floor, vent | **P0** |
| `field_kitchen` | 2×2 | 2 | 2 | Open counter, steam `ANM` | **P0** |
| `infirmary` | 3×2 | 3 | 2 | Covered porch, herb bundles | **P0** |
| `market_stall` | 2×1 | 1 | **4** | Awning, counter, crates | **P0** |
| `well` | 1×1 | 1 | 2 | Winch, bucket | P1 |
| `longhouse` | 4×2 | 2 | 2 | Long roof ridge | P1 |
| `smithy` | 3×2 | 2 | **4** | Forge chimney, glow `ANM`, tool rack | P1 |
| `palisade` | 3×1 | 2 | 2 | Post line, gate variant. **Hand shadow** (O-2) | P1 |
| `watchtower` | 2×2 | 2 | **4** | Crenellation, external stair | P1 |
| `recruitment_hall` | 3×2 | 1 | 2 | Notice board, gate arch | P1 |
| `lumber_yard` | 3×2 | 2 | 2 | Loading apron, log stack | P1 |
| `hunting_camp` | 2×2 | 2 | 2 | Drying rack, firepit | P1 |
| `bathhouse` | 3×2 | 2 | 2 | Steam vent `ANM`, water trough | P2 |
| `tannery` | 2×2 | 1 | 2 | Stretching frames | P2 |
| `quarry_camp` | 3×2 | 2 | 2 | Stone pile, sled | P2 |
| `research_annex` | 3×2 | 2 | 2 | Clerestory, roof vane | P2 |
| `drill_yard` | 3×3 | 2 | 2 | Open ground, posts, weapon rack | P2 |
| `shrine` | 2×2 | 1 | 2 | Standing stone, brazier `ANM` | P2 |

`drill_yard` is a **yard**, not a building: mostly open ground with a fence and equipment.
Its recipe uses `FND` and `DTL` with almost no `WAL` or `ROF` — the kit handles this without
a special case, which is a good sign the part classes are right.

---

## 5. Production order

| Step | Work | Gate |
|---|---|---|
| 1 | `REF_BUILDING_TIERS` — `guild_hall` T1/T2/T3 mocked from draft parts | **Approve before kit production** |
| 2 | `BLD_KIT_FND` + `BLD_KIT_WAL` + `BLD_KIT_ROF`, T1 only | Seam and mirror test |
| 3 | `BLD_KIT_IDENTITY` all 10 | **Ten-building line-up test** |
| 4 | `building-art.json` schema + bake step | Recipes produce real sprites |
| 5 | Six P0 buildings, T1 | First readable town in the world |
| 6 | T2/T3 materials, `DTL`, `ANM` | |
| 7 | `OVR` damage decals + scaffold | `REQ-TWN-008` |
| 8 | P1 and P2 recipes | Data only — no new art |

**Stop-and-review after step 5.** Six buildings on the real 12×9 grid, at 0.55 / 1.0 / 1.8
zoom, is where a kit either proves itself or reveals that every building looks the same. That
review is cheap at six recipes and ruinous at thirty-seven.
