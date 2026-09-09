# Hunter’s Guild: Frontier — Design Bible

> **Amended by Master Build Specification v1.0.** Several requirements below were superseded by the later v1.0 handoff document. Amended requirements are marked **[v1.0]** and carry the new rule; the superseded text is kept alongside so the change is visible rather than silent. `SPEC_RECONCILIATION.md` is the full item-by-item audit, and is the place to look first when this document and v1.0 appear to disagree.

**Status:** LOCKED. Derived from the 350-decision master specification, amended by Master Build Specification v1.0.

**Rule:** This document restates the spec as *testable requirements*. Code cites requirement IDs (e.g. `REQ-AI-006`). Where the spec was ambiguous, the conservative reading is recorded here and logged in `DECISION_LOG.md`. No requirement in this file may be silently changed.

Section numbers in parentheses (§n) reference the master specification.

---

## 0. Prime Directives

| ID | Requirement |
|---|---|
| REQ-PRIME-001 | The Guild is the protagonist — not the Hunter, the gear, the town, or the combat. (§145) |
| REQ-PRIME-002 | Player = Strategy. Guild AI = Management. Hunter AI = Execution. (§3) |
| REQ-PRIME-003 | The player never directly controls a Hunter during combat. Override exists only at policy and constraint level. (§37) |
| REQ-PRIME-004 | A Hunter becomes its build through what it actually does — mastery and behavior memory grow from use. (§3, §15) |
| REQ-PRIME-005 | There is no universally perfect party; only the right party for a situation. (§25, §88) |
| REQ-PRIME-006 | The town is a physical, observable place — never a menu stack. (§6, §59, §129) |

### Anti-goals (§129) — guardrails, tested where possible

Spreadsheet simulator · direct-control RPG · generic idle game · pure loot grinder · hero collector · full life simulator · hardcore survival game.

Target tone: **casual tycoon + RPG flavor**. Death matters; the game stays approachable.

---

## 1. Hunter Domain

| ID | Requirement |
|---|---|
| REQ-HUN-001 | Attributes are STR, AGI, VIT, DEX, INT, LUK. (§9) |
| REQ-HUN-002 | Attribute points are generated from the individual Hunter's level and allocated by the player. (§9) |
| REQ-HUN-003 | Attribute respec is available and relatively cheap, via an obtainable resource. (§9) |
| REQ-HUN-004 | Base level range is 1–100. At cap, Rebirth becomes available. (§10) |
| REQ-HUN-005 | Old Hunters remain valuable; a higher-potential recruit must not automatically invalidate an existing Hunter. (§10, §104) |
| REQ-HUN-006 | Every Hunter carries: level, attributes, class chain, skills, knowledge, mastery, equipment, cards, potential, personality, traits, build identity, preferred role, preferred department, hunger, fatigue, morale, friendship, history, behavior memory, chronicle. (§8) |
| REQ-HUN-007 | Two Hunters of the same class and similar build must not automatically behave identically. (§8, §140-K/L) |
| REQ-HUN-008 | Potential is visible from recruitment. (§17, §77) |
| REQ-HUN-009 | Potential is composite — stat ceiling, growth, traits, unique skill, affinity, synergy — not a single scalar. Legendary means *exceptional potential to become something special*, not *strongest in every situation*. (§17) |
| REQ-HUN-010 | Personality affects morale, AI decision weight, party synergy, work preference, execution style and risk tolerance — but never overrides Guild Policy. It changes *how*, never *whether*. (§18) |
| REQ-HUN-011 | Hunger, fatigue and morale exist. Hunger/fatigue may affect stats, AI, recovery and productivity; morale has a smaller but meaningful effect. Housing quality affects morale and recovery. (§48) |
| REQ-HUN-012 | Hunter relationships are modelled as Friendship only. No full life simulation. (§48, §76) |

### Class chain

