# System Map

Every system from spec §115, assigned a layer, an owner module, the data it owns, and the events it emits or consumes. **A system may only be listed once.** If two systems want the same data, one owns it and the other reads through an interface.

## Layer legend

| Layer | Directory | May import |
|---|---|---|
| Data | `src/data/` | nothing |
| Core | `src/core/` | data |
| Systems | `src/systems/` | core, data |
| AI | `src/ai/` | core, data, systems |
| Sim | `src/sim/` | core, data, systems, ai |
| Save | `src/save/` | core, data, systems |
| App | `src/app/` | everything below (composition root + player intents) |
| UI | `src/ui/` | app and below (read-only; dispatches intents) |
| Debug | `src/debug/` | everything |

**On the `app` layer.** `app/Session.ts` is the composition root — the only place that knows how the systems are wired — and `app/GuildCommands.ts` is the player-intent surface the UI dispatches to. The split exists because allocating attributes, advancing a class and equipping a skill are *player* actions that happen to be convenient for debug tooling too: without a shared surface the UI path and the debug path would each enforce their own rules and eventually disagree. `DebugConsole` delegates to `GuildCommands` and adds only the commands that deliberately bypass rules.

`ui/` must never contain game logic; nothing except `ui/` and `debug/` may touch the DOM (REQ-TEC-010).

---

## Core (cross-cutting foundations)

| System | Module | Owns | Emits / Consumes |
|---|---|---|---|
| RNG | `core/rng.ts` | seeded streams (`loot`, `recruit`, `combat`, `events`, `crafting`, `expedition`, `refine`) | — |
| Clock | `core/clock.ts` | fixed-timestep tick, sim speed | emits `tick` |
| Event bus | `core/events.ts` | typed pub/sub | routes all domain events |
| IDs | `core/ids.ts` | branded id types + id minting | — |
| Result | `core/result.ts` | `Result<T,E>` for fallible operations | — |

## Hunter domain

| System | Module | Owns | Events |
|---|---|---|---|
| Hunter | `core/hunter/Hunter.ts` | the hunter aggregate | `hunter.created` |
| Attributes | `core/hunter/attributes.ts` | attribute → derived-stat maths | — |
| Leveling | `core/hunter/leveling.ts` | XP curve, attribute points, respec, rebirth hook | `hunter.leveled`, `hunter.rebirth` |
| Potential | `core/hunter/potential.ts` | composite potential generation & growth effect | — |
| Constellation | `systems/constellation/Constellation.ts` | the skill node graph: eligibility, region investment, derived class identity (v1.0 §5) | `constellation.nodeTaken` |
| Skill registry | `systems/skills/SkillRegistry.ts` | skill definitions, tags, conditions | — |
| Skill knowledge | `systems/skills/SkillKnowledge.ts` | known skills, active loadout (6–8) | `skill.learned`, `loadout.changed` |
| Skill books | `systems/skills/SkillBooks.ts` | book → skill teaching, compatibility gate | `skillbook.consumed` |
| Skill mastery | `systems/skills/SkillMastery.ts` | per-skill mastery, diminishing returns | `mastery.gained`, `mastery.milestone` |
| Build identity | `systems/hunter/BuildIdentity.ts` | derived build profile consumed by AI | — |
| Personality / traits | `systems/hunter/Personality.ts` | personality + trait modifiers | — |
| Condition | `systems/hunter/Condition.ts` | hunger, fatigue, morale | `condition.changed` |
| Friendship | `systems/hunter/Friendship.ts` | pairwise relationship values | — |
| Behavior memory | `systems/hunter/BehaviorMemory.ts` | learned behavioral patterns (the *only* path from history to behavior) | consumes `chronicle.*` selectively |
| Chronicle | `systems/hunter/Chronicle.ts` | event-sourced hunter history (passive) | consumes everything; emits nothing mechanical |

## Items

