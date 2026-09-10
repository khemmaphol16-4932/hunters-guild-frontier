# Development Roadmap

Ordered by the dependency graph. Each task carries Goal / Dependencies / Modules / Test criteria / Definition of Done (§134). Phases follow §122.

**Status key:** ✅ done · 🔨 in progress · ⬜ not started

---

## MVP scope split (§132-E)

### Must Have — the MVP is not playable without these
Hunter model · attributes · levels · class chain · skills · skill loadout · mastery · build identity · equipment + substats · cards (minimal) · party of 5 · party templates · real-time combat · threat · status (subset) · healing · downed/rescue/death · hunter AI pipeline · hard constraints · expedition generation · branching routes · events (subset) · loot · one region with 2 zone tiers · town grid · a handful of buildings · recruitment · gold + 2 resources · guild policy (subset) · save/load · debug console.

### Should Have — needed for the vertical slice to be *fun*
Chronicle · AI decision log · combat replay timeline · guild report · departments · research (small tree) · contracts · reputation · crafting · market · population · town hunting · offline simulation · 4 zone tiers · bosses.

### Later — full game, not prototype
World bosses · dungeons · factions · full research tree · defense events · friendship · behavior memory · guild mastery · capability vector · monument · full event catalogue · isometric pixel-art presentation · audio.

### Endgame
Legacy · NG+ · generational hunters · mentors · legacy traits · endless scaling · challenge contracts · perfect equipment chase · luxury/prestige sinks.

---

## Phase 0 — Design definition ✅

| Task | Deliverable | DoD |
|---|---|---|
| P0.1 ✅ | `DESIGN_BIBLE.md` | every spec section mapped to a requirement ID |
| P0.2 ✅ | `SYSTEM_MAP.md` | every §115 system has a layer, module and owner |
| P0.3 ✅ | `DEPENDENCY_GRAPH.md` | graph is acyclic; build order derived |
| P0.4 ✅ | `CONFLICT_AUDIT.md` | all §128 conflicts + newly found ones resolved |
| P0.5 ✅ | `RISK_AUDIT.md` | risks ranked with mitigations assigned to phases |
| P0.6 ✅ | this roadmap | MVP scope split; tasks have DoD |

---

## Phase 1 — RPG Foundation ✅

**Goal.** A Hunter exists, grows, learns, specializes, and has a *legible identity* — provable by test and visible in a dashboard.

| Task | Goal | Depends on | Modules | Test criteria | DoD |
|---|---|---|---|---|---|
| P1.1 ✅ | Deterministic foundations | — | `core/rng`, `core/clock`, `core/events`, `core/ids`, `core/result` | same seed → identical stream; clock steps fixed; events typed | no `Math.random()` outside `debug/`, enforced by test |
| P1.2 ✅ | Data layer | P1.1 | `data/schema`, `data/loader`, all JSON | every content file validates; malformed data fails loudly at load | zero balance constants in code |
| P1.3 ✅ | Attributes & derived stats | P1.2 | `core/hunter/attributes` | fixture table of attribute spreads → expected derived stats | formulas read from `balance/attributes.json` |
| P1.4 ✅ | Levels, points, respec | P1.3 | `core/hunter/leveling` | XP curve monotonic; points match level; respec round-trips | rebirth behind an interface, unimplemented |
| P1.5 ✅ | Potential | P1.1, P1.2 | `core/hunter/potential` | deterministic under seed; composite, not scalar | legendary tier is composite (REQ-HUN-009) |
| P1.6 ✅ | Hunter aggregate | P1.3–P1.5 | `core/hunter/Hunter` | construction, immutable updates | carries every REQ-HUN-006 field or a typed placeholder |
| P1.7 ✅ | Class chain | P1.2 | `systems/class/ClassSystem` | legal advancement accepted, illegal rejected | 3 archetypes × advanced × specialization in data |
| P1.8 ✅ | Skill registry & knowledge | P1.2, P1.7 | `systems/skills/SkillRegistry`, `SkillKnowledge` | unlimited knowledge; loadout capped 6–8; unknown skill rejected | no `reaction` category exists |
| P1.9 ✅ | Skill books & compatibility | P1.8 | `systems/skills/SkillBooks` | cross-class matrix honored per data | compatibility fully data-driven |
| P1.10 ✅ | Skill mastery | P1.8 | `systems/skills/SkillMastery` | monotonic, uncapped points, saturating effect, survives save | per-skill effect mapping in data |
| P1.11 ✅ | Personality & condition | P1.2 | `systems/hunter/Personality`, `Condition` | modifiers bounded by config clamp | personality never produces a filter |
| P1.12 ✅ | **Build identity** | P1.6–P1.11 | `systems/hunter/BuildIdentity` | same class + different attributes/mastery → measurably different profile | equipment/card contributions behind interfaces (null objects) |
| P1.13 ✅ | Chronicle | P1.1 | `systems/hunter/Chronicle` | recording an entry changes no derived stat | pure subscriber, no outbound edges |
| P1.14 ✅ | Save + migration chain | P1.6–P1.13 | `save/SaveGame`, `save/migrations/` | round-trip identity; v1→v2 migration test | version bump requires migration + test |
| P1.15 ✅ | Debug console | all | `debug/` | §118 subset callable | not reachable in a production build |
| P1.16 ✅ | Build dashboard | P1.12 | `ui/screens/buildDashboard` | renders two hunters with visibly different identities | no game logic in UI |
| P1.17 ✅ | Architecture test | P1.1 | `tests/architecture.test.ts` | layer violation fails; `Math.random()` fails | runs in `npm test` |

