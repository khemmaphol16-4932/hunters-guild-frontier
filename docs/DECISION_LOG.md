# Design Decision Log

Assumptions made under §127 (ambiguity resolved conservatively, documented, work continues). Each entry: what was ambiguous, what was decided, why it is the conservative reading, and what would reverse it.

---

## DL-001 — Project lives in its own directory and git repository

**Ambiguity.** The working directory already contained an unrelated project (*RetroWorld Online*: `game.html`, `game.js`, `index.html`, `mmorpg.html`, and its three markdown docs).

**Decision.** Hunter's Guild: Frontier lives entirely under `hunters-guild/`, with its own git repository scoped to that folder. The RetroWorld files are untouched.

**Why conservative.** §126 forbids rewriting or disturbing existing work without justification. Scoping git to the new folder keeps the unrelated project out of this project's history.

**Reversal.** If the user wants one repository at the root, `git init` at the root and move the repo.

---

## DL-002 — Toolchain: Node 24 LTS + TypeScript + Vite + Vitest, zero runtime dependencies

**Ambiguity.** §7 targets PC/Web but names no stack. The machine had no Node, npm or Python.

**Decision.** Install Node.js 24.19.0 LTS via winget; TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vite for dev/build, Vitest for tests. **No runtime dependencies** — no engine, no framework, no UI library.

**Why conservative.** §126 forbids adding huge dependencies without reason; §113 requires removable/replaceable systems. Zero runtime deps keeps the mobile/web expansion path in §7 open and prevents an engine's opinions from leaking into the domain layer.

**Reversal.** If rendering needs outgrow Canvas2D in Phase 9, a rendering library may be added *in the `ui/` layer only*.

---

## DL-003 — Fixed simulation timestep is mandatory, project-wide

**Ambiguity.** §38 says real-time combat; §57 says offline uses the same combat AI; §117 requires determinism. The spec does not say how these coexist.

**Decision.** All gameplay advances on a fixed timestep driven by `core/clock.ts`. Rendering interpolates and is never authoritative. Offline catch-up runs the same stepper with rendering detached. No gameplay code may read wall-clock time or frame delta.

**Why conservative.** It is the only interpretation that satisfies all three requirements simultaneously, and it invents no new gameplay system.

**Reversal.** None available — reversing this breaks REQ-OFF-002.

---

## DL-004 — Target lock also releases on target invalidation

**Ambiguity.** §31 permits retargeting only when the current target dies. A target that becomes permanently unreachable would deadlock the hunter.

**Decision.** Retargeting triggers are exactly two: target death, and target invalidation (removed from the encounter, or unreachable beyond a configured timeout). "A better target appeared" remains forbidden — that is the behavior the spec was actually guarding against.

**Why conservative.** Preserves the design intent while preventing a deadlock that would violate REQ-PRIME-002.

**Reversal.** If a design pass wants deadlock-on-unreachable as a deliberate consequence, remove the invalidation trigger; the timeout is already a data value.

---

## DL-005 — Mastery points are unbounded; mastery effects saturate

**Ambiguity.** §15: mastery has "no practical hard cap" *and* "diminishing returns". Taken literally, unbounded effects break balance and serialization.

**Decision.** Points grow without bound and are permanent. Effects are a saturating function of points, per effect type, configured in `data/balance/mastery.json`.

**Why conservative.** This *is* the plain reading of diminishing returns; nothing is invented.

**Reversal.** Curve shapes are data; asymptotes can be retuned without code changes.

---

## DL-006 — Chronicle stores counters plus a bounded notable-entry ring

**Ambiguity.** §19 wants a rich permanent chronicle; §116 wants an evolvable, sane save format. Unbounded per-hunter event logs conflict with both.

**Decision.** Permanent unbounded **counters** (expeditions, bosses defeated, near deaths, times rescued, rare items, companions lost, favorite skill, mastery values, longest expedition — exactly the §19 example display), plus a **capped, significance-ranked ring** of notable narrative entries.

**Why conservative.** Reproduces the spec's own example verbatim while bounding growth. No information the spec explicitly asks to display is lost.

**Reversal.** Ring size is a data value; raise it, or add tiered cold storage, if playtesting shows loss of meaningful history.

---

## DL-007 — Personality modifiers are clamped and applied last

**Ambiguity.** §18 gives personality "AI decision weight"; §70 makes Guild Policy authoritative. Unbounded personality weight could overturn policy.

**Decision.** Personality contributes only weights (never filters), is applied as the final weight stage, and is clamped to a configured range so it can break near-ties but cannot overturn a strong policy signal.