| ID | Requirement |
|---|---|
| REQ-CLS-001 **[v1.0]** | **One node-based skill constellation** with class starting positions. Archetypes are entry points, not silos; the former advanced classes and specializations are now descriptive *regions* of that constellation. *(v1.0 §5; supersedes §11 three-stage chain.)* |
| REQ-CLS-002 **[v1.0]** | A hunter begins at a starting position and never "advances". Class identity is *derived* from which regions their taken nodes fall in, so it changes as they travel. *(v1.0 §5.)* |
| REQ-CLS-003 | Specialization is expressed through skills, weapons, skill books, attributes, equipment, cards and mastery. (§11) |
| REQ-CLS-004 **[v1.0]** | Node eligibility depends on level, class affinity, weapon, build compatibility, prerequisites and skill books — all data-driven. Affinity above zero means reachable but *further*: the level cost is divided by affinity, so distance is progression cost rather than a hard wall. *(v1.0 §5.)* |
| REQ-CLS-005 **[v1.0]** | Hybrid builds are a gradient, not three discrete gates. A hunter may walk into another archetype's territory at a cost; identity follows where they actually went. *(v1.0 §5.)* |

### Skills

| ID | Requirement |
|---|---|
| REQ-SKL-001 | A Hunter may know unlimited skills but equips only 6–8 actives. (§13) |
| REQ-SKL-002 | Skill knowledge is separate from active loadout. (§14) |
| REQ-SKL-003 | Categories: active, passive, buff, debuff, ultimate, party, weapon, movement/utility, trigger-based. (§13) |
| REQ-SKL-004 | **There is no separate Reaction Skill category.** Reaction behavior is expressed through skill conditions, AI rules, triggers, utility evaluation and fixed reaction priorities. (§13, §128) |
| REQ-SKL-005 | Skill Books teach skills, gated by class compatibility. (§14) |
| REQ-SKL-006 | Skill usage is hybrid: resource + cooldown + condition. A ready cooldown alone never makes a skill usable. (§39) |
| REQ-SKL-007 | Unusable skills are filtered out of the candidate set *before* utility evaluation. (§39) |
| REQ-SKL-008 | Skill selection = base priority + player weight + AI utility. Player weight is not an absolute override unless configured as a Hard Constraint. (§40) |

### Skill mastery

| ID | Requirement |
|---|---|
| REQ-MAS-001 | Mastery is permanent, never resets, has no practical hard cap, and has diminishing returns. (§15) |
| REQ-MAS-002 | Mastery increases primarily through actual use. (§15) |
| REQ-MAS-003 | Mastery may affect power, efficiency, resource cost, cooldown, effects, reliability, additional behavior or skill-specific bonuses. The effect is per-skill and data-driven. (§15) |

### Build identity

| ID | Requirement |
|---|---|
| REQ-BLD-001 | Build identity derives from class, attributes, skills, equipment, cards, skill books, mastery, personality, potential and party interaction. (§16) |
| REQ-BLD-002 | Contribution weights — Class 2, Attributes 2, Skills 2, Equipment 2, Cards 1, Skill Books 1. (§16) |
| REQ-BLD-003 | Different builds must produce different **AI behavior**, not merely different numbers. (§16) |
| REQ-BLD-004 | Build identity outranks party strategy. A party template can never force a Hunter into behavior fundamentally incompatible with its build. (§26, §128) |

### Chronicle

| ID | Requirement |
|---|---|
| REQ-CHR-001 | Chronicle records first Red/Black Zone, boss kills, near-death, rescues, rare discoveries, legendary equipment, companions lost, important expeditions, achievements, mastery milestones and survival moments. (§19) |
| REQ-CHR-002 | Chronicle is a core identity system, not flavor text. (§19) |
| REQ-CHR-003 | **A chronicle entry never automatically changes combat behavior.** History becomes mechanical only when explicitly converted into Behavior Memory, Mastery, a Trait or a Legacy Trait. (§19, §35, §128) |
| REQ-CHR-004 | Chronicle is one of the main Hunter pages and must be reachable in one step. (§109) |
| REQ-CHR-005 | A Hunter with a long meaningful chronicle may be worth more than one with better raw stats. Raw-stat optimization must not be the only correct strategy. (§104) |

---

## 2. Equipment, Cards, Items

