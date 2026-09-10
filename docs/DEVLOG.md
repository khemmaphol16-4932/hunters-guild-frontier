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

---

# Phase 3 — The vertical slice

The first build where the game is playable as a game: pick a region and an objective, read the party the AI proposes and *why*, send it, and read back what happened node by node.

## What was built

`data/balance/combat.json` · `data/combat/monsters.json` (6 monsters, one two-phase boss with telegraphed skills) · `data/combat/statuses.json` · `data/world/regions.json` (one BLUE region, one BLACK) · `data/combatSchema.ts` · `core/combat/Combatant.ts` · `core/hunter/buildProfile.ts` · `systems/combat/damage.ts` · `systems/combat/combatants.ts` · `systems/party/Party.ts` · `ai/hunter/hunterAI.ts` · `sim/combat/CombatEncounter.ts` · `sim/expedition/Expedition.ts` · `app/GuildCommands.sendExpedition` · `ui/expeditionView.ts` · `ui/appShell.ts`.

298 tests green, typecheck clean.

## Risk R2 — settled

*"Do different builds produce different AI decisions, or only different numbers?"*

The mechanism is that all seven weight stages in `HunterAI` read `BuildProfile` and none read raw stats. Given the identical board — one ally at a quarter health, one enemy in reach — a Vanguard and an Adept choose different *actions*, not the same action with different damage. That is now an assertion in `tests/expedition.test.ts`, not a claim.

## What the schema refuses to load

`varianceSpread` other than 0.1 (REQ-CBT-007) · hard CC without diminishing returns (REQ-CBT-009) · `statusResistance` on a non-boss (REQ-CBT-010) · a BLUE zone that can injure, or any non-BLACK zone that can kill (REQ-ZON-001) · a region whose boss is not authored as a boss · a monster skill applying a status that does not exist. There is still no `elementMultipliers` key anywhere, deliberately (v1.0 §20).

## Bugs found by building it

**1. No hunter could ever die — anywhere.** Death was reached only by a downed timer expiring, but an encounter ends the moment the last hunter falls, so in a wipe no timer ever ran out. The BLACK zone was decorative. Hunters left down at a wipe are now lost, and the zone tier decides what that means (DL-027). The test that caught it deliberately sends an outmatched party and asserts a death is *reached*, rather than asserting deaths are rare.

**2. The party summary contradicted itself.** A turtle formation wanting two tanks and getting one reported "No tank" directly above a composition line reading "1 tank". "No tank" and "one short of two" lead the player to different actions — recruit, or wait for someone to recover — so the summary now distinguishes them.

**3. Telegraphed boss skills never reported landing.** The log showed "The Warden of Ash begins Cinder Sweep" and then nothing, because only criticals and deaths were recorded. A wind-up with no payoff reads as the boss having done nothing.

**4. The route log was one step out of order.** Each node's continue/retreat reasoning rendered *after* its report, so "The party sets out" appeared beneath a fight that had already happened.

**5. Two layering violations, caught by the architecture test rather than by review.** `core/combat/Combatant` imported `BuildProfile` from `systems/`, and `systems/combat/CombatEncounter` imported `ai/`. Both were fixed structurally — the profile shape moved to `core/`, the encounter moved to `sim/` beside the expedition — not by relaxing the test. See DL-026.

## Verified in the browser

A fresh guild of four. Party proposed with a rationale per member, sent into The Verdant Reach, 4/4 nodes cleared, three items in the armoury, everyone returned Recovering with 21 xp each, and every node expandable to its combat highlights. Same seed, same run.

## Open

Trash encounters are trivially easy against a party at the region's recommended level; the boss is the only fight that costs anything. That is a tuning question for Phase 4's balance pass, not a model failure — but it means the continue/retreat decision only bites on an underlevelled party today. Tracked in TECH_DEBT.

---

# Phase 4 — Combat depth and the AI validation scenarios

The phase that was meant to prove or disprove risk R2. It disproved my Phase 3 evidence for it first.

## What was built

