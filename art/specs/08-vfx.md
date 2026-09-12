# Category 08 — VFX

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/03-monsters.md`, `art/specs/00-production-optimization.md` (O-5)
**Scope:** Hit and skill effects for the 13 hunter skills (`src/data/skills.json`) and 13 monster
skills (`combat/monsters.json`), the 4 statuses (`combat/statuses.json`), telegraphs, and world feedback
**Output style:** Short sprite loops, ground-projected decals, a few code-driven effects

---

## 0. Rules that come before any effect

1. **VFX never hides the fight.** There is no combat camera (`REQ-CW-002`) and no pause, so combat
   must stay readable *while it happens*. An effect may never cover the silhouette it is attached
   to for more than 2 frames.
2. **VFX is presentation only.** `REQ-CW-012`: observing a fight must not change its result. Effects
   read combat facts; they never feed back. Off-screen fights play **no VFX at all**.
3. **Author families, tint per element (O-5).** 26 skills do not need 26 effects. They need ~12
   families, tinted by `element` and damage type.
4. **Only the elements in use.** `skills.json` lists `fire`, `frost`, `storm` and `earth`; content uses
   only `fire` and `frost`. `REQ-CBT-003` forbids inventing the element list or the reaction matrix,
   and the matrix is unapproved. **No reaction VFX, no storm or earth tint** until the design exists.
5. **Telegraph length is data, so telegraph fill is code.** Nine skills carry `telegraphSeconds`
   (0.9 s to 3.0 s). One ground-marker asset fills over exactly that duration, driven by the value in
   `monsters.json` — so the art can never drift from the timing the Hunter AI reacts to.
6. **No full-screen flashes.** Photosensitivity: no frame may change more than 25% of the viewport's
   luminance. `reducedMotion` replaces every effect with its frame 01 held for the effect's duration.

---

## 1. Shared rules

| Field | Rule |
|---|---|
| Frame rate | 12 fps, matching animation |
| Canvas | 64 × 64 `@1x` small, 128 × 96 area, 192 × 128 boss area |
| Pivot | Declared per effect: *target pivot*, *ground at target*, or *source hand* |
| Draw band | 9000 ground-anchored, 9500 overhead (`ART_BIBLE.md` §9.5) |
| Blend | **Normal alpha only.** Additive blending destroys pixel-art edges |
| Colour cap | 12 per effect |
| Palette | Element and status ramps below; §6.1 functional hues **only** on telegraph markers |

### Element and damage ramps (tint tables, O-5)

| Ramp | Base family | Use |
|---|---|---|
| `physical` | Warm white, dust brown | Blades, mauls, arrows, claws |
| `magic` | Pale lavender-grey | Untyped magical damage |
| `fire` | Ember `#c0563a` → honey `#e8b45a` | `ember_lance`, `slag_thrower`, `warden_of_ash` |
| `frost` | Frost white → `#86b1ad` → `#2f4a52` | `frost_chain`, `hollow_chanter`, `mire_weaver`, `the_drowned_choir` |
| `heal` | Soft green `#5fbf87`, low saturation | All `healPower` skills — the healer role hue, by design |

---

### Category negative prompt

Appended to the master negative in `ART_BIBLE.md` §3 by `art/prompts/build.mjs`.

```
anime effects, speed lines, lens flare, bloom, glow halo, energy explosion, lightning bolts,
particle soup, additive blending, full-screen flash, gore, blood spray, smoke filling the frame,
characters, creatures
```

## 2. Asset specifications

### `VFX_FAMILY_<ID>` — skill effect families

| Family | Frames | Covers (hunter skills) | Covers (monster skills) | Pri |
|---|---|---|---|---|
| `impact_light` | 4 | `riposte`, blade hits | `moss_crawler`, `thicket_wasp`, `quarry_hound` attacks, `hamstring` | **P0** |
| `impact_heavy` | 5 | `shield_bash`, maul hits | `rend`, `sundering_blow`, `ashen_grasp`, `undertow` | **P0** |
| `projectile_arrow` | 3 + trail | `piercing_shot`, bow attacks | `cairn_archer` | P1 |
| `projectile_bolt` | 4 + trail | `ember_lance` (fire) | `molten_arc` (fire, lobbed) | P1 |
| `chain` | 6 | `frost_chain` (frost) | `binding_silk` (frost) | P1 |
| `heal_burst` | 6 | `mend` | `mend_kin`, `weave_mend`, `many_voices` | P1 |
| `heal_over_time` | 4 loop | `renewal` | — | P1 |
| `aura_guard` | 4 loop | `guard_stance`, `last_stand` | — | P1 |
| `mark_threat` | 4 loop | `taunt` | — | P1 |
| `rally` | 8 | `rally` | — | P2 |
| `volley` | 8 | `culling_volley` | — | P2 |
| `area_wave` | 8 | — | `cinder_sweep` (fire), `dirge` (frost), `final_verse` (frost) | P2 |

**Enemy heals must be as legible as hunter heals.** `heal_burst` on a monster draws a visible thread
from caster to target, so a player knows *who* healed the enemy.

