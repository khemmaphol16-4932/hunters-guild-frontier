# Category 09 — UI Icons

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/00-production-optimization.md` (O-1, O-5)
**Scope:** Every icon set the interface needs, each anchored to the data file that defines it
**Output style:** 48 × 48 pixel icons, downsampled to 32 and 24 at build time

---

## 0. Rules

1. **Same world, same pixels.** Icons are pixel art on the same grid, palette and upper-left light as
   the world — not a flat-vector icon language pasted on top. `ART_BIBLE.md` §2 applies in full.
2. **An icon never stands alone.** The existing UI puts an `aria-label` or visible text on every
   control (`worldView.ts`, `appShell.ts`). Icons are added beside that text, never instead of it.
   This keeps screen-reader and `largeText` behaviour exactly as shipped.
3. **Easy/Advanced changes words, not icons** (`REQ-UX-002`). One icon set serves both views.
4. **Every set comes from data.** If a data file gains an entry, its icon set gains a row. No icon
   exists for a concept the game does not have.
5. **Shape carries meaning; colour reinforces it.** Every set that uses a §6.1 functional hue must
   also differ by silhouette, and passes a greyscale test.

---

## 1. Shared rules

| Field | Rule |
|---|---|
| Master size | **48 × 48 `@1x`** (96 × 96 `@2x`) |
| Derived sizes | 32 and 24, generated at build time (O-1), hand-fixed where they fail |
| Safe area | Subject within the central 40 × 40; 4 px margin |
| Outline | 1 px, local base colour darkened two ramp steps — never black |
| Colour cap | 16 |
| Background | Transparent. No frame — frames are separate assets (rarity, category) |
| Path | `art/ui/icons/<set>/icon_<set>_<id>@2x.png` |
| Atlas | `atlas_ui` (O-8), eager |

### Shared prompt template

```
<MASTER STYLE PROMPT>
Pixel-art user interface icon for a frontier guild management game: <SUBJECT>.
A single clear symbol that reads instantly at 24 by 24 pixels, drawn as a physical
object from the game world wherever possible rather than an abstract glyph.
96 by 96 canvas, subject within the central 80 by 80, lit from the upper left,
1 pixel outline in a darker shade of its own colour. Fully transparent background,
no frame, no border, no text, no letters, no numbers.
<MASTER NEGATIVE PROMPT> + flat vector icon, material design, emoji, glossy button,
3D icon, gradient, drop shadow, letters, numbers
```

**Variation** — Same set, same framing, same outline weight, same light. Change ONLY the subject to
`<SUBJECT>`. All icons in a set must read as one family side by side.

---

## 2. Icon sets

### `ICO_CONTROL` — interface controls · **P0**

Replaces the unicode glyphs currently used for the world tools in `worldView.ts`
(`⌂` `♙` `⚑` `⌁`) and supplements the text-only buttons in `appShell.ts`.

| Id | Subject | Replaces / supplements |
|---|---|---|
| `build` | A hammer resting on a plank | `⌂` Build & town |
| `hunters` | Three hunters' hoods side by side | `♙` Hunters |
| `guild_affairs` | Guild pennant on a pole | `⚑` Guild affairs |
| `expeditions` | A road marker post pointing out | `⌁` Expeditions |
| `speed_1` `speed_2` `speed_4` | One, two, four chevrons | `1×` `2×` `4×` (DL-065 — no pause icon) |
| `zoom_in` `zoom_out` `center` | Magnifier ±, a compass rose | Camera tools |
| `notices` | A bell | Notices |
| `settings` | A key ring | Settings |
| `close` | A crossed pair of sticks | Drawer close |

**Acceptance** — the three speed icons differ by chevron count, never by colour; the selected
speed is marked by the existing `aria-pressed` state and a frame, not by a different icon.

### `ICO_ATTRIBUTE` · **P0** — `REQ-HUN-001`

| Id | Subject |
|---|---|
| `str` | A clenched fist around a rope |
| `agi` | A feather |
| `vit` | A heart-shaped hearthstone |
| `dex` | A needle and thread |
| `int` | An open book |
| `luk` | A knucklebone die |

### `ICO_ROLE` · **P0** — the five roles in `archetypes.json` `roleLean`

Same shape language as `HUN_OVERLAY_ROLE_PIP` (`specs/02`), at icon scale: tank shield, healer
cross, damage chevron, support circle, control diamond — in the §6.1 role hues. Must pass greyscale.

### `ICO_RESOURCE` · **P0** — `economy/resources.json`

The 8 compact icons from `specs/07-resources.md`, plus **`residents`** (a small house with a lit
window) for the population figure already shown in the resource bar.

### `ICO_CONDITION` · **P0** — `REQ-HUN-011`, `REQ-HUN-012`

`hunger` (an empty bowl), `fatigue` (a guttering candle), `morale` (a small banner, raised or
drooping — two states), `friendship` (two clasped hands). These pair with the three `<meter>`
rows `worldView.renderInspector()` already draws.

### `ICO_NOTIFICATION` · P1 — `ui/notifications.json`, 15 kinds

| Priority | Kinds | Subject direction |
|---|---|---|
| critical | `hunterDied`, `townBreached`, `worldBossAppeared`, `legendaryFound` | Each gets a **heavier 2 px outline**; `hunterDied` is a lowered banner, never a skull |
| important | `stageReached`, `researchCompleted`, `contractResolved`, `worldBossDefeated`, `endlessRecord`, `rareFound`, `frontierEntered` | Standard outline |
| routine | `townDefended`, `hunterLeveled`, `rescue`, `bossDefeated` | Standard outline, smaller subject |

Priority is carried by the existing banner/badge/feed treatment (`REQ-UX-005`); the icon's outline
weight reinforces it, never replaces it.

### `ICO_JOB` · P1 — `town/jobs.json`, 13 jobs

`hunter_drill`, `escort_duty`, `forge_work`, `leatherwork`, `timber_cutting`, `quarrying`,
`field_kitchen`, `archive_work`, `field_survey`, `gate_watch`, `wall_patrol`, `infirmary_rounds`,
`town_hunting` — each the tool of the trade (hammer, axe, pick, ladle, quill, spyglass…). Shown in
the hunter dock beside the activity text `worldView.renderRoster()` already writes.

### `ICO_BUILDING_CATEGORY` · P1 — `buildings.json` `categories`, 10

Uses the same silhouettes as the ten `BLD_KIT_IDENTITY` parts (`specs/04`), reduced to icons — so
the icon and the building on the map are visibly the same idea.

### `ICO_EQUIPMENT_SLOT` · P1 — `item-types.json` `slots`, 7

Empty-slot outlines for `weapon`, `offhand`, `head`, `body`, `hands`, `feet`, `trinket` — drawn at
40% opacity as placeholders in the Build Identity Dashboard.

### `ICO_STATUS` · P1 — `combat/statuses.json`, 4

`burn`, `bleed`, `slow`, `stun` — static single frames of their `VFX_STATUS_*` shapes.

### `ICO_DEPARTMENT` · P2 — `town/departments.json`, 5

`hunter`, `defense`, `resource`, `crafting`, `research`.

### `ICO_PERSONALITY` · P2 — `personalities.json`, 6

`cautious`, `reckless`, `stoic`, `protective`, `methodical`, `opportunist` — for the Build Identity
Dashboard (`REQ-UX-003` lists personality). Must not read as good/bad: `reckless` is not a warning
sign, `cautious` is not a shield. Personality changes *how*, never *whether* (`REQ-HUN-010`).

### Frames · P1

| Asset | Count | Notes |
|---|---|---|
| `ICO_RARITY_FRAME` | 1 + hue table | Six rarities by shape and hue — `specs/06-equipment.md` §1 |
| `ICO_FRAME_SELECTED` | 1 | Selected state for any icon button |

---

## 3. Count

| Set | Icons | Pri |
|---|---|---|
| Control | 13 | P0 |
| Attribute | 6 | P0 |
| Role | 5 | P0 |
| Resource | 9 | P0 |
| Condition | 5 | P0 |
| Notification | 15 | P1 |
| Job | 13 | P1 |
| Building category | 10 | P1 |
| Equipment slot | 7 | P1 |
| Status | 4 | P1 |
| Department | 5 | P2 |
| Personality | 6 | P2 |
| Frames | 2 | P1 |
| **Total** | **100** | |

Traits (14 in `traits.json`) are deliberately **not** iconed: they carry names and descriptions the
dashboard already shows, and 14 abstract trait icons would be the least legible set in the game.