`debug/scenarios.ts` — a harness that builds exact boards (precise health, resource, position, cooldowns, downed timers, boss telegraphs) and hands them to the real `HunterAI` through the real pipeline with nothing stubbed · `tests/scenarios.test.ts` — 24 assertions covering §140 A–M · `ai/policy/orders.ts` — the standing orders a player can actually give · `ai/policy/PolicyBook.ts` · four new AI weight stages, `retreat` and `dodge` actions, rescue-viability estimation, combat chronicle events, party coordination · a standing-orders panel in the UI.

333 tests green, typecheck and production build clean.

## The bug that mattered

**`skillAffinity` was summed over a skill's tags, not averaged.** A three-tag skill scored roughly triple a one-tag skill for reasons having nothing to do with the hunter or the fight. In practice the stage reached ~4.9 against an urgency term of ~2.5, so *preference silently outvoted every situational consideration*. The AI always reached for its favourite skill; telegraphs, zone danger and the guild's objective could not change a decision.

That is exactly the R2 failure this whole design exists to prevent — "build identity collapses into a stat package" — and it survived a green suite, because the Phase 3 test that "settled R2" compared a tank with a healer, whose favourite skills differ anyway. The test was true and proved nothing. A scenario harness that builds one board and asks two builds what they would do found it in a single run.

**Lesson recorded:** a differentiation test must hold the *situation* fixed and vary only the thing under test. Comparing two hunters who differ in every respect proves they differ, not that the mechanism works.

## Other bugs found by building it

- **`monsterOf` was never wired into the Session's `HunterAI`.** Every enemy looked like trash, so `ultimateTiming` ran inverted: an ultimate was *withheld* against a boss and *spent* on a wounded party fighting a rat. An optional dependency nobody supplied.
- **The rescue threshold had its sign inverted.** Boldness was subtracted from viability, making braver hunters *less* likely to attempt a rescue — the opposite of REQ-CBT-013 and of what the word means.
- **A level-50 debug hunter had every attribute still at 5** and 147 points unspent, which silently blocked every attribute-gated constellation node and left a level-50 Ranger knowing exactly one skill. The harness had been describing a hunter the game would never produce, and every scenario built on it was testing that fiction.
- **Retreat was a free, unfailable escape.** Once hunters could withdraw, 25 out of 25 hopelessly outmatched parties in a BLACK zone came home intact and not one hunter died. Permanent death had become a rule the AI could always opt out of (DL-029).
- **A hunter with skills on cooldown walked away at 55% health**, because risk posture rewarded leaving unconditionally rather than in proportion to danger. The same class of bug as the objective term, which at first made a cautious party withdraw at full health without throwing a punch.
- **Retreat urgency was a step function**, which pinned the crossing point and made zone, objective and posture decorative (DL-030).
- **"Hold the line" was obeyed in combat and ignored on the route.** Found in the browser, not in a test: the panel said the order was in force while the report said the party turned back (DL-031).

## What I got wrong about testing

Four of the A–M scenarios failed for a while because *my premise* was wrong, not the AI:

- **§140-C** assumed a tank would brace against a telegraph. `guard_stance` requires being below 70% health, so a tank at full health has nothing to brace with and dodging is the right answer for them too. The brace-versus-evade distinction only exists once bracing is available.
- **§140-E** asserted the `rescue` action, but `drag_to_safety` *is* the rescue skill — the AI was right and the assertion was too narrow.
- **§140-K/M** were written as single hand-picked boards. Two hunters are not required to differ on every board, only to be capable of differing, and pinning that to one board tests a threshold rather than a behaviour. They are sweeps now.
- **§140-M** I spent several iterations trying to force a healer with a heal ready to *stop healing* in a lethal zone. It should heal in both. The zone's real effect is on the party's preservation ranking and on marginal decisions, so that is what the test asserts — plus one swept case where the zone genuinely decides.

The expedition's objective test had the same flaw: it sat on a single outlier seed where the relationship inverted, passing until an unrelated change disturbed it. Across eight seeds the cautious objective comes home in better shape every time.

## Verified in the browser

Ordered "Hold the line", sent a starting-level party into the Ashfall Barrows. The route report reads *"Standing orders forbid turning back. The party presses on at 52% strength"*, then the next node wiped at 0%, then four lines of "did not come back" and an empty roster. The same party, without the order, turned back and survived. The player made one policy decision and can read exactly what it cost.

