# Hunter's Guild: Frontier — Asset Registry

**Status:** PROPOSED, 2026-09-12. Companion to `art/ART_BIBLE.md`.

Every asset group the game needs, anchored to a real content `id` in `src/data/**`.
Detailed per-asset specifications live in `art/specs/` — all twelve categories are specified,
plus `specs/00-production-optimization.md`. Full generation prompts for every asset are in
`art/prompts/` (357 prompts; `npm run art:prompts -- --check` verifies every content id has one).

**Status vocabulary:** `SPEC` (specified, not produced) · `WIP` · `REVIEW` · `DONE` · `BLOCKED`
**Priority:** `P0` = the MVP proof cycle · `P1` = first playable frontier · `P2` = depth · `P3` = polish

---

## Production gate order

Nothing in P0 may begin until the four gate reference sheets are approved
(`ART_BIBLE.md` §11): `REF_PALETTE_MASTER`, `REF_LIGHTING_BALL`, `REF_GRID_PROJECTION`,
`REF_SCALE_LINEUP`.

The P0 set is exactly the proof cycle named at the end of
`docs/CONTINUOUS_WORLD_ARCHITECTURE.md`:

> service → road → Blue field → combat in place → immediate personal loot → physical return
> → sale to Guild → recovery

Anything not on that path is P1 or later, however tempting.

---

## 00 — Reference sheets (`REF`) · `art/reference-sheets/`

| ID | Priority | Status | Notes |
|---|---|---|---|
| `REF_PALETTE_MASTER` | P0 | DONE | **Gate — approved 2026-09-12.** Constructed by `art/tools/reference.mjs` from §6.2 |
| `REF_LIGHTING_BALL` | P0 | SPEC | **Gate.** Sphere/cube/cylinder under the §7 rig |
| `REF_GRID_PROJECTION` | P0 | DONE | **Gate — approved 2026-09-12.** Constructed exactly by `art/tools/reference.mjs` |
| `REF_SCALE_LINEUP` | P0 | SPEC | **Gate.** Every scale class on one baseline |
| `REF_MATERIAL_STUDY` | P0 | SPEC | 9 materials × 5-step ramps |
| `REF_HUNTER_TURNAROUND` | P0 | SPEC | 3 archetypes × 4 facings, layers separated |
| `REF_SILHOUETTE_SHEET` | P1 | SPEC | Rolling — updated as characters land |
| `REF_ZONE_MOOD` | P1 | SPEC | One clearing in Blue/Yellow/Red/Black |
| `REF_BUILDING_TIERS` | P1 | SPEC | `guild_hall` T1/T2/T3, tier reads without a label |

---

## 01 — World environment (`ENV`) · `art/environment/`

Anchored to `src/data/world/regions.json`: 4 regions, 4 zone tiers, 4 node kinds.

| ID | Content id | Priority | Groups | Notes |
|---|---|---|---|---|
| `ENV_TOWN_GROUND` | — | P0 | 9 tiles | Grass, packed dirt, gravel, plaza stone, mud |
| `ENV_ROAD` | — | P0 | 16 tiles | Auto-tiled road set. `REQ-CW-006`: roads affect movement |
| `ENV_TOWN_EDGE` | — | P0 | 8 tiles | Palisade line, gate, treeline transition |
| `ENV_VERDANT_REACH` | `verdant_reach` | P0 | 24 tiles + 12 props | Blue. The proof-cycle field |
| `ENV_WATER` | — | P1 | 12 tiles | Animated 4-frame shoreline + surface |
| `ENV_COLDWATER_QUARRY` | `coldwater_quarry` | P1 | 24 tiles + 12 props | Yellow. Mineral, exposed |
| `ENV_ASHFALL_BARROWS` | `ashfall_barrows` | P2 | 24 tiles + 14 props | Black. Violet signal only on threat |
| `ENV_SUNKEN_CHOIRHOUSE` | `the_sunken_choirhouse` | P2 | 24 tiles + 14 props | Red. Drowned, still |
| `ENV_REGION_BORDER` | — | P2 | 6 | Natural-border cuts, `REQ-CW-004` |
| `ENV_HUNTING_GROUND` | `gate_thickets`, `old_orchard` | P1 | 12 | Just outside the walls, `REQ-TWN-007` |
| `ENV_WEATHER_OVERLAY` | — | P3 | 6 | Runtime tint/particle, `REQ-CW-013`. Not re-authored terrain |

