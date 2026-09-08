# Dependency Graph

The spec forbids "every system depending on every other system" (§126). Acyclicity is achieved by two rules, both mechanically enforced by `tests/architecture.test.ts`:

1. **Layer rule** — imports may only flow downward through `debug → ui → app → save → sim → ai → systems → core → data`.
2. **Event rule** — anything that would require an upward import is expressed as a typed event on `core/events.ts` instead.

The event rule is what keeps Chronicle, Notifications, Guild Mastery and Analytics from becoming universal dependencies: they *subscribe*, they are never *called*.

---

## Layer graph

```
                          debug/
                             │  (imports anything; only main.ts may import it)
                             ▼
                           ui/
                             │  reads state, dispatches intents — no game logic
                             ▼
                           app/
                             │  composition root + player-intent surface
                             ▼
                          save/
                             │  versioned persistence (save reads systems, never the reverse)
                             ▼
                           sim/
                             │  drives the world at any speed (real-time or offline)
                             ▼
                           ai/
                             │  policy pipeline + hunter/monster/guild AI
                             ▼
                        systems/
                             │
                             ▼
                           core/
                             │
                             ▼
                           data/           (pure JSON + schema; imports nothing)
```

---

## System-level graph (within-layer edges)

### Core — no internal cycles

```
ids ──┐
rng ──┼──▶ hunter/attributes ──▶ hunter/Hunter
clock ┤                             ▲
events┘    hunter/leveling ─────────┤
           hunter/potential ────────┘
```

`Hunter` is the only aggregate. Attributes/leveling/potential are pure functions over it — they never mutate it in place; they return new state.

### Systems layer

```
data/schema
   │
   ├──▶ class/ClassSystem ────────────┐
   ├──▶ skills/SkillRegistry ─────┐   │
   │         │                    │   │
   │         ├──▶ SkillBooks ◀────┘   │   (books need compatibility from ClassSystem)
   │         ├──▶ SkillKnowledge      │
   │         └──▶ SkillMastery        │
   │                    │             │
   ├──▶ hunter/Personality            │
   ├──▶ hunter/Condition              │
   │                    ▼             ▼
   └────────────▶ hunter/BuildIdentity ◀──── items/Equipment (STUB) ◀── items/Cards (STUB)
                          │
                          ▼
                    (consumed by ai/)
```

**`BuildIdentity` is the single integration point** between the hunter domain and the AI layer. Nothing in `ai/` reads raw attributes, raw skill lists or raw equipment: it reads a build profile. This is what makes REQ-BLD-003 ("different builds produce different AI behavior") implementable without the AI layer depending on ten hunter subsystems.

### Combat and AI

```
combat/Entity ──▶ combat/Positioning ──▶ combat/Environment
     │                                          │
     ├──▶ combat/damage ◀── combat/Status       │
     ├──▶ combat/Threat                         │
     ├──▶ combat/Healing ──▶ combat/Downed ──▶ combat/Death
     │
     ▼
ai/hunter/awareness ──▶ ai/hunter/candidates ──▶ ai/policy/pipeline ──▶ ai/utility/score ──▶ Action
                                 ▲                        ▲
                    ai/hunter/targeting          ai/policy/hardConstraints
                    ai/hunter/interrupts         ai/policy/guildPolicy
                    ai/hunter/prediction         ai/policy/capability
```

`ai/monster/*` reuses `pipeline` with a different consideration set — one AI framework, configurable parameters (REQ-TEC-003). There is no `HunterAI` god class (REQ-TEC-010); the AI is the pipeline plus a set of small consideration modules.

### Guild and town

```
guild/GuildPolicy ──▶ guild/Departments ──▶ ai/guild/GuildManager ──▶ party/PartyFormation
        │                     │                                              │
        │                     ▼                                              ▼
        │            guild/GuildMastery ◀─(events)                   expedition/Run
        ▼                                                                    │
guild/Research ──▶ guild/Capability ◀─────── economy/Contracts ◀─────────────┘
                          ▲
                  town/Buildings ──▶ town/Population ──▶ economy/Food
```

`Capability` reads from many systems but is read *by* only Contracts and UI — a sink, not a hub. That containment is deliberate (REQ-CAP-001).

---

## Buildable leaves (no gameplay dependencies — build first)

`rng` · `clock` · `events` · `ids` · `result` · `data/schema` · `data/loader` · `attributes` · `leveling` · `potential` · `SkillRegistry` · `Personality`

## Integration points (highest breakage risk — change carefully)

| Node | Consumers | Why it is risky |
|---|---|---|
| `BuildIdentity` | all of `ai/` | the contract between hunter data and AI behavior |
| `ai/policy/pipeline` | hunter AI, monster AI, guild AI | one pipeline for every decision in the game |
| `core/events` | Chronicle, GuildMastery, Notifications, DecisionLog, Analytics | adding an event type touches every subscriber's exhaustiveness check |
| `sim/Runner` | real-time play and offline catch-up | REQ-OFF-002 means one bug here breaks both |
| `save/SaveGame` | every persisted system | schema change requires a migration + round-trip test |

## Deliberately absent edges

| Absent edge | Reason |
|---|---|
| `systems/*` → `ai/*` | systems describe the world; AI decides about it. Never the reverse. |
| `Chronicle` → anything mechanical | REQ-CHR-003 — history must not feed back into combat except via BehaviorMemory. |
| `ui/*` → mutation of domain state | REQ-TEC-010 — UI dispatches intents, it does not mutate. |
| `Departments` → any budget system | REQ-DEP-003 — explicitly forbidden and must not reappear. |
| `ai/*` → `Math.random` | REQ-TEC-005 — all randomness flows through injected RNG streams. |

## Build order implied by the graph

1. core foundations (rng, clock, events, ids, result, data loader)
2. hunter domain (attributes, leveling, potential, Hunter)
3. class + skills + mastery
4. **BuildIdentity** (the keystone — everything after depends on its shape)
5. items → party
6. combat primitives → policy pipeline → hunter AI
7. expedition → world → events
8. town → guild → departments → research
9. economy → contracts → reputation → factions
10. progression → legacy → NG+
11. sim runner → offline
12. UI, then presentation polish

Phase 1 covers steps 1–4.
