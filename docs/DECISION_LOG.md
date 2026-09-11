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

---

## DL-028 — The objective reaches combat, not just the party planner

**Ambiguity.** §28 places ObjectiveWeights above personal priority in the validation order. §26 says party strategy provides context and cannot override build identity. Neither says whether the objective is visible *inside* a fight.

**Decision.** `CombatView` carries a `CombatObjective` — an id and a risk preference — and an `objectiveAlignment` weight stage sits directly below hard constraints, above every identity stage.

**Why.** Without it the objective stopped at recruitment: a "bring everyone home" party and a "kill the boss" party picked different members and then fought identically. That makes the objective a roster filter rather than a strategy, and §28 clearly intends otherwise. It is a weight and not a filter, so it shifts *when* a party breaks off without ever being able to forbid it — forbidding is a hard constraint's job.

---

## DL-029 — Breaking off is contested, and takes time

**Ambiguity.** §7 gives hunters a retreat action. Nothing says what it costs.

**Decision.** A withdrawal completes only after the whole standing party sustains it for `movement.disengageSeconds`, during which the monsters keep acting.

**Why conservative.** With an instant withdrawal, escape was free and unfailable. Across 25 runs of a hopelessly outmatched party in a BLACK zone, every single one withdrew intact and not one hunter died — permanent death had become a rule the AI could always opt out of, which empties REQ-ZON-001 of content. The cost is deliberately small (three seconds); what matters is that it is not zero.

---

## DL-030 — Retreat urgency is continuous, not a threshold

**Ambiguity.** §29 mentions "retreat thresholds" as a policy the player may set.

**Decision.** The AI's own inclination to withdraw rises continuously with injury (squared, scaled by `ai.retreatUrgencyScale`). A *player-set* threshold remains a hard constraint, which is absolute; this is only the AI's judgement in the absence of one.

**Why.** Written as a step, the crossing point was fixed, so no other consideration could move it. Zone danger, guild objective and risk posture all shifted scores on either side of a cliff they could never relocate — a hunter broke off at exactly 35% health whether they were a reckless duelist on a boss kill in a safe zone or a cautious healer told to bring everyone home from a BLACK zone. Those stages were decorative until the curve became smooth. A threshold the player sets is a different thing and stays a threshold.

---

## DL-031 — A standing order states its route meaning explicitly

**Ambiguity.** §29 lets the player forbid retreat. Abandoning an engagement and abandoning the expedition are decided by different systems, and the spec does not distinguish them.

**Decision.** A `StandingOrder` declares an optional `route` force — `forbidsRetreat` or `requiresRetreat` — which the expedition's continue/retreat decision consults *before* any threshold, objective or condition.

**Why.** An order that governed only combat was quietly ignored by the route: a player who ordered "hold the line" watched their party turn back at the next node anyway. From the player's side that is one instruction being disobeyed, and they are right. Making the route meaning part of the order's declaration keeps the two layers from disagreeing about what the player said.

---

## DL-032 — World knowledge belongs to the guild, not to hunters

**Ambiguity.** REQ-WLD-001 says exploration information is permanent and "remembered by the Guild". §19 gives each *hunter* a Chronicle. Nothing says which of the two owns a map.

**Decision.** `WorldKnowledge` is guild state, saved in the envelope (v6). Hunter Chronicles record that a hunter *was there*; the map itself is the guild's.

**Why.** A roster wipe costs you the hunters, not the map. Tying discovery to hunters would let a guild forget a region it had mastered, which REQ-WLD-001 forbids outright — and the case where it matters most is the one where every hunter who went there died. The knowledge type offers `raise` and no way to lower a tier, so permanence is a property of the type rather than a convention callers have to respect.

---

## DL-033 — Locked regions are shown, not hidden

**Ambiguity.** REQ-WLD-002 says regions unlock through combinations of level, reputation, story, capability and player choice. It does not say whether a locked region is visible.

**Decision.** Every region appears in the planner, marked locked, with the specific reasons it is locked spelled out. `sendExpedition` enforces the gate itself, not just the UI.

**Why.** §8 makes the map a knowledge interface: seeing that somewhere exists and being told what it will take is itself progression, and hiding it would make the world feel smaller than it is. Enforcing in the command surface rather than the view is the difference between a gate and a disabled button — the debug console and any future automation path respect it too.

Unlock axes the prototype cannot yet evaluate (reputation, capability) are parsed, carried, and reported as *unsatisfied* rather than silently treated as met. A region that opened early and quietly would be the worse failure.

---

## DL-034 — An event is authored data with named effects, never a script

