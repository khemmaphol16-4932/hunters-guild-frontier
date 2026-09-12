# Continuous World Architecture

**Status:** LOCKED amendment, 2026-09-12. This document supersedes descriptions of Town,
Expedition, or Combat as separate gameplay modes. Existing requirements remain in force unless
this amendment directly replaces their presentation or lifecycle.

## North stars

> **A world worth living in, and a frontier worth risking it for.**

> **The player builds the system; the hunters live it.**

> **If an important system can be represented through observable world behavior, prefer
> showing it in the world before reducing it to a menu.**

Hunter's Guild: Frontier is a continuous autonomous guild-and-city simulation RPG. The player
builds a Hunter Guild city, its economy, services, policies, and frontier infrastructure.
Persistent hunters join, live, earn, spend, train, work, socialize, form parties, travel,
explore, fight, return, sell loot, recover, and grow in the same running simulation.

## Locked requirements

| ID | Requirement |
|---|---|
| REQ-CW-001 | Town, roads, wilderness, expeditions, and combat are activities in one connected simulation, never mutually exclusive game modes. |
| REQ-CW-002 | A player may follow a hunter from town through connected regions into combat without a combat phase, battle scene, or automatic combat camera. |
| REQ-CW-003 | Combat begins in the field where detection occurs. Terrain, nearby monsters, and nearby Guild parties remain relevant; the rest of the world continues. |
| REQ-CW-004 | The technical world may use streamed connected regions, natural-border cuts, and lower-frequency off-screen updates. Agent identity, journey state, decisions, and outcomes persist across them. |
| REQ-CW-005 | An expedition is a Guild-issued objective, party, supplies, policy, and journey through the same world. Hunters may also hunt without one within Guild permission and risk policy. |
| REQ-CW-006 | The town is buildable on a grid: irregular footprints are allowed; buildings rotate four ways and move for gold; roads affect movement; placement, traffic, services, obstacles, decorations, and minor landscaping matter. |
| REQ-CW-007 | World behavior is shown physically when interesting. Menus are used for deep builds, policy, pricing, research, comparison, and statistics. |
| REQ-CW-008 | Hunters own personal money and carried loot. Loot transfers to Guild storage only when sold. If the Guild cannot pay, the hunter keeps it and tries later. |
| REQ-CW-009 | Basic supplies and standard equipment have unlimited shop stock. Individually crafted equipment has limited stock and is sold separately. Hunters compare both using build fit, improvement, preference, and budget. |
| REQ-CW-010 | Retreat overrides automatic engagement. A retreating hunter travels home and fights only when physically blocked. |
| REQ-CW-011 | Loot ownership transfers immediately to hunter inventory, with a brief physical drop/pickup presentation and no second collectible copy. |
| REQ-CW-012 | Distant combat updates less frequently while preserving important events and outcomes. Observing a fight must not change its result. |
| REQ-CW-013 | World Boss arrivals may temporarily affect weather, lighting, sound, creature behavior, and reports, and bring region/zone-appropriate henchmen. Terrain remains intact. |
| REQ-CW-014 | Basic discoveries reach the Guild immediately. Detailed knowledge arrives on return; encounters, gathering, investigation, and successful objectives advance knowledge. |
| REQ-CW-015 | An assignment given to a physically unable injured hunter queues until recovery and visibly explains the delay. |

## Risk, knowledge, camera, and time

Blue, Yellow, Red, and Black are spatial risk regions. Blue produces downing and automatic
rescue/return; Yellow adds injury and recovery; Red adds a small chance of carried-loot loss;
Black permits death. Death loses carried loot and retains equipped gear. Revival requires a
special Guild building/resource. Failure is costly but recoverable.

World knowledge grows through Unknown → Rumor → Discovered → Experienced → Mastered. Important
discoveries cannot depend on invisible, unmarked secrets.

The camera uses an isometric angle with zoom, smooth hunter follow with limited panning, party
follow, bookmarks, and alert jumps. It never auto-frames combat. Region borders may hard-cut
while preserving the journey. Entering buildings leaves the camera outside. If a followed
hunter is downed or dies, the camera returns to town.

Time controls are ~~Pause /~~ 1× / 2× / 4×. **Amended by DL-065:** there is no Pause — the world
always runs. Combat honors the current speed and does not pause the
world. Far-away agents use the same decision rules at a lower update frequency.

## Migration from the current prototype

The deterministic simulation remains the rules engine. Its expedition command currently
resolves a journey synchronously and presents a fact-driven replay. That lifecycle does not yet
satisfy REQ-CW-001 through REQ-CW-005.

1. Introduce persistent journey/activity state owned by the simulation.
2. Advance travel, encounter, combat, return, recovery, and selling through fixed ticks.
3. Make region loading and camera observation consumers of that state.
4. Preserve seeded combat facts and the audit trail for off-screen fidelity.
5. Make live observation primary; retain reports for history and events the player missed.

The first proof is one cycle: service → road → Blue field → combat in place → immediate personal
loot → physical return → sale to Guild → recovery. Other hunters and town services continue.

