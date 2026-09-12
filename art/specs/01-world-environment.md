# Category 01 — World Environment

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/00-production-optimization.md` (O-1, O-5)
**Scope:** The town ground, roads, the town edge, two hunting grounds, and four regions from
`src/data/world/regions.json`, with their hazards
**Camera:** Fixed 2:1 dimetric, no rotation, zoom 0.55–1.8
**Output style:** Ground tiles, auto-tile sets, ground decals, palette tables

---

## 0. The decision that shapes this category

`REQ-CW-001`: the town, the roads and the wilderness are **one connected world**. So there is
no "town tileset" and "field tileset" in the usual sense — there is one ground system, one
lighting rig, one scale, and a road that literally runs from the Guild Hall door to the Verdant
Reach. Regions differ by **palette, form and hazard**, never by projection, camera or rendering
style. A hunter walking out of the gate must not cross a visible seam in how the world is drawn.

Regions come from data. Nothing here invents a region, a hazard or a zone tier:

| Region | `zoneTier` | Knowledge at start | Hazards (`regions.json`) | Monsters |
|---|---|---|---|---|
| `verdant_reach` | **blue** | experienced | — | `moss_crawler`, `thicket_wasp` |
| `coldwater_quarry` | **yellow** | discovered | `flooded_galleries`, `poor_footing` | `quarry_hound`, `slag_thrower` |
| `the_sunken_choirhouse` | **red** | rumor | `standing_water`, `failing_light`, `the_song` | `mire_weaver`, `rot_shambler` |
| `ashfall_barrows` | **black** | rumor | `ashfall`, `grave_cold` | `bracken_stalker`, `cairn_archer`, `hollow_chanter`; boss `warden_of_ash` |

Hunting grounds from `town/threats.json`: `gate_thickets` and `old_orchard`, both *"within sight
of the palisade"* — town work, not expeditions (`REQ-TWN-007`).

---

## 1. Shared rules

| Field | Rule |
|---|---|
| Tile | Diamond, **64 × 32 `@1x`, 128 × 64 `@2x`**. Flat — the town grid has no elevation |
| Pivot | Tile centre, `(32, 16)` `@1x` |
| Format | PNG-8 + alpha. Tile edges are hard, never feathered |
| Draw band | 0 for ground, 100 for decals (`ART_BIBLE.md` §9.5) |
| Palette | Region palettes in `ART_BIBLE.md` §6.2. **No §6.1 functional hue on terrain, ever** |
| Variation | Every base tile ships **4 variants**; the renderer picks by `hash(x, y)` so the same tile always looks the same (stable for saves and replays) |
| Colour cap | 24 per tile |
| Shadows | Terrain casts none. Tiles take no baked shadow from buildings — contact shadows are separate sprites (O-2) |

### The template-and-swap rule (O-5)

A region is **24 template tiles + a palette table + 6 hand-authored identity tiles**, not 24
new tiles. The template set is authored once in neutral ramps; each region's palette table maps
those ramps to its colours. The 6 identity tiles are where form has to change — a palette swap
cannot make Ashfall Barrows feel wrong.

| Template group | Count | Contents |
|---|---|---|
| Base ground | 4 | Plain, worn, patchy, dense |
| Auto-tile path edge | 16 | 2-corner Wang set against base ground (see `ENV_ROAD`) |
| Scatter overlay | 4 | Small stones, leaf litter, tufts, debris |

### Category negative prompt

```
perspective, vanishing point, horizon, sky, elevation cliffs, height levels, 3D terrain,
heightmap, top-down 90 degree, square tiles, hex tiles, visible grid lines, seams,
tile borders, repeating pattern artefacts, noise texture, photo texture, grass blades
rendered individually, flowers in purple, flowers in bright blue, scenery objects,
characters, buildings, lighting from below
```

---

## 2. Asset specifications

---

### `ENV_TOWN_GROUND`

**1. ID** — `ENV_TOWN_GROUND` · no content id (the 12 × 9 grid in `balance/town.json`)

**2. Gameplay purpose** — The ground every building stands on and every hunter walks across.
Must read as *inhabited* — worn where people walk, grassy where they do not — so the town's
traffic is visible in the ground itself (`REQ-CW-006`: placement and traffic matter).

**3. Visual description** — Frontier town earth: packed dirt, trampled grass, gravel, a small
cut-stone plaza reserved for the Guild Hall forecourt at T3, mud after rain.

**4. Views / states** — 5 materials × 4 variants = **20 tiles**. One facing. No animation.

**5. Palette** — Town palette `ART_BIBLE.md` §6.2: moss green `#6f7f4e`, trail dust `#9b9070`,
stone `#8d8a80`, slate-blue shadow `#3e4a5c`.