**Ambiguity.** REQ-EXP-002 lists events and decisions as things expeditions contain, without saying what an event *is*.

**Decision.** An event is a name, a description, a weight, zone/hazard gating, and two or more options. Each option carries a `risk` and a flat record of *named* effects — loot rolls, fatigue, morale, healing, reputation, extra or skipped nodes, ambush, ends-expedition, seconds. The schema rejects an event with fewer than two options.

**Why conservative.** An event that could run arbitrary logic would let content reach into the simulation, and the requirement asks for authored events, not authored code. The two-option minimum is the same principle: REQ-EXP-002 lists *decisions*, and a single-option event presents the Guild AI with a choice it cannot make.

The Guild AI picks by matching the option's risk against the objective's risk preference, scaled by party condition — so a "bring everyone home" guild takes the safe option and a "kill the boss" guild takes the fast one, from identical content. The choice is audited with the option's own authored consequence text, so the report says what happened in words the writer chose.

---

## DL-035 — The ten-minute cap is checked between nodes, never inside a fight

**Ambiguity.** REQ-EXP-003 caps an expedition at ten minutes.

**Decision.** Elapsed expedition time accrues per node and is tested before entering the next one. A run can overshoot by at most the length of the node it was already in.

**Why.** Stopping the clock mid-encounter would make a run's outcome depend on where the tick landed, which breaks the determinism REQ-TEC-005 and §18 rest on. `outOfTime` is its own flag rather than being folded into `retreated`, because running out of daylight is not a decision the party made.

---

## DL-036 — Town Stability weights are severities, not shares

**Ambiguity.** REQ-TWN-003 says Town Stability "summarises, but never replaces" the individual population, food, housing and service indicators. It does not say how the summary is computed.

**Decision.** Stability is a weighted mean of *relieved* pressure across housing, food and services, and the weights (1.0 / 1.25 / 0.7) deliberately do not sum to 1. `Population.report()` always returns the three individual readings alongside the summary, and there is no code path that produces the summary alone.

**Why.** Normalised weights would let one healthy axis average away a collapse on another — a full granary reassuring the player at exactly the moment a housing failure should alarm them. Severities keep the axes comparable without making them substitutable. The structural half matters more than the arithmetic: a `report()` that could return a bare score would let a UI or a test display it *instead of* the detail, which is precisely what the requirement forbids, so the type does not offer that shape.

---

## DL-037 — The town's stage is stored and monotonic, not derived

**Ambiguity.** REQ-TWN-002 fixes the ladder Small Camp → Village → Fortified Town → Hunter City and says there is **no reset** on progression. It does not say whether a stage is a fact about the town's history or a live reading of its current buildings.

**Decision.** `Town` derives a candidate stage from population, building count and Guild Hall tier, but what the town *is* is the highest index it has ever derived — stored in the save, raised only by `refreshStage`, with no public way to lower it. `derivedStage()` remains available and can fall; `stage()` cannot.

**Why.** "No reset" has to survive the cases that would otherwise quietly break it: a demolished building, a population loss, a defense event, or a save loaded against content whose ladder has since changed. A purely derived stage would violate the requirement on load rather than in play, which is the worst place to find out. The content is validated non-decreasing at load for the same reason (`parseTownBalance`), so the ladder cannot be authored into a shape where a growing town satisfies Hunter City while failing Fortified Town.

---

## DL-038 — Town work does not make a hunter `assigned`

**Ambiguity.** v1.0 §4 fixes five availability states, of which `assigned` means "not deployable". REQ-TWN-009 says idle hunters automatically work. Nothing says which state a hunter on the work rota is in.

**Decision.** Town work is tracked entirely in `TownJobs` and does not change availability. A hunter cutting timber is still `available`, still a candidate for an expedition, and is dropped from the rota the moment they are deployed, injured or killed.

**Why.** It looked obvious the other way and it is wrong. If town work occupied `assigned`, the town would compete with the field for the same roster, and a player who built a productive town would discover they had nobody left to send anywhere — punished for engaging with the system. Town work is what idle hunters do *while* idle. It still costs something real: it is gated on the fatigue ceiling, and fatigue is what recovery clears.

---

## DL-039 — Alignment and capability are separate scoring terms

**Ambiguity.** None in the design — this records a bug and the rule that came out of it.

**Decision.** `attributeFit` measures only how well a hunter's build *points at* a job. `capabilityOf` measures only how developed they are. Both are separately weighted terms in the assignment score, never multiplied together.

