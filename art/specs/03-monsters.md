# Category 03 — Monsters and Bosses

**Status:** PROPOSED, 2026-09-12
**Requires:** `art/ART_BIBLE.md`, `art/specs/00-production-optimization.md` (O-2, O-3)
**Scope:** All 11 monsters in `src/data/combat/monsters.json`, one World Boss henchman set
**Camera:** Fixed 2:1 dimetric, no rotation, zoom 0.55–1.8 — **no combat camera**
**Output style:** Whole-sprite sheets (not paper-doll), PNG + sidecar JSON

---

## 0. What the data demands of the art

Monsters are authored whole — there are only 11, and each is a single designed creature, so the
paper-doll system from category 02 would add cost without adding variety.

Four facts from `monsters.json` drive every spec below:

1. **Telegraphs are real, timed data.** Nine skills carry `telegraphSeconds`. `REQ-BOS-001`
   requires a visual, sound *and animation* telegraph, and the Hunter AI reacts to the wind-up,
   not the damage. **A telegraph is a pose first; VFX only reinforces it.** With VFX reduced the
   pose must still read.
2. **Some enemies heal.** `hollow_chanter` (`mend_kin`), `mire_weaver` (`weave_mend`) and
   `the_drowned_choir` (`many_voices`) have `healPower`. A player watching an enemy's health go
   *up* needs to see who did it, or the fight feels unfair.
3. **Two elements are in use**, `fire` and `frost` (of four listed in `skills.json`).
   `REQ-CBT-003`: reactions must be legible in combat, so an elemental monster must read as its
   element at 0.55 zoom. `storm` and `earth` are listed but unused — no asset is authored for them.
4. **Bosses have named phases** at health thresholds. A phase change must be visible in the
   world, because there is no phase-transition cutscene and no combat camera.

| Monster | Tier | Lv | Range | Element | Skills (telegraph) | Region / use |
|---|---|---|---|---|---|---|
| `moss_crawler` | trash | 3 | melee | — | — | Verdant Reach; `gate_thickets`; town defense |
| `thicket_wasp` | trash | 5 | melee | — | — | Verdant Reach; `old_orchard`; town defense |
| `quarry_hound` | trash | 8 | melee | — | `hamstring` → slow | Coldwater Quarry |
| `slag_thrower` | elite | 10 | ranged | fire | `molten_arc` AoE → burn **(1.2 s)** | Coldwater Quarry |
| `bracken_stalker` | elite | 12 | melee | — | `rend` → bleed | Ashfall Barrows; town defense `barrow_raid` |
| `cairn_archer` | elite | 14 | ranged | — | — | Ashfall Barrows |
| `hollow_chanter` | elite | 16 | mid | frost | `mend_kin` heal | Ashfall Barrows |
| `rot_shambler` | elite | 17 | melee | — | `sundering_blow` → bleed **(0.9 s)** | Sunken Choirhouse |
| `mire_weaver` | elite | 18 | mid | frost | `binding_silk` → stun **(1.0 s)**; `weave_mend` heal | Sunken Choirhouse |
| `warden_of_ash` | **boss** | 22 | melee | fire | `cinder_sweep` AoE → burn **(1.5 s)**; `ashen_grasp` **(2.0 s)** | Ashfall Barrows route boss |
| `the_drowned_choir` | **world boss** | 30 | mid | frost | `dirge` AoE → slow **(1.8 s)**; `undertow` → stun **(2.2 s)**; `many_voices` heal; `final_verse` AoE **(3.0 s)** | Ashfall world event (DL-055) |

> **Content mismatch, flagged not fixed.** `town/threats.json` `wolf_pack` is described as
> *"A wolf pack at the treeline"* but spawns `moss_crawler`. There is no wolf in the game. The
> art plan does **not** invent a wolf. Either the threat text changes or a wolf monster is added
> to `monsters.json` — a content decision, after which a spec row follows.

---

## 1. Shared rules