| ID | Requirement |
|---|---|
| REQ-EQP-001 | Equipment carries base stats, rarity, random substats, cards, set effects, refinement, sockets, compatibility and unique effects. (§20) |
| REQ-EQP-002 | Base/main stats are fixed by item type; substats are randomized. (§20, §21) |
| REQ-EQP-003 | Perfect items are possible but extremely rare, and never required for normal progression. (§20, §97) |
| REQ-EQP-004 | All equipment is tradable. Nothing is ever bound to a Hunter. (§20) |
| REQ-EQP-005 | Refinement uses a Safe Zone (reliable) plus a Risk Zone (higher potential, real danger/cost). (§22) |
| REQ-EQP-006 | Set bonuses exist at 2/3/4 pieces and may be dynamic. Sets must not invalidate non-set gear. (§23) |
| REQ-EQP-007 | Legendary equipment changes how a build works; it is never merely a large flat multiplier. (§96) |
| REQ-CRD-001 | Cards are build-changing, carry compatibility tags, and alter build behavior, skill interaction, AI behavior, combat strategy and synergy — not generic +damage. (§24) |
| REQ-CRD-002 | Boss Card drop rate is 0.5% from a Boss; each Boss has its own card pool. (§24) |
| REQ-CRD-003 | Duplicate rare cards and items must have useful conversion options; Boss Cards have duplicate protection/conversion. (§24, §87) |
| REQ-LOT-001 | Loot uses weighted random; some systems use pity/protection. (§87) |
| REQ-LOT-002 | Unused equipment can be sold, dismantled or traded. (§86) |

---

## 3. Party

| ID | Requirement |
|---|---|
| REQ-PTY-001 | Party size is 5. (§25) |
| REQ-PTY-002 | Holy Trinity is available but is only one valid structure; tank/healer/DPS/support/hybrid/control/utility/synergy comps must all be viable. (§25) |
| REQ-PTY-003 | The player creates Party Templates. The Guild AI may only instantiate player-created templates. (§27) |
| REQ-PTY-004 | The AI may select a template, select hunters, replace injured members and adjust within template rules. It may **never invent a new template**. (§27) |

---

## 4. Policy & AI

### Hierarchy