**Why.** They were one term to begin with — alignment × capability — and the DL-008 sweep in `tests/town.test.ts` caught the consequence: both factors sit below 1, so the combined term could only reach about a third of its configured weight at realistic levels (0.5 × 0.82 × 0.41 ≈ 0.17), while `departmentPreference` delivered a flat 0.22. A hunter who was hopeless at the work but had asked for it beat a specialist who had not, so REQ-TWN-010's "input, never veto" was violated in play — while the load-time guard, which compares configured *weights*, reported everything in order.

**The rule worth keeping:** a guard that compares configured weights is only sound if each term can actually reach its weight. Two factors answering different questions belong in different terms, where each is separately weighted, separately readable, and separately tunable.

---

## DL-040 — The Research Department cannot be unlocked by research

**Ambiguity.** REQ-DEP-001 says departments unlock through Research. REQ-RES-002 says research is technology, earned by the guild rather than by hunters — and the natural implementation of that is to make research points come from the Research Department's own output.

**Decision.** Every department may be gated behind a research node except Research itself, which is open from a guild's first day. `crossValidateResearch` fails the build if that is ever changed.

**Why.** Taken together the two requirements are a deadlock, and it shipped: no department means no output, no output means no points, no points means the node that opens the department can never be completed. It was found by playing — a guild ran for four hundred steps with a research target selected and zero progress — rather than by review or by any of the existing content checks, which only verified that *some* node opened each department.

A guild's single archive post in the Guild Hall is the bootstrap, and Record Keeping now unlocks the Research *Annex* instead: the thing that turns one post into a department worth the name. The load-time check is the interesting half — the class of bug is "a resource that can only be produced by something the resource unlocks", and it will not be the last time that shape appears.

---

## DL-041 — Town work is idle work, and idle hunters rest

**Ambiguity.** v1.0 §4 makes recovery depend on time, food, housing and rest. It does not say who is recovering.

**Decision.** Every hunter who is in town and `available` sheds fatigue each coarse step, at the same rate the infirmary uses. Hunters in the field or already `injured`/`recovering` are excluded — the first are not resting, the second are on the slower state-machine path.

**Why.** Recovery ran only on the injured path, which meant an *available* hunter doing town work gained fatigue every outing and shed none, ever. Two hunters hit fatigue 1.0 in a browser session and became permanently unemployable: above the work ceiling so off the rota, not injured so never resting. Both systems were individually correct and nothing joined them up.

None of §4's clauses say "only if wounded". Making rest universal also gives the work rota a real economy: town work costs fatigue, the town repays it, and whether a given rota is sustainable becomes a genuine question about the town supporting it — which is exactly the trade REQ-TWN-003 is built around.

---

## DL-042 — The coarse cadence belongs to the clock, and town time advances it

**Ambiguity.** None. This records two related mistakes and the rule that came out of them.

**Decision.** `SimulationClock.coarseStepRatio` is the only definition of how many fine ticks make a coarse step; the town balance file no longer carries a second one. And `advanceTown` advances the simulation clock through `runSteps`, rather than keeping a private step counter beside it.

**Why.** The balance file had its own `ticksPerCoarseStep: 50` against the clock's 20, so two parts of the game disagreed about how long a step was — precisely the drift DL-020 exists to prevent, reintroduced in a different file.

The second mistake was worse and less visible. Advancing "town time" never moved the clock, and everything timed in ticks — every hunter's `readyAtTick`, the recruitment refresh, the defense timer — was measured against it. So a guild could run for hundreds of steps during which nobody ever recovered, the pool never refreshed on its own, and the walls were never once tested. Nothing failed; the game was simply missing three of its systems. A test had even been written around it, shoving the clock forward by hand to make a refresh happen, which was the bug wearing a workaround.

**The rule:** if a system measures anything in ticks, the thing that advances its time must advance the clock. A private counter beside the clock is not a shortcut, it is a second clock.

---

## DL-043 — The assignment score includes what the work is worth

**Ambiguity.** v1.0 §2.1 places "AI optimization" at rank 3, above department policy and below guild policy. It does not say what the AI optimises *for*.

**Decision.** The job-assignment score carries an `outputValue` term: between two jobs a hunter is comparably suited to, the AI prefers the one that produces more. Weighted below `attributeFit`, so it reorders comparable candidates without overriding who is actually good at the work.

**Why.** Without it the rota was a pure suitability match, and a guild whose hunters were all best at drilling put its entire roster in the drill yard and never staffed the hunting camp next door. The posts existed and were unreachable — the same class of failure as an unreachable region (DL-033): nothing errors, the content is simply never seen.