## Open

Two orders (`no_rescues`, `save_ultimates`) are offered in the UI but have no dedicated scenario coverage yet. `zone.firstEntered` still never fires, so `zonesFirstEntered` is always zero — it needs per-hunter discovery state, which is Phase 5's exploration memory and belongs there.

---

# Phase 5 — The world

The phase that turns a region list into a map. §8's framing did most of the design work: *the map is a knowledge interface*, not a level select — so what the guild knows is progression, and what it can see about a place is a function of having been there.

## What was built

`systems/world/WorldKnowledge.ts` — permanent, guild-owned exploration memory · save **v6** and its migration · region unlock gates (`RegionUnlockDef`) and `GuildCommands.regionAvailability` · `data/world/events.json` — six authored events, each a real decision · `parseEvents` · branching routes, an event node kind, and detours that splice new nodes into a walk in progress · the ten-minute cap · two new regions so all four danger tiers exist, with their own populations and hazards · five new monsters including a world boss · the map panel in the UI.

356 tests green, typecheck and production build clean.

## What the schema now refuses to load

A region gated behind a boss or a region that does not exist · a region gated behind knowledge of *itself* (unsatisfiable) · an event with fewer than two options · an event whose zone tiers and hazards match no region, so it could never fire · a world missing any of REQ-ZON-001's four danger tiers.

That last one is the kind of check worth having: the four tiers are a locked design decision, and until this phase only two of them existed anywhere in the content. Nothing was failing — the game simply had no yellow or red.

## The interesting outcome

**Events made the objective legible in a way combat alone had not.** Given identical content, the two objectives diverge completely and readably:

| | survive | slay |
|---|---|---|
| abandoned cache | leave it | force it open |
| collapsed passage | go around | dig through |
| defensible ground | make camp | push on |
| still water | edge around | wade straight across |

Nothing in the events is authored per objective. It falls out of matching each option's risk against the objective's appetite, and it is the clearest demonstration so far that the player steering *strategy* actually steers behaviour.

## Bugs and wrong premises

- **The branch was unreachable in practice.** `go_around` — the option that splices in extra nodes — is the *cautious* choice, so a healthy party on a "clear the route" objective always dug through instead. The branching worked; nothing ever took it. Found by a test that asserted route length could exceed the region's authored maximum and failed.
- **That test was also wrong twice over.** A detour taken on a short route still lands inside the authored band, so "longer than the maximum" was never the right assertion. Comparing the two objectives on the *same seed* is: both draw the same base route, so any difference in length is the branch.
- **"Well travelled — 0 expeditions."** Caught in the browser. A region's knowledge *tier* and its recorded *visits* are different things — content can start the guild already knowing somewhere it has never mounted an expedition to — and the description conflated them. It also claimed a "deepest point reached: node 0" for a region nobody had entered.
- **"The party turned back, 4/4 of the route."** Also from the browser. Reaching the end of the route and then breaking off from the last fight is a different story from turning back partway, and the summary read as a contradiction.
- **Two tests were single-sample again.** The route-order test sat on the one seed out of eleven where the unordered party happened *not* to turn back, and the objective-condition test was measuring an 83% tendency over eight runs. Both are sweeps now. This is the third phase in which a single-seed assertion has passed or failed for reasons unrelated to what it was checking.

## Verified in the browser

A level-1 guild sees all four regions, three marked "— locked", with "needs a hunter of level 15" spelled out. A levelled guild sees them all open. The Sunken Choirhouse reads *"Danger Red · Conditions Standing water, Failing light, The song · Walked once or twice — 1 expedition · Deepest point reached: node 4 · 2 kinds of inhabitant recorded"*, and the route report now opens with *"1m 54s in the field"*.

## Open

The world boss is authored but not yet *placed* — REQ-BOS-003's respawn, world-event appearance and world-changing effects need a world-event system, which is really Phase 8's territory. Boss card pools still do not feed the loot roll. Reputation and capability unlock axes are carried but not evaluable until Phases 6–8 own them.

---

# Phase 6a — The town

