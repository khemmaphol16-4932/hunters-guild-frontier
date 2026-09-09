# Spec Reconciliation — Master Build Specification v1.0 vs implemented

**Source:** `Hunters-Guild-Frontier-Master-Build-Specification-v1.0.md` (implementation handoff, labelled source of truth).

**Authority.** v1.0 is later than the 350-decision prompt this project was built against, and the original prompt's own conflict rule §2.1 says *"Explicit later decision overrides earlier decision."* So **v1.0 wins on conflicts** — except where v1.0 itself (§19 change-control, §20 ambiguities) says a decision needs approval rather than invention. Those are flagged, not silently rewritten.

Legend: **✅ already satisfied** · **🔧 changed this pass** · **📌 recorded, assigned to a phase** · **⚠️ needs your approval**

---

## 1. Confirmed — v1.0 ratifies what is already built

No action needed. Listed so the overlap is not re-litigated later.

| v1.0 | Implemented as |
|---|---|
| Invisible Guild Master; guild is protagonist (§1, §19) | REQ-PRIME-001/003 |
| One continuous world clock; offline uses the same accelerated systems, same Black Zone risk (§2.3, §19) | DL-003, `core/clock.ts`, REQ-OFF-002 |
| Deterministic seeded resolution; replay/debug (§7, §18) | `core/rng.ts`, seeded streams, save-resumable state |
| Hard constraints eliminate illegal actions *before* scoring (§7) | `ai/policy/pipeline.ts` — filters run before weights, structurally |
| Utility/priority scoring over legal actions (§7) | `DecisionPipeline` weight stages |
| Layered AI: policy → objective → plan → individual choice (§7) | pipeline stage ordering |
| Data-driven skills/effects/monsters/AI considerations (§7, §14) | `data/` + `itemSchema.ts`; zero balance constants in TypeScript |
| Immutable definitions separated from mutable save state (§14) | `data/` vs `save/` + `Armoury`/`Roster` snapshots |
| Equipment: rarity, main stats, substats, card slots, sets, refinement, build-changing legendary (§5) | Phase 2 — all built and tested |
| Equipment transferable; no seasonal reset (§5, §19) | REQ-EQP-004, DL-014 (guild-wide `Armoury`) |
| Refinement safe + risk zones; protection rare/expensive (§5) | `Refinement.ts`, `balance/refinement.json` |
| Item locks prevent sell/dismantle/convert (§5) | `Armoury.setLocked` — *auto-equip guard still to add, see 📌* |
| Cards build-shaping; boss cards alter builds; duplicate Keep/Convert/Trade (§5) | `Cards.ts`, `duplicateConversion` |
| Crafting = targeted progression, loot = jackpot (§5) | documented REQ-ECO-004; crafting is Phase 7 |
| No Combat Power / no Party Synergy score (§1, §19) | REQ-CAP-001 — `Capability` is a vector; nothing reduces to a scalar |
| Research = technology, mastery = experience, kept separate (§2.5, §10) | REQ-RES-002, REQ-GMA-001; `SkillMastery` grows from use |
| Zone language Blue/Yellow/Red/Black (§8) | REQ-ZON-001 |
| 5–7 primary resources + specialised materials (§2.5, §10) | REQ-ECO-002 |
| Five-hunter parties (§6, §19) | REQ-PTY-001 |
| Versioned save + migration strategy (§14, §17) | `save/migrations/`, v1→v2→v3 chain |

---

## 2. Conflicts — v1.0 overrides what was locked

### C1 🔧 Hard constraints are no longer absolute

**v1.0 §2.1/§19:** *"A hard constraint is absolute unless an explicitly configured emergency policy permits its override."* §18 restates it as an acceptance criterion.

**Was:** REQ-POL-004 — hard constraints always win, no exception. `tests/policy.test.ts` asserted an unbounded utility score can never beat one.

**Why it changed and why it matters.** These are not the same design. The old rule made a class of bug impossible; the new rule deliberately admits a narrow, player-configured escape so that (for example) a retreat threshold can be overridden to save a downed hunter *if the player pre-authorised exactly that*. The danger is obvious — an override path is how "hard constraint" quietly becomes "strong suggestion" — so the implementation makes it expensive and visible rather than convenient:

- An emergency exception must name the specific constraint it may override. There is no wildcard.
- It must be player-authored (`author: 'player'`), like a party template.
- Overriding is an explicit pipeline outcome, not a filter that silently passes. Every override emits an audit record with a reason code.
- A constraint with no matching authorisation behaves exactly as before.

**Done:** `ai/policy/emergency.ts`, pipeline `overrides` reporting, tests covering both "no authorisation → still vetoed" and "authorised → overridden and audited".

### C2 🔧 Policy precedence order differs, and policy inherits down a scope chain

**v1.0 §2.1:** `Hard constraints → Guild objective → Guild policy → AI optimization → Department policy → Party objective → Hunter identity/preferences`, with inheritance Guild → Department → Party → Hunter and explicit overrides.

**Was:** REQ-POL-002 put Department above Party above Personal Priority, with AI utility evaluated *last*.

Two real differences: v1.0 introduces **Guild objective** as a tier above Guild policy, and places **AI optimization above department policy** rather than last. The second is the surprising one — it means the AI's optimisation is permitted to outrank a department's stated preference, while remaining subordinate to guild-level policy.

**Done:** precedence is now data (`data/policy/precedence.json`) rather than the implicit ordering of an array literal, so it is auditable and changeable without touching the pipeline. `systems/guild/GuildPolicy.ts` implements the four-scope inheritance chain with explicit overrides.

### C3 📌 The AI proposes party composition; templates govern formation

**v1.0 §6:** creation is *objective → AI proposal → player adjustment*; *"Formation uses templates plus AI positioning adjustment."*

**Was:** REQ-PTY-003/004 — the AI may only instantiate player-created templates and may **never** invent one.

These reconcile more cleanly than they first appear: v1.0 applies templates to **formation** (positioning), not to **composition**. So the AI may propose who goes, the player adjusts, and formation comes from templates plus AI positioning. Conflict A11 in `CONFLICT_AUDIT.md` is superseded on composition and stands on formation.

Assigned to the party phase. `PartyTemplate.author` stays, now scoped to formation templates.

### C4 📌 Elements must not be fixed rock-paper-scissors

**v1.0 §7:** *"Do not substitute a fixed elemental rock-paper-scissors system unless that was explicitly approved."* §20 lists the element list and reaction matrix as needing approval.

**Was:** REQ-CBT-003 said four elements with straightforward advantage/disadvantage — which is precisely the RPS model v1.0 warns against.

Combat does not exist yet, so this is a mistake *prevented* rather than repaired. Recorded as a hard requirement on the combat phase: elements and reactions must be authored data tables (reaction matrix, not a cycle), legible in combat, able to affect build tags and AI choices. REQ-CBT-003 is amended in `DESIGN_BIBLE.md`.

### C5 ✅ Class model: migrated to one skill constellation — **Option B, approved and done**

**Resolved.** The three-stage chain has been replaced by a single node graph. See DL-022/023/024 and the "constellation migration" DEVLOG entry.

What changed: archetypes are now *starting positions*; the 6 advanced classes and 12 specializations became 18 descriptive **regions**; every skill is a node with prerequisites and six-axis eligibility; class identity is **derived** from region investment rather than declared. `ClassSystem` and `skill-compatibility.json` are gone. Save at v5.

Two design problems surfaced during the migration and were fixed at the source rather than papered over — both are recorded in the DEVLOG because they are the kind of thing that would otherwise have shipped silently:

1. **Affinity above zero meant *free* travel**, so every archetype reached everything and all three converged on `primary role: tank` — an Adept out-tanking a Vanguard. Fixed by making affinity a *distance*: a node's level cost is divided by the hunter's affinity for it, so foreign territory is reachable but late.
2. **A build's role tag could be crowded out of its own summary** by higher-confidence affinity tags, so a dedicated front-liner could be described without the word "front-liner". Fixed by reserving the strongest role and range tags before filling the remaining budget.

The original decision text is kept below for the record.

---

### C5 (original) ⚠️ Class model: three-stage chain vs one skill constellation

**v1.0 §5:** *"Classes are flexible starting identities, not rigid content silos. Skill knowledge is one large node-based constellation with different class starting positions."* §20 lists the launch class roster as an ambiguity requiring approval.