---

## 02 — Hunter characters (`HUN`) · `art/characters/`

**Hunters are procedurally generated** (`GuildCommands.foundGuild`, `recruit`) from 5 name/
origin pools. There is no fixed cast. Art is therefore a **paper-doll layer system over 3
archetype skeletons**, never bespoke per-hunter sprites. Full spec: `specs/02-hunter-characters.md`.

| ID | Content id | Priority | Groups | Notes |
|---|---|---|---|---|
| `HUN_SKEL_VANGUARD` | `vanguard` | P0 | 5 states × 2 facings | Broad, grounded, low mass |
| `HUN_SKEL_ADEPT` | `adept` | P0 | 5 states × 2 facings | Tall, robed, vertical line |
| `HUN_SKEL_RANGER` | `ranger` | P0 | 5 states × 2 facings | Lean, asymmetric, bow arc |
| `HUN_LAYER_BODY` | — | P0 | 6 | Skin ramps, build variation |
| `HUN_LAYER_HAIR` | — | P0 | 10 × 6 colours | Silhouette-bearing |
| `HUN_LAYER_OUTFIT_FRONTIER` | `frontier` | P0 | 3 archetypes × 3 tiers | Default pool |
| `HUN_LAYER_OUTFIT_MARSHFOLK` | `marshfolk` | P1 | 3 × 3 | Oilcloth, reed, muted green |
| `HUN_LAYER_OUTFIT_HIGHLAND` | `highland` | P1 | 3 × 3 | Wool, fur, iron pins |
| `HUN_LAYER_OUTFIT_COLLEGIUM` | `collegium` | P1 | 3 × 3 | Layered cloth, belts, cases |
| `HUN_LAYER_OUTFIT_FARROAD` | `farroad` | P2 | 3 × 3 | Deliberately heterogeneous |
| `HUN_LAYER_PACK` | — | P0 | 4 | Travel pack, quiver, satchel, none |
| `HUN_OVERLAY_CONDITION` | — | P1 | 6 | Fatigue, hunger, low morale, injured — `REQ-HUN-011` |
| `HUN_OVERLAY_ROLE_PIP` | — | P0 | 5 | Tank/healer/damage/support/control, §6.1 hues + shape |
| `NPC_SERVICE` | `REQ-TWN-004` | P1 | 5 | Recruiter, merchant, crafter, researcher, service worker. **Service only, no life sim** |

---

## 03 — Monsters and bosses (`MON`) · `art/monsters/`

Anchored to `src/data/combat/monsters.json` — 11 monsters, tiers `trash` / `elite` / `boss`.

| ID | Content id | Tier | Region | Priority | Notes |
|---|---|---|---|---|---|
| `MON_MOSS_CRAWLER` | `moss_crawler` | trash | Verdant Reach (Blue) | P0 | Melee, no element. Proof-cycle enemy |
| `MON_THICKET_WASP` | `thicket_wasp` | trash | Verdant Reach (Blue) | P0 | Melee, swarms 2–3 |
| `MON_QUARRY_HOUND` | `quarry_hound` | trash | Coldwater Quarry (Yellow) | P1 | `hamstring` → slow |
| `MON_SLAG_THROWER` | `slag_thrower` | elite | Coldwater Quarry (Yellow) | P1 | Ranged fire, `molten_arc` telegraph 1.2 s |
| `MON_MIRE_WEAVER` | `mire_weaver` | elite | Sunken Choirhouse (Red) | P2 | Frost, `binding_silk` telegraph 1.0 s, self-heal |
| `MON_ROT_SHAMBLER` | `rot_shambler` | elite | Sunken Choirhouse (Red) | P2 | `sundering_blow` telegraph 0.9 s |
| `MON_BRACKEN_STALKER` | `bracken_stalker` | elite | Ashfall Barrows (Black) | P2 | `rend` → bleed |
| `MON_CAIRN_ARCHER` | `cairn_archer` | elite | Ashfall Barrows (Black) | P2 | Ranged silhouette must read at distance |
| `MON_HOLLOW_CHANTER` | `hollow_chanter` | elite | Ashfall Barrows (Black) | P2 | Frost healer, `mend_kin` |
| `MON_WARDEN_OF_ASH` | `warden_of_ash` | boss | Ashfall Barrows (Black) | P2 | 2×2. Fire. 2 phases, 2 telegraphs |
| `MON_THE_DROWNED_CHOIR` | `the_drowned_choir` | **world boss** | Ashfall Barrows (Black) | P2 | 3×3. Frost. 2 phases, 3 telegraphs. `REQ-BOS-003`, `REQ-CW-013` |
| `MON_HENCHMAN_SET` | `worldBoss.json` | — | Ashfall Barrows | P3 | Region-appropriate henchmen, `REQ-CW-013` |

