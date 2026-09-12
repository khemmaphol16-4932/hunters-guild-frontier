# Category 10 — Map Markers

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/09-ui-icons.md`
**Scope:** Markers drawn over the world and the region map: zone tier, knowledge tier, route node
kind, region, parties, alerts, camera bookmarks, locks
**Output style:** Pin-shaped pixel sprites, 32 × 40 `@1x`

---

## 0. Markers carry signal, so they carry the rules hardest

Markers are where the functional palette (`ART_BIBLE.md` §6.1) is *supposed* to appear — which makes
them the category where colour-blind failure is most likely. Two rules:

1. **Every marker family is a shape system first.** Hue reinforces; shape decides. Each family below
   passes a greyscale test on its own.
2. **Nothing important hides.** `CONTINUOUS_WORLD_ARCHITECTURE.md`: *"Important discoveries cannot
   depend on invisible, unmarked secrets."* A place the Guild has only heard of still gets a marker.
   Only `REQ-SEC-001` secret content is allowed to have none.

### Shared rules

| Field | Rule |
|---|---|
| Canvas | 32 × 40 `@1x` (64 × 80 `@2x`): a 32 × 32 head over an 8 px stem |
| Pivot | **The stem tip**, `(16, 39)` — it touches the ground point it marks |
| Draw band | 10000 (`ART_BIBLE.md` §9.5) — above everything in the world |
| Zoom | **Counter-scaled**: markers stay 32 px on screen at every zoom from 0.55 to 1.8 |
| Composition | Markers compose from a base (zone) + badge (knowledge, node, lock) at runtime — not pre-baked |
| Colour cap | 12 |
| Path | `art/ui/markers/marker_<family>_<id>@2x.png` |

The current region map in `expeditionView.ts` already exposes danger colour, lock requirements,
knowledge tier and visit count *in text*. These markers add the visual layer on top; the text stays.

---

## 1. Families

### `MRK_ZONE` · **P0** — `regions.json` `zoneTiers`

Danger rises with the number of corners, so the order is learnable without colour.

| Tier | Hex | Shape | Rule (`CONTINUOUS_WORLD_ARCHITECTURE.md`) |
|---|---|---|---|
| `blue` | `#5b8dd6` | **Circle** | Downing, automatic rescue and return |
| `yellow` | `#d9a441` | **Triangle** | Adds injury and recovery |
| `red` | `#d4685f` | **Diamond** | Adds a small chance of carried-loot loss |
| `black` | `#8c5fd6` | **Notched octagon** | Death possible |

**Acceptance** — all four distinguishable in greyscale at 24 px; ordered correctly by a tester who
has not been told the scheme; no marker implies Blue is dangerous.

### `MRK_KNOWLEDGE` · P1 — `combatSchema.ts` `KNOWLEDGE_TIERS`

Knowledge is shown as **how solid the marker is** — the Guild's picture of a place filling in.

| Tier | Badge |
|---|---|
| `unknown` | No marker (fog) — unless an important discovery is pending, then `rumor` |
| `rumor` | Dotted outline only |
| `discovered` | Solid outline |
| `experienced` | Outline + half fill |
| `mastered` | Full fill + small inner mark |

This is the map-scale twin of `PRP_FIELD_CAMP` (`specs/05`): trail markers in the world, a filling
marker on the map — the same knowledge, shown at both scales (`REQ-CW-014`).

### `MRK_NODE_KIND` · P1 — `regions.json` `nodeKinds`

Route nodes: `combat` (crossed blades), `rest` (a campfire), `discovery` (a spyglass), `event`
(a signpost). Badge-sized, composited onto the zone base.

### `MRK_REGION` · P1

One identity badge per region, taken from its identity tiles (`specs/01`): Verdant Reach fern,
Coldwater Quarry winch, Sunken Choirhouse drowned arch, Ashfall Barrows cairn.

### `MRK_PARTY` · **P0**

Where a party is right now in the continuous world. Three states, matching the journey lifecycle in
`CONTINUOUS_WORLD_ARCHITECTURE.md` §Migration:

| State | Shape |
|---|---|
| `travelling` | A walking pennant, pointed in the direction of travel |
| `fighting` | The pennant with crossed blades |
| `returning` | The pennant pointing home, with a pack badge (carrying loot — `specs/07`) |

The party's lead hunter's role pip (`HUN_OVERLAY_ROLE_PIP`) sits on the pennant.

### `MRK_ALERT` · P1 — camera alert jumps

The camera *"uses … bookmarks, and alert jumps"* and *"never auto-frames combat"*. Alert markers are
where the player **chooses** to jump; they never move the camera themselves.

| Alert | Source | Shape |
|---|---|---|
| `hunter_downed` | `REQ-CBT-012` | Healer-hue ring, pulsing (matches `VFX_DOWNED`) |
| `town_attack` | `REQ-TWN-008` defense events | Palisade silhouette |
| `world_boss` | `worldBossAppeared` notice | The Choir's bell (matches its card) |
| `rare_find` | `rareFound` / `legendaryFound` | Rarity frame shape |

### `MRK_BOOKMARK` · P2

Player-placed camera bookmarks: a plain numbered flag — the number is rendered by the UI, not baked.
4 colours from the town palette (never §6.1 hues).

### `MRK_LOCKED` · P1 — `REQ-WLD-002`

A padlock badge over any region whose `unlock` requirement is unmet (e.g. Coldwater Quarry at
`guildLevel` 5). Two states: `locked`, `requirement_met` (badge fades out over 6 frames).

### `MRK_QUEUED` · P1 — `REQ-CW-015`

A small hourglass badge on a building, shown when an assignment there is queued behind a hunter's
injury — the building-side half of *"visibly explains the delay"*; the hunter-side half is
`HUN_OVERLAY_CONDITION`.

---

## 2. Production order

1. `MRK_ZONE` + greyscale test — **gate**: if the four shapes fail, nothing else in this family ships
2. `MRK_PARTY`
3. `MRK_KNOWLEDGE`, `MRK_NODE_KIND`, `MRK_REGION`, `MRK_LOCKED`, `MRK_ALERT`, `MRK_QUEUED`
4. `MRK_BOOKMARK` — when camera bookmarks exist in code

**Count:** 4 zone + 4 knowledge badges + 4 node + 4 region + 3 party + 4 alert + 1 bookmark +
2 lock + 1 queued = **27**.
