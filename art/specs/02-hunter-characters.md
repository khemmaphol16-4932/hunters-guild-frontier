# Category 02 — Hunter Characters

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md` (all rules below inherit from it)
**Scope:** Every playable hunter in the game
**Target platform:** Web (Vite + TypeScript, DOM/canvas — **no Unity in this project**)
**Camera:** Fixed 2:1 dimetric, no rotation, zoom 0.55–1.8
**Output style:** Layered paper-doll sprite sheets, PNG + sidecar JSON

---

## 0. The scoping correction that drives this whole category

A reasonable first instinct is "produce the 8 starting guild hunters as 8 characters."
**That is wrong for this codebase, and producing it would waste the budget.**

`GuildCommands.foundGuild()` creates **four** hunters:

```ts
this.recruit({ archetype: 'vanguard', personality: 'stoic'      }),
this.recruit({ archetype: 'vanguard', personality: 'reckless'   }),
this.recruit({ archetype: 'adept',    personality: 'protective' }),
this.recruit({ archetype: 'ranger',   personality: 'opportunist' }),
```

…and `recruit()` **generates** them: name drawn from one of five origin pools in
`src/data/names.json`, attributes and potential rolled from a seeded RNG, traits and
personality assigned from `traits.json` / `personalities.json`. Every new save, every
recruitment, and every New Game+ cycle produces different people. Recruitment is endless.

There is no cast to draw. Bespoke per-hunter art is therefore impossible in principle, not
merely expensive — and it would break `REQ-HUN-007` (two hunters of the same class must not
look or behave identically) the moment two Vanguards appeared.

**The lock:** three archetype skeletons carry all animation; identity is a composited
paper-doll layer set. Any generated hunter resolves to a unique visual without new art.

### What the player must be able to read, from the sprite alone

| Read | Source | Carried by |
|---|---|---|
| Archetype / role | `archetypes.json` `roleLean` | Skeleton silhouette + role pip |
| This is a *specific person* | generated name + origin | Hair, outfit culture, body layer |
| Origin culture | `names.json` pool | Outfit layer set |
| What they are doing now | `townJobs`, `availability` | Animation state |
| Condition | `REQ-HUN-011` hunger/fatigue/morale | Condition overlay |
| Tier / investment | equipment tier | Outfit tier + weapon layer |

---

## 1. Combinatorics

| Layer | Variants | Notes |
|---|---|---|
| Skeleton | 3 | `vanguard` `adept` `ranger` |
| Body | 6 | 4 skin ramps × build variation |
| Hair | 10 styles × 6 colours = 60 | Silhouette-bearing |
| Outfit | 5 origins × 3 archetypes × 3 tiers = 45 | |
| Weapon | 15 item types | `items/item-types.json` |
| Pack | 4 | pack / quiver / satchel / none |

Distinct visual hunters ≈ `6 × 60 × 45 × 15 × 4` — far beyond any need. The practical
guarantee: **no two hunters in a 40-hunter guild will share an appearance.**

---

## 2. Shared rules for every asset in this category

**Views:** author `se` and `ne`. Mirror to `sw` and `nw` at runtime.
**Exception:** asymmetric kit (scabbard side, quiver, eyepatch) is authored in all four.

**Pivot:** `(32, 72)` on a 64 × 80 @1x canvas — bottom-centre of the ground footprint, feet
on the ground plane, 8 px overhang below.

**Scale:** 56 px standing height @1x. Head-to-height about 1:4.5, soft cute-chibi (DL-069). Head ≈ 12 px.

**Palette:** environment palettes from `ART_BIBLE.md` §6.2. The nine functional hues in §6.1
may appear **only** on the role pip and condition overlay — never on cloth, leather, or skin.

**Colour cap:** 32 unique colours per composited hunter.

**Animation:** 12 fps. Tier A states are mandatory for every skeleton.

**Frame 01 of every loop must be a valid standalone pose** — `reducedMotion` holds there.

### Category negative prompt (appended to the master negative in `ART_BIBLE.md` §3)

```
character portrait, bust shot, face closeup, detailed facial features, rendered eyes,
heroic pose, action pose, dynamic pose, flying cape, wind effects, hero splash art,
character select screen, class icon, oversized weapon, dual wielding for style,
glowing weapon, enchanted glow, magic aura, energy effects, armour spikes,
pauldrons larger than the head, high heels, impractical armour, exposed midriff,
extreme 1:3 mascot proportions, baby anatomy, moe, cute mascot, generic RPG adventurer, elf ears,
horns, wings
```

---

## 3. Asset specifications

---

### `HUN_SKEL_VANGUARD`

**1. Name / ID** — Vanguard skeleton · `HUN_SKEL_VANGUARD`

**2. Gameplay purpose** — Base animation rig for every hunter whose build identity resolves
to the `vanguard` region of the constellation. Carries all Tier A animation; the body layer,
outfit, and weapon composite on top. `roleLean` is tank 0.55 / damage 0.25 / control 0.15,
`rangeBand` melee 0.8 — the silhouette must promise *holds ground*.

**3. Visual description** — Broad-shouldered, weight low and centred, stance slightly wide
with feet planted. Mass concentrated at shoulders and shins. Reads as someone who intends to
still be standing in the same place shortly. Not a bodybuilder — a person who does heavy work
and expects to be hit.

**4. Views / poses / animation states**

| State | Frames | Loop | Notes |
|---|---|---|---|
| `idle` | 4 | yes | Weight shift, breath. Shield arm settled |
| `walk` | 8 | yes | Heavy, ~0.9× base speed read |
| `attack` | 6 | no | Step-in, commit, recover. Impact on frame 03 |
| `hit` | 2 | no | Absorb, not stagger — this is the tank |
| `downed` | 3 + hold | hold | `REQ-CBT-012`. Frame 03 holds until rescue or death |

× 2 authored facings (`se`, `ne`) = **46 frames**

**5. Style / palette** — `ART_BIBLE.md` §2 master style. Base skeleton authored in a neutral
grey ramp; all colour arrives via layers.

**6. Format / resolution** — PNG-8 + alpha. Cell 128 × 160 @2x (64 × 80 @1x). Horizontal
strip per state per facing.

**7. Transparency** — Fully transparent, binary alpha on the silhouette edge. No baked shadow.

**8. Layering / pivot** — Pivot `(32, 72)` @1x. Layer order bottom→top:
`shadow · body · outfit_legs · outfit_body · pack · hair · outfit_head · weapon_offhand ·
weapon_main · condition_overlay · role_pip`.
`weapon_main` draws **behind** the body on `ne`/`nw` facings — the sidecar JSON declares a
per-facing `weaponBehind: true` flag.

**9. Naming / path**
```
art/characters/vanguard/hunter_vanguard_skel_<state>_<facing>_<NN>@2x.png
art/characters/vanguard/hunter_vanguard_skel_<state>_<facing>.json
```

**10. Variants / tiers** — None. The skeleton is invariant; tiering happens in outfit and
weapon layers.

**11. Appearance in the continuous world** — Walks the town grid between buildings
(`REQ-TWN-001`), walks the road out of the gate, fights where detection occurs
(`REQ-CW-003`), walks home, and recovers — **the same sprite throughout**, no battle variant.

**12. System connections** — `archetypes.json` `vanguard`; `buildIdentity.profileOf()`
→ `primaryRole`, already used for `role-${primaryRole}` in `worldView.renderRoster()`;
`townJobs` for `work` states; `availability` for `describeAvailability()`; `REQ-CBT-012`
downed/rescue.

**13. Acceptance criteria** — `ART_BIBLE.md` §13 global gate, plus:
- [ ] Silhouette distinguishable from `adept` and `ranger` at 55% zoom, black-filled
- [ ] `walk` loops seamlessly — frame 08 → frame 01 with no pop
- [ ] `attack` impact lands on frame 03 (combat timing hook)
- [ ] `downed` frame 03 is legible as *downed, not dead* at 0.55 zoom
- [ ] Every layer slot has correct clearance — no outfit clipping at any frame
- [ ] Composites correctly with all 45 outfit variants without z-fighting

**14. Generation prompt**
```
<MASTER STYLE PROMPT>