---

## 04 — Buildings (`BLD`) · `art/buildings/`

Anchored to `src/data/town/buildings.json` — 20 buildings, 10 categories, 1–3 tiers each,
**4 rotations each** (`REQ-CW-006`). Irregular footprints allowed.

| ID | Content id | Category | Tiers | Priority |
|---|---|---|---|---|
| `BLD_GUILD_HALL` | `guild_hall` | management | 3 | **P0** |
| `BLD_BUNKHOUSE` | `bunkhouse` | housing | 2 | **P0** |
| `BLD_GRANARY` | `granary` | services | 2 | **P0** |
| `BLD_FIELD_KITCHEN` | `field_kitchen` | services | 2 | **P0** |
| `BLD_INFIRMARY` | `infirmary` | healing | 3 | **P0** |
| `BLD_MARKET_STALL` | `market_stall` | economy | 1 | **P0** |
| `BLD_WELL` | `well` | services | 1 | P1 |
| `BLD_LONGHOUSE` | `longhouse` | housing | 2 | P1 |
| `BLD_SMITHY` | `smithy` | crafting | 2 | P1 |
| `BLD_PALISADE` | `palisade` | defense | 2 | P1 |
| `BLD_WATCHTOWER` | `watchtower` | defense | 2 | P1 |
| `BLD_RECRUITMENT_HALL` | `recruitment_hall` | recruitment | 1 | P1 |
| `BLD_LUMBER_YARD` | `lumber_yard` | economy | 2 | P1 |
| `BLD_HUNTING_CAMP` | `hunting_camp` | economy | 2 | P1 |
| `BLD_BATHHOUSE` | `bathhouse` | services | 2 | P2 |
| `BLD_TANNERY` | `tannery` | crafting | 1 | P2 |
| `BLD_QUARRY_CAMP` | `quarry_camp` | economy | 2 | P2 |
| `BLD_RESEARCH_ANNEX` | `research_annex` | research | 2 | P2 |
| `BLD_DRILL_YARD` | `drill_yard` | management | 2 | P2 |
| `BLD_SHRINE` | `shrine` | revival | 1 | P2 |

**Buildings are a modular kit, not 37 hand-drawn structures** (technique O-6). Author **96
kit parts** — foundations, walls, roofs, corners, details, and ten category identity pieces —
plus one JSON recipe per tier-variant in `src/data/town/building-art.json`. Damage and
construction are shared overlays; shadows are generated from sprite alpha.

Worked example: `guild_hall` costs **4 rotations × 3 tiers of recipe data** and 2 animated
details, not 40 sprites. A 21st building costs a recipe and no new art.
Full spec: `specs/04-buildings.md`.

---

## 05 — Props and decorations (`PRP`) · `art/props/`

`REQ-CW-006` (decorations and minor landscaping matter) and `REQ-TWN-002` / `REQ-CHR-002`
(the town visibly remembers).

| ID | Priority | Groups | Notes |
|---|---|---|---|
| `PRP_TOWN_BASIC` | P0 | 14 | Barrel, crate, sack, cart, bench, firepit, woodpile, rack |
| `PRP_LIGHTING` | P0 | 6 | Lantern post, brazier, hanging lamp — self-illuminated |
| `PRP_SIGNAGE` | P1 | 8 | Notice board, guild banner, shop sign, gate sign |
| `PRP_LANDSCAPING` | P1 | 12 | Planter, hedge, path edge, flowerbed, fence |
| `PRP_TREES` | P0 | 9 | 3 species × 3 sizes. Replaces `worldView.ts` CSS trees |
| `PRP_HISTORY` | P2 | 10 | **Trophy mount, plaque, repaired wall patch, memorial stone.** `REQ-CHR-002` |
| `PRP_MONUMENT` | P2 | 4 | Guild Monument tiers — existing system |
| `PRP_FIELD_CAMP` | P1 | 8 | Trail marker, camp, cairn, supply cache. Makes knowledge visible |
| `PRP_RUBBLE` | P1 | 6 | Post-attack damage dressing, `REQ-TWN-008` |

