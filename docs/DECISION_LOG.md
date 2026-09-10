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