| ID | Requirement |
|---|---|
| REQ-POL-001 | Policy hierarchy: Player → Guild Policy → Guild AI → Department/Activity → Party Strategy → Build Identity → Hunter AI → personality/mastery/behavior/equipment/fatigue/morale/history/potential → Action. (§28) |
| REQ-POL-002 **[v1.0]** | Canonical precedence: Hard constraints → Guild objective → Guild policy → AI optimization → Department policy → Party objective → Hunter identity/preferences. Policy inherits Guild → Department → Party → Hunter with explicit overrides. Declared in `data/policy/precedence.json` rather than in source order, because v1.0 §18 makes "conflict order resolves exactly as canonical hierarchy" an acceptance criterion. *(v1.0 §2.1; supersedes §28's ordering, which put AI utility last and Department above Party.)* |
| REQ-POL-003 | Policy hierarchy determines organizational strategy; capability determines whether an action is *valid*; personality determines execution *style*. These three are distinct mechanisms. (§28) |
| REQ-POL-004 **[v1.0]** | Hard Constraints win **unless an explicitly configured emergency policy permits the override**. An authorisation must name the specific constraint (no wildcards), be player-authored, be conditional on an active trigger, and be audited. With no authorisation configured, behaviour is unchanged — the AI never violates a constraint because another system rates an action optimal. *(v1.0 §2.1/§18; supersedes §29's absolute rule.)* |
| REQ-POL-005 | Hard Constraints include: prohibited action, prohibited zone, prohibited risk, required retreat threshold, death policy, equipment restriction, skill restriction, role restriction, player safety setting. (§29) |
| REQ-POL-006 | Guild Policy outranks Personal Priority. Hunters cannot refuse assigned work; they may only execute it differently. (§71) |
| REQ-POL-007 | Policy levels: Guild, Department/Activity, Party, Individual. (§70) |

### Hunter AI

| ID | Requirement |
|---|---|
| REQ-AI-001 | Hunter AI is Utility + Rules + Constraints. Not simple if/then. (§30) |
| REQ-AI-002 | Four evaluation layers: (1) objective & hard constraints, (2) tactical state & threat, (3) self status & combat state, (4) identity & capability. (§30) |
| REQ-AI-003 | Monster baseline targeting is Highest Threat. Threat is generated by damage, healing and taunt; taunt adds significant threat; threat decays. (§31) |
| REQ-AI-004 | Bosses use the same threat model unless a specifically designed boss system says otherwise. Bosses do not simply ignore tanks. (§31) |
| REQ-AI-005 | Tank Peel exists. (§31) |
| REQ-AI-006 | **A Hunter changes its current target only when that target dies.** Tactical adaptation happens through skill choice, positioning, defense, support, utility, movement and resource management instead. (§31, §128) |
| REQ-AI-007 | The AI has an internal Interrupt Priority. Reaction priority is **fixed** and not player-adjustable. Interrupts must respect hard constraints, target rules, build identity, skill availability and reaction priority. (§32, §128) |
| REQ-AI-008 | Prediction is lightweight and deterministic — imminent boss attack, ally death, skill timing, danger, rescue viability. No machine learning. (§33) |
| REQ-AI-009 | Hunters know only what they can detect or have learned. Awareness is a radius around the Hunter. No omniscient battlefield knowledge. (§34) |
| REQ-AI-010 | AI learning happens only through Mastery and Behavior Memory. (§35) |
| REQ-AI-011 | AI explanation surfaces important decisions only, in player-readable language ("rescued the Cleric because estimated survival was 82%"), never raw utility scores. (§35, §36) |
| REQ-AI-012 | Combo/synergy is dynamic and may consider class, skill tags, element, status, build identity and party synergy. (§41) |
| REQ-AI-013 | Party Skills support coordinated actions; Ultimates require conditions + resource + tactical decision. (§41) |

---

## 5. Combat

| ID | Requirement |
|---|---|
| REQ-CBT-001 | Combat is real-time auto-combat, physically staged in the expedition environment. (§38) |
| REQ-CBT-002 | Damage formula is hybrid — externally understandable, internally multi-layered. (§42) |
| REQ-CBT-003 **[v1.0]** | Damage types: physical, magic, element, true. Elements and reactions are **build and encounter interactions authored as data tables (a reaction matrix), never a fixed rock-paper-scissors cycle**. Reactions must be legible in combat, affect build tags and AI choices, and support theorycraft simulation. The element list and matrix values are unapproved (v1.0 §20) and must not be invented. *(v1.0 §7/§20; supersedes §42's advantage/disadvantage cycle — which is precisely the model v1.0 warns against.)* |
| REQ-CBT-004 | Defense: physical DEF, magic DEF, elemental resistance. Penetration: flat and percentage. (§42) |
| REQ-CBT-005 | Accuracy model: accuracy, evasion, situational modifier. (§42) |
| REQ-CBT-006 | Critical: crit chance, crit damage, and critical resistance. (§42) |
| REQ-CBT-007 | Damage variance is ±10%. (§42) |
| REQ-CBT-008 | Status effects include poison, bleed, burn, stun, freeze, silence, curse, slow, blind and others. Each status owns its stacking rules. (§43) |
| REQ-CBT-009 | CC has soft and hard tiers. Bosses have high resistance and diminishing returns. (§43) |
| REQ-CBT-010 | Generic Status Resistance is primarily a **Boss** system. Normal hunters and normal enemies do not get a blanket resistance stat; use immunities or specific conditions instead. (§43) |
| REQ-CBT-011 | Healing supports direct heal, HoT, shield, recovery and rescue. Healing AI is utility-based. Some skills convert overheal into another effect. (§44) |
| REQ-CBT-012 | At 0 HP: Downed → ally rescue → death. A downed Hunter cannot act. The downed timer is affected by timer and situation. (§45) |
| REQ-CBT-013 | Rescue method depends on class, skill, equipment and situation. Rescue AI weighs risk/benefit and may decline a rescue with poor survival odds. (§45) |
| REQ-CBT-014 | Death is governed by the player's Risk/Death Policy. The AI evaluates risk but never overrides a Hard Constraint. (§46) |
| REQ-CBT-015 | Black Zone death is always reversible via expensive revival. (§46, §51) |

---

## 6. Expeditions & World

| ID | Requirement |
|---|---|
| REQ-EXP-001 | World structure is a fixed world map with procedural expedition routes. (§49, §50) |
| REQ-EXP-002 | Expeditions have branching routes, events, combat, exploration, loot, bosses, decisions and environmental situations. (§49) |
| REQ-EXP-003 | Maximum expedition duration is 10 minutes; different expeditions may be shorter. (§49) |
| REQ-EXP-004 | Continue/Retreat is a major tension mechanic driven by expedition policy, party policy, hunter condition, events, danger checkpoints, AI evaluation and player risk policy. Hard Constraints always win. (§47) |
| REQ-WLD-001 | The world map is persistent; exploration information is permanent and remembered by the Guild. (§50, §90) |
| REQ-WLD-002 | Regions unlock through combinations of level, reputation, story, capability and player choice, and must feel clearly different. (§50) |
| REQ-ZON-001 | Four danger tiers: BLUE (no death), YELLOW (injury, healing building required), RED (severe injury, healing building required), BLACK (death possible, revive building required). (§51) |
| REQ-ZON-002 | Zones differ in environment, monsters, loot, events and risk. (§51) |
| REQ-ENV-001 | Terrain affects movement cost and positioning. (§52) |
| REQ-ENV-002 | Environmental damage is limited primarily to specific Events. (§52, §128) |
| REQ-ENV-003 | Hunters use environmental mechanics only through designated skills. Ordinary monsters never deliberately exploit the environment. Bosses may have scripted environmental interactions. World Bosses may have genuinely unique mechanics. (§52, §128) |
| REQ-BOS-001 | Boss design = stat + skill + phase + environment. Every important boss skill has a visual, sound and animation telegraph. (§53) |
| REQ-BOS-002 | Unique mechanics beyond the standard boss framework are reserved for World Bosses. (§53, §54) |
| REQ-BOS-003 | World Bosses respawn, appear as world events, carry their own card pool, create Guild Chronicle entries, and may temporarily change the world (region danger, special monsters, markets, contracts, factions, resources, events). (§54, §105) |
| REQ-DGN-001 | Dungeons appear from midgame as fixed theme + procedural layout, and supplement rather than replace expeditions. (§55) |
| REQ-EVT-001 | The player sets event policy; the AI makes the decision. The player must never be forced to micromanage every event. (§56) |
| REQ-EVT-002 | Event outcomes affect loot, reputation, chronicle, hunters, town, resources, world discovery, contracts, factions and risk. (§56) |
| REQ-SEC-001 | Secret content is rare discovery and must not be obvious. (§91) |

---

## 7. Offline Simulation

| ID | Requirement |
|---|---|
| REQ-OFF-001 | The Guild continues working while the player is away, up to a maximum of 3 days. (§57) |
| REQ-OFF-002 | Offline expeditions run **the same gameplay systems in simulation mode**, using **the same combat AI**. A separate fake combat model is forbidden. Presentation may be abstracted; rules may not. (§57) |
| REQ-OFF-003 | Hunters can die offline; the player must configure Risk/Death Policy beforehand. (§58) |
| REQ-OFF-004 | Offline events are resolved immediately by AI per policy and never remain pending for the player. (§58) |
| REQ-OFF-005 | Outcomes reach the player through the Guild Report plus chronicle/history/logs. (§58, §112) |

---

## 8. Town & Guild

| ID | Requirement |
|---|---|
| REQ-TWN-001 | The town is a physical place on a clear grid; buildings are placed and physically exist; hunters physically walk between them. (§59, §62) |
| REQ-TWN-002 | Town progression: Small Camp → Village → Fortified Town → Hunter City, with visual change at each step and **no reset** on progression. (§59) |
| REQ-TWN-003 | The town has a real population that creates demand for food, housing and services, and grants visual growth, economy, building unlocks and progression. Excess population creates food, housing and infrastructure pressure. (§60) |
| REQ-TWN-004 | NPCs are service NPCs only (recruiter, merchant, crafting, research, service workers). No NPC life simulation. (§61) |
| REQ-TWN-005 | Buildings support recruitment, healing, revival, crafting, research, housing, defense, economy and guild management. (§62) |
| REQ-TWN-006 | The Guild Hall is the heart of town, with tiers, multiple levels per tier, management functions, command-center functions, policy management and Guild AI management. (§63) |
| REQ-TWN-007 | Town hunting is real: hunters physically walk to hunting areas and fight using the same combat system; the player may watch. It yields loot, EXP, chronicle events and chance events. (§74) |
| REQ-TWN-008 | Town defense occurs as occasional events that can damage buildings. The player sets guard policy; the AI organizes guards. If hunters are away, the Guild AI evaluates severity. (§75) |
| REQ-TWN-009 | Idle hunters automatically work per Guild Policy; only hunters not otherwise assigned are considered for idle work. (§72) |
| REQ-TWN-010 | Hunter job assignment uses Preferred Role and Preferred Department as inputs, never as vetoes. (§72) |
| REQ-TWN-011 | Daily routines exist to make the Guild feel alive; they are not a life simulator. (§76) |

### Departments & research

| ID | Requirement |
|---|---|
| REQ-DEP-001 | Departments: Hunter, Crafting, Resource, Defense, Research. They unlock through Research. (§66) |
| REQ-DEP-002 | The player appoints Department Heads; qualification improves performance; heads may affect skills, traits, efficiency, AI and department performance. If absent, a deputy/AI takes over. (§67) |
| REQ-DEP-003 | **There is no Department Budget system.** It must not be reintroduced. (§67, §128) |
| REQ-DEP-004 | The player sets department policy and priority; Guild Policy remains the highest authority. Performance is shown on a multi-metric dashboard. On poor performance the AI recommends and the player decides. (§68) |
| REQ-DEP-005 | Manager behavior evolves through Guild Mastery, Research and Department Head. Policy presets exist. (§69) |
| REQ-RES-001 | Research is a tree with multiple branches; some choices lock others, creating Guild identity. Research can be reset with a rare resource. (§64) |
| REQ-RES-002 | Research represents technology; Guild Mastery represents experience. (§64, §65) |
| REQ-GMA-001 | Guild Mastery grows from actually performing activities (expedition, crafting, recruitment, defense, research) and is institutional experience, not an arbitrary XP bar. (§65) |

---

## 9. Economy

| ID | Requirement |
|---|---|
| REQ-ECO-001 | Gold matters and must have meaningful sinks from early game onward, growing heavier later (luxury, prestige, convenience, crafting, refinement, recruitment, infrastructure, recovery, revival). (§82, §98) |
| REQ-ECO-002 | Use a small set of core resources plus specialized resources with multiple sources. Some important resources are intentional bottlenecks. Hundreds of currencies are forbidden. (§83) |
| REQ-ECO-003 | Food is a core resource supporting hunter needs, population and town economy; hunger has gameplay effects. (§84) |
| REQ-ECO-004 | Craft = certainty, Loot = jackpot. Crafting must never be strictly better than loot. Crafting quality involves cost, speed, quality chance and new recipes. (§85) |
| REQ-ECO-005 | The market supports buy/sell/trade with dynamic but controlled prices — never a chaotic economic simulation. (§86) |
| REQ-ECO-006 | Wealth sinks at the top end favor luxury, prestige, convenience, cosmetics, monuments and small morale/reputation benefits over raw power inflation. (§98) |
| REQ-CON-001 | Guild Contracts are a major income source and must be analyzed before acceptance. Tiers scale with reputation and guild capability. Contracts carry faction/client identity and affect reputation, economy, resources, world state and chronicle. (§79) |
| REQ-REP-001 | Reputation is rank + numerical value, scoped globally and regionally. It can fall from failure, hunter death, contract failure and negative events, and affects recruitment, merchants, market, contracts, events and factions. (§80) |
| REQ-FAC-001 | Factions have per-faction reputation and affect contracts, recruitment, events, markets and world content. It is not a political simulator. (§81) |
| REQ-CAP-001 | **There is no single universal Power Score.** Guild Capability is multi-dimensional (combat, expedition, crafting, resource, defense, research, economic) and drives contract generation. (§89) |
| REQ-RCT-001 | Recruitment runs through the Recruitment Hall + NPC Recruiter with a dynamic pool depending on town, reputation and region; refresh is both paid and timed. (§77) |
| REQ-RCT-002 | Different regions produce clearly different hunter pools, and exceptional recruits must be immediately legible as special. (§78) |

---

## 10. Progression & Endgame

| ID | Requirement |
|---|---|
| REQ-END-001 | Endgame is a main goal plus open-ended Guild life; the player may continue after the main objective. (§92) |
| REQ-END-002 | Endless scaling affects monsters, zones, events and rewards. Before an endless expedition the player chooses an objective (max loot, survival, boss hunting, resource gathering, exploration, record attempt). (§93) |
| REQ-END-003 | Endless content uses personal records; global competitive ranking is not mandatory. (§94) |
| REQ-END-004 | Endgame Challenge Contracts provide difficult constraints, unique rewards and tests of build, party and guild strategy. (§95) |
| REQ-MON-001 | The Guild Monument records historic achievements (world boss victories, legendary hunters, first Red Zone clear, first Black Zone survival, major discoveries, historic contracts, disasters, exceptional expeditions). (§99) |
| REQ-LEG-001 | Legacy is a major long-term system with points from multiple sources, unlocking options, systems, starting choices, QoL, variant rules, archetypes and world variants. It must not primarily grant large raw stat advantages. (§100) |
| REQ-LEG-002 | NG+ resets world progression while keeping Legacy, and may provide endless scaling. Variant worlds can change the rules of the world. (§101) |
| REQ-LEG-003 | Legacy can unlock new starting archetypes that create new ways to play. (§102) |
| REQ-LEG-004 | Retired hunters become mentors/NPCs providing EXP bonuses, mastery training and training efficiency; effects depend on the hunter. Some chronicle events become Legacy Traits. (§103) |

---

## 11. UI / UX

| ID | Requirement |
|---|---|
| REQ-UX-001 | Teaching is through play with progressive disclosure. No 30-minute tutorial dump. (§106) |
| REQ-UX-002 | AI complexity has two views: Easy (plain explanations) and Advanced (policy, constraints, utility factors, build priorities, tactical state, decisions). Raw implementation detail is hidden unless requested. (§107) |
| REQ-UX-003 | The Hunter Build screen is a Build Identity Dashboard showing class, attributes, skills, equipment, cards, mastery, personality, potential, AI tendencies, synergies, weaknesses, role and chronicle highlights, answering "what kind of Hunter is this?" at a glance. (§108) |
| REQ-UX-004 | Combat replay is timeline/highlight based and must explain why a hunter died, why a boss fell, key skills, rescues, mistakes and turning points. Full-frame replay of long battles is not required. (§110) |
| REQ-UX-005 | Notifications are importance-prioritized; only important events interrupt. (§111) |
| REQ-UX-006 | On return from offline, a Guild Report summarizes expeditions, deaths, injuries, rare loot, discoveries, contracts, attacks, chronicle events, reputation changes, research completion and economic changes. (§112) |
| REQ-UX-007 | Camera is isometric / 3D top-down with pixel-art direction. (§6) |

---

## 12. Technical

| ID | Requirement |
|---|---|
| REQ-TEC-001 | Modular systems; any system can be removed or added without breaking the game. (§113) |
| REQ-TEC-002 | Data-driven: hunter/item/skill data lives separately from logic. The §114 list of data-driven values is authoritative. (§113, §114) |
| REQ-TEC-003 | Shared AI framework + configurable parameters. (§113) |
| REQ-TEC-004 | Save supports auto-save, manual save and backup; save data is versioned and designed for migration. (§113, §116) |
| REQ-TEC-005 | Randomness is controlled: seedable RNG, weighted tables, explicit probabilities, deterministic simulation where possible — critical for offline sim, combat debugging, loot, recruitment, procedural routes and events. (§117) |
| REQ-TEC-006 | Debug tooling is built early and hidden from normal players; the §118 command list is the minimum. (§118) |
| REQ-TEC-007 | Every major system has automated or reproducible tests where practical (§119 list). |
| REQ-TEC-008 | AI is validated by controlled behavioral scenarios (§120, §140 A–M), not unit tests alone. |
| REQ-TEC-009 | Balance is validated by simulation, hunting for dominant builds, dead builds, infinite loops, exploits, progression walls, inflation and degenerate strategies. (§121) |
| REQ-TEC-010 | Forbidden structures: giant GameManager, giant HunterAI class, giant CombatManager, UI owning game logic, game logic depending on UI, universal system interdependence. (§126) |
| REQ-TEC-011 | Performance priority order: gameplay stability → AI simulation → combat entities → town simulation → offline simulation → rendering → UI. Profile, don't guess. (§143) |
| REQ-TEC-012 | Prefer simple architecture with deep interaction over large architecture with shallow interaction. (§144) |

---

## 12b. Requirements added by Master Build Specification v1.0

| ID | Requirement |
|---|---|
| REQ-V1-AUD-001 | Consequential state changes are recorded with game time, actor/system, source event, policy version, deterministic seed, inputs, outcome and reason codes. An entry without a reason code is rejected. (v1.0 §14) |
| REQ-V1-AUD-002 | Every important AI action and consequential outcome can be explained from an audit record. (v1.0 §18) |
| REQ-V1-CLK-001 | Coarse deterministic steps drive idle town/economy work and finer deterministic ticks drive active combat; both derive from the same elapsed game time, with the coarse cadence an integer multiple of the fine one so the two cannot drift. (v1.0 §4) |
| REQ-V1-AVL-001 | Hunter availability is one of Available, Assigned, Recovering, Injured, Unavailable. Illegal transitions are rejected — in particular, injury heals into recovery and never straight to available. (v1.0 §4) |
| REQ-V1-AVL-002 | Recalling a hunter takes transition time; a hunter mid-recall is not deployable. (v1.0 §4) |
| REQ-V1-AVL-003 | Recovery varies measurably with time, food, housing quality, service quality and rest. Absent food it slows but never stops. (v1.0 §4, §18) |
| REQ-V1-TAG-001 | Build tags are *generated* from actual attributes, skills, equipment, cards, sets and elemental interactions. They are never stored, never manually chosen, and never aggregate into a rating. (v1.0 §5, §6, §19) |
| REQ-V1-CHR-001 | Chronicle events are Minor, Major or Historic. Only remarkable events enter. Historic events may affect legacy and monuments. (v1.0 §11) |
| REQ-V1-PTY-001 | Party creation is objective → AI proposal → player adjustment. Formation uses templates plus AI positioning adjustment. *(Supersedes REQ-PTY-003/004 on composition; templates still govern formation.)* (v1.0 §6) |
| REQ-V1-KNW-001 | The world map is a knowledge interface — unknown → rumor → discovered → experienced → mastered — and previews never show more than the guild plausibly knows. (v1.0 §8, §18) |
| REQ-V1-THC-001 | Theorycraft simulations use production combat rules and award no progression rewards. (v1.0 §5, §18) |
| REQ-V1-GAP-001 | On loss or unavailability: capability gap → AI analysis → replacement candidates → player/policy decision. The AI never auto-retires a hunter. (v1.0 §2.4, §18) |

## 13. Definition of Done (§134)

A system is Done only when it: works · is integrated · is testable · is data-driven where appropriate · violates no locked decision · handles errors reasonably · adds no obvious architectural debt · is extensible · is documented · works with save/load where relevant.