**Phase DoD.** `npm run typecheck` clean · full suite green · dashboard shows two same-class hunters with different build identities in a browser · DEVLOG and DECISION_LOG updated.

---

## Phase 2 — Equipment ✅

Slots · item definitions · rarity · main stats · substats · cards · set bonuses · refinement (safe/risk) · item generation · trading · sell/dismantle/convert.

**Delivered.** Substat randomization is seeded and reproducible; the refinement risk zone can downgrade and destroy; `BuildIdentity` picked up real equipment and card contributions with **no interface change** — `git diff` over `src/systems/hunter/` was empty after the phase (validates the B7/DL-009 resolution). Storage is guild-wide (`Armoury`) rather than per-hunter, because REQ-EQP-004 leaves items unbound. Save at v3 with a v2→v3 migration.

## Phase 2.5 — v1.0 reconciliation ✅

Master Build Specification v1.0 arrived after Phase 2 and supersedes several locked decisions. `SPEC_RECONCILIATION.md` is the item-by-item audit; this phase implemented the parts of v1.0 §17 step 1 that were missing.

**Delivered.** Audit/replay model (`core/audit.ts`) with the §14 minimum field set and a rejection for entries lacking a reason code · dual-resolution simulation clock, coarse and fine cadences from one elapsed-time source · canonical policy precedence as data (`data/policy/precedence.json`) with validation that filters always outrank weights · emergency overrides for hard constraints (`ai/policy/emergency.ts`) — named constraint only, player-authored only, trigger-conditional, always audited · five canonical availability states with legal transitions and recall transition time · recovery varying with food, housing and services · generated build tags · Chronicle Minor/Major/Historic. Save at v4 with a v3→v4 migration.

**Open at the time:** the class-model divergence (SPEC_RECONCILIATION C5) — since approved and delivered as Phase 2.6 below.

---

> **Sequencing note (v1.0 §17).** v1.0 orders the work: schemas/clock/RNG/audit/migration/precedence → **vertical slice** → town → AI Operations → economy → world knowledge → equipment/cards/theorycraft → legacy. Equipment was already built as Phase 2 under the previous roadmap, which is not reversible work and earned its place (it validated the DL-009 interface and caught a live `BuildIdentity` bug). The remaining order below is resequenced to match v1.0, and §17's closing instruction stands: **no further content production until the vertical slice is measurable and replayable.**

## Phase 2.6 — Skill constellation ✅

v1.0 §5, approved as SPEC_RECONCILIATION option B. The three-stage class chain is replaced by one node graph: archetypes are starting positions, the former advanced classes and specializations are descriptive regions, every skill is a node with prerequisite groups and six-axis eligibility (level, class affinity, weapon, build, prerequisites, skill books), and class identity is derived from region investment rather than declared.

**Delivered.** `systems/constellation/Constellation` · `data/constellation/{nodes,regions}.json` · affinity-as-distance so foreign territory is reachable but late (DL-024) · skill-book possession as real armoury state · `ClassSystem` and `skill-compatibility.json` removed · save v5 with a v4→v5 migration.

**Found by measurement, fixed at the source:** all three archetypes had converged on the same role because affinity above zero meant free travel; and a build's role tag could be crowded out of its own summary. Both are written up in DEVLOG.

**Open:** the Ranger line is content-thin and 10 of 18 regions hold no nodes — the 12-skill prototype budget, tracked in TECH_DEBT.

---

## Phase 3 — Vertical slice ✅

v1.0 §17 step 2: *hunter state → party planner → deterministic combat → expedition outcome → recovery/loot/Chronicle*, end to end and replayable.

Party of five with objective-first creation (AI proposal → player adjustment, REQ-V1-PTY-001) · formation templates + AI positioning · pre-deployment fit analysis (strengths, weaknesses, risks, key-hunter dependency) · deterministic real-time auto-combat · one safe and one high-risk region · continue/retreat · injuries and death prototype · expedition report · recovery consuming the availability states built in Phase 2.5.

Key DoD (v1.0 §16): the player can make a strategy/policy decision, watch the guild execute it, understand *why* the result occurred from the audit trail, and see the outcome affect the living guild. Same seed must reproduce the same run.

## Phase 4 — Combat depth + AI ✅

Real-time combat · entities · targeting · threat · skills in combat · status · healing · downed · rescue · death · positioning · environment · **hunter AI** · party synergy · combat chronicle.