Isometric pixel-art base character rig for a frontier hunter, "vanguard" archetype.
Broad-shouldered adult human, weight low and centred, feet planted in a slightly wide
stance. Built like someone who does heavy physical work and expects to be struck —
solid, practical, not muscular fantasy. Plain neutral grey undergarment only: this is a
base body rig, clothing is added as a separate layer. Soft cute-chibi proportions, about 1 to 4.5 head-to-height.
No facial detail beyond two-pixel eyes. Viewed at true 2:1 dimetric from above,
facing south-east. Neutral standing pose, arms slightly away from the body for
clean layer separation, ready for rigging. 56 pixels tall on a 64 by 80 canvas,
feet on the ground plane at the bottom centre.
Fully transparent background, no shadow, no ground.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT>
```

**15. Variation prompt**
```
Same base rig, same proportions, same palette, same lighting, same 2:1 dimetric angle.
Change ONLY: [facing to north-east | pose to frame NN of the walk cycle].
The figure must be recognisably the identical rig — do not restyle, do not resize,
do not change the head-to-body ratio, do not add clothing or equipment.
```

**16. Web implementation notes** — Composited once per equipment change into an offscreen
canvas, cached by `skeleton|body|hair|outfit|weapon|pack|state|facing` (`ART_BIBLE.md` §12.3).
Never composite per frame. `image-rendering: pixelated`. Camera translate rounded to whole
device pixels or the sprite shimmers while panning.

---

### `HUN_SKEL_ADEPT`

**2. Gameplay purpose** — Base rig for `adept` builds. `roleLean` healer 0.4 / damage 0.3 /
control 0.2, `rangeBand` ranged 0.65 / mid 0.35. Silhouette must promise *acts at distance,
mends or unmakes*.

**3. Visual description** — Tall and vertical. Long robe or coat breaking the leg silhouette
into one column. Stave held upright creates a second strong vertical. Narrow shoulders, hands
forward and visible — the hands are where the work happens. Posture attentive rather than
braced.

**4. States** — Same Tier A matrix, but `attack` is replaced by `cast` (6 frames: gather,
shape, release, recover — release on frame 04). Ranged release must be legible at 0.55 zoom
*without* relying on the projectile VFX, since VFX may be reduced.
× 2 facings = **46 frames**

**5–10.** As `HUN_SKEL_VANGUARD`, path `art/characters/adept/`.

**11. Continuous world** — Frequently assigned `infirmary_rounds` and `archive_work`
(`town/jobs.json`); must read as *working* from across the town square.

**12. System connections** — `archetypes.json` `adept`; `skillTags` `arcane` `restorative`
`elemental` `magical`; `REQ-CBT-011` healing/rescue AI.

**13. Acceptance** — global gate, plus:
- [ ] Vertical silhouette distinct from `ranger` at 55% — the failure mode is both reading
      as "thin person with a stick"
- [ ] `cast` release legible with all VFX disabled
- [ ] Robe hem does not clip the ground plane at any walk frame

**14. Generation prompt**
```
<MASTER STYLE PROMPT>