It is also the honest reading of rank 3. An optimiser that cannot express "this work matters more" is not optimising, it is matching; and the alternative fixes on offer were both worse — hand-tuning slot counts until the arithmetic happened to work, or giving the player a per-job priority lever that department priority already covers at the right altitude.

---

## DL-044 — The ledger never takes payment for goods it cannot store

**Ambiguity.** None in the design. This records a bug found in the Phase 7–8 review.

**Decision.** `Resources.transact` takes an overflow rule. `reject` fails the whole transaction when a credit would exceed capacity; `discard` fills to capacity and reports the excess on the receipt. Anything the guild *pays* for — every market trade — uses `reject`. Unpaid income (hauls, production, rewards) uses `discard`, because refusing an entire expedition reward over a full granary would be worse. Capacity is judged on the net result, so a trade that spends and receives the same resource is not refused for a moment of overflow it never reaches.

**Why.** The ledger clamped every credit silently. Buying 5 Warding Salt into a full store charged 495 gold and delivered nothing, and nothing anywhere reported it.

---

## DL-045 — A balance the save does not mention restores to its founding value

**Ambiguity.** The v10→v11 migration had to decide what a pre-economy guild owns. Its comment said "migrated saves start from zero".

**Decision.** `Resources.restore` gives any resource missing from a save its authored `starting` balance. A balance the save *does* record — including zero — is kept exactly.

**Why.** Zero meant a Phase 6 save opened with no gold, no food and no materials: starving from its first step and unable to build. A pre-economy guild never earned or spent anything, which is exactly what a new guild is, so the founding grant is the fair reading. The same rule covers a resource added to content after a save was written.

---

## DL-046 — The market prices each unit where the price is when it trades

**Ambiguity.** REQ-ECO-005 asks for dynamic but controlled prices. It does not say how an order's size meets its own price impact.

**Decision.** An order walks the price one unit at a time: a large buy pays the rising price it causes and a large sell accepts the falling one. Buys round the total up and sells round it down. `parseEconomy` refuses any config where `sellMarkdown × (1 + impactPerUnit / minPriceScale)` reaches `buyMarkup`, because then a single unit of impact could outrun the spread.

**Why.** The whole order used to be priced at the pre-trade price, with the impact applied afterwards. Buying 150 materials and selling them straight back earned +300 gold per round trip, with no time passing: 3,000 → 9,420 gold in twenty clicks. The balance soak that was meant to reject free-profit round trips traded one unit at a time, the only size at which the bug could not appear. `sim/Balance.ts` now probes every good at the bottom, middle and top of its band, in both orders, at sizes up to the whole stock.

**The rule worth keeping:** a check written at the scale its author imagined does not test the system; it tests the imagination. Probe at the sizes a player will actually try.

---

## DL-047 — Phase 8 balance lives in data, and Legacy is bounded

**Ambiguity.** REQ-LEG-001 wants Legacy points "from multiple sources". It does not bound them.

**Decision.**
1. Every Phase 8 number moves to `balance/progression.json`, with the Phase 7 ones it touched: Guild Mastery curve and activity points, capability weights, the Legacy catalogue and awards, the retirement level, mentor effects, New Game+ openings. Crafter speed and quality floor go to `recipes.json`, and faction standing to `contracts.json`.
2. Legacy awards are capped **per Monument kind per cycle** (`maxPerCycle`), and the loader refuses an uncapped award.
3. A contract is historic the first time the guild completes *that contract*, keyed by template, not by individual offer.
4. Every Legacy unlock must have a consumer. Starting choices, archetypes and world variants are checked against the tables that give them effects; Veteran Records now adds fuller histories to the recruitment board, Long Winter scales food consumption, and Carved Founders carves the previous generation onto the new cycle's Monument.

**Why.** Every completed contract created a new plaque worth 2 Legacy points, and the board refilled with the same three contracts forever: thirty loops earned 42 points against a catalogue that costs 16 in total. Legendary finds and legendary hunters had the same unbounded shape. Separately, three of the six unlocks were paid for with Legacy points and read by nothing at all. All of it sat in TypeScript constants, against DL-002, where no designer would see it.

---

## DL-048 — New Game+ founds a new guild in a new world

**Ambiguity.** v1.0 §12 and §20 reserve New Game+ carry-over and cycle rules for the design owner. What follows is the smallest behaviour that is not broken, and it is labelled as **pending approval** in data and on screen.