Key DoD: all §140 A–M scenarios produce the specified behavior; scenarios K and L (identical builds differing only in personality, then only in mastery) produce *different* decisions. This is the phase that proves or disproves R2.

## Phase 5 — World + Expedition ✅

World map · regions · zone tiers · expedition generation · branching · events · dungeons · bosses · world bosses · discovery · exploration memory.

Key DoD: an expedition completes end-to-end in ≤10 minutes with continue/retreat honoring hard constraints.

## Phase 6 — Town + Guild ✅

Grid · buildings · guild hall · population · housing · services · departments · policies · town hunting · defense · recruitment hall · research.

Key DoD: the town is physically observable and hunters visibly move through it (REQ-PRIME-006).

**Delivered (6a — the physical town and the guild that runs it).** A real grid with footprints, four-direction rotation, collision and free relocation (`systems/town/TownGrid`) · 18 buildings across REQ-TWN-005's nine functions, each a tier ladder of cost and capacity · the Small Camp → Village → Fortified Town → Hunter City ladder, stored and monotonic so progression never resets (DL-037) · population, per-axis demand and pressure, and a Town Stability summary that cannot be returned without the three indicators it summarises (DL-036) · five departments with appointed heads, deputy and Guild-AI fallback, per-department priority and four policy presets, and a four-metric dashboard with no combined score (REQ-DEP-004) · idle-hunter job assignment through a scorer where preference is a weight and never a filter · **guild reputation**, which makes REQ-WLD-002's reputation unlock axis evaluable instead of permanently shut · **recovery wired to the actual town**, repaying the Phase 3 placeholder. Save at v7 with a v6→v7 migration. 409 tests green, typecheck and build clean.

**Found by measurement, fixed at the source.** The DL-008 sweep caught a live REQ-TWN-010 violation: `attributeFit` multiplied alignment by capability, so the term could never reach its configured weight and a hunter's stated preference beat a specialist's competence — while the load-time guard, comparing weights, reported everything correct (DL-039). Two content problems surfaced the same way: a starting town that could not service its own starting population and began losing residents on turn one, and a services indicator quoting capacity units as if they were people. Both are written up in DEVLOG.

**Delivered (6b — research, recruitment, and the walls).** The research tree: three branches, symmetric conflicts that make it an identity rather than a checklist, effects consumed by real systems, and REQ-RES-001's reset · the Recruitment Hall: a dynamic pool sized and populated by the guild's standing, refresh both paid and timed, five regionally distinct origins biasing names, archetypes, personalities and potential, exceptional recruits flagged rather than inferred, and a Guild Fit analysis that ranks by *what the guild is missing* and is willing to be discouraging · town hunting and town defense, both fought with the actual combat system · guard policy, building damage and repair. Saves v8, v9 and v10 with their migrations. 493 tests green, typecheck and build clean.

**Found by measurement, fixed at the source.** A deadlock that shipped — the Research Department was unlocked by research whose points only that department could produce, so a new guild could never research anything, and the existing content check passed because it verified only that *some* node opened the department (DL-040). Two hunters made permanently unemployable by fatigue that nothing ever cleared for an available hunter (DL-041). Town time advancing without the simulation clock, freezing recovery, recruitment and defense together (DL-042). And a hunting camp whose posts could never be filled, because the rota had no notion of what work was worth (DL-043). All four are written up in DEVLOG.

**Phase DoD.** The town is physically observable, hunters move through it as work, and REQ-PRIME-006 is met at the level Phase 9 presentation will build on.

## Phase 7 — Economy 🟨 **in progress**

Gold · resources · food · production · crafting · market · contracts · reputation · factions · economy simulation.

**Foundation delivered.** One authoritative, data-authored resource ledger now owns gold and the deliberately small resource set (REQ-ECO-001/002). Multi-resource transactions are atomic, new guild balances come from content, and save v11 persists the ledger with a v10→v11 migration. Next: route existing computed costs and town-job production through this ledger before adding crafting or the market.

Key DoD: `sim/Balance.ts` long-run simulation finds no unbounded resource growth (§141).

## Phase 8 — Progression ⬜

Guild mastery · capability · reputation depth · research depth · legacy · NG+ · generational hunters · mentors · legacy traits · endless scaling.

## Phase 9 — UX / Presentation ⬜

Progressive UI · build dashboard polish · chronicle · combat timeline · AI explain · guild report · notifications · town and world presentation · **isometric pixel-art** · audio hooks · accessibility.

## Phase 10 — Technical Hardening ⬜

Performance · save migration · memory · AI profiling · simulation profiling · content validation · error handling · recovery · automated and regression testing.

---

## Vertical slice gate (§124)

Before Phase 7, the project must demonstrate Town → Expedition → Combat → Return with a real town, real hunters, a real party, real AI, a real expedition, real environment, real combat, real loot, a real chronicle and a real upgrade loop — using the actual architecture, no fake systems.