Isometric pixel-art base character rig for a frontier hunter, "adept" archetype.
Tall slender adult human in a plain long robe reaching mid-calf, creating a single
strong vertical silhouette. Narrow shoulders, hands held forward and clearly visible,
attentive upright posture. A scholar who walks into dangerous country, not a wizard:
practical cloth, no ornament, no runes, no glow. Soft cute-chibi proportions, about 1 to 4.5 head-to-height.
No facial detail beyond two-pixel eyes. True 2:1 dimetric from above, facing south-east.
Neutral standing pose, arms slightly away from the body for clean layer separation.
56 pixels tall on a 64 by 80 canvas, feet on the ground plane at bottom centre.
Fully transparent background, no shadow, no ground.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + glowing runes, magic circle,
floating objects, pointy wizard hat, staff with a crystal, spell effects
```

**15–16.** As `HUN_SKEL_VANGUARD`.

---

### `HUN_SKEL_RANGER`

**2. Gameplay purpose** — Base rig for `ranger` builds. Skirmishers and marksmen.
Silhouette must promise *mobile, ranged, reads the ground*.

**3. Visual description** — Lean and asymmetric — the defining trait. Bow arc across the
back, quiver on one side, one shoulder lower. Weight forward on the balls of the feet.
Layered practical travel clothing, sleeves bound. Looks mid-journey even when standing still.

**4. States** — Tier A matrix; `attack` is a 6-frame draw-and-loose, release on frame 04.
`walk` runs ~1.1× base speed read. × 2 facings = **46 frames**

**5–10.** As above, path `art/characters/ranger/`. **Asymmetry note:** the quiver/bow side is
fixed, so `sw` and `nw` are **authored, not mirrored** — mirroring would flip the quiver.
This skeleton is therefore **92 frames**, not 46.

**11. Continuous world** — The natural `field_survey` and `gate_watch` hunter. Visible on the
road more than any other archetype.

**12. System connections** — `archetypes.json` `ranger`; `bow` item type
(`rangeBand` ranged 0.85); `REQ-CW-014` knowledge advancement through investigation.

**13. Acceptance** — global gate, plus:
- [ ] Asymmetry visible at 55% zoom — this is the whole identity read
- [ ] All four facings authored; **no mirroring** (quiver side must stay fixed)
- [ ] Bow arc does not merge with the body silhouette on `ne`/`nw`

**14. Generation prompt**
```
<MASTER STYLE PROMPT>

