# Hunter’s Guild: Frontier — Master Build Specification v1.0

**Status:** implementation handoff / source of truth

**Audience:** lead systems architect and build agent (Claude Opus)

**Instruction:** This is a synthesis of the locked design conversation, not a prompt to redesign the game. Preserve the decisions below. When an implementation detail is absent, use the smallest data-driven solution that preserves the stated behavior; record it in an ambiguity log and request approval before altering player-facing rules.

## 1. Product definition

Hunter’s Guild: Frontier is a living-guild management RPG. The player is the invisible Guild Master—not a player character. Hunters are the on-screen characters; the guild, town, history, and accumulated knowledge are the protagonist.

The player sets objectives, policies, priorities, risk tolerance, and meaningful exceptions. Guild AI runs routine operations; hunter AI executes combat and local behavior. Expeditions generate loot, injury, knowledge, reputation, history, and sometimes irreversible loss. The intended feeling is: *build an institution that learns, survives, and becomes remembered.*

### Design pillars

1. **A living guild, not disconnected menus.** Town activity, hunter work, recovery, population, and returning expeditions are visibly connected.
2. **Hunters are people, not cooldowns.** Identity, personality, potential, build, fatigue, injuries, history, and later-life roles matter.
3. **Strategy remains player agency.** AI removes administration; it does not silently choose strategy or irreversible outcomes.
4. **Knowledge is progression.** The guild only knows what it has discovered, experienced, or researched.
5. **Build diversity over a single power number.** No global Combat Power or Party Synergy score. Explain suitability, trade-offs, tags, and interactions instead.
6. **Risk creates consequence.** Safe failure costs time and resources; high-risk failures can become guild-defining events.
7. **History becomes world state.** Notable expeditions, hunters, parties, equipment, monuments, and town evolution persist.
8. **Depth without accounting software.** A compact core economy and information hierarchy make complexity readable.

## 2. Canonical rules (locked)

### 2.1 Authority and decision hierarchy

Normal precedence:

`Hard constraints → Guild objective → Guild policy → AI optimization → Department policy → Party objective → Hunter identity/preferences`

Policy inheritance is Guild → Department → Party → Hunter, with explicit overrides. A hard constraint is absolute unless an explicitly configured emergency policy permits its override. Hunter personality affects *how* an instruction is executed; it does not supersede guild policy.

### 2.2 AI boundary

AI may assign workers, propose/adjust parties, replace unavailable members according to policy, react to emergencies, manage routine schedules, recommend contracts, optimize permitted actions, and run offline simulation. The player owns objectives, constraints, risk, priorities, exceptions, policy overrides, and irreversible/high-impact decisions. Important or unusual AI actions must include an explanation; routine actions need not spam the player.

### 2.3 Single world clock

All systems use one continuous world-time model: combat, town activity, hunger/fatigue, crafting, research, contracts, expeditions, and schedules. While offline, the same systems are accelerated/simulated—not paused and not replaced by arbitrary independent timers. Black Zone risk is the same online and offline, subject to the player’s risk policy.

### 2.4 Failure, death, and replacement

Consequences scale with selected risk, preparation, and policy. A safe expedition can cost time/resources; Black Zone failure can cause injuries, death, losses, capability gaps, and Chronicle events. Resurrection is available but costly; cost is based on hunter value, death severity, revival method, and guild capability. On loss/unavailability: **capability gap → AI analysis → replacement candidates → player/policy decision**.

### 2.5 Progression and economy

Major progression is multi-axis: Guild development + research + reputation + world discovery + demonstrated capability. Core resources remain roughly 5–7 primary types, with specialized materials as supporting inputs. Conversion is controlled and lossy. Research is guild technology; mastery is experience earned through doing. Neither collapses into a generic “guild level.”

## 3. Core gameplay loop

1. Read the guild’s state: people, town capacity, contracts, world knowledge, resources, threats.
2. Set goals/policies and accept or prioritize work.
3. Build or accept AI-proposed parties around an objective; inspect fit, risk, dependencies, formation, and readiness.
4. Prepare through rest, food, services, equipment, skills, cards, crafting, and research.
5. Deploy into town hunting, contracts, defense, or expeditions.
6. Observe live execution, receive only meaningful decisions/alerts, and choose continue/retreat when warranted.
7. Resolve outcome: loot, injuries, knowledge, reputation, mastery, Chronicle events, and recommendations.
8. Reinvest in town, staff, equipment, research, recruitment, policies, and world access.

