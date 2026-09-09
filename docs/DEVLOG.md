# Development Log

Append-only. One entry per working session (§126).

---

## 2026-09-09 — Phase 0 + Phase 1

**Goal.** The spec's mandated first deliverable: conflict-audited architecture, implementation plan, and a working core prototype. Scope agreed with the user: stop at the end of Phase 1 (RPG Foundation), before combat and AI.

### Toolchain

Machine had no Node, npm or Python. Installed Node 24.19.0 LTS via winget. Project scaffolded under `hunters-guild/` with its own git repository (DL-001), TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, Vite, Vitest. **Zero runtime dependencies** (DL-002).

The Vite dev server needed a launcher script (`.claude/dev-hunters-guild.cmd`) because Node was installed after this shell's environment was captured, so `npm` is not on the inherited PATH.

### Delivered

- **Phase 0 docs**: DESIGN_BIBLE (350 decisions restated as ~150 testable requirement IDs), SYSTEM_MAP, DEPENDENCY_GRAPH, CONFLICT_AUDIT (11 spec-resolved conflicts + 8 found here), RISK_AUDIT (10 ranked risks), ROADMAP (all 10 phases, MVP scope split), DECISION_LOG, TECH_DEBT.
- **Phase 1 code**: deterministic core (seeded splittable RNG, fixed-timestep clock, typed event bus, branded ids), validated data layer, hunter domain (attributes, levelling, respec, composite potential), class chain, skills (registry, knowledge, books, mastery), personality, condition, **build identity**, chronicle, policy pipeline shape, versioned save with a live migration chain, debug console, build dashboard.
- **160 tests** across 9 suites. Typecheck clean.

### What the tests caught (all fixed at the source, not in the test)

1. **The UI was importing the debug console.** Allocating attributes, advancing a class and respeccing are *player* actions, not debug commands — they were only in DebugConsole because that is where they were written first. Extracted `app/GuildCommands.ts` as the player-intent surface; the dashboard dispatches there and DebugConsole delegates to it, keeping only the genuinely rule-*bypassing* commands of its own. This is the difference between a rule that holds and a rule that holds until someone uses the other path.

2. **Specialising unlocked nothing.** A fresh Adept could learn Ember Lance, Frost Chain and Renewal before choosing anything, and every skill available to a Bulwark was already available to a plain Vanguard. The third stage of the class chain was cosmetic. Gated the elemental and heal-over-time skills behind the Invoker/Mender lines, and moved the ultimate (`last_stand`), the party skill (`rally`) and the counter (`riposte`) above archetype level. Advancing now changes what a hunter can do, which is what REQ-CLS-003 requires.

3. **Mastery in an unusable skill correctly does nothing** — a test assumed otherwise and was wrong. Kept the behavior, fixed the test.

### Calibration recorded rather than tuned away

Class advancement plus retraining moves a build profile by ~0.08 on the 0–1 distance metric; rebuilding a hunter's attributes moves it by more. That is the honest consequence of §16 weighting class at 2 of 10 while a 12-skill content budget gives an advanced class only two skills the archetype lacked. Two thresholds are named in the test file with that reasoning attached, and TECH_DEBT tracks it — the expectation is that this number rises as content grows, and if it ever falls to zero, REQ-BLD-002 has been broken.

### Verified in the browser

Dev server on :5173, no console or build errors. Two Vanguards taken down opposite paths (Sentinel→Bulwark with VIT and 12,000 Taunt mastery; Templar→Crusader with STR and 12,000 Riposte mastery) read as genuinely different hunters — 71% tank / 8% risk posture versus damage-primary / 95% risk posture, profile distance 0.338. Save → full page reload → level, attributes, class chain, mastery and derived build identity all restored.

### Open at the end of this session

The behavioural half of REQ-BLD-003 — different builds producing different AI *decisions* — cannot be tested until combat exists. Everything here is the profile-level proxy. Risk R2 stays open until Phase 4.

---

## 2026-09-09 — Phase 2: Equipment