| Field | Trash | Elite | Boss (2×2) | World Boss (3×3) |
|---|---|---|---|---|
| Height `@1x` | 28–44 | 48–64 | 88–120 | 140–200 |
| Canvas `@1x` | 64 × 64 | 96 × 96 | 192 × 160 | 320 × 256 |
| Pivot `@1x` | `(32, 56)` | `(48, 88)` | `(96, 144)` | `(160, 232)` |
| Colour cap | 24 | 32 | 40 | 48 |
| Facings authored | 2 + mirror | 2 + mirror | **4** | **4** |

Bosses are authored in all four facings: their telegraphs are asymmetric (a sweep has a
leading arm), and a mirrored telegraph sends the Hunter AI's visual cue the wrong way.

### State matrix

| State | Frames | Loop | Notes |
|---|---|---|---|
| `idle` | 4 | yes | Every monster, always animated |
| `walk` | 6 (trash) / 8 | yes | |
| `attack` | 5 | no | Impact on frame 03 |
| `hit` | 2 | no | |
| `death` | 6 | no | Monsters die in every zone. Ends on a readable corpse frame that fades over 1 s — **no gore** |
| `windup_<skill>` | 3 + hold | hold | One per skill with `telegraphSeconds`. Frame 03 holds for the telegraph duration |
| `cast_<skill>` | 5 | no | Release |
| `heal` | 5 | no | Only for the three healers. Must visibly point at its target |
| `phase_<N>` | overlay | — | Bosses only; see §2.4 |

**Hold, don't animate, the telegraph.** `telegraphSeconds` of 3.0 at 12 fps would be 36
frames. Instead: 3 wind-up frames, then frame 03 holds for the remaining duration, with the
telegraph VFX (`specs/08-vfx.md`) looping over it. Three frames per telegraph instead of up to 36.

### Category negative prompt

```
cute, mascot, cartoon monster, pokemon style, extreme 1:3 mascot proportions, kawaii, gore, entrails, exposed organs,
blood pools, dripping blood, horror body, screaming faces, excessive teeth, excessive eyes,
glowing eyes everywhere, dragon, demon, generic orc, generic goblin, skeleton warrior,
zombie, tentacles for no reason, spikes everywhere, armour on animals, text, UI, health bar
```

---

## 2. Asset specifications

### 2.1 Trash

#### `MON_MOSS_CRAWLER` · `moss_crawler` · **P0**

- **Purpose** — The first enemy most players ever see: the proof-cycle Blue fight, the
  `gate_thickets` hunting ground, and the most common town-defense spawn. Must read as
  *fightable* — the frontier's everyday nuisance, not its teeth.
- **Visual** — A low, broad, slow creature of damp moss and bark plates, the size of a large
  dog, crawling on many short legs. Reads as *part of the undergrowth that got up*. Earth-green
  and bark-brown with a pale underside.
- **States** — Tier A matrix, no skills. 2 facings + mirror. **~25 frames.**
- **Path** — `art/monsters/moss_crawler/monster_moss_crawler_<state>_<facing>_<NN>@2x.png`
- **World** — In Verdant Reach grass and at the palisade during a defense event, at the same scale.
- **Systems** — `regions.json` Verdant Reach encounters; `threats.json` `gate_thickets`,
  `wolf_pack` (see the mismatch note above).
- **Acceptance** — silhouette distinct from `thicket_wasp` at 0.55; low and wide, never taller
  than a hunter's knee; readable on `ENV_VERDANT_REACH` grass (it must not camouflage *too* well).
- **Prompt**
  ```
  <MASTER STYLE PROMPT>
  Isometric pixel-art creature, a "moss crawler": a low broad slow-moving animal made of
  damp moss and overlapping bark plates, many short stubby legs, the size of a large dog,
  pale underside. It looks like a piece of forest floor that decided to walk. Not cute,
  not frightening — a nuisance. Palette: moss green, bark brown, pale lichen, slate shadow.
  True 2:1 dimetric, facing south-east, neutral idle pose, 40 pixels long on a 64 by 64 canvas,
  feet on the ground plane. Fully transparent background, no shadow.
  <MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT>
  ```