**Why conservative.** Satisfies "personality changes *how*, not *whether*" (§18) literally.

**Reversal.** The clamp is a tunable in `data/balance/personality.json`; calibration is deferred to the balance harness and tracked in `TECH_DEBT.md`.

---

## DL-008 — Preferred role/department are scoring inputs, never vetoes

**Ambiguity.** §71 (hunters cannot refuse work) vs §72 (assignment uses preferences).

**Decision.** Preferences feed the assignment score. A hunter assigned against preference still complies; mismatch may affect morale and execution style only.

**Why conservative.** Preserves both statements without inventing a refusal or negotiation system (§127 point 6).

---

## DL-009 — Build identity consumes equipment and cards through interfaces

**Ambiguity.** REQ-BLD-001 requires equipment and cards as build inputs, but they arrive in Phase 2.

**Decision.** `BuildIdentity` depends on `EquipmentContribution` and `CardContribution` interfaces. Phase 1 supplies null-object implementations. The §16 contribution weights already include these sources, so Phase 2 requires no reweighting.

**Why conservative.** §127 point 2 — isolate the gap behind an interface and continue.

---

## DL-010 — Three archetypes in the prototype, not the full class catalogue

**Ambiguity.** §11 defines a three-stage class chain but names no classes; §139 demands representative diversity over quantity.

**Decision.** Prototype content: three archetypes (Vanguard / Adept / Ranger) each with two advanced classes and two specializations, covering tank, healer, melee DPS, ranged DPS and hybrid roles. Skills: 12, spanning damage, heal, buff, debuff, CC, rescue, party and ultimate.

**Why conservative.** Exactly the §139 content strategy. The class chain is data, so expansion needs no code change.

**Reversal.** Add data files; no code impact.

---

## DL-022 — Advanced classes and specializations became constellation *regions*

**Ambiguity.** v1.0 §5 describes one skill constellation with class starting positions, and says nothing about advanced classes or specializations. §20 lists the class roster as needing approval, so neither keeping nor deleting them could be assumed.

**Decision.** The 6 advanced classes and 12 specializations became 18 **regions** — named areas of the constellation that are purely descriptive. They gate nothing. A hunter who has taken Sentinel-region nodes *reads as* a Sentinel.

**Why conservative.** It preserves every piece of authored content (role lean, range, attribute affinity, risk posture, tags — all tuned in Phase 1) while removing the thing v1.0 rejected, which was the *gating*. Deleting them would have thrown away working content to satisfy a paragraph; keeping them as gates would have ignored it. Regions also give the constellation legible structure and let class identity be derived, which is §5's own principle applied one level up.

---

## DL-023 — A v4 hunter's advanced class and specialization are dropped, not translated

**Ambiguity.** Migrating v4 → v5, a hunter carries `classChain: { archetype, advanced, specialization }`. Only `archetype` survives into v5.

**Decision.** Carry the archetype forward; drop the other two. Refuse the migration outright if a hunter has no archetype rather than guessing one.

**Why this is not lossy.** Under the constellation, identity derives from known skills. A v4 hunter who advanced to Sentinel necessarily *knows Sentinel-region skills*, because that advancement is what gated them. Their identity therefore reconstructs itself from `knownSkills` with nothing invented. Guessing a missing archetype, by contrast, would silently rewrite who a hunter is — so that case throws.

---

## DL-024 — Affinity is distance, expressed as progression cost

**Ambiguity.** v1.0 §5 wants "flexible starting identities, not rigid content silos" and permits eligibility to depend on class, but does not say what non-zero affinity should *cost*.

**Decision.** A node's level requirement is divided by the hunter's affinity for it: `effectiveLevel = ceil(requiredLevel / affinity)`. Affinity 0 remains genuinely unreachable.

**Why.** Found by measurement, not by reasoning. With affinity above zero meaning *free* access, every archetype reached everything and all three converged on the same profile — an Adept who picked up Shield Bash and Guard Stance out-tanked a Vanguard, and class identity collapsed entirely. Distance-as-cost keeps the door open (a determined Ranger can still become a counter-fighter) while making it a real investment, and it needs no new mechanism: deeper nodes already cost more level, so the penalty scales naturally with how far into foreign territory a hunter is reaching.

---

## DL-018 — Master Build Specification v1.0 overrides the 350-decision prompt on conflicts

**Ambiguity.** v1.0 arrived after Phases 0–2 were built, labelled "source of truth", and conflicts with the original prompt on several locked points.