**Goal.** Items, rarity, substats, cards, sets, refinement and disposal — with the acceptance condition that `BuildIdentity` picks up real equipment and card contributions **without an interface change**, validating the DL-009 bet.

### Delivered

Six content files (rarities, item types, substats, cards, sets, unique effects) plus refinement and loot balance, all schema-validated with cross-file referential checks. Systems: `ItemGenerator` (weighted table + pity), `Substats`, `Equipment` (slots, derived main stats, stat and effect aggregation), `Cards` (sockets, tag compatibility, duplicate conversion), `Sets` (2/3/4-piece stacking), `Refinement` (safe zone + risk zone), `Armoury` (guild-wide storage, sell, dismantle, bulk sell), and `identityContributions` (the real `EquipmentContribution` / `CardContribution`). Save bumped to v3 with a v2→v3 migration. Equipment and armoury cards added to the dashboard.

**212 tests across 10 suites** (was 160). Typecheck and production build clean.

### The DL-009 bet paid off — with one caveat worth stating

`git diff HEAD -- src/systems/hunter/` returned **empty**: `BuildIdentity.ts`, `contributions.ts` and `build-identity.json` were byte-identical to the Phase 1 commit after the whole equipment system landed. Swapping the null objects for real implementations required no interface change, no reweighting, and no new coupling. That is the payoff for having designed the contribution interfaces in Phase 1 rather than deferring build identity until items existed.

**The caveat:** the interface held, but Phase 1 had only ever *consumed half of it*. `IdentityContribution` declares four fields; `BuildIdentity` read `roleLean` and `rangeBand` from equipment and cards and silently ignored `riskPostureShift` and `skillAffinity`. Nothing noticed because the null objects returned zeros for all four. Phase 2's tests caught it immediately — a boss card could not make a hunter bolder, and a legendary could not make one more rescue-minded, which quietly contradicted REQ-BLD-001's claim that equipment and cards are build inputs. Fixed by consuming all four fields; the change is additive and is exactly zero for an unequipped hunter, so no Phase 1 test moved.

Worth recording as a general lesson: a null object satisfies a compiler but proves nothing about whether the consumer actually uses what it is given.

### Other problems the tests caught

1. **Two malformed assertions of my own** — `expect(x).toBeLessThan ? … : …` is a truthiness check on a function, not an assertion. Replaced with real bounds, and the perfect-item test now also asserts `isPerfect` *can* return true, so it cannot pass vacuously.
2. **A v1 migration test asserting stale expectations** — the v1→current chain now legitimately adds equipment slots. Updated, and a second test added for the case that actually matters: a v2 save that already has equipment must not have it overwritten.

### Design decisions taken this phase

- **`Inventory` became `Armoury`, guild-wide rather than per-hunter.** REQ-EQP-004 says equipment is never bound to a hunter; a per-hunter bag would turn "give the recruit the old sword" into a transfer with failure modes rather than an equip with none.
- **Main stats are derived, never stored.** An item persists type, rarity, level and refinement; its main stats are computed. Retuning a blade's coefficient therefore updates every blade in every existing save (REQ-TEC-002). Substats are the opposite — they are rolls, so they are stored.
- **Refinement scales main stats only.** This keeps the substat lottery and the refinement gamble as separate games, so refinement cannot launder a badly-rolled item.
- **Set bonuses and card effects are behavioural, not flat stats.** This is the mechanism honouring REQ-EQP-006's "must not invalidate normal equipment" and REQ-CRD-001's "not merely generic +damage" — and tests now assert the property, so a future set cannot quietly break it.
- **Boss card drop rate validation is a hard failure.** `loot.json` declaring anything other than 0.005 throws at load, because REQ-CRD-002 locks it and a well-meaning retune should not be able to override a locked decision silently.

### Verified in the browser

Two Vanguards gear-differentiated: one in a completed 4-piece Ashwarden set with a +6 refined shield carrying the Warden of Ash boss card, one in a caster kit. Profile distance 0.337. The dashboard shows roll quality per slot, all three set tiers with progress toward the next, merged gear effects (threat generation +135%, ally-safety AI weight +28%, defensive skill cost −20%), and a gear column in the derived stats. Save → reload → 74 items, 7 equipped, refinement 6 and risk posture restored bit-identically. No console or build errors.