Isometric pixel-art base character rig for a frontier hunter, "ranger" archetype.
Lean athletic adult human, deliberately asymmetric silhouette: one shoulder lower,
weight forward on the balls of the feet, bound sleeves, layered practical travel
clothing worn soft with use. Reads as someone who has been walking for days.
Soft cute-chibi proportions, about 1 to 4.5 head-to-height. No facial detail beyond two-pixel eyes.
True 2:1 dimetric from above, facing south-east. Neutral standing pose,
arms slightly away from the body for clean layer separation.
56 pixels tall on a 64 by 80 canvas, feet on the ground plane at bottom centre.
Fully transparent background, no shadow, no ground.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + hood covering the whole face,
assassin, ninja, cloak billowing, rogue stereotype
```

**15–16.** As `HUN_SKEL_VANGUARD`, but variation prompts must **never** mirror the figure.

---

### `HUN_LAYER_OUTFIT_<ORIGIN>`

**1. ID** — `HUN_LAYER_OUTFIT_FRONTIER` / `_MARSHFOLK` / `_HIGHLAND` / `_COLLEGIUM` / `_FARROAD`

**2. Gameplay purpose** — Makes each generated hunter a specific person, and makes the five
origin pools in `src/data/names.json` **visible in the world** rather than buried in a data
file. A hunter named Ceri Reedmere should look like they came from somewhere wet.

**3. Visual description** — one culture set per origin, from the `$note` fields already
written into `names.json`:

| Origin | `names.json` note | Visual language |
|---|---|---|
| `frontier` | the default pool | Honest working kit: canvas, boiled leather, wool. Warm browns, faded red |
| `marshfolk` | *"soft consonants, water and weather"* | Oilcloth, reed weave, rolled cuffs, muted green and silt |
| `highland` | *"hard, short, weather and stone"* | Heavy wool, fur trim, iron pins, blue-grey and undyed cream |
| `collegium` | *"latinate, faintly pleased with itself"* | Layered cloth, belts, satchels, ink-stained cuffs, deep neutrals |
| `farroad` | *"deliberately heterogeneous — that is the point"* | Mismatched by design: no two pieces from the same place |

**4. Views / states** — Must deform correctly across **every frame of every Tier A state**
for its archetype. Authored as a per-frame overlay, not a static decal.

**6. Format** — PNG-8 + alpha, cell matching its skeleton exactly.

**8. Layering** — Splits into `outfit_legs`, `outfit_body`, `outfit_head` so head gear can be
swapped without re-authoring the body.

**9. Naming / path**
```
art/characters/outfits/<origin>/hunter_outfit_<origin>_<archetype>_t<N>_<state>_<facing>_<NN>@2x.png
```

**10. Variants / tiers** — 3 tiers matching equipment investment. T1 plain and worn, T2
reinforced with visible repair, T3 well-made and maintained. **Tier reads through material
and condition, never through ornament or glow** — the same rule as buildings.

**11. Continuous world** — This is the layer a player actually recognises a hunter by from
across the town square.

**12. System connections** — `town/origins.json`; `names.json` pools; equipment tier;
`REQ-HUN-007` (same class must not look identical).

**13. Acceptance**
- [ ] Composites cleanly on all 3 skeletons with no clipping at any frame
- [ ] Five origins distinguishable side by side at 100% — cultural read, not palette swap
- [ ] Three tiers distinguishable **without** colour — material and wear only
- [ ] Contains **no** §6.1 functional hue
- [ ] Does not obscure the archetype silhouette read at 55%

**14. Generation prompt** (example: marshfolk / ranger / T2)
```
<MASTER STYLE PROMPT>

Isometric pixel-art clothing layer for a frontier hunter character sheet.
Culture: marshfolk — people of reed beds, slow water, and constant weather.
Waxed oilcloth coat, reed-woven belt and pouches, rolled and bound cuffs,
practical hood down. Reinforced at the shoulders and knees with visible honest
repair — this is tier 2 kit, mended and maintained, not new and not ruined.
Palette: muted greens, silt brown, undyed grey-cream, dull horn buttons.
No heraldry, no bright dye, no ornament.
Drawn as a clothing overlay for an existing lean asymmetric body rig,
true 2:1 dimetric from above, facing south-east, neutral standing pose.
Aligned to a 64 by 80 canvas with the body at 56 pixels tall.
Fully transparent background, clothing only, no body, no head, no weapon.

