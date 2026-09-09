# Risk Audit

Ranked by *expected cost of getting it wrong*, not by difficulty. A cheap mistake in a hard system beats an expensive mistake in an easy one.

Severity: **S1** = threatens the project · **S2** = threatens a phase · **S3** = local damage.

---

## R1 — Offline simulation must share the combat AI (S1)

**Requirement.** REQ-OFF-002: offline expeditions run the same systems and the same combat AI, up to 3 days of catch-up.

**Why it is dangerous.** The obvious implementation — a fast statistical approximation for offline — is explicitly forbidden, and every project that tries to add determinism *later* ends up rewriting its combat loop. Three days of game time at a realistic tick rate is millions of steps; if a single step touches `Math.random()`, wall-clock time, or the DOM, offline results diverge from real-time results and become untestable.

**Mitigation (Phase 1, already designed).**
- `core/clock.ts` fixed timestep; rendering interpolates and is never authoritative.
- `core/rng.ts` seeded streams injected everywhere; `Math.random()` banned outside `debug/`.
- Architecture test enforces both bans from the first commit.

**Residual risk.** Step-budget performance for 3-day catch-up is unknown until Phase 4. Measure early — a naive per-entity-per-tick AI evaluation will not survive it. Planned mitigation: AI decisions re-evaluate on a slower cadence than physics, with interrupts able to force early re-evaluation.

---

## R2 — "Builds change AI behavior" may not actually happen (S1) — **settled in Phase 4**

**Requirement.** REQ-BLD-003. This is the game's central promise (§131: *"This Hunter is terrible on paper, but somehow he became incredible"*).

**Why it is dangerous.** The failure mode is silent. Utility AI naturally converges on "use the highest-damage available skill", which makes every build behave the same and reduces build identity to a stat package — the exact outcome §16 forbids. Nothing crashes; the game just becomes boring, and by then the AI is load-bearing and expensive to change.

**Mitigation.**
- `BuildIdentity` produces a *structured profile* (role lean, range band, risk posture, resource profile, skill affinities), not a number. Utility considerations read the profile, so build differences enter the decision as differing **weights and thresholds**, not just differing damage.
- Phase 1 ships the differentiation test as an acceptance gate: same class, different attributes/mastery → measurably different profiles.
- Phase 4 adds §140 K/L behavioral scenarios: identical builds differing only in personality, and only in mastery, must produce different decisions.

**Outcome (Phase 4).** Settled, and the danger was real. The §140 A–M harness caught the exact
failure this entry predicted, already live in the code and hidden behind a green test suite:
`skillAffinity` summed a skill's tags instead of averaging them, so preference reached ~4.9
against an urgency term of ~2.5 and *silently outvoted every situational consideration*. The AI
always reached for its favourite skill; telegraphs, zone danger and the guild's objective could
not change a decision. Build identity had collapsed into a preference table.

It survived because the Phase 3 test that claimed to settle R2 compared a *tank* with a *healer* —
two hunters who differ in every respect. It proved they differed, not that the mechanism worked.
A differentiation test has to hold the situation fixed and vary only the thing under test, which
is what §140-K and §140-L now do.

**Residual risk.** Profile → behavior mapping quality is a tuning problem that only playtesting
settles, and the weights are still hand-calibrated against the scenarios rather than against a
simulation (TECH_DEBT).

---

## R3 — The policy hierarchy leaks (S1)

**Requirement.** REQ-POL-004: hard constraints always win.

**Why it is dangerous.** A hierarchy enforced by convention *will* be violated eventually — some future system adds a "but if the boss is enraged…" branch that quietly bypasses a retreat threshold. The player then watches a hunter die against an explicit instruction, which is the single most trust-destroying bug this design can have.

**Mitigation.** Structural, not conventional: hard constraints are the only stage that *removes* candidates unconditionally, and they run first. Every later stage can only reorder what survives. There is no API to add a candidate after filtering. Tested with adversarial scenarios where the utility-optimal action is forbidden.

---

## R4 — Save schema evolution across a long-lived project (S2)

**Requirement.** REQ-TEC-004.

