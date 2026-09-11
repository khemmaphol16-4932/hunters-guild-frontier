# Technical Debt & Deferred Work

Every entry names what is owed, why it was deferred, and what triggers repayment. Nothing here is a placeholder that has been forgotten (§126).

## Deliberate stubs (interface exists, implementation deferred)

| Item | Where | Deferred to | Trigger |
|---|---|---|---|
| ~~`EquipmentContribution` null object~~ | — | — | **done in Phase 2** — replaced by `systems/items/identityContributions` with no change to `BuildIdentity`'s interface |
| ~~`CardContribution` null object~~ | — | — | **done in Phase 2** |
| ~~Gold and resource accounting for refinement, selling and dismantling~~ | — | — | **done in Phase 7b** — all three transact through `systems/economy/Resources` |
| Rebirth | `core/hunter/leveling` | **needs a design decision** (DL-054) | the design owner decides what resets, what is kept, what a rebirth grants, and any limit |
| ~~Policy pipeline weight stages~~ | — | — | **done in Phase 3** — seven build-reading stages in `ai/hunter/hunterAI` |
| Behavior memory | `systems/hunter/` | Phase 5+ | first behavior-memory-driven decision |
| ~~`zone.firstEntered` never fires~~ | — | — | **done in Phase 5** — `WorldKnowledge` emits it on a region's first entry |
| `no_rescues` and `save_ultimates` orders have no dedicated scenario coverage | `tests/scenarios.test.ts` | next AI pass |
| ~~Friendship~~ | — | — | **done** (DL-057) — `systems/hunter/Friendship`, save v24 |

## Balance values needing simulation calibration

All are data values; none require code changes to retune.

| Value | File | Blocked on |
|---|---|---|
| Attribute points per level, XP curve exponent | `balance/attributes.json` | Phase 4 combat + Phase 7 economy sim |
| Mastery saturation asymptotes per effect type | `balance/mastery.json` | Phase 4 |
| Personality modifier clamp range | `balance/personality.json` | tuning — §140-K passes, but the two postures sit close together |
| Potential tier thresholds | `balance/potential.json` | Phase 3 recruitment feel |
| Notable-chronicle ring size | `balance/chronicle.json` | Phase 5 expedition volume |
| Threat decay rate, taunt magnitude | `balance/combat.json` | Phase 5 volume testing |
| The four new AI weights, `retreatUrgencyScale` and `disengageSeconds` — calibrated by hand against the scenarios | `balance/combat.json` | simulation calibration |
| Monster stat lines — trash is trivial at the region's recommended level, so continue/retreat only bites on an underlevelled party | `combat/monsters.json` | Phase 4 balance pass |
| ~~Injury and recovery durations — flat placeholders~~ | — | **done in Phase 6a** — `systems/town/Recovery` computes both from the live town; the two constants are gone |
| ~~Rescue risk/benefit threshold~~ | — | **done in Phase 4** — `HunterAI.rescueViability`, covered by §140-F |
| Build-identity axis weights beyond the §16 ratios | `balance/build-identity.json` | Phase 4 behavioral differentiation |

## Content gaps found during the constellation migration

| Gap | Why it matters | Repay when |
|---|---|---|
| **The Ranger line is content-thin.** Only two nodes sit in Ranger regions (`piercing_shot`, `riposte`), and `riposte` needs a weapon, so a Ranger tops out at one or two skills while a Vanguard reaches four. | Not a model failure — the 12-skill prototype budget — but it makes the Ranger the weakest demonstration of the constellation, and any Ranger-based balance reading is currently unreliable. | Next content pass. Each archetype wants roughly equal node coverage before balance means anything. |
| **10 of 18 regions contain no nodes.** Templar, Invoker, Crusader, Field Medic, Shadowblade, Sharpshooter, Trapper and others exist as definitions with nothing in them. | They still contribute to identity *if* a hunter reaches them, but nobody can. Harmless now, misleading later. | As the skill pool grows past ~30. |
| **Affinity values are unvalidated.** `archetypeAffinity` was authored by judgement and then corrected once by measurement (DL-024). The current numbers produce good separation but have not been swept. | Distance-as-cost makes these numbers load-bearing for build diversity. | Balance harness, Phase 7. |

## Content gaps found during Phase 1

