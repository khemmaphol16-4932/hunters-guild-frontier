# Category 06 — Weapons and Equipment

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/02-hunter-characters.md`, `art/specs/00-production-optimization.md` (O-7)
**Scope:** 15 item types across 7 slots (`items/item-types.json`), 6 rarities (`items/rarities.json`),
3 sets (`items/sets.json`), 4 unique effects (`items/unique-effects.json`), 9 cards (`items/cards.json`)
**Camera:** World layer at gameplay zoom; icons in the Build Identity Dashboard (`REQ-UX-003`)
**Output style:** Paper-doll layers + inventory icons

---

## 0. Two needs, never one asset

| Need | Where | Size | Question it answers |
|---|---|---|---|
| **World layer** | Composited onto a hunter, every facing, every frame | Fits the 64 × 80 hunter cell | *What is that hunter carrying?* |
| **Inventory icon** | Build Identity Dashboard, compare view, loot notices | 48 × 48 `@1x` | *Which item is this, and how good?* |

**O-7 applies hard here.** At the 0.55 zoom floor a hunter is 31 px tall. So:

| Slot | Types | World layer | Icon |
|---|---|---|---|
| weapon | `blade` `maul` `bow` `stave` | **Yes** — defines the silhouette | Yes |
| offhand | `shield` `focus` | **Yes** | Yes |
| body | `cuirass` `robes` | **Yes** — via the outfit layer | Yes |
| head | `helm` | Yes, P1 | Yes |
| hands | `gauntlets` `wraps` | **No** — 2–4 px | Yes |
| feet | `greaves` `boots` | **No** | Yes |
| trinket | `charm` `sigil` | **No** | Yes |

`REQ-EQP-004`: all equipment is tradable, never bound to a hunter. So no item's art may imply an
owner — no personal heraldry, no names.

---

## 1. Rarity: signal on the frame, not the object

`items/rarities.json` gives each rarity its hex and its sockets. The art rule:

> **Rarity is shown on the icon frame and socket pips — never by making the object glow.**

| Rarity | Hex | Sockets | Icon frame |
|---|---|---|---|
| Common | `#8c98a8` | 0 | Plain 1 px frame |
| Refined | `#dde3ea` | 0–1 | 1 px frame, corner ticks |
| Rare | `#5b8dd6` | 1 | 2 px frame |
| Epic | `#b58bd6` | 1–2 | 2 px frame, notched corners |
| Ancient | `#d9a441` | 2–3 | 2 px frame, notched, inner line |
| Legendary | `#d4685f` | 2–3 | 3 px frame, notched, inner line, corner studs |

Frames differ by **shape as well as hue**, so rarity survives colour-blindness
(`ART_BIBLE.md` §12.4). One frame asset + a hue table (O-5), not six.

`REQ-EQP-003` — "Perfect" is not a rarity but an item whose substats all rolled maximum. It gets
**no special art** beyond a small corner mark on the icon; it must not look like a seventh rarity.

`REQ-EQP-007` — Legendary equipment *changes how a build works*. So a legendary's world sprite
gets a **distinct silhouette**, not a colour or a glow: it should look like a different kind of
tool, not a shinier one.

---

### Category negative prompt

Appended to the master negative in `ART_BIBLE.md` §3 by `art/prompts/build.mjs`.

```
oversized weapon, fantasy greatsword, glowing blade, enchanted glow, magic staff crystal,
runes, encrusted gems, gold filigree, skulls, dragon motifs, personal heraldry, engraved names,
trading card, stat block, rarity glow, rainbow colours
```

## 2. Asset specifications

### `EQP_WEAPON_<TYPE>` — world layer · P0 (`bow`, `blade`, `stave`), P1 (`maul`)

**2. Purpose** — The weapon is the strongest single identity read on a hunter after the archetype
silhouette. It also tells the Hunter AI story visually: a bow means ranged, a maul means
committed melee (`rangeBand` in `item-types.json`).

**3. Visual** — Working tools, not heroic props. Length and mass are true to scale against a
56 px hunter.

| Type | `rangeBand` | Silhouette rule |
|---|---|---|
| `blade` | melee 1.0 | Straight or slightly curved, one hand, hip-carried when not in use |
| `maul` | melee 1.0 | Two-handed, heavy head — the widest weapon silhouette |
| `bow` | ranged 0.85 | Tall recurve arc, carried across the back when not drawn |
| `stave` | ranged 0.6 / mid 0.4 | Vertical line taller than the hunter; plain wood, no crystal |

**4. Views** — Per type: **3 tiers** (matching outfit tiers) × the full Tier A state matrix of
every skeleton that can wield it × 2 facings + mirror (4 for bows — see §2 of `specs/02`).
Tiers differ by material and wear: T1 plain, T2 fitted and bound, T3 fine work.

**8. Layering** — `weapon_main` slot. The sidecar declares `weaponBehind: true` for `ne`/`nw`.

**9. Path** — `art/equipment/world/<type>/eqp_<type>_t<N>_<skeleton>_<state>_<facing>_<NN>@2x.png`

**13. Acceptance**
- [ ] The four weapon types distinguishable on a hunter at 0.55
- [ ] Composites on every skeleton that can wield it, every frame, no clipping
- [ ] No glow, no runes, no enchantment effects at any rarity

**14. Prompt** (world layer)
```
<MASTER STYLE PROMPT>
Isometric pixel-art weapon layer for a character sprite: a <TYPE BRIEF>, tier <N>.
A working tool made by a frontier smith, true to real scale, no ornament, no glow, no runes.
Drawn alone on a transparent 64 by 80 canvas in the exact position it is held in a neutral
standing pose, true 2:1 dimetric, facing south-east.
<MASTER NEGATIVE PROMPT> + oversized weapon, fantasy greatsword, glowing blade, magic staff crystal
```

