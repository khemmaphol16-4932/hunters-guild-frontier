# Category 05 — Props and Decorations

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/00-production-optimization.md` (O-2, O-5)
**Scope:** Town dressing, lighting, landscaping, trees, field camps, and the props that make the
town's history physical
**Camera:** Fixed 2:1 dimetric, no rotation, zoom 0.55–1.8
**Output style:** Single sprites, a few short loops

---

## 0. Props must earn their place

A prop in this game is one of three things. Anything that is none of them is cut.

| Kind | Why it exists | Requirement |
|---|---|---|
| **Placeable decoration** | The player places it; it affects the town | `REQ-CW-006` — *"decorations and minor landscaping matter"* |
| **State made visible** | It appears because something in the simulation is true | `REQ-PRIME-008`, `REQ-CW-007` |
| **History made physical** | It appears because something *happened* | `REQ-CHR-002`, `REQ-TWN-002`, `ART_DIRECTION.md`: *"town history belongs in the world"* |

The third kind is the most important and the easiest to fake. The rule: **a history prop is
driven by a real record, never placed as set dressing.** The game already keeps that record —
`src/systems/progression/Monument.ts`, *"the guild's permanent record of historic
achievements"* — so the props read from it.

The current renderer draws 94 decorative CSS trees with a deterministic formula
(`worldView.renderScene()`) and deliberately avoids decorative NPCs and *"pretend simulated
roads"*. That restraint is correct and this spec keeps it.

---

## 1. Shared rules

| Field | Rule |
|---|---|
| Canvas `@1x` | Small props 64 × 48; trees 96 × 128; large props per row |
| Pivot | Bottom-centre of the ground contact, declared in the sidecar JSON |
| Footprint | Placeable props occupy exactly **1 × 1** grid cell; dressing props occupy none |
| Facings | One, unless the prop has a functional face (signs, stalls, benches) — then 2 + mirror |
| Shadow | Generated from alpha (O-2) |
| Colour cap | 24 |
| Draw band | `round(screenY)`, like every other upright object |

### Category negative prompt

```
magic items, glowing objects, treasure chest, gold coins pile, potions, crystals,
fantasy runes, modern objects, plastic, neon, signage with readable text, letters,
numbers, ornate carving, gilded, multiple objects collage, scenery, ground plate
```

Signs and plaques **carry no readable text** in the art. Text, where needed, is rendered by the
game in the UI layer, so it can be localised and read by screen readers.

---

## 2. Asset specifications

### `PRP_HISTORY` — the Monument made physical · P2

**2. Purpose** — The town visibly remembers. Every entry kind in `MONUMENT_KINDS`
(`src/data/progressionSchema.ts`) gets a physical object that appears in town when an entry of
that kind is recorded.

| Monument kind | Prop | Where it appears |
|---|---|---|
| `worldBossVictory` | Mounted trophy — a drowned choir-bell, salvaged | Above the Guild Hall door |
| `frontierDiscovery` | Survey marker stone with a carved region sigil | Beside the gate road |
| `legendaryFind` | Glass-fronted display case | Guild Hall forecourt |
| `historicContract` | Sealed contract nailed to a board | Recruitment Hall wall |
| `legendaryHunter` | Carved standing post, one per hunter who reached level 50 | Around the Monument |
| `townMilestone` | Stage banner (Village, Fortified Town, Hunter City) | Guild Hall flagpole |
| `researchBreakthrough` | Brass instrument on a plinth | Research Annex |
| `foundersFacade` | Founders' cornerstone | Guild Hall foundation |
| `endlessRecord` | Notched depth-post | Hunting Camp |

**3. Visual** — Modest, made-by-hand objects. A frontier guild commemorates with what it has:
timber, stone, rope, salvage. Never gilded, never glowing.

**4. Views** — 9 props × 2 facings + mirror. Stack/repeat props (`legendaryHunter` posts,
`historicContract` notices) have 3 fill variants so a crowded board still reads.

**11. Continuous world** — Accumulates over a whole save. A Hunter City in year three should be
visibly *older* than a new one of the same size, purely from these.

**12. Systems** — `Monument.ts` entries; `REQ-TWN-002` no reset; New Game+ (`newGamePlus` in
`balance/progression.json`) — the `foundersFacade` cornerstone is the one prop that should
survive into the next cycle if NG+ keeps the Monument.

**13. Acceptance**
- [ ] Every `MONUMENT_KINDS` value has exactly one prop — and no history prop exists without a kind
- [ ] Each reads as *commemorative* rather than *decorative* at 1.0 zoom
- [ ] A board with 12 contracts nailed to it still reads at 0.55
- [ ] No readable text in the art

**14. Prompt template**
```
<MASTER STYLE PROMPT>
Isometric pixel-art commemorative object for a frontier hunters' guild town: <PROP>.
Made by hand from what a frontier town has — timber, stone, rope, salvaged metal —
modest and a little rough, clearly kept with care. It marks something that really happened.
No text, no letters, no gilding, no glow. True 2:1 dimetric, facing south-east,
on a 64 by 64 canvas, standing on the ground plane. Fully transparent background, no shadow.
<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT>
```

---

### `PRP_TOWN_BASIC` · P0

**2. Purpose** — The minimum dressing that makes buildings look *used*: things piled where work
happens. Placed by building recipes (`specs/04-buildings.md` `DTL`) and by the player.

| Prop | Used by | Notes |
|---|---|---|
| Barrel, crate, sack | Granary, Market Row, Cookhouse | 3 variants each |
| Handcart | Lumber Yard, Quarry Camp | 2 facings |
| Bench | Anywhere (placeable) | 2 facings |
| Firepit | Hunting Camp, Cookhouse | + 4-frame fire loop |
| Woodpile | Cookhouse, Smithy | |
| Weapon rack | Drill Yard | |
| Washing line | Bunkhouse, Longhouse | |

**13. Acceptance** — reads at 0.55; never taller than a hunter's shoulder (props must not hide
people); no functional hue.

---

### `PRP_LIGHTING` · P0

**2. Purpose** — The honey-gold lantern light is the single most identifying colour of the
Guild (`ART_DIRECTION.md` palette). Light sources are the **only** props allowed
self-illumination (`ART_BIBLE.md` §7).

| Prop | Frames | Notes |
|---|---|---|
| Lantern post | 4 loop | Town roads |
| Hanging lamp | 4 loop | Building eaves (a `DTL` part) |
| Brazier | 6 loop | Shrine, gate |

**13. Acceptance** — glow is a hand-authored halo of 2–3 ramp steps inside the sprite, not an
additive blend; `reducedMotion` holds frame 01, still lit.

---

### `PRP_TREES` · P0

**2. Purpose** — Replaces the 94 CSS `scenery-tree` divs in `worldView.renderScene()` 1:1, keeping
its deterministic placement formula so saves and screenshots stay stable.

**4. Views** — 3 species × 3 sizes = **9 sprites**: broadleaf, conifer, birch. Per-region
species come from palette swap (O-5): Verdant Reach green, Coldwater sparse and grey, Ashfall
scorched, Choirhouse drowned.

**8. Layering** — A tree taller than a building behind it must fade to 40% opacity when a hunter
or building it would hide is selected — a runtime rule, but the sprite needs a clean top half
for it to look right.

**13. Acceptance** — the three species distinguishable at 0.55; the canopy never fully hides a
1 × 1 building.

---

### `PRP_LANDSCAPING` · P1

**2. Purpose** — Placeable decoration (`REQ-CW-006`): hedge, fence run (auto-tiling 16-mask, like
roads), planter, flowerbed, path edging, stone marker. 12 sprites.

**Hard rule** — flowerbeds use **only** warm, earthy flower colours from the town palette. No
blue, violet or red flowers: those hues are functional signal (`ART_BIBLE.md` §6.1).

---

### `PRP_SIGNAGE` · P1

Notice board, guild banner, shop sign, gate sign — 8 sprites, **no readable text**. The notice
board at the Recruitment Hall shows `historicContract` notices from `PRP_HISTORY`.

---

### `PRP_FIELD_CAMP` · P1

**2. Purpose** — Knowledge made visible (`REQ-CW-014`, `REQ-WLD-001`): the Verdant Reach vista in
`ART_DIRECTION.md` promises *"trail markers, camps and a small travelling party make the guild's
accumulated knowledge visible"*. As a region's knowledge tier rises, these appear along its routes.

| Knowledge tier | Props that appear |
|---|---|
| `rumor` | — |
| `discovered` | Trail blaze on a tree, first cairn |
| `experienced` | Cleared campsite, rope line at a crossing |
| `mastered` | Supply cache, waymarked route, lean-to shelter |

Also: the six route events in `world/events.json` get one prop each where they occur —
`abandoned_cache` (jammed crate), `collapsed_passage` (rubble), `wounded_stranger` (bedroll),
`still_water` (nothing — the absence is the point; handled by `ENV_HAZARD`), `the_singing`
(nothing — sound, handled by VFX), `defensible_ground` (a dry corner with a firepit).

**13. Acceptance** — a region at `mastered` visibly differs from the same region at
`discovered`, from props alone.

---

### `PRP_RUBBLE` · P1

Post-attack dressing for `REQ-TWN-008`: 6 sprites of rubble, fallen beams and scorch. Pairs with
the building damage overlays (`specs/04-buildings.md` `OVR`). **Removed automatically when the
Guild AI repairs the building** (`standingOrders.autoRepair` in `GuildCommands`) — rubble that
outlives the repair would lie about the town's state.

---

## 3. Production order

| Step | Assets |
|---|---|
| 1 | `PRP_TREES` — immediate visual win; replaces CSS divs 1:1 |
| 2 | `PRP_TOWN_BASIC`, `PRP_LIGHTING` — with the P0 buildings |
| 3 | `PRP_FIELD_CAMP`, `PRP_RUBBLE`, `PRP_SIGNAGE`, `PRP_LANDSCAPING` |
| 4 | `PRP_HISTORY` — alongside the Monument UI |
