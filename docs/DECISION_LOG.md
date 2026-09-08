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

## DL-011 — Attribute point budget and the 1–100 curve

**Ambiguity.** §9 says attribute points are generated from level; §10 caps level at 100. Neither gives numbers.

**Decision.** Prototype values (all in `data/balance/attributes.json`): 3 attribute points per level, 5 in each attribute at level 1, XP curve `base * level^exponent`. These are placeholders explicitly flagged for simulation-based calibration.

**Why conservative.** The spec deliberately left balance open; putting it in data means calibration never requires code changes.