**Decision.** `Session.beginNewGamePlus` resets the world and keeps Legacy and the chosen mentors. `GuildCommands.beginNewGamePlus` then founds a new guild through `foundGuild()`, the same starting roster and town a new save gets, plus any unlocked archetype as a developed recruit. Each cycle draws from RNG streams seeded from the world seed and the cycle number.

**Why.** The reset restored a snapshot taken when the Session was constructed, which is *before* a guild is founded. New Game+ therefore opened on an empty grid: no Guild Hall, no hunters, twelve residents and nothing to do. And because the snapshot also held the constructor's RNG state, every cycle replayed the first — the same recruits, in the same order, with the same names. Reseeding per cycle keeps determinism (the same save and cycle always produce the same world) without making every generation identical.

Legacy awards are keyed by cycle, so a new generation that beats the same world boss again has done it again. Nothing pays twice within one cycle.

---

## DL-049 — Smaller corrections from the Phase 7–8 review

- **Crafting needs its workshop.** Each recipe names a building (`smithy`, `tannery`); a guild with no smithy used to forge blades, which made the crafting buildings decorative.
- **Contracts can be abandoned.** An accepted contract for a region the guild never visits used to block every other contract for the rest of the save. Abandoning costs standing with the client (`contracts.json.standing.abandon`).
- **Mentor effects stack under one cap.** Mastery training and training efficiency both apply to a practice session, so they multiply and the product is capped as a whole (`practiceCap`) rather than stacking two separately capped bonuses.
- **The mentors' EXP bonus reaches expedition experience.** It only applied to town hunts.
- **The Legacy restore runs after the New Game+ restore**, because Legacy keys awards by cycle and reconciles while it restores.
- **Phase 7–8 systems are on screen.** The Hall tab exposes contracts, crafting, capability, the Monument, Legacy, mentors and New Game+. Everything but the market used to be reachable only from the debug console.

---

## DL-050 — Respec is charged, and Insight Crystals have sources

**Ambiguity.** REQ-HUN-003 says respec is "relatively cheap, with an obtainable resource". The resource was authored (Insight Crystal) and nothing produced it.

**Decision.** `GuildCommands.respec` charges `respecCost` in Insight Crystals and refuses when the guild cannot pay; the debug console's respec stays free, as scenario setup. `freeMovesPerLevel` is now applied per level, as its name says. Insight Crystals come from the market (with restocking, see below), Red and Black expeditions, the Tier 3 Ashfall contract, every Challenge Contract, and exploration-focused endless runs. A full respec at level 30 costs 10 crystals, about 450 gold at the market.

The market now restocks toward its usual stock each step (`restockPerStep`). Stock used to change only through the guild's own trades, so anything bought out was gone for the rest of the save.

**Why.** Phase 7's TECH_DEBT entry recorded every price as wired. Respec was not, and the resource it named — also the research-reset resource — had no source at all, so both actions were impossible in play. Separately, the duplicate-boss-card conversion named `boss_essence`, which no resource file defined and no check caught; it now names `essence` and the loader validates it.

**Pending approval:** the crystal price, sources and respec rate are data-driven defaults.

---

## DL-051 — The contract board follows the guild; Challenge Contracts constrain the party

**Ambiguity.** REQ-CON-001 says contract tiers scale with reputation and capability, and REQ-CAP-001 says capability drives contract generation. Neither says how.

**Decision.** Each template names a tier and optional requirements — reputation, minimum capability readings, standing with the client. The board draws `board.size` offers from the templates the guild qualifies for, weighted by tier, and clients post new work every `board.refreshSteps` coarse steps. The Hall lists the next tier's locked contracts and exactly what each needs.

Endgame Challenge Contracts (REQ-END-004) add constraints: a maximum party size, a maximum member level, forbidden roles. When the player lets the planner choose, the planner is given only the hunters the contract allows and trims the party to fit. A party the player picked is checked and never altered: a violating party is refused with reasons, and the player can change the party or abandon the contract. Challenge rewards pay in rare resources.

**Why.** The first board offered the same three contracts for the whole save, whatever the guild had become, and the capability vector had no consumer but a readout. The catalogue (names, clients, numbers) is a **pending-approval** default; v1.0 §20 reserves content catalogues for the design owner.

---

## DL-052 — Endless expeditions are one run that keeps going deeper

**Ambiguity.** REQ-END-002 asks for endless scaling across monsters, zones, events and rewards, with an objective chosen beforehand. It does not say what an endless run is structurally.

**Decision.** An endless run is a single expedition. When the party walks a route to its end, the next route is laid down one depth deeper and the same continue-or-retreat decision governs it. Monster stats grow per depth (`statsPerDepth`), rewards grow per route cleared (`rewardPerDepth`, loot rolls per depth), and **item level never rises** (v1.0 §12). The ten-minute cap (REQ-EXP-003) still applies, and it is what makes depth a record rather than a function of patience.