**Why it is dangerous.** This game is explicitly designed for very long single saves ("I don't want to delete this Guild because it has stories", §130). A save format that cannot migrate destroys exactly the thing the design values most. Migration debt compounds silently.

**Mitigation.** Versioned envelope plus an ordered migration chain from day one, with the rule: *a version bump requires a migration and a round-trip test in the same commit*. Phase 1 ships a deliberate v1→v2 migration so the chain is exercised before it matters.

---

## R5 — Economy exploits and runaway loops (S2)

**Requirement.** REQ-TEC-009 / §141.

**Why it is dangerous.** Infinite money, infinite resources, infinite healing or infinite item generation destroy pacing permanently, and they typically emerge from *interactions* between systems that are each individually fine.

**Mitigation.** `sim/Balance.ts` runs long headless simulations and asserts invariants (net resource flow bounded, no unbounded growth in any tracked quantity). Deferred to Phase 7, but the determinism work in R1 is what makes it possible at all.

---

## R6 — Content volume outrunning system proof (S2)

**Why it is dangerous.** §138/§139 warn against it explicitly. Authoring 100 skills before the AI can distinguish 8 of them wastes the effort *and* makes rebalancing prohibitive.

**Mitigation.** Hard content budget for the prototype: 10–12 skills, 5–8 monsters, 1–2 regions, 3 archetypes. Content expansion is gated on the differentiation tests in R2 passing.

---

## R7 — Chronicle and event growth (S3, becomes S2 late)

Covered by conflict B6: aggregate counters plus a bounded notable-entry ring. Risk is deferred, not eliminated — revisit when hunter count times playtime gets large.

---

## R8 — Physical town / spatial sim performance (S3)

**Why it is dangerous.** REQ-TWN-001 requires hunters to physically walk the town, and REQ-TWN-007 makes town hunting real combat. Combined with offline catch-up (R1), the town becomes a second continuously-simulated world.

**Mitigation.** Town movement is presentation-layer interpolation over a coarse logical simulation (hunters occupy logical locations and transition over time); pathing is not simulated per-tick per-hunter. Town hunting escalates to the full combat system only for the encounter itself. Deferred to Phase 6.

---

## R9 — Toolchain and environment (S3, currently mitigated)

The machine had no Node.js, npm or Python at project start. Node 24.19.0 LTS is now installed via winget, and the project is self-contained under `hunters-guild/` with its own git repository. Dependencies are limited to TypeScript, Vite and Vitest — no runtime dependencies at all, which keeps REQ-TEC-001 (removable/replaceable systems) honest and avoids §126's "huge dependencies without reason".

---

## R10 — Isometric pixel-art presentation deferred (S3, accepted)

Presentation is deliberately deferred to Phase 9 (user decision). The risk is that a renderer swap late in the project is expensive. Mitigated by keeping the renderer a thin read-only layer over simulation state from the start: the sim owns positions in world units; the renderer owns projection. Swapping top-down for isometric changes only the projection function and the sprite pipeline.

**Watch for** the anti-goal in §129: if the game is still menus-only by end of Phase 4, presentation has been deferred too far.

---

## Ranked summary

| Rank | Risk | Severity | First addressed |
|---|---|---|---|
| 1 | Offline sim shares combat AI | S1 | Phase 1 (clock + RNG + arch test) |
| 2 | Builds must change AI behavior | S1 | Phase 1 (BuildIdentity + differentiation test) |
| 3 | Policy hierarchy leaks | S1 | Phase 1 (pipeline shape) / Phase 4 (full) |
| 4 | Save migration debt | S2 | Phase 1 (chain + v1→v2 test) |
| 5 | Economy exploits | S2 | Phase 7 |
| 6 | Content outruns systems | S2 | Phase 1 (content budget) |
| 7 | Chronicle growth | S3→S2 | Phase 1 (bounded design) |
| 8 | Town/spatial performance | S3 | Phase 6 |
| 9 | Toolchain | S3 | resolved |
| 10 | Deferred presentation | S3 | Phase 9 |

Four of the top five are addressed structurally in Phase 1 — which is the reason Phase 1 includes the clock, the RNG, the save chain and the architecture test rather than only hunter data.