**Built:** a three-stage chain — Archetype → Advanced Class → Specialization (3 / 6 / 12 nodes) with a per-skill class allowlist. Fully implemented and tested; `ClassSystem` plus 28 tests depend on it.

**Why I have not changed it.** These are genuinely different content architectures, not a naming difference. A chain gates capability at discrete advancement moments; a constellation gates it per node with prerequisites, and "class" becomes only a starting position. Rewriting this touches `ClassSystem`, the compatibility data, `BuildIdentity`'s class contribution, and the advancement UI — and v1.0 itself says the class roster needs approval rather than invention. Silently replacing three working systems on my own reading of one paragraph is exactly what §19 forbids.

**The two paths are laid out in §5 of this document.** This is the one item blocking a clean run at the vertical slice, because skill eligibility feeds party fit.

### C6 🔧 Roles are generated capability tags, not fixed boxes

**v1.0 §5/§6:** build tags are *generated* from actual attributes, skills, weapon, cards, sets and elemental interactions, describe role and behaviour (*"crit melee, fire, sustain"*), are never manually chosen, and never reduce to Combat Power. Roles are *"functional capability tags, not mandatory tank/DPS/healer boxes."*

**Was:** `BuildProfile` exposes a continuous `roleLean` over a fixed five-role enum — closer to v1.0 than a box, but still not tags.

**Done:** `systems/hunter/buildTags.ts` generates tags from the real build. The five-role lean stays as an internal AI axis (it is what the utility layer reads); tags are the player-facing description, and they are derived, never stored or chosen.

### C7 🔧 Chronicle levels are Minor / Major / Historic

**v1.0 §11:** three named levels; only remarkable events enter; near-death qualifies *when the remarkable-event threshold is met*; historic events can affect legacy and monuments.

**Was:** numeric significance 1–5.

**Done:** the numeric scale is retained internally for ring retention (it needs an ordering) but is now mapped to the three named levels, and the level is what surfaces. Threshold semantics preserved.

### C8 🔧 Canonical hunter availability states

**v1.0 §4:** **Available, Assigned, Recovering, Injured, Unavailable**; recalling a hunter takes transition time; recovery depends on time + food + housing/service quality + appropriate rest and is explicitly *"not a manual rest-click loop or a single timer."*

**Was:** absent. Hunters had condition (hunger/fatigue/morale) but no availability state at all, so nothing could express "this hunter cannot be deployed".

**Done:** `core/hunter/availability.ts` with the five canonical states, legal transitions, and recall-in-progress modelling. Food is now a recovery input alongside housing quality.

### C9 🔧 Dual-resolution simulation stepping

**v1.0 §4:** *"coarse, deterministic steps for idle town/economy work and finer deterministic ticks for active combat; both derive from the same elapsed game time."*

**Was:** a single fixed 50 ms step for everything — correct in spirit (one clock) but too fine for town/economy and too coarse to be cheap for 3-day catch-up.

**Done:** `SimulationClock` now drives two cadences from one elapsed-time source. Combat ticks at the fine step; idle work accumulates into coarse steps. Both are integer multiples of the same base, so online and offline still agree exactly.

### C10 🔧 Audit / replay model

**v1.0 §14:** minimum audit fields for consequential state changes — *game time, actor/system, source event, policy version, deterministic seed, inputs, outcome, reason codes*. §17 puts this in implementation step 1. §18 makes it an acceptance criterion: *"Every important AI action and consequential outcome can be explained from an audit record."*

**Was:** absent. The event bus emits typed domain events but nothing persists a reasoned trail, so no AI decision could be explained after the fact.

**Done:** `core/audit.ts` — a bounded, queryable append-only log with exactly those fields, wired into the policy pipeline and the emergency-override path.

### C11 📌 Implementation order: equipment is step 7, the vertical slice is step 2

**v1.0 §17** sequences equipment/cards/theorycraft at step 7 and the vertical slice (hunter → party planner → deterministic combat → expedition outcome → recovery/loot/Chronicle) at step 2. §17 closes with *"Do not begin with broad content production... before the vertical slice is measurable and replayable."*

Equipment was built as Phase 2 under the old roadmap. That is not reversible work and it earned its place — it validated the DL-009 contribution interface and caught a live bug in `BuildIdentity`. But the sequencing note is taken: `ROADMAP.md` is resequenced so **the vertical slice is next**, and no further content production happens until it runs.

