# Conflict Audit

Two classes of conflict: those the specification **already resolved** in §128 (recorded here with the architectural mechanism that enforces the resolution), and those **found during this audit** (resolved conservatively per §127 and logged in `DECISION_LOG.md`).

Resolution precedence used throughout (§2): later decision > hard constraint > specific over general > latest clarification > preserve both through architecture > never invent a new major system to resolve a conflict.

---

## Part A — Pre-resolved by the specification (§128)

### A1. Interrupt Priority vs Reaction Priority

**Tension.** §32 gives the AI an "Interrupt Priority"; §13 forbids a player-facing reaction-skill system.

**Resolution (locked).** The AI has an internal interrupt priority. Reaction priority is fixed and not player-adjustable.

**Mechanism.** `ai/hunter/interrupts.ts` holds a constant, ordered priority table loaded from `data/balance/interrupts.json` — designer-tunable, not player-tunable. No UI surface writes to it. Interrupts enter the same `pipeline` as normal actions, so they are still subject to hard constraints and capability filtering (they cannot become a bypass).

**Test.** An interrupt candidate that violates a hard constraint is dropped, not promoted.

---

### A2. Reaction skills as a category

**Resolution (locked).** No separate reaction-skill category exists.

**Mechanism.** `SkillDefinition.conditions[]` plus `SkillDefinition.triggers[]`. A "counter" skill is an ordinary active skill whose condition is `wasAttackedWithin(0.5s)`. The candidate enumerator evaluates conditions before utility (REQ-SKL-007), so reactive behavior emerges from the normal path.

**Test.** The skill schema has no `reaction` category; a data file declaring one fails validation.

---

### A3. Death Policy vs AI judgement

**Resolution (locked).** Player Risk/Death Policy is authoritative. The AI evaluates; it never overrides a hard constraint.

**Mechanism.** Death/retreat policy compiles into hard-constraint predicates evaluated in `hardConstraints.ts`, the **first** stage of the pipeline and the only stage that *removes* candidates unconditionally. Utility scores are computed after, and can only reorder survivors.

**Test.** A scenario where the utility-optimal action violates a retreat threshold must produce a different action, every time, under every seed.

---

### A4. Highest Threat vs sophisticated monster AI

**Resolution (locked).** Monster targeting is primarily highest-threat. Sophistication comes from skill use, movement, phases, threat generation and positioning — not arbitrary target switching. Bosses use the same threat model unless a specific boss system says otherwise.

**Mechanism.** `Threat.ts` owns the target selection for all monsters including bosses. `bossAI.ts` may add phase behavior and scripted mechanics but has no target-override hook; a boss that must ignore threat declares an explicit, named exception in its data definition rather than bypassing the system in code.

---

### A5. Hunter target switching

**Resolution (locked).** A Hunter's current target changes only when the target dies.

**Mechanism.** `targeting.ts` holds a target lock. Retargeting is triggered by exactly one event: `entity.died` for the locked target (plus target-unreachable as a degenerate case — see B3). All tactical adaptation flows through skill choice, positioning, defense, support, utility and movement instead.

**Test.** A more attractive target appearing mid-combat must not change the lock.

---

### A6. Build Identity vs Party Strategy

**Resolution (locked).** Build identity wins; party strategy is context.

**Mechanism.** Party strategy contributes **weights**, never **filters**. Build capability contributes filters. Because filters run before weights, no party template can make an action valid that the build cannot perform. A glass-cannon assigned to a tank-shaped template simply scores tanking actions higher among the actions it *can* actually do.

**Test.** A glass-cannon DPS in a "need tank" template must not select tank-frontline actions it lacks the capability for.

---

### A7. Chronicle vs behavior

**Resolution (locked).** Chronicle records history; history does not automatically become a gameplay penalty. Only Behavior Memory, Mastery, Trait and Legacy Trait convert experience into effects.

**Mechanism.** `Chronicle` is a pure event subscriber with no outbound dependency (see the "deliberately absent edges" table in `DEPENDENCY_GRAPH.md`). `BehaviorMemory` is a *separate* subscriber with an explicit, small, data-driven list of which events it converts. Adding a chronicle event type therefore has zero mechanical effect by default.

**Test.** Recording "died in Red Zone" changes no derived stat and no AI weight.

---

### A8. Environment

**Resolution (locked).** Terrain affects movement and positioning. Environmental damage is limited to specific events. Hunters use environmental mechanics only via designated skills. Ordinary monsters never deliberately exploit the environment. Bosses may have scripted interactions. World Bosses may have unique mechanics.

**Mechanism.** `Environment.ts` exposes movement cost and positioning only. Environmental damage lives in event definitions, not in the combat loop. `monsterAI.ts` has no environment-exploitation considerations at all; `bossAI.ts` reads scripted environment steps from boss phase data.

---

### A9. Offline events

**Resolution (locked).** Offline events are resolved by AI per policy and never wait for the player.

**Mechanism.** `EventPolicyAI` resolves every event synchronously during simulation. There is no pending-event queue in the save format — a design choice that makes the "waiting event" failure mode structurally impossible. Outcomes are recorded for the Guild Report.

---

### A10. Department Budget

**Resolution (locked).** There is no Department Budget system, and it must not be reintroduced.

**Mechanism.** Recorded as a negative requirement (REQ-DEP-003) and as an absent edge in the dependency graph. Departments hold policy and priority, never allocation of currency.