## 4. Simulation, states, and operations

### Hunter availability

Use canonical availability states: **Available, Assigned, Recovering, Injured, Unavailable**. Recalling a hunter takes transition time. Recovery depends on time + food + housing/service quality + appropriate rest; it is not a manual rest-click loop or a single timer.

### Automation progression

Unlock automation through guild progression in this order: **Manual → Assisted → Automated → Strategic Automation**. Policy preview shows affected hunters and predicted consequences. Conflict UI explains the conflict and a proposed resolution. The AI Operations dashboard displays active decisions, exceptions, important actions, and operational health.

### Time-step recommendation (implementation)

Use an authoritative simulation clock with event scheduling. Use coarse, deterministic steps for idle town/economy work and finer deterministic ticks for active combat; both derive from the same elapsed game time. Offline catch-up must use the same event resolver and seeded random stream/auditable result log. Exact tick durations are implementation variables, not design decisions.

## 5. Hunter system

### Identity, recruitment, careers

Hunters have persistent identity, class, attributes, traits/personality, potential, skills/mastery, equipment/cards, status, current activity, memories, and legacy eligibility. Recruitment pools are dynamic. Recruitment emphasizes identity, potential, personality, and capability—not raw power. AI provides a Guild Fit analysis, top candidates with reasons, acquisition cost, what the guild gains, and notable alternatives.

Potential is fully visible; exceptional potential receives a tier, badge, and explanation. Older hunters remain valuable. AI may recommend a qualified hunter for mentor, trainer, guard-captain, or crafting-specialist paths, but must never auto-retire them.

### Classes, attributes, and skills

Classes are flexible starting identities, not rigid content silos. Skill knowledge is one large node-based constellation with different class starting positions. Eligibility can depend on level, class, weapon, build compatibility, prerequisites, and required skill books. Skill books are visible as requirements in the tree. Skills develop usage mastery; active loadouts are drag-and-drop slots.

Skill presentation must expose description, effect, cooldown/resource costs, with deeper mechanics in a second-level tooltip/advanced view. Exact class roster, attribute list, slot counts, numerical formulas, and skill catalogue are intentionally data-driven implementation content; do not invent a player-facing final roster without approval.

### Builds and equipment

Build tags are generated from actual attributes, skills, weapon/equipment, cards, sets, and elemental interactions. They describe role and behavior (for example, crit melee, fire, sustain); they are not manually chosen labels and do not reduce to Combat Power.

Equipment supports rarity, main stats, substats, card slots, sets, refinement, identification, and build-changing legendary effects. It is transferable, while notable ownership/use, creator, and refinement milestones can enter its history. Evaluation is build relevance + stats + substats + set/card interactions. Major changes display stat deltas, build tags, skill/AI behavior changes, and synergy impact.

Crafting is reliable targeted progression; loot is the jackpot. Craft preview shows recipe, cost, and outcome range. Quality depends on recipe, crafter capability/mastery, material quality, and controlled randomness. Dismantling returns type/tier-sensitive materials. Keep/sell/dismantle/convert rules can filter by rarity, type, stats/substats, set, and card slots. Full inventories follow player-defined loot priority.

Refinement has safe and risk zones; risk tiers have multiple outcomes. Protection items exist but are rare/expensive. Item locks prevent sell, dismantle, conversion, and auto-equip. There is no seasonal equipment reset.

### Cards and collection

Cards are collectible, build-shaping equipment modifiers. They can be shared/stacked where system rules permit; UI identifies current use and links to the equipped hunter. Rare and boss cards can fundamentally alter a build. Boss card drops receive a special reveal and Chronicle event. Duplicate handling is a deliberate Keep / Convert / Trade choice. Collection milestones offer cosmetics and controlled gameplay rewards, never large mandatory power spikes.

Unknown cards show silhouette, known source/region, and partial effect category; exact effect/value is discovered on acquisition. The guild permanently records discovered sources. AI can recommend farming locations using card, party, and risk context. Incompatibility must state why and what would make the card compatible.