<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + armour plate, chainmail,
heraldry, tabard, bright dye, clean new fabric, fantasy robes
```

**15. Variation prompt**
```
Same culture, same palette, same materials, same lighting, same dimetric angle.
Change ONLY: [tier to T1 plainer and more worn | tier to T3 better made and maintained |
archetype cut to vanguard/adept | facing to north-east].
Keep it recognisably the same cultural wardrobe. Do not change the palette family,
do not add ornament, do not add heraldry.
```

---

### `HUN_LAYER_HAIR`

**2. Purpose** — Primary cheap identity signal. Silhouette-bearing: hair is often the only
thing separating two hunters in the same kit at 0.55 zoom.

**4. Views** — 10 styles × 4 facings. **Back views authored separately** — this is exactly
the case where mirroring fails.

**10. Variants** — 10 styles × 6 colours (black, dark brown, auburn, ash blond, grey, white).
Colours are applied as ramp swaps at build time, not authored 60 times.

**13. Acceptance**
- [ ] Each of the 10 styles distinguishable **in black-fill silhouette** at 55%
- [ ] Back views authored, not mirrored
- [ ] Composites under `outfit_head` without clipping
- [ ] Ramp swap produces all 6 colours with no manual fix-up

---

### `HUN_OVERLAY_CONDITION`

**2. Purpose** — Makes `REQ-HUN-011` (hunger, fatigue, morale) and `REQ-CW-015` (an
assignment queued behind injury *visibly explains the delay*) readable **in the world**. This
overlay is the single clearest expression of `REQ-PRIME-008` in the whole category: the
condition meters already exist in `worldView.renderInspector()`, and this is what gets them
out of the panel and into the town.

**3. Visual description** — Posture and small-mark modifiers, not icons floating overhead:

| Condition | Visual |
|---|---|
| Fatigued | Shoulders drop 1–2 px, walk cycle slows, longer idle hold |
| Hungry | Slight hunch, hands closer to body |
| Low morale | Head angle down 1 px, slower idle |
| Injured | Limp in `injured_walk`, visible bound arm or leg |
| Recovering | Seated or leaning near the infirmary |
| Queued (`REQ-CW-015`) | Waiting stance near the assignment's building |

**8. Layering** — Small-mark elements (bindings) are an overlay; posture changes are separate
animation frames on the skeleton, not an overlay. Both are listed here because they are one
design idea.

**13. Acceptance**
- [ ] Each condition readable at 0.55 zoom without a UI element
- [ ] Injury read survives all 5 origin outfits
- [ ] Never uses a §6.1 functional hue — condition is posture and mark, not colour
- [ ] `reducedMotion`: condition still readable when animation holds on frame 01

---

### `HUN_OVERLAY_ROLE_PIP`

**2. Purpose** — The one deliberate exception to "no UI on the sprite". A small
ground-anchored pip showing `buildIdentity.profileOf(h).primaryRole` — already driving the
`role-${primaryRole}` class in `worldView.renderRoster()`. Lets a player scan a working town
and see party composition without opening anything.

**3. Visual description** — 10 × 10 px pip at the pivot, at the front edge of the contact
shadow. **Shape and colour both encode the role**, never colour alone:

| Role | Hex (§6.1) | Shape |
|---|---|---|
| Tank | `#5b8dd6` | Shield — flat top, tapered base |
| Healer | `#5fbf87` | Cross |
| Damage | `#d4685f` | Chevron |
| Support | `#b58bd6` | Circle |
| Control | `#4fb0b8` | Diamond |

**13. Acceptance**
- [ ] All 5 distinguishable at 0.55 zoom
- [ ] All 5 distinguishable **in greyscale** (colour-blindness, `ART_BIBLE.md` §12.4)
- [ ] Never overlaps the character silhouette
- [ ] Can be disabled by preference without breaking any other read

---

## 4. Production order

| Step | Assets | Gate |
|---|---|---|
| 1 | `REF_HUNTER_TURNAROUND` — 3 archetypes × 4 facings, neutral | **Approve before any animation** |
| 2 | `HUN_SKEL_VANGUARD` Tier A | Silhouette + 0.55 zoom gate |
| 3 | `HUN_LAYER_BODY`, `HUN_LAYER_HAIR` | Compositing pipeline proven end to end |
| 4 | `HUN_LAYER_OUTFIT_FRONTIER` T1 | First fully composited hunter in the world |
| 5 | `HUN_SKEL_ADEPT`, `HUN_SKEL_RANGER` Tier A | Line-up test across all three |
| 6 | `HUN_OVERLAY_ROLE_PIP` | |
| 7 | Remaining outfits, Tier B states, condition overlay | |

**Stop-and-review after step 4.** One hunter, fully composited, walking the town at 0.55 /
1.0 / 1.8 zoom is the real test of every rule in `ART_BIBLE.md`. Finding a projection, scale,
or palette error there costs one asset. Finding it after step 7 costs several hundred.
