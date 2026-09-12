# Category 07 — Resources and Loot

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`
**Scope:** The 8 resources in `src/data/economy/resources.json`, the physical loot drop, and
carried-loot visibility
**Output style:** World drop sprites, UI icons, one hunter overlay

---

## 0. Loot is a physical thing a person carries

Three locked requirements make loot a *world* object, not a number:

| Requirement | What the art must show |
|---|---|
| `REQ-CW-011` | Loot transfers to the hunter **immediately**, with a brief physical drop/pickup and **no second collectible copy** |
| `REQ-CW-008` | Hunters own their carried loot; it becomes the Guild's only when **sold** |
| Risk tiers | Red zone: a small chance of losing carried loot. Black zone: death loses carried loot |

So a player should be able to look at a hunter walking home and see that they are *carrying
something* — because in Red and Black zones, that load is at risk. That is `REQ-PRIME-008` in its
purest form, and it costs one overlay.

There are exactly **8 resources**. None is invented here.

| Id | Name | Category | Seen in the world as |
|---|---|---|---|
| `gold` | Gold | currency | Coin pouch — hunters' personal money and Guild stores |
| `food` | Provisions | core | Sacks, crates, smoked meat |
| `materials` | Building Materials | construction | Timber and cut stone |
| `iron` | Iron | crafting | Rough bar / ore lump |
| `salvage` | Salvage | crafting | Bundled scrap — fittings, blades, buckles |
| `warding_salt` | Warding Salt | specialized | Small wax-sealed jar |
| `essence` | Monster Essence | specialized | Stoppered vial, cloudy |
| `insight_crystal` | Insight Crystal | rare | A single clear crystal in a cloth wrap |

---

## 1. Assets

### `RES_<ID>` — per resource · P0 (`gold`, `food`, `materials`), P1 (`iron`, `salvage`), P2 (rest)

| Deliverable | Size `@1x` | Use |
|---|---|---|
| World drop | 32 × 32 | The brief physical drop (`REQ-CW-011`) |
| UI icon | 48 × 48 | Guild Report, loot notices, market |
| Compact icon | 24 × 24 | The resource bar `worldView.refresh()` already renders |

**3. Visual** — The object from the table above, unmistakable by shape at 24 px. `essence` and
`insight_crystal` are the two allowed to carry a faint internal light — they are specialised
magical materials — but a 2-step ramp, never a halo.

**Colour rule** — `gold` uses a warm metal ramp built from lantern gold `#e8b45a`, **not** the
Ancient/Yellow-zone signal `#d9a441`. Close in hue, distinct in value: they must not be confused.

**9. Path** — `art/resources/res_<id>_<drop|icon|compact>@2x.png`

**13. Acceptance** — all 8 distinguishable at 24 × 24 in greyscale; no text or numbers; the
24 px versions read in the existing resource bar beside `Residents`.

**14. Prompt template**
```
<MASTER STYLE PROMPT>
Pixel-art icon of <OBJECT>, a frontier resource, three-quarter view, filling about
80 percent of a 96 by 96 canvas, lit from the upper left. Unmistakable by shape alone
at very small size. No glow, no sparkle, no text, no numbers.
Fully transparent background, no frame, no shadow.
<MASTER NEGATIVE PROMPT> + treasure pile, gold coins spilling, gemstones, loot chest
```

**15. Variation** — Same style, size, lighting and framing. Change ONLY the object to
`<OBJECT>`. All eight must read as one family.

---

### `RES_DROP_WORLD` — the drop/pickup presentation · **P0**

**2. Purpose** — `REQ-CW-011` exactly: the item arcs out of the defeated monster, lands, and the
hunter who owns it picks it up. Then it is **gone** from the ground. There is never a second copy.

**4. Frames** — Uses the resource's own 32 × 32 drop sprite on a shared motion:

| Beat | Frames | |
|---|---|---|
| Arc | 4 | Pop up and out from the monster's pivot |
| Land | 2 | Small settle; a 2-frame ground puff from `VFX_LOOT_PICKUP` |
| Pickup | 3 | Flies to the hunter's pack; the hunter plays `gather` if idle |

Total under one second at 12 fps. **Motion is code (a parabola), not frames** — the only authored
art is the resource sprite and the puff. The arc must land within the hunter's reach, so the
pickup never becomes a trip.

**Acceptance** — the item is on the ground for under a second and never duplicates; with
`reducedMotion`, the item appears at the pack with no arc.

---

### `RES_CARRY_OVERLAY` — what a hunter is carrying · P1

**2. Purpose** — Makes carried loot visible (`REQ-CW-008`) so the Red and Black risk to it is
something a player can *see*. A pack that fills up.

| State | When | Visual |
|---|---|---|
| empty | no carried loot | The pack layer as authored |
| laden | some carried loot | Bulging pack, a bundle tied on |
| heavy | near capacity, or any rare+ item | Overfull pack, bundles on both sides, a slight lean in the walk |

**8. Layering** — Replaces the `HUN_LAYER_PACK` sprite; 3 states × the pack variants. The
`heavy` lean is a walk-cycle variant on the skeleton, reused from the fatigue posture in
`HUN_OVERLAY_CONDITION`.

**11. Continuous world** — A hunter who leaves town `empty` and comes home `heavy` has told the
player the expedition went well before any report opens. Selling to the Guild (`sell` state,
`specs/11-animations.md`) returns the pack to `empty`.

**Acceptance** — the three states distinguishable at 0.55 on all three skeletons.