| System | Module | Owns |
|---|---|---|
| Item generation | `systems/items/ItemGenerator.ts` | rarity roll, weighted loot table, pity counter |
| Substats | `systems/items/Substats.ts` | randomized substat rolls, roll quality |
| Equipment | `systems/items/Equipment.ts` | slots, equipping, derived main stats, stat and effect aggregation |
| Cards | `systems/items/Cards.ts` | card definitions, sockets, tag compatibility, duplicate conversion |
| Sets | `systems/items/Sets.ts` | 2/3/4-piece bonuses, stacking, progress description |
| Refinement | `systems/items/Refinement.ts` | safe zone / risk zone, protection charges |
| Armoury | `systems/items/Armoury.ts` | guild-wide item and card storage, sell, dismantle, bulk sell. Renamed from `Inventory` in Phase 2 — REQ-EQP-004 leaves items unbound, so a per-hunter bag would turn handing a recruit the old sword into a transfer with failure modes rather than an equip with none. |
| Item identity | `systems/items/identityContributions.ts` | the real `EquipmentContribution` and `CardContribution` consumed by `BuildIdentity` (DL-009) |

## Party & combat

| System | Module | Owns |
|---|---|---|
| Party templates | `systems/party/PartyTemplate.ts` | player-authored templates (AI may only instantiate) |
| Party formation | `systems/party/PartyFormation.ts` | template → concrete party, substitution rules |
| Party synergy | `systems/party/Synergy.ts` | composition synergy evaluation |
| Combat entities | `systems/combat/Entity.ts` | combatant state, position |
| Damage | `systems/combat/damage.ts` | hybrid damage pipeline |
| Threat | `systems/combat/Threat.ts` | threat generation, decay, taunt, peel |
| Status | `systems/combat/Status.ts` | status effects, per-status stacking, CC tiers |
| Healing | `systems/combat/Healing.ts` | heal, HoT, shield, overheal conversion |
| Downed / rescue | `systems/combat/Downed.ts` | downed state, timer, rescue resolution |
| Death | `systems/combat/Death.ts` | death, revival cost |
| Positioning | `systems/combat/Positioning.ts` | spatial movement, range bands |
| Environment | `systems/combat/Environment.ts` | terrain movement cost, designated env skills |

## AI

| System | Module | Owns |
|---|---|---|
| Policy pipeline | `ai/policy/pipeline.ts` | the filter/weight chain (§28) |
| Hard constraints | `ai/policy/hardConstraints.ts` | absolute vetoes (§29) |
| Guild policy | `ai/policy/guildPolicy.ts` | guild-level rules |
| Capability filter | `ai/policy/capability.ts` | build/skill/resource validity |
| Utility scoring | `ai/utility/score.ts` | weighted utility considerations |
| Candidate actions | `ai/hunter/candidates.ts` | action enumeration + pre-filter (§39) |
| Interrupts | `ai/hunter/interrupts.ts` | fixed reaction priority table |
| Targeting | `ai/hunter/targeting.ts` | target lock; switch only on target death |
| Prediction | `ai/hunter/prediction.ts` | lightweight deterministic prediction |
| Awareness | `ai/hunter/awareness.ts` | detection radius, known-information filter |
| Monster AI | `ai/monster/monsterAI.ts` | threat-based targeting, skill use, movement |
| Boss AI | `ai/monster/bossAI.ts` | phases, telegraphs, scripted environment |
| Guild manager | `ai/guild/GuildManager.ts` | assignment, party selection from templates |
| Department AI | `ai/guild/DepartmentAI.ts` | per-department execution |
| Event policy AI | `ai/guild/EventPolicyAI.ts` | resolves expedition/offline events by policy |
| Decision log | `ai/explain/DecisionLog.ts` | records important decisions; plain-language rendering |

## World & expedition

| System | Module | Owns |
|---|---|---|
| World map | `systems/world/WorldMap.ts` | fixed regions, unlock rules |
| Zones | `systems/world/Zone.ts` | BLUE/YELLOW/RED/BLACK tiers |
| Discovery | `systems/world/Discovery.ts` | permanent exploration memory |
| Expedition generation | `systems/expedition/Generator.ts` | procedural route within a region |
| Expedition run | `systems/expedition/Run.ts` | node progression, continue/retreat |
| Events | `systems/expedition/Events.ts` | event definitions and outcomes |
| Dungeons | `systems/expedition/Dungeon.ts` | fixed theme + procedural layout |
| Bosses | `systems/world/Boss.ts` | boss definitions, phases |
| World bosses | `systems/world/WorldBoss.ts` | respawn, world-state effects, card pool |
| Loot | `systems/loot/LootTable.ts` | weighted tables, pity |