The six REQ-END-002 objectives are data. Each maps to a base party objective the planner and the Guild AI already play, plus an emphasis on what the run pays: maximum loot, survival, boss hunting, resource gathering, exploration, record attempt.

Personal records (REQ-END-003) keep the best depth per region and objective, with the party and cycle, and survive New Game+ as the player's history rather than the world's. Crossing a milestone depth carves an "exceptional expedition" on the Monument (REQ-MON-001), capped for Legacy like every other kind. Save **v22** carries the records.

**Why this structure.** Chaining ordinary expeditions would have failed immediately: every expedition sends its party home to recover, so a second floor would have had nobody to send. It would also have meant a second loop beside the one that already decides when to turn back. Extending the walk reuses the whole engine: branching events, rest nodes, time, audit, aftermath.

**Tuning note.** The first growth rates (15% HP per depth) let a level-8 party match a level-60 one, because the time cap, not the monsters, ended every run. At 40% HP and 30% attack per depth, depth separates parties by strength: a level-6 party reaches depth 1 in the Coldwater Quarry, and a level-60 party reaches depth 6. All values are pending approval.

---

## DL-053 — Legacy Traits are inherited by apprentices, and trait effects must be read

**Ambiguity.** REQ-LEG-004 says some Chronicle events become Legacy Traits; REQ-CHR-003 says history becomes mechanical only through an explicit conversion. `traits.json` already reserved `origin: "legacy"` for Phase 8.

**Decision.** Three Legacy Traits grow from the three historic (significance 5) Chronicle kinds: Keeper of the Fallen (a companion lost), Wardenbane (a world boss defeated) and Black-Zone Walker (first into a Black Zone). The loader refuses a legacy trait whose Chronicle kind can never be historic. A retiring hunter's historic entries resolve to the Legacy Traits they carry. The explicit conversion is **apprenticeship**: the player chooses a mentor, pays, and picks which of the mentor's Legacy Traits the new recruit inherits. That is the generational play v1.0 §11 describes, with veteran value migrating into training. Pending approval: counts and costs.

Two trait effects gained readers so the Legacy Traits would do what they say: `experienceGainMultiplier` (expedition and town-hunt XP) and `masteryGainMultiplier` (practice), which also makes the innate Quick Study trait work for the first time.

**Why the guard.** The same review found that **seven of the eight innate traits did nothing at all**: only Tireless had an effect anything read. Glass Nerves, Battle-Born, Iron Stomach and the rest were rolled, displayed and valued by the recruiter, and were inert. `tests/legacyTraits.test.ts` now fails if a new trait effect has no reader, and it also fails if one of the known gaps gains a reader without leaving the list. The remaining gaps are in TECH_DEBT; wiring them into combat and the AI is real work with balance consequences, not a cleanup.

---

## DL-054 — Rebirth stays unimplemented, pending a design decision

**Ambiguity.** REQ-HUN-004 says rebirth becomes available at the level cap. `core/hunter/leveling.ts` has carried a `RebirthRules` interface since Phase 1 with the note that its costs and grants are a design decision, and TECH_DEBT scheduled it for Phase 8.

**Decision.** Not implemented. Every plausible version changes the Hunter aggregate, the attribute budget and the save format, and each embeds a balance philosophy (what carries over, what resets, what a rebirth grants) that REQ-HUN-005 constrains but does not settle. New Game+ was implemented as a labelled default because it was already built and broken; rebirth has no half-built version to repair.

**Needed from the design owner:** what resets (level? attributes? skills?), what is kept, what a rebirth grants, and whether there is a limit.

---

## DL-055 — The Drowned Choir is a persistent Ashfall world event

**Decision.** The Drowned Choir appears in the Ashfall Barrows as an explicit world event rather than becoming the region's permanent boss. The expedition screen exposes the event and a dedicated challenge command replaces the route boss for that run. A victory emits the world-boss form of the combat event, applies world-boss reputation, rolls the Choir's own card pool, removes the event, and schedules its deterministic respawn 500 simulation steps later.

**Why.** Making the Choir Ashfall's ordinary boss would erase the authored Warden of Ash and would not satisfy appearance or respawn. A saved event identity and next-appearance tick make the world state inspectable, replayable and migration-safe. Save v23 carries this state. The respawn interval is a pending-approval balance default.

---

## DL-056 — World-boss corrections: respawn in steps, one kill reported once