**Acceptance, every family**
- [ ] Tints cleanly to each ramp it lists with no re-authoring
- [ ] The target's silhouette is visible on every frame except at most 2
- [ ] Reads at 0.55 zoom
- [ ] Normal alpha only; ≤ 12 colours

**Prompt template**
```
<MASTER STYLE PROMPT>
Pixel-art combat effect sprite sheet, <FAMILY BRIEF>, <N> frames in a horizontal strip,
each frame <W> by <H>, for a grounded frontier fantasy game viewed in true 2:1 dimetric.
Restrained and readable rather than flashy: a few strong shapes, no particle soup,
no lens flare, no bloom. Neutral grey ramp so it can be recoloured.
Fully transparent background.
<MASTER NEGATIVE PROMPT> + anime effects, speed lines, lens flare, bloom, glow halo,
energy explosion, lightning everywhere, particle soup
```

---

### `VFX_TELEGRAPH_AREA` and `VFX_TELEGRAPH_TARGET` · P1

**2. Purpose** — `REQ-BOS-001`: every important boss skill has a visual telegraph, and the Hunter AI
reacts to the wind-up. These markers show the player *what the AI sees coming*, for exactly as long
as the data says.

| Asset | Used by | Shape |
|---|---|---|
| `VFX_TELEGRAPH_AREA` | `cinder_sweep` 1.5 s, `molten_arc` 1.2 s, `dirge` 1.8 s, `final_verse` 3.0 s | Ground-projected 2:1 ellipse; outline + fill that grows inward |
| `VFX_TELEGRAPH_TARGET` | `ashen_grasp` 2.0 s, `undertow` 2.2 s, `binding_silk` 1.0 s, `sundering_blow` 0.9 s | Ground ring under the chosen hunter, closing in |

**4. Frames** — **Two frames each**: the outline, and the fill texture. Code scales the fill from 0
to 1 over `telegraphSeconds`. A 3.0 s telegraph costs no more art than a 0.9 s one.

**5. Colour** — The one place a §6.1 hue is correct in combat VFX: the telegraph uses the
**region's zone hue** (`regions.json` `zoneTiers[].colour`) — it is signal, not decoration.

**13. Acceptance**
- [ ] Fill completes exactly when the skill releases, driven by `telegraphSeconds`, not a frame count
- [ ] Readable on every region's ground palette
- [ ] Distinguishable by **shape** from the selection ring and the rescue marker
- [ ] `reducedMotion`: outline shown with a static half-fill

---

### `VFX_STATUS_<ID>` · P1

The 4 statuses in `combat/statuses.json`, each a small loop above or at the afflicted unit:

| Status | Loop | Visual | Anchor |
|---|---|---|---|
| `burn` | 6 | Two or three small flame tongues at the shoulders | Overhead |
| `bleed` | 6 | Occasional dark drop falling from the torso — **restrained, no spray, no pooling** (anti-goal: gore) | Target pivot |
| `slow` | 6 | Frost-white drag lines at the feet | Ground |
| `stun` | 6 | Small orbiting marks above the head | Overhead |

Plus `ICO_STATUS_*` in `specs/09-ui-icons.md` for the inspector. `REQ-CBT-008` lists more statuses as
a target — none is authored until it exists in `statuses.json`.

---

### World feedback effects

| ID | Frames | Purpose | Pri |
|---|---|---|---|
| `VFX_SELECTION_RING` | 4 loop | Ground-projected 2:1 ring under the selected hunter or building | **P0** |
| `VFX_DOWNED` | 4 loop | `REQ-CBT-012` — a downed hunter must read as *downed, not dead* at 0.55: a slow pulsing ground ring in the healer hue | **P0** |
| `VFX_LOOT_PICKUP` | 6 | `REQ-CW-011` — landing puff and pickup sparkle (see `RES_DROP_WORLD`) | **P0** |
| `VFX_RESCUE` | 6 | `drag_to_safety`, `REQ-CBT-013` | P1 |
| `VFX_LEVEL_UP` | 8 | A column of warm light, brief | P1 |
| `VFX_BUILD_COMPLETE` | 6 | Dust settle as scaffolding comes down | P1 |
| `VFX_THE_SONG` | 8 loop | Sunken Choirhouse hazard `the_song` — faint concentric ripples on still water, in rhythm | P2 |
| `VFX_WORLD_BOSS_ARRIVAL` | 12 | `REQ-CW-013` — water sheeting off the Choir as it rises out of the ash; pairs with the Ashfall weather overlay | P2 |

**`VFX_DOWNED` vs death.** Blue downs and auto-rescues; Yellow and Red injure; only Black kills. The
downed marker must never look like a death marker, because in three zones out of four it isn't one.
Death has **no VFX** — the `death` animation and the Guild Report carry it. Quiet, not spectacular.

---

## 3. Production order

| Step | Assets |
|---|---|
| 1 | `VFX_SELECTION_RING`, `VFX_DOWNED`, `impact_light`, `impact_heavy`, `VFX_LOOT_PICKUP` — the P0 fight |
| 2 | Telegraph pair — with the first telegraphed monster (`slag_thrower`) |
| 3 | Statuses, projectiles, heals, chain, auras |
| 4 | Boss area waves, arrival, `the_song` |