The phase that turns a roster into a place. REQ-TWN-001's wording did the design work again: *the town is a physical place on a clear grid*. That is a stronger claim than it looks, and it rules out the shape this system drifts into by default — a list of owned buildings with a count, where "placement" is decoration. If a building does not occupy space, nothing is ever traded against anything, and the town is a menu with a picture.

## What was built

`systems/town/TownGrid` — footprints, four-direction rotation, collision and free relocation · `Town` — capacity, housing and service *quality*, and the stage ladder · `Population` — demand, per-axis pressure, Town Stability, deterministic growth · `Departments` — heads, deputies, priorities, four policy presets and a four-metric dashboard · `TownJobs` + `ai/town/jobAssignment` — the idle-hunter work rota · `Reputation` · `Recovery` · `data/town/{buildings,jobs,departments}.json` and `balance/town.json` · save **v7** and its migration · the town view.

409 tests green (356 before), typecheck and production build clean.

## The bug the sweep found

`attributeFit` multiplied two things: how well a hunter's build *pointed at* a job, and how much hunter there was. Both sit below 1, so the product could only reach about a third of its configured weight at realistic levels — 0.5 × 0.82 × 0.41 ≈ 0.17 — while `departmentPreference` delivered a flat 0.22.

The consequence is exactly the failure REQ-TWN-010 exists to prevent. A hunter who was hopeless at forge work but had asked for the crafting department beat a specialist who had asked for something else. A preference that always wins is a veto wearing a different hat, and DL-008 had been violated in play for as long as the code had existed.

What makes it worth recording is that **the guard designed to prevent it reported everything correct.** `parseDepartments` checks that the summed preference weights stay below `attributeFit` — 0.35 < 0.5, comfortably. The check was true and proved nothing, because the term could never deliver the 0.5 it was configured for.

**Lesson recorded:** a guard that compares configured weights is only sound if each term can actually reach its weight. Two factors that answer different questions belong in separate terms (DL-039).

This is the second time a green check has hidden a live requirement failure — Phase 4's R2 test compared a tank to a healer and proved they differ rather than that the mechanism works. Both were caught by a sweep that held the situation fixed and varied one thing.

## Found in the browser

- **A new guild opened on a crisis it had no means to fix.** The founding town housed eight against a starting population of twelve and serviced three of them, so stability sat low enough that departures outran arrivals and the town began shrinking on turn one, before the player had done anything. Two causes: one bunkhouse where two were needed, and a services demand of 1.0 per resident — which reads plausibly and is wrong, because services are *shared*. One service point now covers about four people, and the founding layout is comfortable and small. The player creates the pressure by growing, which is the trade REQ-TWN-003 is asking for.

- **"Services comfortable for 3"** in a town of twelve that was perfectly fine. The summary was quoting *capacity units* in a sentence whose other numbers were people. Exactly the Phase 5 "well travelled — 0 expeditions" bug: two different quantities sharing one sentence. Summaries are stated in people now, and `describe` takes people on both sides so the mistake is hard to reintroduce.

- **The layering test caught the rota importing the AI that fills it.** `systems/` sits below `ai/`, so `TownJobs` could not import `assignJobs`. Fixed the way the project already solved this for `BuildProfile`: the shapes moved down into `core/town/assignment.ts` and the rota receives the scorer as an injected dependency, like `Expedition` receives the hunter AI. Worth noting that review did not catch this and the test did, three files after the mistake was made.

## Two placeholders repaid

**Recovery.** `GuildCommands` carried `INJURY_TICKS = 2000` and `RECOVERY_TICKS = 400` since Phase 3, with a note naming Phase 6 as the trigger. The odd part is that `core/hunter/availability.recoveryRatePerStep` had modelled food, housing, services, hunger and traits *correctly* since Phase 2.5 — and nothing called it. A complete implementation with no caller is indistinguishable from a stub, and the two constants sat next to a working model for three phases without anyone noticing they disagreed. An injury now runs ~40 steps in a baseline town, ~17 for an ordinary return in a good one, and hits the 400-step ceiling in a collapsed one — and says which of food, housing or services is responsible.

**Reputation.** Parsed and carried since Phase 5, reported to the player as "not yet tracked", which meant a region gated on reputation was permanently shut (DL-033). It is a real quantity now, weighted by danger so that a hundred walks through a Blue zone are worth nothing, with a bounded readable history of why it moved.