**Decision.** v1.0 wins where the two disagree — except where v1.0 itself defers a decision (§20) or forbids silent substitution (§19), which are flagged for approval instead.

**Why conservative.** The original prompt's own conflict rule §2.1 says *"Explicit later decision overrides earlier decision."* Applying v1.0 is therefore following the original instruction, not departing from it. The exceptions matter just as much: §20 lists things v1.0 deliberately did not decide, and inventing them would be exactly the redesign §19 forbids.

**Recorded in** `SPEC_RECONCILIATION.md`, item by item.

---

## DL-019 — Emergency overrides are narrow, provenanced and audited

**Ambiguity.** v1.0 §2.1 permits a hard constraint to be overridden by "an explicitly configured emergency policy" but does not say how narrow that permission should be.

**Decision.** An authorisation must (a) name one specific constraint id — no wildcards, (b) be player-authored, (c) be conditional on an active trigger, and (d) emit an audit record whenever it applies. With none configured, hard constraints behave exactly as they did when they were absolute.

**Why conservative.** An override path is how "hard constraint" degrades into "strong suggestion", and the player watching a hunter die against an explicit instruction is the most trust-destroying bug this design can have. Every one of the four properties above removes a way that could happen silently. The narrowest reading that still satisfies §2.1 is the right one.

---

## DL-020 — The coarse simulation cadence is an integer multiple of the fine one

**Ambiguity.** v1.0 §4 asks for coarse steps for idle work and fine ticks for combat, "both derived from the same elapsed game time", without specifying the relationship.

**Decision.** The coarse cadence is an integer multiple of the fine one, and the clock rejects a non-integer ratio at construction.

**Why conservative.** It makes "derived from the same elapsed time" literally true: after any span, `coarseSteps === floor(fineSteps / ratio)` exactly. A fractional ratio would leave the two cadences on divergent paths for identical elapsed time, which is precisely the drift §18's online/offline equivalence criterion forbids.

---

## DL-021 — A v3 hunter migrating to v4 defaults to `available`

**Ambiguity.** v1.0 §4 introduces availability states; a v3 save has no availability data, including for a hunter who was mid-expedition when it was written.

**Decision.** All migrated hunters become `available`.

**Why conservative.** It is the recoverable error. A hunter wrongly marked available can simply be reassigned; one wrongly stuck as `assigned` to an expedition that no longer exists could never be freed, because the thing that would release them does not exist any more.

---

## DL-012 — Player intents live in `app/GuildCommands`, not in the debug console

**Ambiguity.** None in the spec — this was a design error caught by the architecture test during Phase 1. Allocating attributes, advancing a class, equipping a skill and respeccing were implemented in `DebugConsole` because that is where they were needed first, and the dashboard then imported the debug console to reach them.

**Decision.** `app/GuildCommands` is the player-intent surface. The UI dispatches there; `DebugConsole` delegates to it and keeps only the commands that deliberately bypass rules (learning an incompatible skill, jumping levels, fast-forwarding time).

**Why it matters.** REQ-TEC-010 says the UI holds no game logic. With one shared surface, a rule cannot hold on the UI path while a different rule holds on the debug path — the two cannot drift, because there is only one implementation.

---

## DL-013 — Ultimates, party skills and counters are gated above archetype level

**Ambiguity.** §11 says specialization is expressed through skills, but the spec names no skills and no tier structure.

**Decision.** Archetype level grants basic skills only. Ultimates (`last_stand`), party skills (`rally`) and counters (`riposte`) require an advanced class; elemental and heal-over-time skills require the Invoker/Mender lines.

**Why conservative.** Found by test: before this change, a fresh Adept could learn every Adept skill in the game and advancing a Vanguard unlocked nothing at all, which made the class chain cosmetic and contradicted REQ-CLS-003. The fix is the minimum that makes advancement change what a hunter can *do*.

**Open.** Specialization-exclusive skills still do not exist — the third stage expresses itself through class weights only. Tracked in `TECH_DEBT.md`; needs a larger skill pool to repay.

---

## DL-014 — Item storage is guild-wide (`Armoury`), not a per-hunter inventory

**Ambiguity.** §20 describes equipment and trading but never says where items live.

**Decision.** One guild-wide `Armoury` holds every item and loose card. A hunter's `equipment` field references items by id; the hunter *has* items equipped, the guild *owns* them.

**Why conservative.** REQ-EQP-004 states equipment is never bound to a hunter. With a per-hunter bag, "give the new recruit the old sword" becomes a transfer operation with two failure modes; guild-wide, it is an equip with none. The system map originally said `Inventory`; renamed once the requirement made the shape obvious.