**Ambiguity.** None. This records two bugs in DL-055's implementation, found in review.

**Decision.**
1. `respawnSteps` is authored in coarse steps in `world/worldBoss.json`, together with the boss, region and first appearance, and is converted with the clock's ratio. The original constant was added straight to the tick, so the Choir returned after **25 steps instead of 500**.
2. The encounter is the only place a boss kill is reported. `Expedition.run` tells the encounter which boss is the world boss, and the encounter emits the kill with `worldBoss: true`. The command layer used to emit it a second time for every survivor, so **one kill counted twice** in every hunter's Chronicle.
3. The world-boss card roll now honours the per-boss guarantee after `guaranteeAfterKills`, and converts a duplicate into essence (REQ-CRD-003). Both rules were authored and ignored.

**Why.** The first bug is DL-042's mistake again: a second notion of time beside the clock. The second is the rule the Chronicle depends on: one fact, reported once, at the place it happened.

---

## DL-057 — Every trait does something; field hunger; Friendship

**Ambiguity.** REQ-HUN-012 models relationships as "Friendship only, no full life simulation", and says no more. The nine unread trait effects (DL-053) each named a behaviour, but not a mechanism.

**Decision.**
- **Each trait effect is read where its description points:**
  - `riskPostureShift` (Battle-Born, Glass Nerves) goes into the build profile's risk posture.
  - `departmentHeadAptitude` (Born Leader) is added on top of the head-qualification cap.
  - `reliabilityBonus` (Sure Hands) scales accuracy.
  - `moraleVolatility` (Glass Nerves) scales the morale swing on the way home.
  - `hungerRateMultiplier` (Iron Stomach) scales field hunger.
  - `sustainedCombatBonus` (Battle-Born) ramps up over a fight.
  - `partySupportBonus` (Born Leader) lifts every standing ally.
  - `allySafetyWeightShift` (Loyal) raises the AI's weight on rescues, through a new optional `allySafety` on the build profile.
  - `friendshipGainMultiplier` (Loyal) speeds bonding.
- **Field hunger exists.** Expeditions add hunger by minutes in the field, and the town feeds hunters back down as fast as provisions allow (`resources.json.hunger`). `Condition.exert` had existed since Phase 1 with no caller, so REQ-ECO-003's "hunger has gameplay effects" was true only on paper. Condition already turns hunger into a stat penalty and a cautious risk posture.
- **Friendship** is a bond per pair, 0..1. It grows from shared expeditions and much faster from rescues, and ends when a hunter dies, retires or leaves. Past a threshold the two are friends, and a hunter with a friend in the fight gets one combat bonus, however many friends are present. There is no decay, rivalry or gossip. Save **v24**.
- Combat reads every bonus through one hook, `EncounterDeps.outgoingMultiplier`, supplied from `systems/combat/outgoing.ts`. The encounter asks for a number and knows nothing about traits or friendship.

**Why.** Seven of eight innate traits were inert, while the recruiter valued them and the dashboard displayed them. A trait is part of what a hunter *is* (REQ-HUN-009); if it changes nothing, the identity is only a label. Every value (`balance/friendship.json`, `resources.json.hunger`) is **pending approval**.

**Note on DL-009.** `BuildProfile` gained one optional field (`allySafety`). It is additive; existing consumers and hand-built profiles are unchanged, and the §140 A–M scenarios still pass.

---

## DL-058 — The town has a calendar, and the guild works while you are away

**Ambiguity.** REQ-OFF-001 says the guild keeps working while the player is away, for up to three days. Nothing said how town time relates to real time, and nothing moved town time except the "Let a season pass" button.

**Decision.**
- `balance/time.json` sets the live rate: one town step per `realSecondsPerStep` (30), so a 20-step season is ten minutes. The browser entry point advances the town on that interval and autosaves every step, when the tab hides and on unload.
- On load, real time since the last autosave converts to steps at the same rate, capped at 72 hours, and runs through `passTime`. That is the same `advanceTown` path the season button uses (REQ-OFF-002: the same systems, accelerated, never a separate model). Three days, 8,640 steps, takes about half a second.
- A **standing expedition order** (region, objective, cadence) runs during catch-up and live play. REQ-OFF-003: it never goes where hunters can die unless the player ticked "allow lethal zones" when writing it. REQ-OFF-004: an order that cannot run is resolved as "not now" and reported, never left pending.
- The Guild AI **rebuilds damaged buildings** it can afford, on by default and switchable off, and reports what it could not afford.
- The **Guild Report** (REQ-UX-006) records the window from domain events and ledger diffs. It leads with the worst news, groups repeated expeditions and attacks, and shows once on return.