- **Variation** — Same creature, proportions, palette, lighting and angle. Change ONLY
  `[facing to north-east | pose to frame NN of <state>]`.

#### `MON_THICKET_WASP` · `thicket_wasp` · **P0**

- **Purpose** — Comes in swarms of 2–3 (`regions.json`), 3–4 in the `wasp_swarm` defense
  threat — *"The sound arrives a long time before they do."* The swarm is the read, not the
  individual.
- **Visual** — A hand-sized wasp scaled up to a small bird: amber and dark-banded, translucent
  wings as 2–3 flat pixel shapes, hovering. **Hovers 10 px above its pivot** so it reads as
  airborne; its contact shadow stays on the ground (O-2 handles the offset).
- **States** — `idle` is a 4-frame hover loop; `walk` = fly. 2 facings + mirror. **~25 frames.**
- **Acceptance** — three wasps overlapping still count as three at 0.55; wing flicker is not a
  seizure risk (no full-frame flashing; `reducedMotion` holds wings mid-beat).
- **Prompt subject** — *"a thicket wasp: a wasp the size of a small bird, amber with dark
  bands, two pairs of flat translucent wings, hovering, legs tucked"*.

#### `MON_QUARRY_HOUND` · `quarry_hound` · P1

- **Purpose** — Coldwater's fast melee threat. `hamstring` slows a hunter, so its attack should
  visibly go *low*, at the legs.
- **Visual** — Lean, grey, dust-coated hound, long legs, low head carriage, mineral scabs on the
  shoulders — something that has lived in the quarry spoil.
- **States** — Tier A + `cast_hamstring` (low bite). No telegraph (the skill has none).
- **Prompt subject** — *"a quarry hound: a lean long-legged grey hound coated in stone dust,
  low-carried head, mineral scabs across the shoulders"*.

### 2.2 Elites

Elites share one visual rule: **one silhouette-defining feature the trash tier lacks** — a
weapon, a posture, an object — so a player can pick the elite out of a mixed encounter at 0.55.

| ID | Defining feature | Visual brief | Skill states | Pri |
|---|---|---|---|---|
| `MON_SLAG_THROWER` | Glowing crucible it hurls from | Squat, heat-scarred, arms long enough to lob. **Fire**: ember glow in the crucible is its element read | `windup_molten_arc` (1.2 s — crucible raised overhead), `cast_molten_arc` | P1 |
| `MON_BRACKEN_STALKER` | Hooked forelimbs | Tall, thin, bent-forward thing of dead bracken and ash, moving in straight lines (*"it walked in a straight line, and it did not stop at the ditch"*) | `cast_rend` | P2 — **also appears in town defense** (`barrow_raid`), so it must read against town ground too |
| `MON_CAIRN_ARCHER` | A bow made from a cairn-stone stave | Barrow-dweller, stone-grey, hunched, drawing a heavy bow. Must read as ranged **at distance** | Tier A with ranged `attack` | P2 |
| `MON_HOLLOW_CHANTER` | Open, singing posture | Robed, hollow-chested figure; **frost** read through rime on its edges | `heal` (`mend_kin`) — arms out toward its target | P2 |
| `MON_ROT_SHAMBLER` | Oversized dragging arm | Waterlogged, heavy, lurching; the arm is the threat | `windup_sundering_blow` (0.9 s — arm dragged back), `cast_sundering_blow` | P2 |
| `MON_MIRE_WEAVER` | Silk strands between its limbs | Spindly marsh weaver, many-jointed; **frost** read through a pale icy sheen on the silk | `windup_binding_silk` (1.0 s), `cast_binding_silk`, `heal` (`weave_mend`) | P2 |