---

## DL-015 — Item main stats are derived; substats are stored

**Ambiguity.** §20/§21 fix main stats by item type and randomise substats, but say nothing about persistence.

**Decision.** An item persists its type, rarity, level, refinement, substat rolls, sockets, set and unique effect. Main stats are *computed* from type × level × rarity multiplier × refinement bonus at read time.

**Why conservative.** REQ-TEC-002 wants balance in data. Deriving main stats means retuning a blade's coefficient updates every blade in every existing save; storing them would freeze old items at old balance. Substats are the opposite case — they are rolls, not formulas, so they must be stored or the item would change every time it was read.

---

## DL-016 — Refinement scales main stats only

**Ambiguity.** §22 defines refinement as safe zone plus risk zone but not what it affects.

**Decision.** Refinement multiplies main stats. It never touches substats.

**Why conservative.** It keeps the substat lottery and the refinement gamble as two separate games. If refinement scaled substats, a badly-rolled item could be laundered into a good one, which would flatten the "two copies of the same item are worth different amounts" property REQ-EQP-021 depends on.

---

## DL-017 — Set and card effects are behavioural, not flat stats

**Ambiguity.** §23 says sets must not invalidate normal equipment; §24 says cards must not be generic +damage. Neither says how to guarantee it.

**Decision.** Every set tier and every card effect is drawn from a declarative vocabulary of *behavioural* effects — skill-tag power and cost, threat generation, AI weight shifts, status chance, overheal conversion, downed-timer bonus, interrupt readiness. No set or card grants a flat stat.

**Why conservative.** It makes both requirements structural rather than a tuning target: a better-rolled non-set item still competes on stats and loses only the behaviour, so the choice stays live. Tests assert the property, so a future set cannot quietly break it. It also gives Phase 4's combat and AI one vocabulary to consume instead of four.

---

## DL-011 — Attribute point budget and the 1–100 curve

**Ambiguity.** §9 says attribute points are generated from level; §10 caps level at 100. Neither gives numbers.

**Decision.** Prototype values (all in `data/balance/attributes.json`): 3 attribute points per level, 5 in each attribute at level 1, XP curve `base * level^exponent`. These are placeholders explicitly flagged for simulation-based calibration.

**Why conservative.** The spec deliberately left balance open; putting it in data means calibration never requires code changes.

---

## DL-025 — Combat positioning is one distance axis, not a plane

**Ambiguity.** §7 requires positioning, range bands and telegraphed AoE. It never says the combat space is two-dimensional.

**Decision.** Combatants hold a single `position` scalar. The guild starts at 0, monsters at the region's starting separation, and both close along that one axis. Range bands are distances on it. AoE is "everyone on the guild side", not a shape.

**Why conservative.** Every §7 requirement the prototype must demonstrate — closing to reach, ranged hunters holding distance, a boss telegraphing a sweep — is expressible on one axis. A plane would add pathing, facing and formation geometry, none of which the player controls and none of which any locked requirement asks for. The axis is a field on `Combatant`; widening it later is additive.

---

## DL-026 — The combat encounter lives in `sim/`, not `systems/`

**Ambiguity.** None in the spec; a layering question the architecture test forced.

**Decision.** `CombatEncounter` sits beside `Expedition` in `sim/`. `systems/combat/` keeps the damage pipeline and the hunter-to-combatant bridge, which are pure and AI-free.

**Why.** The encounter *drives* the AI — it asks `HunterAI` what each hunter wants and applies the answer. In `systems/` that is an upward import, and the architecture test rejected it. Moving it was the honest fix: an encounter is a simulation driver, exactly like an expedition, and this keeps `systems/` free of any dependency on how decisions get made. The same reasoning moved `BuildProfile` into `core/hunter/buildProfile.ts` — it is a contract *between* layers, so it cannot be owned by one of its own consumers.

---

## DL-027 — A wipe kills the hunters left down, without waiting for their timers

**Ambiguity.** §7 gives downed hunters a rescue timer; REQ-ZON-001 says BLACK zones can kill. Neither says what a total party wipe does.

**Decision.** An encounter ends the moment every hunter is down or dead. Hunters still downed at that point are *lost*, and the zone decides what that means — death in BLACK, injury in YELLOW/RED, nothing in BLUE.

**Why.** Relying on the downed timer alone produced a silent bug: because the encounter stops stepping when the last hunter falls, no timer could ever expire in a wipe, so no hunter could ever die anywhere. The rule above makes the zone tier the only thing that decides lethality, which is what REQ-ZON-001 actually asks for.
