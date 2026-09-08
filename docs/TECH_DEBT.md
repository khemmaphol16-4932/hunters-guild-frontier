# Technical Debt & Deferred Work

Every entry names what is owed, why it was deferred, and what triggers repayment. Nothing here is a placeholder that has been forgotten (§126).

## Deliberate stubs (interface exists, implementation deferred)

| Item | Where | Deferred to | Trigger |
|---|---|---|---|
| `EquipmentContribution` null object | `systems/hunter/BuildIdentity` | Phase 2 | equipment system lands |
| `CardContribution` null object | `systems/hunter/BuildIdentity` | Phase 2 | card system lands |
| Rebirth | `core/hunter/leveling` | Phase 8 | a hunter reaches level 100 in play |
| Policy pipeline weight stages | `ai/policy/pipeline` | Phase 4 | hunter AI implementation |
| Behavior memory | `systems/hunter/` | Phase 4+ | first behavior-memory-driven decision |
| Friendship | `systems/hunter/` | Phase 3 | recruitment lands |

## Balance values needing simulation calibration

All are data values; none require code changes to retune.

| Value | File | Blocked on |
|---|---|---|
| Attribute points per level, XP curve exponent | `balance/attributes.json` | Phase 4 combat + Phase 7 economy sim |
| Mastery saturation asymptotes per effect type | `balance/mastery.json` | Phase 4 |
| Personality modifier clamp range | `balance/personality.json` | Phase 4 §140-K scenario |
| Potential tier thresholds | `balance/potential.json` | Phase 3 recruitment feel |
| Notable-chronicle ring size | `balance/chronicle.json` | Phase 5 expedition volume |
| Threat decay rate, taunt magnitude | Phase 4 | Phase 4 |
| Rescue risk/benefit threshold | Phase 4 | Phase 4 §140-F scenario |
| Build-identity axis weights beyond the §16 ratios | `balance/build-identity.json` | Phase 4 behavioral differentiation |

## Content gaps found during Phase 1

| Gap | Why it matters | Repay when |
|---|---|---|
| **No specialization-exclusive skills.** With a 12-skill budget, every skill a Bulwark can learn is also available to its parent Sentinel. The third class stage currently expresses itself through class weights only, not through new capability. | REQ-CLS-003 says specialization is expressed through skills. Right now it is expressed through numbers. | Phase 2–4, as the skill pool grows past ~30. Each specialization should gain at least one exclusive skill. |
| **Advancement moves a build profile ~0.08** on the 0–1 distance metric, against ~0.15+ for an attribute rebuild. | Follows from §16 weighting class at 2 of 10 plus the small skill pool. Acceptable now; the expectation is that it rises. Named as `ADVANCEMENT_DIFFERENCE` in `tests/buildIdentity.test.ts` with the reasoning attached. | Re-measure whenever the skill pool grows; if it ever reads ~0, REQ-BLD-002 has been broken. |
| **One name pool.** REQ-RCT-002 requires regions to produce clearly different hunter pools. | Recruitment identity is a Phase 3 promise. | Phase 3 |

## Known limitations of the Phase 1 build

1. **Build identity has no equipment or card input yet** — profiles are derived from class, attributes, skills, mastery and personality only. The §16 weights already reserve equipment and card shares, so profiles will shift when Phase 2 lands. Expected and accounted for.
2. **The dashboard is functional, not designed** — it exists to prove REQ-BLD-003 visually. Presentation is Phase 9.
3. **No combat, so "different builds behave differently" is proven only at the profile level** — the behavioral half of REQ-BLD-003 cannot be tested until Phase 4. This is the largest open question in the project (risk R2).
4. **Save covers Phase 1 state only** — every later phase adds a migration.
5. **Chronicle records but nothing yet generates entries in play** — the generators arrive with expeditions and combat.

## Architectural watch list

| Watch | Why | Detection |
|---|---|---|
| A god class forming in `ai/` | §126 forbids a giant HunterAI | module size review each phase |
| UI reaching into domain mutation | REQ-TEC-010 | architecture test |
| A second RNG source appearing | REQ-TEC-005, risk R1 | architecture test bans `Math.random()` |
| Wall-clock or frame-delta reads in gameplay | DL-003, risk R1 | architecture test |
| Department budget reappearing | REQ-DEP-003 | code review; explicitly forbidden |
| Capability collapsed to a scalar | REQ-CAP-001 | code review each phase |