| Gap | Why it matters | Repay when |
|---|---|---|
| **No specialization-exclusive skills.** With a 12-skill budget, every skill a Bulwark can learn is also available to its parent Sentinel. The third class stage currently expresses itself through class weights only, not through new capability. | REQ-CLS-003 says specialization is expressed through skills. Right now it is expressed through numbers. | Phase 2–4, as the skill pool grows past ~30. Each specialization should gain at least one exclusive skill. |
| **Advancement moves a build profile ~0.08** on the 0–1 distance metric, against ~0.15+ for an attribute rebuild. | Follows from §16 weighting class at 2 of 10 plus the small skill pool. Acceptable now; the expectation is that it rises. Named as `ADVANCEMENT_DIFFERENCE` in `tests/buildIdentity.test.ts` with the reasoning attached. | Re-measure whenever the skill pool grows; if it ever reads ~0, REQ-BLD-002 has been broken. |
| **One name pool.** REQ-RCT-002 requires regions to produce clearly different hunter pools. | Recruitment identity arrives with the Recruitment Hall, not with the vertical slice. | Phase 6 |

## Deferred out of Phase 5

| Item | Requirement | Deferred to | Why |
|---|---|---|---|
| ~~World boss placement and respawn~~ | — | **done in Phase 8** | the Drowned Choir appears in Ashfall through `WorldEvents` and respawns deterministically after defeat; broader temporary economy changes remain optional content |
| ~~Boss card pools feed the world-boss loot roll~~ | — | **done in Phase 8** | the Drowned Choir owns `hollow_choir_card`, rolled at the authored boss-card rate on victory |
| Reputation and capability unlock axes | REQ-WLD-002 | Phases 6–8 | parsed and carried, reported as unsatisfied rather than silently met (DL-033) |
| Dungeons as a distinct structure | §49 | Phase 6+ | a dungeon is currently a region with a boss at the end |

## Known limitations after Phase 5

1. **The dashboard is functional, not designed** — it exists to make systems observable. Presentation is Phase 9.
2. ~~**No combat, so "different builds behave differently" is proven only at the profile level.**~~ Settled in Phase 4: the §140 A–M scenarios assert the behavioural half of REQ-BLD-003 directly, and finding a live R2 failure in the process is recorded in RISK_AUDIT.
3. **Chronicle records but almost nothing generates entries in play** — mastery milestones and class advancement do; the rest arrive with expeditions and combat.
4. **Trading has no interface.** REQ-EQP-004 is satisfied structurally — items are guild-owned and unbound, so any hunter can use any item — but guild-to-market trade needs the Market system in Phase 7.
5. **No crafting.** REQ-ECO-004's "craft = certainty, loot = jackpot" is a pairing; Phase 2 delivers only the jackpot half, so the item economy is deliberately incomplete until Phase 7.
6. ~~**Boss cards cannot yet drop.**~~ Closed for the placed world boss in Phase 8; ordinary authored boss pools remain available for expansion.
7. **Trash encounters are trivial at a region's recommended level.** The boss is the only fight that costs anything, so the continue/retreat decision only bites on an underlevelled party.
8. ~~**The world boss is authored but unplaced.**~~ Closed in Phase 8 by the Ashfall world event.
9. **No live combat view.** `CombatEncounter.step` is public precisely so a renderer can drive it a tick at a time, but nothing does — the player reads the fight as a report afterwards rather than watching it, which §7 asks for.

## Phase 2 lesson worth keeping

A null object satisfies the compiler but proves nothing about whether the consumer uses what it is handed. `BuildIdentity` ignored two of `IdentityContribution`'s four fields for an entire phase and no test noticed, because the null objects returned zero for all four. **When stubbing behind an interface, add at least one test that feeds the interface a non-zero value and asserts the output changes.**

## Architectural watch list

| Watch | Why | Detection |
|---|---|---|
| A god class forming in `ai/` | §126 forbids a giant HunterAI | module size review each phase |
| UI reaching into domain mutation | REQ-TEC-010 | architecture test |
| A second RNG source appearing | REQ-TEC-005, risk R1 | architecture test bans `Math.random()` |
| Wall-clock or frame-delta reads in gameplay | DL-003, risk R1 | architecture test |
| Department budget reappearing | REQ-DEP-003 | code review; explicitly forbidden |
| Capability collapsed to a scalar | REQ-CAP-001 | code review each phase |

## Deferred out of Phase 6a