---

### A11. Party Templates

**Resolution (locked).** The AI may only use player-created templates; it may not invent new ones.

**Mechanism.** `PartyTemplate` objects carry an `author: 'player'` provenance field and are constructed only through a player-intent entry point. `GuildManager` accepts a template id and a hunter pool; it has no template-construction API to call.

**Test.** `GuildManager` cannot produce a party whose template id is not in the player-authored set.

---

## Part B — Found during this audit

### B1. "Hunters cannot refuse work" vs "Preferred Role / Preferred Department"

**Tension.** §71 says Guild Policy always wins and hunters cannot refuse assignment. §72 says assignment *uses* preferred role and preferred department.

**Resolution.** Preferences are **inputs to the assignment scoring function**, never vetoes. A hunter assigned against preference still performs the work; the preference mismatch may affect morale (§48) and execution style (§18), never compliance.

**Recorded as** REQ-TWN-010. Conservative: preserves both statements without inventing a refusal system.

---

### B2. Personality "affects AI decision weight" vs "Guild Policy takes priority"

**Tension.** §18 gives personality decision weight; §70 makes Guild Policy authoritative.

**Resolution.** Personality is the **last weight stage** in the pipeline, applied after all policy weights, and it is bounded: personality modifiers are clamped to a configured range (`data/balance/personality.json`) so they can reorder near-ties but cannot overturn a strong policy signal. Personality never contributes a filter.

**Recorded as** REQ-HUN-010, REQ-POL-003. The clamp bound is a tunable, flagged in `TECH_DEBT.md` as needing simulation-based calibration.

---

### B3. Target lock vs unreachable targets

**Tension.** §31 permits retargeting only on target death. A target can become permanently unreachable (phased out, fled, separated by terrain), which would deadlock the hunter.

**Resolution.** Retargeting triggers are exactly two: target death, and target *invalidation* (removed from the encounter or unreachable for longer than a configured timeout). Invalidation is not "a better target appeared" — the spec's actual concern. Preferring a deadlock would violate REQ-PRIME-002 (the AI must manage execution).

**Logged in** `DECISION_LOG.md` as an assumption under §127.

---

### B4. Real-time combat vs deterministic offline simulation

**Tension.** §38 requires real-time combat; §57 requires offline runs to use the *same* combat AI; §117 requires deterministic simulation.

**Resolution.** Combat runs on a **fixed simulation timestep**, never on frame delta. Rendering interpolates between simulation states. Offline catch-up runs the identical stepper with rendering detached and the step budget raised. This is the single most load-bearing architectural decision in the project and is why `core/clock.ts` is a Phase 1 deliverable rather than a Phase 4 one.

**Consequence.** No gameplay code may read wall-clock time or `requestAnimationFrame` delta. Enforced by the architecture test.

---

### B5. "No hard cap on mastery" vs numeric stability

**Tension.** §15 says mastery has no practical hard cap; unbounded values threaten balance and serialization stability.

**Resolution.** Mastery *points* are unbounded and permanent. The mastery *effect* is a bounded function of points (a saturating curve approaching an asymptote defined per effect in `data/balance/mastery.json`). "No practical cap" is satisfied — points always grow — while effects stay finite. Diminishing returns (§15) is exactly this curve.

**Recorded as** REQ-MAS-001/003.

---

### B6. Chronicle growth vs save size

**Tension.** §19 wants a rich, permanent chronicle; §116 wants an evolvable save format. A 127-expedition hunter times dozens of hunters times full event logs grows without bound.

**Resolution.** Chronicle stores **aggregate counters** (expeditions, bosses, near-deaths, rescues, rare finds, companions lost) plus a **capped ring of notable entries** ranked by significance. Counters are cheap and permanent; the notable ring is bounded and configurable. This preserves the spec's example display exactly (§19) while bounding growth.

**Logged in** `DECISION_LOG.md`.

---

### B7. Build identity depends on equipment, which does not exist in Phase 1

**Tension.** REQ-BLD-001 requires equipment and cards as build inputs; Phase 2 delivers them.

**Resolution.** `BuildIdentity` consumes `EquipmentContribution` and `CardContribution` **interfaces**, not concrete systems. Phase 1 supplies null-object implementations returning zero contribution. Phase 2 swaps in real implementations without touching `BuildIdentity`. The §16 contribution weights (Class 2, Attributes 2, Skills 2, Equipment 2, Cards 1, Books 1) are configured in data and already include the not-yet-implemented sources, so weights do not have to be rebalanced later.

---

### B8. "No universal Power Score" vs the need to rank hunters for assignment

**Tension.** §89 forbids a single universal power score; `GuildManager` must still pick hunters for a party slot.

**Resolution.** Assignment scores are **per-context and per-role**: a hunter is scored *for this template slot on this expedition*, never globally. `Capability` is a vector, and no code may reduce it to a scalar for display or comparison. UI shows the vector.

**Recorded as** REQ-CAP-001.

---

## Open items requiring simulation to settle

These cannot be resolved by reasoning and are deferred to the balance harness (§121), tracked in `TECH_DEBT.md`:

- Personality modifier clamp range (B2)
- Mastery saturation asymptotes per effect type (B5)
- Notable-chronicle ring size (B6)
- Threat decay rate and taunt magnitude
- Rescue risk/benefit threshold — the value that makes "a Hunter may decline a rescue" feel deliberate rather than cowardly