### Open

Refinement and selling compute their gold cost but do not move gold — the Resources system is Phase 7, and half-implementing it here is the temporary architecture §126 warns against. The *risk* half of refinement's risk/reward is fully live. Tracked in TECH_DEBT.md.

---

## 2026-09-09 — v1.0 reconciliation, then the constellation migration

Two pieces of work in one session. The reconciliation is written up in `SPEC_RECONCILIATION.md`; this entry records what the migration actually taught us.

### Reconciliation (v1.0 §17 step 1)

Audit/replay model · dual-resolution clock · canonical precedence as data · emergency overrides for hard constraints · five availability states · generated build tags · Chronicle Minor/Major/Historic. Save v3 → v4.

The override path was the change worth being careful about. §2.1 makes hard constraints overridable, replacing the absolute rule this project was built on, and an override path is precisely how "hard constraint" degrades into "strong suggestion". So it is narrow by construction: one named constraint, player-authored only, trigger-conditional, always audited. With none configured, behaviour is identical to before.

### The constellation (approved Option B)

Replaced the three-stage Archetype → Advanced → Specialization chain with one node graph. Archetypes became starting positions; the 18 advanced/specialization definitions became descriptive **regions**; every skill became a node with prerequisite groups and six-axis eligibility; class identity is now derived from region investment. `ClassSystem` and `skill-compatibility.json` deleted. Save v4 → v5.

**271 tests across 12 suites.** Typecheck and production build clean.

### What the migration exposed — two real bugs, found by measurement

Neither would have thrown an error. Both would have shipped.

**1. Every archetype converged on the same role.** After the migration I probed actual profiles rather than trusting the tests, and found that at level 20+ a Vanguard, an Adept and a Ranger *all* read `primary role: tank`, with near-identical role spreads. The cause: `archetypeAffinity > 0` meant free access, so every hunter simply took every reachable node, and an Adept holding Shield Bash and Guard Stance out-tanked an actual Vanguard.

The fix was to make affinity mean *distance*: `effectiveLevel = ceil(requiredLevel / affinity)`. Foreign territory stays reachable — v1.0 §5 explicitly wants that — but it arrives late, and deep foreign nodes become effectively unreachable without needing a hard wall. After the fix: vanguard → tank (focus 0.49), adept → healer (0.53), ranger → damage (0.67).

A second contributor was my own test helper: `refreshLoadout` took *every* available node, which no player would do. It now builds toward the hunter's own territory, with an explicit `wander` option for the cross-training case. Modelling "a developed hunter" as "one who took everything" was quietly wrong.

**2. A build's role could vanish from its own summary.** `generateBuildTags` sorted purely by confidence and truncated to eight. Skill-affinity tags routinely hit 1.0, so they crowded out the role tag — a dedicated front-liner could be described as "defensive, threat-holding, martial" while never being called a front-liner. The strongest role and range tags are now reserved before the remaining budget is filled.

### Design decisions recorded

DL-022 (regions, not deletion) · DL-023 (v4 advanced/spec dropped, not translated — identity reconstructs from `knownSkills`; a missing archetype throws rather than being guessed) · DL-024 (affinity as distance).

### Verified in the browser

Fresh guild: Vanguard · Sentinel (tank), Adept · Mender (healer), Ranger · Marksman (damage) — identity derived, not declared. A level-45 Vanguard walked deeper reads "Vanguard · Bulwark/Sentinel", offers Mend and Piercing Shot as cross-territory options, and shows Renewal/Riposte/Rally greyed on the frontier with their unmet requirements on hover. Skill books appear as visible requirements, which is what §5 asks for.

### Open

The Ranger line is content-thin: only two nodes sit in Ranger regions, so a Ranger tops out at one or two skills. That is the 12-skill prototype budget, not a model failure, and it is tracked in TECH_DEBT — but it means the Ranger is the weakest demonstration of the constellation right now.