---

## 06 — Weapons and equipment (`EQP`) · `art/equipment/`

Anchored to `src/data/items/item-types.json` — 15 types across 7 slots — and
`src/data/items/rarities.json` — 6 rarities.

**Two distinct needs, do not conflate:**
- **World layer** — a paper-doll sprite composited onto a hunter, 4 facings. Silhouette only.
- **Inventory icon** — a 48×48 icon for the Build Identity Dashboard (`REQ-UX-003`).

| ID | Slot | Types | Priority | Notes |
|---|---|---|---|---|
| `EQP_WEAPON_BLADE` | weapon | `blade` | P0 | |
| `EQP_WEAPON_BOW` | weapon | `bow` | P0 | |
| `EQP_WEAPON_STAVE` | weapon | `stave` | P0 | |
| `EQP_WEAPON_MAUL` | weapon | `maul` | P1 | |
| `EQP_OFFHAND` | offhand | `shield` `focus` | P0 | |
| `EQP_BODY` | body | `cuirass` `robes` | P0 | Paper-doll outfit layer |
| `EQP_HEAD` | head | `helm` | P1 | Must not destroy the hair silhouette read |
| `EQP_HANDS` | hands | `gauntlets` `wraps` | P2 | Icon only — invisible at world scale |
| `EQP_FEET` | feet | `greaves` `boots` | P2 | Icon only |
| `EQP_TRINKET` | trinket | `charm` `sigil` | P2 | Icon only |

**Rarity tiers:** rarity is signalled by the §6.1 hue on the **icon border and socket pips
only**. `REQ-EQP-007`: legendary equipment changes how a build works — its world sprite gets
a distinct silhouette, never a glow. No rainbow weapons.
**Refinement** (`REQ-EQP-005`) adds small authored wear/quality marks, not particles.

---

## 07 — Resources and loot (`RES`) · `art/resources/`

Anchored to `src/data/economy/resources.json` — exactly 8 resources. Do not invent more.

| ID | Content id | Category | Priority |
|---|---|---|---|
| `RES_GOLD` | `gold` | currency | **P0** |
| `RES_FOOD` | `food` (Provisions) | core | **P0** |
| `RES_MATERIALS` | `materials` | construction | **P0** |
| `RES_IRON` | `iron` | crafting | P1 |
| `RES_SALVAGE` | `salvage` | crafting | P1 |
| `RES_WARDING_SALT` | `warding_salt` | specialized | P2 |
| `RES_ESSENCE` | `essence` (Monster Essence) | specialized | P2 |
| `RES_INSIGHT_CRYSTAL` | `insight_crystal` | rare | P2 |
| `RES_DROP_WORLD` | — | — | **P0** |

`RES_DROP_WORLD` is the physical drop/pickup presentation required by `REQ-CW-011`:
a brief arc, a landing, a pickup. **Exactly one copy** — loot transfers to hunter inventory
immediately, and there is never a second collectible object left behind.

Each resource ships: a 32×32 world drop sprite, a 48×48 UI icon, and a 24×24 compact icon
for the resource bar already rendered in `worldView.refresh()`.

---

## 08 — VFX (`VFX`) · `art/vfx/`

Anchored to `src/data/combat/statuses.json` — **only 4 statuses exist**: `burn`, `bleed`,
`slow`, `stun`. `REQ-CBT-008` lists more as a design target; do not author unapproved ones.