**Elite acceptance, all six:**
- [ ] Picked out of a mixed encounter at 0.55 by silhouette alone
- [ ] Elemental elites (`slag_thrower` fire; `hollow_chanter`, `mire_weaver` frost) read as
      their element with VFX disabled
- [ ] Every `windup_*` frame 03 is readable as *"something is coming"* without VFX
- [ ] Healers visibly direct their heal at a target

**Elite prompt template**
```
<MASTER STYLE PROMPT>
Isometric pixel-art elite creature for a frontier fantasy management RPG: <VISUAL BRIEF>.
Its single defining silhouette feature is <DEFINING FEATURE>, which must read clearly even
as a pure black silhouette at small scale. Grounded and strange rather than monstrous;
no gore. True 2:1 dimetric, facing south-east, neutral idle pose, <HEIGHT> pixels tall on a
96 by 96 canvas, feet on the ground plane. Fully transparent background, no shadow.
<MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT>
```

### 2.3 `MON_WARDEN_OF_ASH` · `warden_of_ash` · boss · P2

- **Purpose** — Ashfall Barrows' route boss. Level 22, fire, 1,600 HP. Its `$note` in the data:
  *"Every important skill carries a telegraph, so the AI can react to a wind-up rather than to
  the damage after the fact."* The art is how the player sees what the AI is reacting to.
- **Visual** — A towering keeper of the barrows: a figure of fused grave-stone and banked coals,
  wearing the ash like a mantle. Heat shows through cracks. Deliberate and slow, a guardian
  rather than a beast.
- **States** — Tier A + `windup_cinder_sweep` (**1.5 s** — the coal-arm drawn wide, the sweep's
  arc readable from the pose), `cast_cinder_sweep`, `windup_ashen_grasp` (**2.0 s** — one hand
  opening toward a single target), `cast_ashen_grasp`. **4 facings authored.**
- **Phases** (`phases` in data):

  | Phase | Threshold | Visible change (overlay, not a new sheet) |
  |---|---|---|
  | base | 100–50% | Coals banked, dull glow in the cracks |
  | **Kindling** | < 50% | Cracks brighten and widen; ember motes rise |
  | **Conflagration** | < 20% | Flame breaks through the mantle; the ash cloak burns away |

- **Canvas** — 192 × 160 `@1x`, pivot `(96, 144)`, 2 × 2 footprint.
- **Acceptance** — each telegraph pose readable at 0.55 with VFX off; phase overlays readable
  at a glance; the sweep's direction correct in all four facings.
- **Prompt**
  ```
  <MASTER STYLE PROMPT>
  Isometric pixel-art boss creature, "the Warden of Ash": a towering, slow guardian of burial
  terraces, built from fused grave-stone and banked glowing coals, wearing a heavy mantle of
  grey ash like a cloak. Dull ember light shows through cracks in the stone. Solemn and
  deliberate, a keeper rather than a beast. No face, no gore. Palette: ash grey, scorched
  earth, bone, ember orange-red. True 2:1 dimetric, facing south-east, neutral idle pose,
  110 pixels tall on a 192 by 160 canvas, occupying a 2 by 2 tile footprint.
  Fully transparent background, no shadow.
  <MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + fire demon, balrog, lava monster
  ```
- **Variation** — Same creature, same proportions and lighting. Change ONLY `[facing |
  wind-up pose for cinder sweep: coal-arm drawn wide to one side | phase overlay: brighter,
  wider cracks with rising embers]`.

### 2.4 `MON_THE_DROWNED_CHOIR` · `the_drowned_choir` · world boss · P2

- **Purpose** — The World Boss (`REQ-BOS-003`). It *"appears in the Ashfall Barrows as an
  explicit world event"* and respawns (DL-055), may change weather and lighting on arrival
  (`REQ-CW-013`), and creates Guild Chronicle entries. The single biggest visual event in the game.