**6–8.** Shared rules above.

**9. Path** — `art/environment/town/env_town_ground_<material>_<NN>@2x.png`
(`grass` `dirt` `gravel` `plaza` `mud`).

**10. Variants** — 4 per material, hash-selected. `plaza` appears only when the Guild Hall
reaches T3, as forecourt dressing around its footprint.

**11. Continuous world** — Fills every cell of the 12 × 9 grid under and between buildings.
The only ground in the game a player looks at for hours, so variants must not pattern-repeat
at 0.55 zoom.

**12. System connections** — `Town.grid`; `REQ-TWN-002` stage (plaza at Great Hall);
future traffic wear could swap `grass` → `dirt` on well-walked cells, driven by `TownJobs`
routes — worth considering, not specified here.

**13. Acceptance** — `ART_BIBLE.md` §13 global gate, plus:
- [ ] A 12 × 9 field of hash-selected `grass` shows **no visible repeat** at 0.55 zoom
- [ ] Every material tiles seamlessly with every other on all four diamond edges
- [ ] Buildings and hunters stay the highest-contrast thing on screen — ground value range is
      narrower than either (the ground is a stage, not a subject)

**14. Prompt**
```
<MASTER STYLE PROMPT>

A single isometric pixel-art ground tile for a frontier town: packed earth trampled by
daily foot traffic, with a few pressed-in stones and faint wheel ruts. Low contrast and
calm, so buildings and people read clearly on top of it. Palette: trail dust, warm brown
earth, muted moss, slate-blue shadow. Exactly one 2:1 diamond, 128 by 64 pixels,
designed to tile seamlessly with copies of itself on all four edges.
Fully transparent outside the diamond.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT>
```

**15. Variation prompt**
```
Same tile shape, same palette, same light direction, same level of detail and contrast,
seamless on all four edges with the original. Change ONLY the placement of stones, ruts
and worn patches so that four variants can sit side by side without a visible pattern.
```

**16. Web notes** — Ground is baked once per town layout into a single offscreen canvas and
blitted as one image (O-9). It re-bakes only when a building is placed, moved or removed.

---

### `ENV_ROAD`

**2. Purpose** — Roads affect movement (`REQ-CW-006`). The road is also the visible spine of
the continuous world: the one thing that runs unbroken from town into the frontier.

**3. Visual** — Compacted earth and gravel road with shallow ruts and a soft verge. T2 town
roads gain edging stones; the frontier road stays earth.

**4. Views** — **16-tile 4-bit auto-tile set** (N/E/S/W connection bitmask): end caps,
straights, corners, T-junctions, crossroad. × 2 materials (`earth`, `edged`) = **32 tiles**.

**9. Path** — `art/environment/road/env_road_<material>_<mask4bit>@2x.png` — e.g.
`env_road_earth_0101@2x.png` is a straight N–S road.

**12. Systems** — `REQ-CW-006` movement cost; the town gate; `REQ-EXP-001` connected regions.

**13. Acceptance**
- [ ] All 16 masks join seamlessly in every legal combination
- [ ] Reads as a road at 0.55 zoom — the ruts carry direction
- [ ] The same road tile works on town ground and on Verdant Reach ground (the gate has no seam)

**14. Prompt**
```
<MASTER STYLE PROMPT>

Isometric pixel-art road tile for a frontier road: compacted earth and fine gravel,
two shallow wheel ruts, a soft grassy verge. Connections: [north and south]. The road
must meet the matching edge of any other tile in the set exactly at the diamond edge
midpoints. One 2:1 diamond, 128 by 64 pixels, transparent outside the diamond.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + paved asphalt, cobblestones, lane markings
```

**15. Variation** — Same road, same rut spacing, same verge width, same palette. Change ONLY
the connection set to `[...]`. The road centreline must hit the same edge midpoints as every
other tile.