## Verified in the browser

A new guild opens as a Small Camp of twelve with six buildings, Thriving, growing at 0.04 residents per step. Twenty seasons later it is a Village of twenty, and all three indicators have turned: *"Short 4 beds for 20 residents"*, *"Feeding 14 of 20 — people are going hungry"*, *"Services stretched — enough for 12 of 20"*. Building a longhouse and a cookhouse turns them back — *"Beds for 36, 27 taken"*, Thriving, growth resumed — and the Bathhouse, locked at a population of 25 a moment earlier, is now available. The whole trade REQ-TWN-003 describes, in one sitting, with the player's action in the middle of it.

Sending that guild into the Verdant Reach earns 0.5 reputation for *"an expedition into The Verdant Reach"*, brings four hunters home `recovering` with individually different durations, and writes *"Halvor Karsthold returned to recover — Recovering for about 17 steps — the town cannot feed everyone, the housing is good"* into the audit trail.

## Open

Town hunting and town defense (REQ-TWN-007/008), the Recruitment Hall's dynamic pool and Guild Fit analysis, and the research tree are Phase 6b — their buildings stand and staff jobs, but their systems are not written. Research also owns the real department-unlock predicate; the interim one keys off town stage, injected so Research replaces the closure without `Departments` changing. Building costs are computed and displayed but not charged, which waits on the Phase 7 ledger.

---

# Phase 6b — Research, recruitment, and the walls

The rest of Phase 6: the research tree, the Recruitment Hall, town hunting and town defense. All four had buildings standing since 6a with nothing behind them, which turned out to be the useful thing about the split — the shape of each system was already fixed by what its building had been promising.

## What was built

`systems/town/Research` and `data/researchSchema` — three branches, symmetric conflicts, effects consumed by real systems · `systems/town/Recruitment` + `ai/town/guildFit` — a dynamic pool, paid and timed refresh, and a recruiter that argues its case · `sim/town/TownCombat` — hunting and defense fought with the actual `CombatEncounter` · `systems/town/Defense` — guard policy, threat scheduling, building damage · five regional name pools, five origins, ten research nodes, two hunting grounds, three threats · saves **v8, v9 and v10** with their migrations · research, recruitment and defense panels in the town view.

493 tests green (409 after 6a), typecheck and production build clean.

## Four bugs, and the third one is the interesting one

**Unreachable posts.** A guild whose hunters were all best at drilling put its whole roster in the drill yard and never staffed the hunting camp standing next to it. The rota was a pure suitability match with no notion of what work was *worth*, so the camp's posts existed and could not be reached — nothing errored, the content was simply never seen. Fixed by giving the score an `outputValue` term, which is also the honest reading of v1.0 §2.1's rank-3 "AI optimization": an optimiser that cannot say "this work matters more" is a matcher (DL-043).

**Permanently unemployable hunters.** Two hunters reached fatigue 1.0 in a browser session and stopped being able to work at all — above the rota's ceiling, not injured enough to be resting. Recovery only ever ran on the *injured* path, so an available hunter doing town work gained fatigue every outing and shed none, ever. Both systems were individually correct and nothing joined them up. Now everyone in town rests, which also gives the work rota a real economy (DL-041).

**A deadlock that shipped.** The Research Department was unlocked by researching Record Keeping. Research points come only from the Research Department's output. So: no department, no points, no way to open the department, forever. A guild ran four hundred steps with a research target selected and zero progress before this was noticed.

What makes it worth the write-up is that the existing content check *passed*. `crossValidateResearch` verified that some node opened each gated department — which was true, and useless, because it never asked whether that node could be completed. The check is now specific: the Research Department may not be gated behind research, and the build fails if anyone tries (DL-040). The general shape is "a resource that can only be produced by something the resource unlocks", and it will recur.

**Two clocks.** `advanceTown` advanced town time without advancing the simulation clock, and everything measured in ticks — every `readyAtTick`, the recruitment refresh, the defense timer — was measured against it. Hundreds of steps could pass in which nobody recovered, the pool never refreshed itself and the walls were never once tested. A test had already been written *around* this, shoving the clock forward by hand to force a refresh; the workaround was the bug, and nobody read it as one. The town balance file was also carrying its own `ticksPerCoarseStep: 50` against the clock's 20, which is DL-020's drift reintroduced in a different file (DL-042).