Theorycraft Mode permits full hypothetical builds—attributes, skills, equipment, cards, and sets—including unowned items with acquisition sources. Controlled simulations use the same combat rules and AI at accelerated speed and award no progression rewards. Comparisons explain identity, strengths, weaknesses, AI behavior, and situational fit.

## 6. Party, formation, and synergy

Parties are five hunters. Creation begins **objective → AI proposal → player adjustment**. Every party has an explicit objective (expedition, contract, hunting, defense) used to evaluate it. Pre-deployment analysis shows strengths, weaknesses, synergy tags/interactions, risks, environment fit, and key-hunter dependency alternatives.

Roles are functional capability tags, not mandatory tank/DPS/healer boxes. Formation uses templates plus AI positioning adjustment; previews cover threat, range, AoE, and protection. Incompatible builds warn and explain but never block experimentation. “Ready” means objective requirements, policy, and viability are met—not a power threshold.

AI adjusts membership only when a meaningful improvement exists and reports change, reason, and expected benefit. It optimizes objective success probability + synergy + risk + long-term guild value. Parties retain performance/environment history, receive emergent identity tags, and develop Party Synergy Mastery through repeated successful cooperation. Mastery persists when composition changes but its effectiveness changes with actual compatibility. Major achievements go to Party and Guild Chronicle.

## 7. Combat, elements, and AI architecture

Combat is real-time auto-combat with meaningful pre-combat strategy and live observation. Hunter AI is execution-level: it follows policy, party objective, local threats, build, skills, personality, formation, resources, and hard constraints. Guild AI is operational-level: it does not replace combat decision logic.

### Required architecture

- **Data-driven combat definitions:** skills, effects, statuses, elements, reactions, monsters, boss phases, targeting rules, and AI considerations are authored data.
- **Deterministic event resolution:** seed every combat/expedition run; record input events and random outcomes for replay/debug/test.
- **Utility/priority behavior:** score legal actions against survival, objective, threat, control, resource use, synergy/reaction setup, and policy. Hard constraints eliminate illegal actions before scoring.
- **Explainability layer:** retain compact reason codes for major actions (e.g., interrupt lethal cast; retreat threshold reached; protect vulnerable ally). UI exposes summaries, not raw scoring internals by default.
- **Layered AI:** global policy → party objective → encounter/formation plan → individual utility choice → animation/action execution.

Elements and reactions are build and encounter interactions, not a cosmetic damage-color system. The final element list/reaction matrix and formula values must live in data tables. Preserve known requirements: reactions are legible in combat, affect build tags and AI choices, and support theorycraft simulation. Do not substitute a fixed elemental rock-paper-scissors system unless that was explicitly approved.

Combat UI must make threat, interrupts, reactions/combo chains, intentional waits, important AI decisions, and post-failure diagnosis understandable without overwhelming the player. Combat highlights—not every action—enter live logs.

## 8. World, expeditions, contracts, and risk

The world map is an interactive hybrid of map and physical-world preview. It is a **knowledge interface**: unknown → rumor → discovered → experienced → mastered. Discovered regions show name, environment, danger, and all information the guild has learned; unknown regions retain fog/rumor and explicit unknowns. Procedural route previews show only knowledge the guild can plausibly possess.

Risk uses zone language (Blue/Yellow/Red/Black) with color, icon, and explanatory context—not one misleading risk number. Expedition Planning Mode shows party list, formation, known environment/monsters/loot/events, hunter readiness, injury/fatigue/equipment/food, risk, and policy conflict warnings.

Live expedition view includes world view, party status, node/branch route with current location, route progress, significant events, and combat highlights. Event pausing depends on event type. Continue/retreat decisions show all decision-relevant information. Retreat displays a return route and takes a brief travel interval. Players may inspect hunters but cannot change build/equipment mid-expedition. Boss UI at minimum shows boss name and HP; phase/threat presentation should be supported by data/UI capability.

Contracts connect expeditions to rewards, reputation, factions, risk, and guild identity. AI may recommend contracts and compare party/risk/environment/history, but player policy/objectives decide. Exact contract catalogues, faction names, thresholds, and reward tables are content parameters.

## 9. Town, living guild, hunting, and defense

