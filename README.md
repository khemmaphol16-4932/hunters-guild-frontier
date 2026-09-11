# Hunter's Guild: Frontier

An autonomous Hunter Guild management RPG. The player is the Guild Master: they set strategy, policy, builds and parties — they never directly control a Hunter in combat. The Guild AI manages execution, and Hunter AI executes.

> Player = Strategy · Guild AI = Management · Hunter AI = Execution

The design goal is that a Hunter does not merely *have* a build — they **become** one, through what they actually do. Mastery grows from use, and build identity is what the AI reads when it decides how to act.

**Status:** Phases 0–8 complete, including the approved five-rank Hunter rebirth system, with Phase 9 presentation in progress. The guild runs in real time and while you are away, with standing orders, a Guild Report on return, ranked notices, a combat replay that explains itself, Easy/Advanced AI views and accessibility settings. The real town grid now has an isometric presentation with visible hunters commuting to their assigned work; world presentation, live combat rendering and production audio remain.

---

## Getting started

Requires Node.js 20+ (developed on 24.19.0 LTS). No other dependencies — no game engine, no UI framework, nothing at runtime.

```bash
npm install
npm run dev        # dev server on http://localhost:5173
```

If `npm install` reports blocked install scripts (npm 11+ default), the project still works — esbuild ships its platform binary as an optional dependency. `npm rebuild esbuild` if you hit trouble.

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | typecheck, then production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | full Vitest suite |
| `npm run test:watch` | Vitest in watch mode |

The dev build attaches a debug console to `window.hgf` (`{ session, commands, debug, dashboard }`). See `src/debug/commands.ts` — spawn hunters and items, grant mastery, force loot, inspect build identity, fast-forward the simulation clock.

---

## Read the docs first

The design is locked and documented before it is coded. `docs/` is the source of truth, and code cites requirement IDs (`REQ-BLD-003`, `REQ-POL-004`) back to it.

| Document | What it is |
|---|---|
| [DESIGN_BIBLE.md](docs/DESIGN_BIBLE.md) | The locked design restated as ~150 testable requirement IDs. **Start here.** |
| [SYSTEM_MAP.md](docs/SYSTEM_MAP.md) | Every system, its layer, module and owner |
| [DEPENDENCY_GRAPH.md](docs/DEPENDENCY_GRAPH.md) | How imports may flow, and why the graph is acyclic |
| [CONFLICT_AUDIT.md](docs/CONFLICT_AUDIT.md) | Design conflicts and the architecture enforcing each resolution |
| [RISK_AUDIT.md](docs/RISK_AUDIT.md) | Ranked technical risks and their mitigations |
| [ROADMAP.md](docs/ROADMAP.md) | All 10 phases, MVP scope split, per-task definition of done |
| [DECISION_LOG.md](docs/DECISION_LOG.md) | Every assumption made where the design was ambiguous |
| [TECH_DEBT.md](docs/TECH_DEBT.md) | Deliberate stubs, values awaiting balance simulation, known limits |
| [DEVLOG.md](docs/DEVLOG.md) | What happened each session, including what the tests caught |

---

## Architecture in one screen

Imports flow **downward only**, and a test fails the build if they don't:

```
debug/ → ui/ → app/ → save/ → sim/ → ai/ → systems/ → core/ → data/
```

- **`data/`** — JSON content plus validation. Every balance value lives here; there are no balance constants in TypeScript.
- **`core/`** — pure domain: the Hunter aggregate, items, attribute maths, seeded RNG, the simulation clock, the typed event bus.
- **`systems/`** — gameplay systems. They describe the world; they never decide about it.
- **`ai/`** — the decision pipeline. Filters remove candidate actions, weights reorder survivors, and hard constraints always run first.
- **`app/`** — `Session` (composition root) and `GuildCommands` (the player-intent surface the UI dispatches to).
- **`ui/`** — presentation only. No game logic, and it cannot mutate domain state.

### Three invariants worth knowing before you change anything

1. **No `Math.random()`** outside `debug/`, and **no wall-clock reads** below the composition root. Both are enforced by `tests/architecture.test.ts`. Offline progression has to run the *same* combat AI as live play and reproduce the same results, and that only holds if every random draw comes from an injected seeded stream and every tick comes from the fixed-timestep clock.

2. **Hard constraints cannot be outvoted.** The decision pipeline filters before it scores, and nothing can reintroduce a filtered candidate. A forbidden action never receives a score, so it cannot win on one. This is structural, not a convention — see `src/ai/policy/pipeline.ts`.

3. **A save version bump requires a migration and a round-trip test in the same commit.** This game is designed for very long single saves; a format that cannot migrate destroys the thing the design values most.

### `BuildIdentity` is the keystone

`systems/hunter/BuildIdentity.ts` is the only contract between hunter data and the AI layer. Nothing in `ai/` reads raw attributes, skills or equipment — it reads a structured *profile* (role lean, range band, risk posture, resource profile, skill affinities). That indirection is what makes "different builds behave differently" implementable rather than aspirational.

If you change its interface, you are changing the thing every later phase depends on. Read `DECISION_LOG.md` DL-009 first.

---

## Testing

```bash
npm test
```

648 tests across 39 suites. Beyond ordinary unit coverage, some tests exist to protect design decisions and will fail if a decision is quietly reversed:

- `tests/architecture.test.ts` — layer violations, unseeded randomness, wall-clock reads, and the absence of both a reaction-skill category and a department budget system
- `tests/buildIdentity.test.ts` — two hunters of the same class built differently must be *measurably* different
- `tests/policy.test.ts` — an enormous utility score must still lose to a hard constraint
- `tests/items.test.ts` — set and card effects must be behavioural rather than flat stats
- `tests/town.test.ts` — a town's stage never falls, the stability summary never arrives without the three indicators it summarises, and a hunter's stated preference loses to competence under *every* department policy preset
- `tests/townCombat.test.ts` — a town hunt must produce real combat log entries, because a dice roll that returns loot passes any test that only checks outputs
- `tests/reviewRegressions.test.ts` — each bug the Phase 7–8 review reproduced, tested at the scale where it lived: 150-unit market round trips, thirty contracts, a migrated save, a second New Game+ cycle
- `tests/legacyTraits.test.ts` — every trait effect must be read by some system, or be on a tracked list of known gaps

The last two both earn their place by having caught live requirement failures rather than regressions — a hunter's preference beating competence (DL-039), and a research deadlock that no existing content check noticed (DL-040). See DEVLOG's Phase 6 entries.

---

## What is not built yet

Isometric pixel-art presentation and production audio (Phase 9).

Several catalogues and curves are working defaults **pending design approval**, and each is labelled in its data file: contracts, endless-expedition scaling, apprentices and the New Game+ carry-over rules (v1.0 §20). `TECH_DEBT.md` lists what is still missing, including the nine innate trait effects no system reads yet.

The **Hall** tab is where the institution lives: contracts, crafting, capability, the Monument, Legacy, mentors and apprentices, and New Game+. Endless expeditions are on **The Field**.

Risk R2 — the claim that different builds produce different AI **decisions** and not merely different profiles — was settled in Phase 4 by the §140 A–M scenarios, which caught a live failure in the process. `RISK_AUDIT.md` has the write-up.