## What the DL-008 sweep is worth

Phase 6a's sweep caught a live REQ-TWN-010 violation. Phase 6b added a term to the same score and the sweep caught nothing, because the term was weighted where it belonged. That is the point of keeping it: it is now a standing check that no amount of retuning makes a hunter's stated preference decisive, and it costs nothing to run.

## Verified in the browser

A Village of 35 with seven hunters, a hunting camp and a watchtower: five outings a season, all won, and the wall tested four times. The severity policy is visible in the log — *"A swarm out of the marsh. The wall held. — 7 defenders"* against *"A wolf pack at the treeline. The wall held. — 1 defenders"* — the Guild AI calling out the roster for one and letting the watch handle the other, from the same policy.

Research was making no progress, and the department dashboard said why: *"Nobody is doing this work. Raise the department priority, or free up a hunter."* Raising it moved somebody within one step, with the reason attached — *"Halvor Northgate → Archive work: the department is a priority"* — and Field Medicine and Record Keeping both completed. Field Medicine then showed up where it should: *"Injured for about 68 steps — the town cannot feed everyone, the infirmary and baths help, the guild knows its medicine."* That is REQ-DEP-004's "the AI recommends and the player decides" doing exactly what it says.

The Recruitment Hall reads as intended too. Candidates arrive from named places — *"Rurik Ironbrow — The hill clans"*, *"Sten Karsthold — Frontier-born"* — and the recruiter is willing to be discouraging: *"a competent tank who would not change the guild much either way"*, with concerns listed under it (*"the guild is already deep in tank"*).

## Open

Building costs, recruit fees and the research reset resource are all computed and displayed and charged nowhere — Phase 7 owns the ledger. The world boss is still unplaced. The Shrine still provides comfort and no revival, because v1.0 §20 leaves resurrection an open design question and inventing one here would be the wrong kind of initiative.

---

# Phase 7a — The ledger

Phase 7 begins at the seam every earlier phase deliberately left alone: one authoritative guild ledger. `systems/economy/Resources` owns the balances and applies multi-resource debits and credits atomically, so a failed purchase cannot consume only half its inputs. The resource catalogue and founding grant live in `data/economy/resources.json`; TypeScript owns no balance constants.

Save **v11** persists the ledger and migrates old saves without inventing production they never earned. New guilds receive the authored founding grant; migrated pre-economy guilds begin with zero balances. 496 tests green, typecheck and production build clean.

## Next

Wire the costs and outputs already computed by refinement, buildings, recruitment, research reset and town jobs through the ledger. Only after every existing price is real should crafting and the market add new transaction paths.

---

# Phase 7b — Prices become decisions

Every price the earlier phases displayed is now enforced. Refinement pays before the roll; buildings and upgrades roll their grid mutation back if payment fails; paid recruitment refreshes preserve the current board when the guild is short of gold; hiring, research resets and repairs debit the same ledger. Item sales and dismantling credit it, and staffed town jobs finally deposit their authored material output.

The content loader cross-validates every externally referenced resource id, preventing a typo from turning a dismantle yield or protection charge into a silently ignored transaction. Repair cost is a content-owned fraction of the building tier rather than a TypeScript balance constant. 498 tests green, typecheck and production build clean.

## Next

Model provisions as a stored flow—production, population consumption and shortage—then connect expedition and town-hunting rewards before crafting and the market add more transaction paths.

---

# Phase 7c — What the town eats

Provisions are inventory now, not only a building-capacity number. Staffed food work deposits into the ledger, population consumes an authored per-resident amount, and a shortfall reduces the food pressure reading and the recovery model through the same `fedFraction`. A zero-step observation cannot reset hunger. Save **v12** persists that fraction, closing the obvious reload exploit.

Expeditions and successful town hunts deposit gold, provisions and materials from data-owned reward tables. Withdrawals receive a route-progress fraction, completed expeditions receive the full tier reward, and a wiped party brings no resource haul home. The town headline exposes the three everyday balances and a season report calls out production and shortages. 503 tests green, typecheck and production build clean.