---

### `ENV_TOWN_EDGE`

**2. Purpose** — Where the town stops and the frontier starts. `ART_DIRECTION.md`: *"a faint
sense of the untamed frontier outside the palisade."* The edge is where the warm palette
hands over to the cool one.

**3. Visual** — A 1–2 tile transition band: trampled ground → scrub → treeline. The palisade
itself is a building (`BLD_PALISADE`); this is the land it stands on.

**4. Views** — 8 tiles (edge straights and corners, 2 variants each).

**13. Acceptance**
- [ ] Palette crosses from town to Verdant Reach over the band, not at a hard line
- [ ] Reads correctly whether or not a palisade has been built on it

---

### `ENV_HUNTING_GROUND`

**2. Purpose** — The two grounds hunters physically walk out to for town hunting
(`REQ-TWN-007`), both *"within sight of the palisade"*.

| Ground | `threats.json` description | Visual | Monsters |
|---|---|---|---|
| `gate_thickets` | *"Scrub within sight of the palisade. Somebody is always cutting it back."* | Dense low scrub with fresh-cut stumps and a cleared path | `moss_crawler` |
| `old_orchard` | *"Half-wild, half-tended, and full of things that eat the fruit."* | Gnarled fruit trees, fallen fruit, a broken fence line | `thicket_wasp` |

**4. Views** — 4 identity tiles + 2 props per ground = **12 files**. Built on Verdant Reach
templates (they are Blue-palette land).

**11. Continuous world** — Visible from the town at default zoom. A hunter on `town_hunting`
walks out through the gate to one of these and fights in place — the first combat most players
see, so it must read clearly.

**13. Acceptance**
- [ ] Both grounds readable as *places* from inside the town at 1.0 zoom
- [ ] Clearly Blue-safe in mood: warm-ish, generous, no threat palette

---

### `ENV_REGION_<ID>` — the four regions

**1. IDs** — `ENV_VERDANT_REACH` · `ENV_COLDWATER_QUARRY` · `ENV_SUNKEN_CHOIRHOUSE` ·
`ENV_ASHFALL_BARROWS`

**2. Purpose** — `REQ-WLD-002`: regions *"must feel clearly different"*. `REQ-ZON-002`: zones
differ in environment. The palette and form of the ground is the first way a player knows,
without a UI, how much danger their hunters are walking into.

**3. Visual description** — built from the region's own `description` in `regions.json`:

| Region | `regions.json` | Form (identity tiles) | Mood |
|---|---|---|---|
| Verdant Reach | *"Overgrown lowland within a day of the gate. The guild has walked it a hundred times."* | Soft meadow, fern, worn hunter trails, low stone walls | Generous, known, warm edge of green |
| Coldwater Quarry | *"A flooded cutting the guild works for stone and salvage."* | Cut stone steps, spoil heaps, standing cold water, rusted winch bases | Exposed, mineral, cold |
| Sunken Choirhouse | *"A drowned hall under the marsh. Something in it is still singing."* | Waterlogged flagstones, drowned pews, reed-choked arches | Still, wet, sound-heavy — the art should feel *quiet* |
| Ashfall Barrows | *"Burial terraces under a permanent fall of warm ash."* | Terraced barrows, cairns, ash drifts, scorched roots | Warm and wrong — not gore, not horror |

**4. Views** — Per region: 24 template tiles (palette-swapped) + **6 identity tiles** + a
palette table. **6 authored tiles per region, 24 in total.**

**5. Palette** — `ART_BIBLE.md` §6.2 per region. **Ashfall Barrows** may use the Black-zone
violet `#8c5fd6` only on threat sources (a hazard decal, a monster), never on terrain — the
functional-hue rule holds even here.

**9. Path** — `art/environment/<region_id>/env_<region_id>_<tile>_<NN>@2x.png` and
`art/environment/<region_id>/palette.json`.

**11. Continuous world** — Regions connect through natural-border cuts (`REQ-CW-004`); a hunter
walks from one into the next on the same ground system and lighting rig.

**12. Systems** — `regions.json` `zoneTier`, `description`, `hazards`, `encounters`; the
knowledge ladder (`combatSchema.ts` `KNOWLEDGE_TIERS`) governs how much of a region the map
reveals — see `specs/10-map-markers.md`.