- **Visual** — **Not one creature: many.** The name and its skills — `many_voices`, `dirge`,
  `final_verse`, and the Sunken Choirhouse's *"it is not one voice"* — all say a chorus. A
  drowned, cold procession of robed figures fused at the shoulders into one slow mass, standing
  in warm ash where it does not belong, water still running from it. Frost is its element; the
  art contrast is **cold and wet arriving in hot and dry**.
- **States** — Tier A + `windup_dirge` (1.8 s), `windup_undertow` (2.2 s), `windup_final_verse`
  (**3.0 s** — the longest telegraph in the game, and the most readable), their casts, and
  `heal` (`many_voices`). **4 facings authored.**
- **Phases**:

  | Phase | Threshold | Visible change |
  |---|---|---|
  | base | 100–65% | One voice leads; the mass is quiet |
  | **the Second Voice** | < 65% | A second figure lifts its head out of the mass — an added overlay layer |
  | **the Final Verse** | < 30% | Every figure faces outward, mouths open; water streams faster |

  The phase overlays add **figures**, not glow — phase reads as the choir gaining voices.
- **Canvas** — 320 × 256 `@1x`, pivot `(160, 232)`, 3 × 3 footprint.
- **Arrival** — pairs with `VFX_WORLD_BOSS_ARRIVAL` and the Ashfall weather overlay in
  `specs/01-world-environment.md`. Terrain stays intact (`REQ-CW-013`).
- **Acceptance** — reads as *many* at 0.55; each of the three telegraph poses distinct from
  the others with VFX off; the two phase overlays read as *more voices*; no horror imagery.
- **Prompt**
  ```
  <MASTER STYLE PROMPT>
  Isometric pixel-art world boss, "the Drowned Choir": a slow procession of drowned robed
  figures fused together at the shoulders into one tall, heavy mass, heads bowed, one figure
  at the front leading. Water still runs from their robes and pools at their feet, though
  they stand in dry grey ash. Cold, sorrowful and enormous rather than monstrous: no faces
  in detail, no gore, no skulls. Palette: deep water teal-grey, wet stone, pale algae,
  frost-white highlights. True 2:1 dimetric, facing south-east, neutral idle pose,
  180 pixels tall on a 320 by 256 canvas, occupying a 3 by 3 tile footprint.
  Fully transparent background, no shadow.
  <MASTER NEGATIVE PROMPT> + <CATEGORY NEGATIVE PROMPT> + screaming faces, ghosts, glowing
  eyes, horror, zombies, sea monster, kraken
  ```
- **Variation** — Same mass, same figure count, lighting and angle. Change ONLY `[facing |
  phase overlay: a second figure raising its head from the mass | final phase: every figure
  facing outward, mouths open]`.

### 2.5 `MON_HENCHMAN_SET` · P3

`REQ-CW-013` lets a World Boss bring region-appropriate henchmen. **None exist in
`worldBoss.json` yet.** Reserve the ID; no art until the content defines them. Recommendation
when it does: palette-swapped existing Ashfall elites carrying the Choir's water motif — O-5,
no new sheets.

---

## 3. Production order

| Step | Assets | Gate |
|---|---|---|
| 1 | `MON_MOSS_CRAWLER`, `MON_THICKET_WASP` Tier A | **P0 proof: a Blue fight in place, beside a Tier A hunter, at 0.55 / 1.0 / 1.8** |
| 2 | `MON_QUARRY_HOUND`, `MON_SLAG_THROWER` | First telegraph shipped and read by a playtester |
| 3 | `MON_BRACKEN_STALKER` | Before `barrow_raid` can fire in a real save (reputation ≥ 15) |
| 4 | Remaining elites | Elite line-up test |
| 5 | `MON_WARDEN_OF_ASH` | Phase and telegraph review |
| 6 | `MON_THE_DROWNED_CHOIR` + arrival VFX + weather | |

**Stop-and-review after step 2.** The first telegraph is where the Hunter AI's reaction becomes
visible to a player; if it does not read there, it will not read on a boss.