## Next

Crafting: validated recipes, previewed inputs and outcome range, crafter capability, completion time, and deterministic quality—while keeping loot as the jackpot.

---

# Phase 7d — Targeted crafting

Four data-authored recipes now provide the certainty half of “craft = certainty, loot = jackpot”: the player chooses the item type and known rarity, sees every input, the estimated work time and the capability-driven quality floor, then receives an item from the same generator loot uses. Payment is atomic and an unavailable hunter cannot craft. Crafted tiers stop at Rare while Ancient and Legendary remain drop-only aspirations.

The content loader rejects recipes with unknown item types, rarities or resource ids. The item generator gained a general quality-floor input rather than a second crafting-only roll path, so deterministic generation and item identity remain shared.

The first pass only reported duration while delivering the item immediately. That made time decorative and let one hunter craft an unlimited number of things at once. Work is now a persisted order: payment and the deterministic item are reserved at the start, the crafter becomes assigned, and the item enters the armoury only when the shared clock reaches its deadline. Save **v13** carries outstanding orders, their items and their ticks. 508 tests green, typecheck and production build clean.

## Next

The bounded market, followed by contracts/factions and the long-run balance harness. Phase 8 begins only when those Phase 7 gates are green.

---

# Phase 7e — A market, not a stock exchange

The Market Stall now buys and sells the resource catalogue against finite stock. Prices move with purchases and sales, but only inside an authored 0.75–1.35 band and they revert toward baseline as town time passes. That is the “dynamic but controlled” part of REQ-ECO-005: player activity is visible without turning the game into a chaotic economic simulation.

The buy/sell spread makes an immediate round trip lossy, trades use the atomic ledger, and content validation rejects a market good that is not a real resource. Save **v14** carries stock and price scales; migrated saves receive the authored starting stock rather than an empty shop. 512 tests green, typecheck and production build clean.

## Next

Contracts and factions: generated offers tied to client identity, region, risk and rewards; analysis before acceptance; completion consequences for the ledger, reputation and Chronicle.

---

# Phase 7f — Work with a name on it

Contracts now connect the economy back to the world. Three authored clients issue offers tied to a region and objective; the pre-acceptance analysis names the recommended level, the guild's best available level, the client and the reward. It is advice rather than automation: the player accepts, and only a real matching expedition can resolve the work.

Success pays the contract's ledger reward and raises both global and client-specific standing. Failure pays nothing and lowers both. Every participating hunter receives a Chronicle counter and entry, while the audit trail records acceptance and resolution. Faction standings are deliberately bounded at ±100 rather than becoming a political simulation. Save **v15** persists the board, active contract and all standings. 516 tests green, typecheck and production build clean.

## Next

The Phase 7 exit gate: `sim/Balance.ts` runs long deterministic economies and rejects negative balances, unbounded resource growth, price escape, free-profit trading and unrecoverable food collapse.

---

# Phase 7g — Ten thousand seasons

`sim/Balance.ts` now soaks the resource, provisions and market systems for 10,000 deterministic steps. It checks every balance against zero and its authored storage capacity, exercises lossy market round trips, verifies a sustainably staffed town does not collapse, and proves an identical run produces an identical report. Resource capacities are content rather than hidden clamps.

The exit gate is green: 518 tests across 24 suites, typecheck and production build clean. Phase 7 is complete. The next code belongs to Phase 8: Guild Mastery and the multidimensional Capability vector first, because legacy, contracts at scale and endgame gates all need those institutional readings.

---

# Phase 8a — Guild progression foundation

Guild Mastery now records institutional experience from the actions that create it: expeditions, crafting, recruitment, defense, research completions and contract resolutions. Its total, per-activity history and nonlinear level survive save/load through the v15→v16 migration.

Capability now reads the guild across seven independent axes: combat, expedition, crafting, resource, defense, research and economic. It deliberately exposes no total score, preserving distinct guild identities and giving future unlocks concrete dimensions to query.

The checkpoint closes with 521 tests across 25 suites, including persistence, vector-shape and divergent-investment coverage. Typecheck and production build are clean.