| ID | Content id | Priority | Frames | Notes |
|---|---|---|---|---|
| `VFX_HIT_PHYSICAL` | — | **P0** | 5 | |
| `VFX_HIT_MAGIC` | — | P1 | 5 | |
| `VFX_STATUS_BURN` | `burn` | P1 | 6 loop | |
| `VFX_STATUS_BLEED` | `bleed` | P1 | 6 loop | Restrained. Anti-goal: gore |
| `VFX_STATUS_SLOW` | `slow` | P1 | 6 loop | |
| `VFX_STATUS_STUN` | `stun` | P1 | 6 loop | |
| `VFX_DOWNED` | — | **P0** | 4 loop | `REQ-CBT-012`, must read at 0.55 zoom |
| `VFX_RESCUE` | — | P1 | 6 | `REQ-CBT-013` |
| `VFX_LOOT_PICKUP` | — | **P0** | 6 | `REQ-CW-011` |
| `VFX_LEVEL_UP` | — | P1 | 8 | |
| `VFX_TELEGRAPH_AREA` / `_TARGET` | — | P1 | 2 + 2 | `REQ-BOS-001`. Fill driven by `telegraphSeconds` in code — one asset covers all nine telegraphed skills |
| `VFX_WORLD_BOSS_ARRIVAL` | `drowned_choir` | P2 | 12 | `REQ-CW-013`. Terrain stays intact |
| `VFX_BUILD_COMPLETE` | — | P1 | 6 | |
| `VFX_SELECTION_RING` | — | **P0** | 4 loop | Ground-projected ellipse in true 2:1 |

**Rule:** VFX never obscures the silhouette it is attached to. Combat must stay readable
while it is happening — there is no combat camera to fall back on.

---

## 09 — UI icons (`ICO`) · `art/ui/`

| ID | Anchored to | Count | Priority |
|---|---|---|---|
| `ICO_ATTRIBUTE` | `REQ-HUN-001` STR AGI VIT DEX INT LUK | 6 | **P0** |
| `ICO_ROLE` | tank healer damage support control | 5 | **P0** |
| `ICO_RESOURCE` | `economy/resources.json` + residents | 9 | **P0** |
| `ICO_CONDITION` | hunger fatigue morale (×2) friendship | 5 | **P0** |
| `ICO_NOTIFICATION` | `ui/notifications.json` — 15 kinds | 15 | P1 |
| `ICO_JOB` | `town/jobs.json` — 13 jobs | 13 | P1 |
| `ICO_BUILDING_CATEGORY` | `buildings.json` categories | 10 | P1 |
| `ICO_DEPARTMENT` | `town/departments.json` | 5 | P2 |
| `ICO_PERSONALITY` | `personalities.json` | 6 | P2 |
| `ICO_EQUIPMENT_SLOT` | `item-types.json` slots | 7 | P1 |
| `ICO_STATUS` | `combat/statuses.json` | 4 | P1 |
| `ICO_RARITY_FRAME` | `items/rarities.json` | 6 | P1 |
| `ICO_CONTROL` | world tools, speed 1×/2×/4×, camera, notices, settings, close | 13 | **P0** |

Icons are authored at **48×48 @1x** and downsampled to 32 and 24. They are pixel art on the
same grid as the world — not a separate flat-vector icon language.
`REQ-UX-002`: Easy/Advanced changes wording, never iconography.

---

## 10 — Map markers (`MRK`) · `art/ui/`

| ID | Anchored to | Count | Priority |
|---|---|---|---|
| `MRK_ZONE` | `regions.json` `zoneTiers` — blue/yellow/red/black | 4 | **P0** |
| `MRK_KNOWLEDGE` | Rumor → Discovered → Experienced → Mastered (Unknown has no marker) | 4 | P1 |
| `MRK_NODE_KIND` | `nodeKinds` — combat/rest/discovery/event | 4 | P1 |
| `MRK_REGION` | 4 regions | 4 | P1 |
| `MRK_PARTY` | Party position on the world map | 3 | **P0** |
| `MRK_ALERT` | Camera alert-jump targets | 4 | P1 |
| `MRK_LOCKED` | `REQ-WLD-002` unlock requirements | 2 | P1 |
| `MRK_QUEUED` | `REQ-CW-015` assignment waiting on recovery | 1 | P1 |
| `MRK_BOOKMARK` | Camera bookmarks | 1 | P2 |

**Accessibility rule (`ART_BIBLE.md` §12.4):** the four zone markers must differ by
**silhouette as well as hue**, so danger tier survives colour-blindness. Colour alone is a
rejection.

---

## 11 — Animations (`ANM`) · sheets live beside their subject

Not a separate art category so much as the state matrix applied to categories 02, 03, and 14
of the props set. Full matrix in `ART_BIBLE.md` §10.2 and `specs/11-animations.md`.