---

## 3. New requirements v1.0 introduces — recorded, phased

| # | Requirement (v1.0 §) | Phase |
|---|---|---|
| N1 | Automation tiers: Manual → Assisted → Automated → Strategic Automation, with policy preview and conflict UI (§4) | Guild/AI Ops |
| N2 | Capability gap → AI analysis → replacement candidates → player decision on loss (§2.4) | Combat + Guild AI |
| N3 | Resurrection cost from hunter value, death severity, method, guild capability (§2.4) | Combat + Economy |
| N4 | World map as knowledge interface: unknown → rumor → discovered → experienced → mastered; previews never exceed guild knowledge (§8, §18) | World |
| N5 | Theorycraft Mode — hypothetical builds incl. unowned items, production combat rules, **no rewards** (§5, §18) | Post-combat |
| N6 | Party Synergy Mastery from repeated successful cooperation; persists across composition change; emergent party identity tags (§6) | Party |
| N7 | Guild Advisor as in-world NPC/interface with Low/Medium/High confidence recommendations that de-prioritise when declined (§13) | UX |
| N8 | Expedition report ordered outcome → loot/EXP → performance/highlights → Chronicle → recommendations; MVP only when genuinely notable (§11) | Expedition |
| N9 | Skill constellation UI with skill books visible as requirements; drag-and-drop loadout slots; two-level tooltips (§5, §13) | UX |
| N10 | Keep/sell/dismantle/convert filter rules by rarity/type/stats/set/slots; loot priority when inventory full (§5) | Economy |
| N11 | Item lock must also block **auto-equip** (§5) | Party/AI |
| N12 | Recovery varies measurably with time, food, housing/services and rest — acceptance-tested (§18) | Town |
| N13 | Town Stability summarises but never replaces individual population/food/housing/service indicators (§9) | Town |
| N14 | Build-mode toggle: grid, four-direction rotation, ghost preview, cost/stat/visual preview, free relocation (§9) | Town |
| N15 | Online/offline equivalence within documented coarse-step boundaries; save/load and catch-up cannot duplicate or lose anything (§18) | Sim |

---

## 4. Ambiguities v1.0 explicitly defers (§20) — not to be invented

Exact launch class/attribute roster · elements and reaction matrix values · combat timing and skill slot counts · final resource names/count · content catalogues (regions, monsters, factions, contracts, buildings, recipes, cards) · numerical balance curves · exact resurrection methods · New Game+ carry-over and cycle rules · final platform/network model.

**Note on two of these that are already implemented as data:** the six-attribute roster (STR/AGI/VIT/DEX/INT/LUK) and the 6–8 skill loadout cap came from the 350-decision prompt, which was explicit about both. They live in `balance/attributes.json` and `SkillKnowledge`, are data-driven, and are cheap to change — but they *are* currently baked as defaults rather than pending approval. Flagging so you can ratify or revise them deliberately.

---

## 5. ⚠️ The one decision I need from you (C5)

**Option A — keep the three-stage class chain.** Archetype → Advanced → Specialization stays as built and tested. Cost: v1.0 §5's "one large node-based constellation" is not implemented, and §19's "flexible classes / one knowledge constellation" stays unsatisfied. Zero rework; 28 tests keep passing.

**Option B — migrate to one skill constellation.** Classes become starting *positions* in a single node graph; eligibility per node comes from level, class affinity, weapon, build compatibility, prerequisites and skill books. Cost: rewrite `ClassSystem`, replace `skill-compatibility.json` with a node graph, rework `BuildIdentity`'s class contribution and the advancement UI, and re-author the skill data. Roughly a phase of work. Gain: matches v1.0 exactly and makes hybrid builds a gradient rather than three discrete gates.

**Option C — hybrid.** Keep archetypes as starting positions, drop the advanced/specialization *gates*, and express what those nodes currently contribute as constellation regions. Middle cost; keeps most tests; loses the discrete "I advanced to Sentinel" moment.

My read: **B is what v1.0 actually describes**, and doing it before the vertical slice is cheaper than after, because skill eligibility feeds party fit and combat candidate generation. But it is a phase of rework on working systems, and §20 says the class roster is yours to approve — so I have not started it.