| Item | Requirement | Deferred to | Why |
|---|---|---|---|
| ~~Town hunting~~ | — | **done in Phase 6b** — `sim/town/TownCombat.hunt` runs a real `CombatEncounter`; watching it a tick at a time is Phase 9 |
| ~~Town defense~~ | — | **done in Phase 6b** — building damage is real, and DL-037 held: a wrecked granary does not demote a Village |
| ~~Recruitment Hall~~ | — | **done in Phase 6b** — pool, both refresh routes, five origins and a Guild Fit analysis with reasons, gains and concerns |
| ~~Research tree~~ | — | **done in Phase 6b** — three branches, symmetric conflicts, and the real department-unlock predicate |
| ~~Department unlock keys off town stage~~ | — | **done in Phase 6b** — replaced by the real research predicate; `Departments` did not change, which was the point of injecting it |
| ~~Building costs are computed and displayed but never charged~~ | — | **done in Phase 7b** — placement and payment commit atomically |
| ~~`JobOutput.materials` is authored and produced but goes nowhere~~ | — | **done in Phase 7b** — town advancement deposits it into the ledger |
| ~~Town defence capacity unused~~ | — | **done in Phase 6b** — the Guild AI weighs it when deciding whether the posted watch is enough |
| The Shrine provides comfort only | REQ-TWN-005 | open | v1.0 §20 names exact resurrection methods as an open design question, so the building deliberately does not invent one |
| Population growth ignores the Chronicle | REQ-TWN-003 | Phase 8 | §60 ties growth to reputation, events and prosperity — all three exist; "events" as a town-event system does not |

## Deferred out of Phase 6b

| Item | Requirement | Deferred to | Why |
|---|---|---|---|
| Watching a town hunt or a defense as it happens | REQ-TWN-007, §7 | Phase 9 | `CombatEncounter.step` is public precisely so a renderer can drive it a tick at a time; nothing does yet, for expeditions either |
| ~~Recruit fees, the research reset resource, and building repair costs~~ | — | **done in Phase 7b** — all are real ledger debits; repair scale is authored economy data |
| ~~Respec cost~~ | — | **done in the 2026-09-10 review** (DL-050) — Phase 7b's entry above claimed every price; respec was missed, and its resource had no source |
| ~~Friendship~~ | — | **done** (DL-057) | bonds from shared expeditions and rescues; friends fight harder together |
| The Shrine still provides comfort and no revival | REQ-TWN-005 | open | v1.0 §20 leaves exact resurrection methods an open design question; inventing one here would be the wrong kind of initiative |
| Departments have no per-job lever | REQ-DEP-004 | if it proves needed | department priority separates departments, not jobs within one. `outputValue` (DL-043) covers the case that motivated it; a finer lever would sit below the altitude the design works at |

## Found in the Phase 7–8 review (2026-09-10)

| Item | Requirement | Deferred to | Why |
|---|---|---|---|
| ~~Innate trait effects with no consumer~~ | — | **done** (DL-057) | every trait effect now has a reader; `tests/legacyTraits.test.ts` fails if a new one arrives without one |
| ~~Field hunger is never applied~~ | — | **done** (DL-057) | expeditions add hunger by time in the field; the town feeds it back down as far as provisions allow |
| Ordinary bosses' card pools are still not rolled | REQ-CRD-* | next loot pass | the world boss rolls its pool with the drop chance, the per-boss guarantee and duplicate conversion (DL-056); region bosses have empty pools and nothing rolls them |
| Contract, endless and New Game+ catalogues and numbers are defaults | v1.0 §20 | design approval | every one is labelled pending approval in its data file; v1.0 §20 reserves content catalogues, balance curves and New Game+ rules for the design owner |
| ~~World boss placement~~ | REQ-BOS-003 | **done in Phase 8** | the Drowned Choir is an actionable Ashfall world event with persistence and respawn |

## Waiting for the art phase

| Item | Requirement | Why it waits |
|---|---|---|
| Isometric 2.5D pixel-art town and world | REQ-UX-007, `art/ART_DIRECTION.md` | the art phase; the grid town, text reports and the replay are the functional layer it will present |
| Sounds | Phase 9 audio | `ui/audioCues.json` names a cue for every notice; nothing plays until assets exist |
| Watching a fight live | REQ-UX-004, §7 | `CombatEncounter.step` and `CombatFacts` are ready for a renderer; the replay reads as a story until one exists |