| Group | Subjects | States | Priority |
|---|---|---|---|
| `ANM_HUNTER_TIER_A` | 3 skeletons × 2 authored facings | idle, walk, attack, hit, downed | **P0** |
| `ANM_MONSTER_TIER_A` | `moss_crawler`, `thicket_wasp` | idle, walk, attack, hit, death | **P0** |
| `ANM_HUNTER_TIER_B` | 3 skeletons | gather, work, rest, cast, run | P1 |
| `ANM_BUILDING_IDLE` | Smoke, forge glow, banner, water | 4–6 loop | P1 |
| `ANM_HUNTER_TIER_C` | 3 skeletons | death, rescue, carry, sell, celebrate, injured_walk | P2 |
| `ANM_BOSS` | `warden_of_ash`, `the_drowned_choir` | + phase transitions, telegraphs | P2 |

---

## 12 — Loading and promotional (`PRM`) · `art/promotional/`

Follows the MVP asset sequence already approved in `ART_DIRECTION.md`. Two of these exist.

| ID | Priority | Status | Notes |
|---|---|---|---|
| `PRM_TOWN_OVERVIEW` | — | **DONE** | `generated/guild-town-overview-v1.png`. **Needs re-export: 3.0 MB** |
| `PRM_VERDANT_VISTA` | — | **DONE** | `generated/verdant-reach-vista-v1.png`. **Needs re-export: 3.0 MB** |
| `PRM_GUILD_HALL_EXTERIOR` | P2 | SPEC | `ART_DIRECTION.md` asset 02 |
| `PRM_BLACK_ZONE_VISTA` | P2 | SPEC | Real danger, no horror excess |
| `PRM_TITLE_SCREEN` | P2 | SPEC | Quiet upper-left space for title overlay |
| `PRM_REGION_CARD` | P3 | SPEC | 4, one per region. Place and mood only — **no tips** (`REQ-UX-001`) |
| `PRM_EQUIPMENT_REVEAL` | P3 | SPEC | `ART_DIRECTION.md` asset 06 |

> **Open issue.** The two shipped anchors are ~3 MB each, 6 MB total, against a 4 MB @1x
> budget for the *entire* shipped art payload (`ART_BIBLE.md` §9.4). They must be re-exported
> as sized, compressed WebP/PNG and lazy-loaded, or dropped from the bundle.

---

## Volume — after the optimization pass

The naive column is what a per-subject-per-state-per-facing count produces. The optimized
column is the plan. Techniques are specified in `specs/00-production-optimization.md`.

| Category | Naive | **Optimized** | Main technique |
|---|---|---|---|
| Reference sheets | 9 | 9 | — |
| World environment | 200 | 72 | O-5 palette swap |
| Hunter characters | 700 | 214 | O-3 mirror, O-5, O-7 |
| Monsters | 420 | 148 | O-3 mirror, O-2 shadows |
| Buildings | 640 | **108** | **O-6 modular kit** |
| Props | 160 | 62 | O-2, O-5 |
| Equipment | 190 | 54 | **O-7 cut what the camera cannot see** |
| Resources | 30 | 24 | — |
| VFX | 130 | 58 | O-5 |
| UI icons | 100 | 100 | O-5, O-1 (counted exactly in `specs/09`) |
| Map markers | 30 | 27 | Runtime composition (counted in `specs/10`) |
| Promotional | 20 | 14 | — |
| **Total authored `@2x`** | **~2,630** | **~720** | **−73%** |
| `@1x` | +2,630 by hand | **0 by hand** | O-1 build step |

**P0 subset: ~700 → ~200 authored files.**

The three largest savings, in order:

1. **O-6, the building kit** — 640 → 108, and a 21st building costs a JSON recipe instead of
   32 sprites. Full spec in `specs/04-buildings.md`.
2. **O-1 + O-2, build-time generation** — `@1x` downsampling and contact shadows are
   functions of the `@2x` art, not separate work. Together they remove ~2,900 hand-authored files.
3. **O-7, cutting the invisible** — gauntlets, boots and trinkets occupy 2–4 px at the 0.55
   zoom floor. They ship as inventory icons with no world layer.

### Runtime, not just file count

`REQ-TEC-011` ranks rendering *below* simulation, so the art must not eat the frame budget
the AI needs. Two fixes are available today and need no new art at all:

| | Fix | Win |
|---|---|---|
| **O-11** | Re-export the two 3 MB PNGs in `art/generated/` as sized WebP | **~5.6 MB** — larger than the entire art budget |
| **O-12** | Round the camera transform to whole device pixels | Stops pixel shimmer while panning; one line |