---

### `EQP_OFFHAND` — world layer · P0

`shield` (round timber-and-hide, iron boss; the Vanguard's low mass) and `focus` (a hand-held
lens, bell or bound book — something an Adept *uses*, not wears). 3 tiers each.

---

### `EQP_ICON_<TYPE>` — inventory icons · P0 (weapons, offhand, body), P1 (head), P2 (hands, feet, trinket)

**2. Purpose** — The Build Identity Dashboard (`REQ-UX-003`) and the compare view answer
*"what kind of hunter is this?"* at a glance. Icons carry that on the equipment row.

**3. Visual** — The object alone, three-quarter view, filling ~80% of a 48 × 48 cell, on
transparent. Same pixel grid and lighting rig as the world — **not a separate flat-vector icon
language**.

**4. Views** — 15 types × 3 tiers = **45 icons**, plus 1 rarity frame + hue table.

**6. Format** — 48 × 48 `@1x` (96 × 96 `@2x`), downsampled to 32 and 24 at build time (O-1).

**9. Path** — `art/equipment/icons/eqp_icon_<type>_t<N>@2x.png`

**13. Acceptance**
- [ ] All 15 types distinguishable at 24 × 24
- [ ] Reads identically on all six rarity frames
- [ ] No text, no stat numbers baked in

**14. Prompt template**
```
<MASTER STYLE PROMPT>
Pixel-art inventory icon of a single <ITEM BRIEF>, tier <N>, three-quarter view,
filling about 80 percent of a 96 by 96 canvas, lit from the upper left. A practical
frontier item, no glow, no runes, no gems unless the item is a sigil or charm.
Fully transparent background, no frame, no border, no shadow, no text.
<MASTER NEGATIVE PROMPT>
```

---

### `EQP_SET_<ID>` — set visual motifs · P2

`REQ-EQP-006`: sets exist at 2/3/4 pieces and must not invalidate non-set gear. Visually, a set
is a **shared motif**, not a matching costume — a small mark repeated on each piece's icon and,
where a piece has a world layer, on that layer.

| Set | Name and flavour (`sets.json`) | Motif |
|---|---|---|
| `ashwardens` | *Ashwarden's Vigil* — *"Worn by hunters whose job was to still be standing at the end."* | Soot-darkened iron edging, a single ember-coloured stitch line |
| `quietstep` | *Quietstep* — *"Light, fast, and not where the counterattack lands."* | Wrapped cord bindings, muted grey-green |
| `lantern_order` | *Vestments of the Lantern Order* — *"went into the dark specifically to bring people back out."* | A small hooded-lantern badge; lantern gold |

**Acceptance** — a 2-piece set hunter is recognisable as wearing *part of* a set at 1.0 zoom,
without looking better than a hunter in unmatched gear of the same tier.

---

### `EQP_UNIQUE_<ID>` — unique effect marks · P2

Four unique effects in `unique-effects.json`: *The Long Argument*, *The Widow's Ledger*, *The Iron
Promise*, *Cold Arithmetic*. Each gets **one silhouette variant** of the item type it rolls on —
e.g. *The Iron Promise* on a shield becomes a shield with a chain wrapped through the boss — per
`REQ-EQP-007` (build-changing, so shape-changing). Icon + world layer where the slot has one.

---

### `EQP_CARD_<ID>` — cards · P1 (regular), P2 (boss)

**2. Purpose** — Cards are build-changing (`REQ-CRD-001`). `ART_DIRECTION.md` asset 06 lists
*"card and equipment reveal art — high-value collectible moments"*.

**Anti-goal check.** `DESIGN_BIBLE.md` §129 lists *"hero collector"* as an anti-goal, and the
master negative prompt bans the trading-card layout. So cards are drawn as **physical objects in
the world** — an engraved plate, a carved token — never as a portrait card with a frame and a
stat block.

| Card | Rarity | Source | Object |
|---|---|---|---|
| `bulwark_sigil` | rare | drop | Iron plate stamped with a wall |
| `tidebound_charm` | rare | drop | Tide-worn stone on a cord |
| `quartermasters_seal` | rare | drop | Wax seal on a tag |
| `counterpoise` | epic | drop | Balanced brass weight |
| `long_watch` | epic | drop | Worn watch-candle stub |
| `hoarfrost_lens` | epic | drop | Frosted glass disc |
| `warden_of_ash_card` | legendary | boss `warden_of_ash` | A coal still warm in a stone setting |
| `hollow_choir_card` | legendary | boss `the_drowned_choir` | A small drowned bell |
| `emberheart_card` | legendary | boss `emberheart` | **Blocked** — see below |

> **Content gap, flagged.** `emberheart_card` names `bossId: "emberheart"`, which does not exist
> in `monsters.json`. No art until the boss exists or the card's source changes.

**Boss cards** (`REQ-CRD-002`, 0.5% drop) get a **reveal animation**: 8 frames, the object turning
once in the hand-light. That is the "high-value moment" — earned by motion, not by a gold frame.

**Acceptance** — none looks like a trading card; each reads as a physical object at 48 × 48;
the three legendary cards visibly relate to their source.

---

## 3. Production order

| Step | Assets |
|---|---|
| 1 | Rarity frame + hue table (O-5) |
| 2 | `EQP_WEAPON_BOW/BLADE/STAVE`, `EQP_OFFHAND`, T1 — with the hunter skeletons |
| 3 | Their icons + `EQP_ICON_CUIRASS/ROBES` — for the Build Identity Dashboard |
| 4 | T2/T3, `maul`, `helm`, remaining icons |
| 5 | Cards, set motifs, unique-effect silhouettes |