Town is a modern 2.5D pixel-art isometric world with a contextual management panel—not a spreadsheet or life simulator. It is warm/cute in the guild space and dangerous/serious in wilderness. Major buildings produce strong visual-tier milestones; minor buildings change more modestly. Build mode is a dedicated toggle with grid, four-direction rotation, ghost preview, cost/stat/visual upgrade preview, and free building relocation.

Clicking a building highlights it and opens a right-side detail panel. Buildings communicate activity/problems through in-world animation/icons and panel details. NPCs have occupation-based routines and offer name, role, service/action on selection. Population is represented by a count, visible NPCs, and dashboard indicators. Simulate only enough routine behavior to create legible life—do not build a full life sim.

Hunters circulate by department/activity. Returning parties enter via the town gate; important returns can create a short summary/event moment. Town hunting is visible real-time physical activity controlled through policy/priorities, with AI choosing workers. Town defense is a physical event; guard assignment follows policy and AI selection.

Population grows through reputation, events, recruitment, and prosperity. Capacity mismatch creates food, housing, and service pressure. Town Stability summarizes, but never replaces, individual population/food/housing/service indicators. Reputation and achievements visibly improve prosperity, NPC density, decoration, monuments, and the town’s accumulated history.

## 10. Economy, crafting, research, and mastery

Implement a compact primary-resource taxonomy (target 5–7) with specialized materials. Every resource needs at least one source, meaningful use, storage/flow representation, and sink. Conversion prevents dead ends at an efficiency loss; it must not erase strategic scarcity.

Suggested *implementation categories*, subject to content naming approval: currency/trade, food/provisions, construction materials, crafting materials, research/knowledge, influence/reputation access, and rare/expedition materials. These are categories, not a locked final naming or exact count.

Research is technology learned by the guild. Present it as a branching constellation with main branches Combat / Town / Economy; show cost, effect, result preview, partial requirements, conflicts/locks, time/progress, and concrete before/after AI/policy changes where applicable. Mastery is experience from actual activity. UI explicitly shows how research and mastery reinforce each other without merging their ledgers.

## 11. Reputation, Chronicle, Legacy, and generations

Reputation changes contracts, recruitment, population/prosperity, access, and faction relationships. Its exact formulas must be transparent enough to explain meaningful changes but need not expose every hidden probability.

Every expedition produces a report ordered: **outcome → loot/EXP → hunter performance/highlights → Chronicle → recommended actions**. Use side-panel/sectioned presentation. Loot uses grid, rarity, quantity, and rare/legendary emphasis. Hunter performance uses stats plus highlights. MVP exists only when someone made a genuinely notable contribution; it is not a permanent ranking.

Chronicle event levels are Minor, Major, Historic. Only remarkable events enter it; near-death survival may qualify when the remarkable-event threshold is met. Historic events can affect hunter legacy and guild monuments. Party achievements record to both party and guild history. Valuable equipment can retain notable history. The town is a physical Chronicle.

Generational play means veteran value can migrate into mentorship, training, command/defense, and specialist careers; it does not mean automatic retirement or disposable replacement. New Game+ must preserve the premise of enduring legacy and no seasonal gear invalidation.

## 12. Progression, endgame, and New Game+

Progression gates combine guild infrastructure, technology, reputation, discovery, and demonstrated capability. Endgame must favor aspirational horizontal/deep optimization: perfect substats, refinement, card/set/legendary interactions, collection objectives, hard bosses, dangerous regions, endless expeditions, world-scale defense/contract problems, and legacy goals. It must not reset equipment seasonally or collapse into infinitely rising item level.

New Game+ is a continuation/renewal layer for legacy, world discovery, build experimentation, and escalating challenges. Specific carry-over rules, cycle modifiers, and content gates remain implementation ambiguities requiring approval before exposure.

## 13. UX and UI requirements

### Information hierarchy

1. **Instant read:** level, class, HP, important status.
2. **Build read:** key stats, equipment, generated build tags, skills.
3. **Deep dive:** expandable sections, advanced tabs, two-level tooltips, detailed mechanics.

Use numbers + comparison + simple bars when helpful; use positive/negative color deltas. Do not rely on giant aggregate ratings. Hunter Detail has Overview, Build, Equipment, Skills, and Chronicle; AI settings are configured through Guild Policy, not individual hunter pages.