## Town & guild

| System | Module | Owns |
|---|---|---|
| Town grid | `systems/town/TownGrid.ts` | grid, placement validity |
| Buildings | `systems/town/Buildings.ts` | building definitions, levels, effects |
| Guild hall | `systems/town/GuildHall.ts` | tiers, command-center functions |
| Population | `systems/town/Population.ts` | population, demand, pressure |
| Housing | `systems/town/Housing.ts` | housing quality → morale/recovery |
| NPC services | `systems/town/Services.ts` | service NPCs |
| Town activity | `systems/town/Activities.ts` | rest, training, crafting, gathering, patrol, study |
| Town hunting | `systems/town/TownHunting.ts` | real hunts using the combat system |
| Defense | `systems/town/Defense.ts` | attack events, guard policy, building damage |
| Departments | `systems/guild/Departments.ts` | department definitions, heads, deputies |
| Guild policy | `systems/guild/GuildPolicy.ts` | policy storage at 4 levels |
| Guild mastery | `systems/guild/GuildMastery.ts` | institutional experience from activity |
| Capability | `systems/guild/Capability.ts` | multi-dimensional capability vector |
| Research | `systems/guild/Research.ts` | branch tree, mutual locks, reset |

## Economy

| System | Module | Owns |
|---|---|---|
| Resources | `systems/economy/Resources.ts` | gold + core/specialized resources |
| Food | `systems/economy/Food.ts` | food production and consumption |
| Production | `systems/economy/Production.ts` | resource generation |
| Crafting | `systems/economy/Crafting.ts` | recipes, quality, speed |
| Market | `systems/economy/Market.ts` | buy/sell/trade, bounded dynamic prices |
| Contracts | `systems/economy/Contracts.ts` | generation, analysis, completion |
| Reputation | `systems/economy/Reputation.ts` | rank + value, global and regional |
| Factions | `systems/economy/Factions.ts` | per-faction standing |

## Progression, sim, persistence, presentation

| System | Module | Owns |
|---|---|---|
| Legacy | `systems/progression/Legacy.ts` | legacy points, unlocks, legacy traits |
| NG+ | `systems/progression/NewGamePlus.ts` | world reset preserving legacy, variant rules |
| Mentors | `systems/progression/Mentors.ts` | retired hunters as NPC mentors |
| Endless scaling | `systems/progression/Endless.ts` | scaling curves, objectives, personal records |
| Monument | `systems/progression/Monument.ts` | historic achievements |
| World events | `systems/world/WorldEvents.ts` | world-boss appearance, defeat and respawn state |
| Simulation runner | `sim/Runner.ts` | drives clock + systems + AI at any speed |
| Offline sim | `sim/Offline.ts` | catch-up using the same systems (max 3 days) |
| Balance harness | `sim/Balance.ts` | batch simulation for §121 checks |
| Save | `save/SaveGame.ts` | versioned envelope, auto/manual/backup |
| Migrations | `save/migrations/` | ordered version migrations |
| Renderer | `ui/render/` | canvas presentation (town, expedition, combat) |
| Screens | `ui/screens/` | build dashboard, chronicle, guild report, policy editor |
| Notifications | `ui/Notifications.ts` | importance-prioritized surfacing |
| Debug console | `debug/` | §118 command set, AI inspectors, scenario harness |

---

## Implementation status

| Status | Meaning |
|---|---|
| **BUILT** | implemented and tested this phase |
| **STUB** | interface exists, implementation deferred |
| **PLANNED** | named here, not yet coded |

Phase 1 delivers as BUILT: RNG, Clock, Events, IDs, Result, Hunter, Attributes, Leveling, Potential, Class, SkillRegistry, SkillKnowledge, SkillBooks, SkillMastery, BuildIdentity, Personality, Condition, Chronicle, Save+migrations, Debug console, Build Dashboard.

Phase 1 delivers as STUB: the equipment/card contribution interfaces consumed by BuildIdentity, and the policy pipeline shape (hard-constraint filter only). Everything else is PLANNED — see `ROADMAP.md`.
