# Technical Debt & Deferred Work

Every entry names what is owed, why it was deferred, and what triggers repayment. Nothing here is a placeholder that has been forgotten (§126).

## Deliberate stubs (interface exists, implementation deferred)

| Item | Where | Deferred to | Trigger |
|---|---|---|---|
| ~~`EquipmentContribution` null object~~ | — | — | **done in Phase 2** — replaced by `systems/items/identityContributions` with no change to `BuildIdentity`'s interface |
| ~~`CardContribution` null object~~ | — | — | **done in Phase 2** |
| Gold and resource accounting for refinement, selling and dismantling | `app/GuildCommands` | Phase 7 | Resources system lands. Costs and yields are already computed and returned, so wiring them to a ledger is a small change. The *risk* half of refinement is fully live. |
| Rebirth | `core/hunter/leveling` | Phase 8 | a hunter reaches level 100 in play |
| ~~Policy pipeline weight stages~~ | — | — | **done in Phase 3** — seven build-reading stages in `ai/hunter/hunterAI` |
| Behavior memory | `systems/hunter/` | Phase 5+ | first behavior-memory-driven decision |
| `zone.firstEntered` never fires, so `zonesFirstEntered` is always zero — needs per-hunter discovery state | `app/GuildCommands` | Phase 5 exploration memory |
| `no_rescues` and `save_ultimates` orders have no dedicated scenario coverage | `tests/scenarios.test.ts` | next AI pass |
| Friendship | `systems/hunter/` | Phase 6 | recruitment lands (the Recruitment Hall is a Phase 6 building) |

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
| Injury and recovery durations — flat placeholders until housing/food/services exist | `app/GuildCommands` | Phase 6 |
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

## Known limitations after Phase 4

1. **The dashboard is functional, not designed** — it exists to make systems observable. Presentation is Phase 9.
2. ~~**No combat, so "different builds behave differently" is proven only at the profile level.**~~ Settled in Phase 4: the §140 A–M scenarios assert the behavioural half of REQ-BLD-003 directly, and finding a live R2 failure in the process is recorded in RISK_AUDIT.
3. **Chronicle records but almost nothing generates entries in play** — mastery milestones and class advancement do; the rest arrive with expeditions and combat.
4. **Trading has no interface.** REQ-EQP-004 is satisfied structurally — items are guild-owned and unbound, so any hunter can use any item — but guild-to-market trade needs the Market system in Phase 7.
5. **No crafting.** REQ-ECO-004's "craft = certainty, loot = jackpot" is a pairing; Phase 2 delivers only the jackpot half, so the item economy is deliberately incomplete until Phase 7.
6. **Boss cards cannot yet drop.** The 0.5% rate, per-boss pools and duplicate-protection counter exist as validated data and tested logic, but the loot roll does not yet consult a defeated boss's card pool.
7. **Trash encounters are trivial at a region's recommended level.** The boss is the only fight that costs anything, so the continue/retreat decision only bites on an underlevelled party.
8. **No live combat view.** `CombatEncounter.step` is public precisely so a renderer can drive it a tick at a time, but nothing does — the player reads the fight as a report afterwards rather than watching it, which §7 asks for.

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