### Primary surfaces

- Guild dashboard / AI Operations
- Isometric town + contextual building panel + construction mode
- Hunter roster: medium-density cards; filters class/role/status/region/build/potential/traits; remembered sort; compare up to three
- Recruitment: Guild Fit, potential, identity, cost/gain/alternatives
- Party builder and expedition planning
- World knowledge map and live expedition
- Combat observation / event log / decision panels
- Equipment, cards, theorycraft, crafting/refinement
- Research Management constellation
- Contracts/reputation/factions
- Chronicle/legacy
- Policy hierarchy editor

Guild Advisor is an in-world NPC/interface representation of guild intelligence, never a player avatar. Recommendations are configurable by type/frequency, have Low/Medium/High confidence, show costs and expected benefit, offer quick action, and decline repeatedly when the player signals disinterest. Critical alerts prioritize without automatically pausing the game. Policy override requires player confirmation.

## 14. Data model recommendations

Use stable IDs, versioned schemas, authored data tables, and event sourcing/audit logs for simulations. Separate immutable definitions from mutable save-state.

| Domain | Definition data | Save-state / events |
|---|---|---|
| Hunter | class, attributes, trait, skill, item/card definitions | identity, rolls, mastery, loadout, condition, activity, memories |
| Party | template, role/build tags, formation rules | composition, objective, mastery, history, performance |
| Combat | skills, effects, statuses, element/reaction rules, AI considerations | seeded encounter, action/event log, cooldowns, health, outcomes |
| World | regions, nodes, encounter/loot/contract definitions | knowledge state, unlocked routes, expedition state, discovered sources |
| Town | building/service/job definitions | placement, upgrades, population, stocks, assignments, stability |
| Economy | resource, recipe, conversion, loot/refinement definitions | inventories, orders, transactions, locks, item history |
| Policy | policy types, constraints, priorities, emergency permissions | scoped policies, overrides, previews, AI explanations |
| Chronicle | event qualification templates | recorded events, monuments, legacy links, party/item history |

Minimum audit fields for consequential state changes: game time, actor/system, source event, policy version, deterministic seed, inputs, outcome, and reason codes. This is necessary for offline reconciliation, combat debugging, AI explanation, and test reproducibility.

## 15. System dependency map

```text
Guild objectives + policies + emergency constraints
                  ↓
Guild AI ──→ assignments / replacements / automation / explanations
                  ↓
Hunters (identity, condition, build, mastery, equipment, cards)
                  ↓                         ↘
Party objective + formation + synergy          Town (food, housing, services, staff)
                  ↓                             ↓
Combat AI + elements/reactions ←──────── recovery / availability
                  ↓
Expeditions / contracts / hunting / defense ← World knowledge + risk
                  ↓
Loot + injuries + resources + reputation + discovery + Chronicle
                  ↓
Crafting / research / mastery / recruitment / town development
                  ↓
Capability + access + legacy + endgame / New Game+
```

## 16. Scope and delivery sequence

### MVP: prove the game’s identity

- Single town scene with Guild Hall, housing/service, basic production, and visible hunter activity.
- Small data-driven hunter roster, flexible builds, a skill subset, equipment subset, and a basic card subset.
- Five-hunter party builder, objective fit analysis, formation templates, dependency warnings.
- One safe region and one high-risk region; deterministic real-time auto-combat; continue/retreat; injuries/death prototype.
- One compact policy layer, AI assignment/replacement explanation, offline catch-up.
- Expedition report, minimal Chronicle, basic crafting/research, and save/load.

**MVP acceptance target:** player can make a strategy/policy decision, watch the guild execute it, understand why the result occurred, and see that the outcome affects the living guild.

### V1: complete core management loop

Expand town services/population/defense, resource economy, recruitment, contracts/reputation, more classes/skills/equipment/cards, research constellation, full policy/automation tiers, discovery map, party history/mastery, and rich Chronicle/legacy.

### V2: depth and scale

Advanced factions, broader world/biomes, bosses and richer reaction/encounter sets, theorycraft simulations, endgame collection/refinement systems, mature generational roles, expanded visual town history, accessibility and responsive UI.

### Endgame / New Game+