**Why the repair rule.** The first long catch-up in the browser emptied a town holding 6,848 gold: attacks damaged both bunkhouses, the well and the Guild Hall, nothing rebuilt them, and every resident left. A standing policy that lets that happen is not a policy anyone would choose.

**Pending approval:** the calendar rate, and the default for automatic repairs.

---

## DL-059 — Food capacity is production, in residents fed

**Ambiguity.** Phase 6 authored food as capacity in *residents fed* (Granary 14, Field Kitchen 6, a kitchen worker 4) and the pressure panel reads it that way. Phase 7c made provisions a stored flow, but produced them only from staffed jobs, in *provisions per step*.

**Decision.** Provisions produced per step = the town's food capacity × the ration each resident eats. One unit throughout: a town "with enough food for 14" produces what 14 residents eat, so the stores grow when it is bigger than its population and drain when it is not.

**Why.** The founding town has a granary and no kitchen, so under Phase 7c it produced nothing. It starved after about 90 steps and emptied within 200 — five presses of the season button, which is why nobody noticed. The live calendar makes 200 steps less than two hours. The balance soak missed it because it fed the town a fixed production figure rather than the town's own. `tests/offline.test.ts` now holds the founding town through two back-to-back three-day absences.

---

## DL-060 — Notifications are ranked in data; only critical ones interrupt

**Ambiguity.** REQ-UX-005 says notifications are prioritised by importance and only important events interrupt. It does not say which events are important.

**Decision.** `ui/notifications.json` classifies every notice kind the game raises into critical, important or routine, and the loader refuses a missing or unknown kind. Critical notices (a death, a breached wall, the world boss appearing, a legendary find) interrupt as a dismissible banner with `role="alert"`. Important notices raise the unread count on the Notices button. Routine notices wait in the feed. A notice about a party-wide event (a contract, a boss kill) is raised once, not once per hunter. Events the Guild Report already covered are marked read when the report is shown, so returning from time away never produces a wall of banners. Two domain events were added so the notifier could hear them: `town.defended` and `worldBoss.appeared`.

**Pending approval:** which kinds are critical.

---

## DL-061 — The combat replay is a story built from recorded facts

**Ambiguity.** REQ-UX-004 asks for a timeline and highlights that explain why a hunter died, why a boss fell, the key skills, rescues, mistakes and turning points, without a full-frame replay. The combat log held sentences, not facts a replay could reason over.

**Decision.** Every encounter now returns `CombatFacts`: damage dealt and taken, healing, skill uses, killing blows, downs with their source, deaths, rescues, **declined rescues** (read from the AI's own scored candidates: a rescue was on the table and something else was chosen) and a once-a-second sample of each side's health. `sim/combat/combatStory.ts` turns those into:
- a verdict;
- *why* sentences, with the boss first, then each death with its cause and any rescue that was passed over;
- key skills and who leaned on them;
- up to twelve moments, including the largest swing either way in the balance of the fight.

A fight with a death or a boss kill shows its first *why* line in the route report without a click.

**Why "mistakes" are phrased as choices.** A declined rescue appears only if the hunter it left behind went on to die, and the sentence says what the chooser did instead ("chose to keep attacking"). The replay's job is to make the choice visible. Whether it was wrong is the player's call — the same AI would decline a hopeless rescue every time.

---

## DL-062 — Easy and Advanced views, accessibility, and friendship that takes time

**Decision.**
- **REQ-UX-002.** A Settings panel switches between Easy (plain explanations: the default) and Advanced. Advanced adds the policy reason codes on route decisions and log lines, the raw combat log under each replay, the numbers the AI reads from a build profile (risk posture, resource profile, focus, ally safety, top skill affinities), and each trait's effect values. Preferences describe the viewer, not the guild, so they live in browser storage, not the save.
- **Accessibility.** Larger text, higher contrast and reduced motion (which also follows the OS setting). Visible focus rings. Roster rows and route nodes are keyboard-operable, and Shift+Enter compares builds the way Shift-click does. The critical banner is `role="alert"` and the notice feed `role="log"`.
- **REQ-UX-003.** The hunter dashboard gains a Traits & bonds card: traits (innate and Legacy), condition bars, and friends.
- **Friendship now has diminishing returns** (each shared hardship closes part of the remaining distance), and the shared-expedition gain is lower. With the live calendar, a flat gain made every pair of hunters best friends within a few hours of standing orders, and a bond everyone has means nothing.