**13. Acceptance**
- [ ] **Zone mood test (`REF_ZONE_MOOD`):** the same clearing in all four palettes — a player
      ranks them by danger without being told
- [ ] Every region tiles seamlessly with the road set
- [ ] No functional hue on terrain in any region
- [ ] Ashfall reads *wrong* without gore, blood or skulls in quantity (anti-goal: grim-dark)

**14. Prompt** (identity tile, Sunken Choirhouse)
```
<MASTER STYLE PROMPT>

Isometric pixel-art ground tile for a drowned hall under a marsh: old flagstones half
under still, dark water, a line of reeds, the stump of a stone column. Absolutely still
water, no ripples. It should feel quiet and holding its breath rather than frightening.
Palette: deep water teal-grey, wet stone, pale algae green, silt brown.
One 2:1 diamond, 128 by 64 pixels, seamless on all four edges with the region's base
ground tile. Transparent outside the diamond.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + skulls, bones, blood, gore,
glowing water, fog blobs, horror
```

**15. Variation** — Same region, palette and light, seamless with the same base. Change ONLY
the identity feature: `[drowned pew | fallen arch stone | reed island | submerged step]`.

---

### `ENV_HAZARD_<ID>` — hazard decals and overlays

**2. Purpose** — Every hazard in `regions.json` gets a physical presence, so a player sees why
a route is dangerous (`REQ-CW-007`, `REQ-ENV-001`: terrain affects movement). Hazards are
**decals on top of region ground (band 100) or runtime overlays** — never new tilesets.

| Hazard | Region | Type | Treatment |
|---|---|---|---|
| `flooded_galleries` | Coldwater Quarry | Decal set, 4 | Cold standing water over cut stone |
| `poor_footing` | Coldwater Quarry | Decal set, 4 | Loose scree, cracked ledge |
| `standing_water` | Sunken Choirhouse | Decal set, 4 + 4-frame shimmer | Still pools |
| `failing_light` | Sunken Choirhouse | **Runtime overlay** | Radial darkening, no asset beyond a 256² gradient |
| `the_song` | Sunken Choirhouse | **VFX, not terrain** | Faint rhythmic ripples — `specs/08-vfx.md` |
| `ashfall` | Ashfall Barrows | **Particle overlay**, 2 sprites | Slow warm ash motes, drifting |
| `grave_cold` | Ashfall Barrows | Decal set, 4 | Rime on stone — a cold patch inside warm ash |

**13. Acceptance**
- [ ] Every hazard in `regions.json` has a treatment — and nothing else does
- [ ] Hazards read at 0.55 zoom without obscuring hunters
- [ ] `reducedMotion`: animated hazards hold on frame 01 and still read

---

### `ENV_REGION_BORDER` and `ENV_WEATHER_OVERLAY`

**Border** — 6 natural-cut transition pieces (ridge, riverbank, treeline, rock band) so region
boundaries look like geography, not loading seams (`REQ-CW-004`). P2.

**Weather** — World Boss arrivals may affect weather and lighting (`REQ-CW-013`), with terrain
intact. Delivered as **runtime tint + particles**, not re-authored terrain. The Drowned Choir is
a drowned thing arriving in warm ash (DL-055), so its overlay brings *cold and damp into
Ashfall*: desaturate toward `#2f4a52`, add drizzle, dim the ember light. Nothing on the ground
changes. P3.

---

## 3. Production order

| Step | Assets | Gate |
|---|---|---|
| 1 | `REF_GRID_PROJECTION`, `REF_ZONE_MOOD` | **Approve before any tile** |
| 2 | Template set (24) in neutral ramps | Seamless-edge test across all combinations |
| 3 | `ENV_TOWN_GROUND`, `ENV_ROAD` | The 12 × 9 town, laid out, no repeat at 0.55 |
| 4 | `ENV_TOWN_EDGE`, `ENV_VERDANT_REACH`, `ENV_HUNTING_GROUND` | **P0 proof: walk from the Guild Hall door to a Blue fight with no seam** |
| 5 | Coldwater Quarry + its hazards | |
| 6 | Sunken Choirhouse, Ashfall Barrows, borders, weather | |

**Stop-and-review after step 4.** The proof cycle's road — service → road → Blue field — is
this category's whole job in P0.