Endless and high-risk expedition structures, world bosses, deep build optimization, capability challenges, legacy/monument goals, and approved New Game+ carry-over/cycle rules.

## 17. Implementation order

1. Establish data schemas, simulation clock, RNG/replay/audit model, save migration strategy, and policy evaluation precedence.
2. Build the vertical slice: hunter state → party planner → deterministic combat → expedition outcome → recovery/loot/Chronicle.
3. Add visible town state and services so recovery and staffing have real consequences.
4. Add AI Operations: assignment, readiness, replacement, reason codes, policy preview/conflict resolution.
5. Add economy/crafting/research and resource-to-world feedback.
6. Add world knowledge, contracts/reputation, and risk-zone expansion.
7. Add equipment/cards/theorycraft and party mastery/history.
8. Add legacy, generational roles, endgame, and New Game+ only after core consequence loops are proven.

Do not begin with broad content production, full town life simulation, or endgame systems before the vertical slice is measurable and replayable.

## 18. Testing and acceptance criteria

### Determinism and persistence

- Given identical seed, data version, world state, and policies, online and offline resolution produce equivalent outcomes within documented coarse-step boundaries.
- Save/load and offline catch-up cannot duplicate/lose resources, events, deaths, or policy actions.
- Every important AI action and consequential outcome can be explained from an audit record.

### Policy and agency

- Hard constraints are never violated unless a configured emergency exception applies.
- Conflict order resolves exactly as canonical hierarchy.
- AI never auto-retire a hunter or silently override a player policy.
- High-impact/irreversible actions require the appropriate player decision or pre-authorized policy.

### Systems

- Recovery measurably varies with time, food, housing/services, and rest.
- Death produces economic/legacy consequence and capability-gap analysis.
- Party readiness/fit is objective-based, not a hidden aggregate score.
- Equipment/card changes update build tags and explain consequential behavior changes.
- Theorycraft simulations yield no rewards and use the production combat rules.
- Map information never exceeds Guild knowledge state.
- Town pressure visibly and mechanically follows resource/infrastructure mismatch.

### UX

- A new player can identify current urgent state, a hunter’s role/status, and an expedition’s risks without opening advanced screens.
- A theorycrafter can inspect eligibility, interactions, consequences, and comparisons without an external tool.
- Alerts/recommendations remain actionable and non-spammy; rejected recommendation patterns reduce prominence.
- No primary flow depends on Combat Power or a Party Synergy score.

## 19. Strict change-control: do not alter without approval

The build agent must not silently redesign or substitute any of the following:

- Player is invisible Guild Master; no player character. Guild is protagonist; hunters are characters.
- One continuous world clock; offline uses the same accelerated simulation and carries the same Black Zone risk rules.
- AI operates execution/administration; player owns strategy, policy, exceptions, risk, and irreversible choices.
- Canonical policy/constraint hierarchy and explicit emergency overrides.
- Contextual risk-based failure; meaningful high-risk death; resurrection cost logic; capability-gap replacement flow.
- Flexible classes/one knowledge constellation; build tags generated from actual build; no Combat Power/Party Synergy score.
- Five-hunter parties; objective-first AI proposal + player adjustment; functional roles and formation template + AI adjustment.
- Equipment is transferable; no seasonal equipment reset; crafting targeted progression and loot jackpot; controlled lossy conversion.
- Card discovery/theorycraft/shared-card principles and no-reward production-rule simulation.
- World map as guild knowledge, not omniscient player data.
- Living isometric town, visible hunting/defense/returns, population pressure, and town as Chronicle—not a life sim.
- Research = technology; mastery = experience; multi-axis progression.
- Chronicle qualification, historic legacy/monuments, non-automatic veteran retirement, and long-term legacy focus.
- Guild Advisor as an NPC/interface character, not player avatar; recommendation/override behavior.

## 20. Genuine implementation ambiguities to surface for approval

These are deliberately not inventions to make now: exact launch class/attribute roster; elements/reaction matrix and formula values; combat timing/skill slot counts; final resource names/count; content catalogues (regions, monsters, factions, contracts, buildings, recipes, cards); numerical balance curves; exact resurrection methods; exact New Game+ carry-over/cycle rules; and final platform/network model. Propose data-driven defaults only after the vertical slice demonstrates the relevant loop, and label each proposal as pending approval.

