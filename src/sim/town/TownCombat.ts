/**
 * Town hunting and town defense.
 *
 * REQ-TWN-007: *"Town hunting is real: hunters physically walk to hunting areas and fight
 * using the same combat system; the player may watch."* REQ-TWN-008: town defense happens as
 * occasional events that can damage buildings, with the AI organising guards under a policy
 * the player sets.
 *
 * "The same combat system" is the load-bearing phrase, and it is why this lives in `sim/`
 * beside `Expedition` rather than in `systems/town/`. Both of these build real combatants
 * and run a real `CombatEncounter`. A town hunt that resolved as a dice roll would be a
 * resource tick with a fight-shaped name, and every property the design cares about —
 * that mastery grows from use, that builds behave differently, that the Chronicle records
 * what happened — would quietly not apply to half the game's activity.
 *
 * Two deliberate differences from an expedition:
 *
 * **Town work cannot kill.** A hunting ground is inside the guild's own reach, so it runs at
 * blue-zone rules. Permanent death belongs to the zone tiers (REQ-ZON-001), and letting the
 * drill-yard rota kill people would make the safest activity in the game the deadliest by
 * volume.
 *
 * **Defense is fought where the buildings are.** Losing does not end a party; it ends a
 * *wall*, and the cost is paid in the town rather than in bodies. That is what makes it a
 * different event rather than an expedition that came to you.
 */

import type { Rng } from '../../core/rng.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import type { CombatBalance, MonsterDef } from '../../data/combatSchema.js';
import type { HuntingGroundDef, ThreatDef } from '../../data/threatSchema.js';
import type { SkillDef } from '../../data/schema.js';
import type { StatusDef } from '../../data/combatSchema.js';
import type { HunterId } from '../../core/ids.js';
import type { HunterAI } from '../../ai/hunter/hunterAI.js';
import { CombatEncounter, type CombatLogEntry } from '../combat/CombatEncounter.js';

export interface TownCombatDeps {
  readonly balance: CombatBalance;
  readonly ai: HunterAI;
  readonly skillOf: (id: string) => SkillDef | undefined;
  readonly statusOf: (id: string) => StatusDef | undefined;
  readonly monsterOf: (id: string) => MonsterDef | undefined;
  readonly combatantFor: (hunterId: HunterId) => Combatant;
  readonly monsterCombatant: (def: MonsterDef, index: number, position: number) => Combatant;
}

export interface HuntResult {
  readonly groundId: string;
  readonly groundName: string;
  readonly hunterIds: readonly HunterId[];
  readonly won: boolean;
  readonly xp: number;
  readonly elapsedSeconds: number;
  readonly log: readonly CombatLogEntry[];
  /** Whether this outing earned a loot roll. */
  readonly loot: boolean;
}

export interface DefenseResult {
  readonly threatId: string;
  readonly threatName: string;
  readonly severity: number;
  readonly defenderIds: readonly HunterId[];
  readonly held: boolean;
  /** Buildings damaged, and residents lost, when the walls did not hold. */
  readonly buildingsDamaged: number;
  readonly populationLost: number;
  readonly xp: number;
  readonly log: readonly CombatLogEntry[];
  /** Player-readable account, because a defense the player did not watch still happened. */
  readonly summary: string;
}

export class TownCombat {
  constructor(private readonly deps: TownCombatDeps) {}

  /**
   * One hunting outing.
   *
   * Runs to completion rather than being watchable a tick at a time — but `CombatEncounter`
   * exposes `step`, so the renderer that lets the player watch (REQ-TWN-007's "the player
   * may watch") plugs in without this changing. That is the same affordance the expedition
   * report has been waiting on since Phase 4, and it is a Phase 9 concern.
   */
  hunt(
    rng: Rng,
    ground: HuntingGroundDef,
    hunterIds: readonly HunterId[],
  ): HuntResult {
    const guild = hunterIds.map((id) => this.deps.combatantFor(id));
    const monsters = this.spawn(rng, ground.monsters, ground.count);

    const encounter = new CombatEncounter(
      {
        balance: this.deps.balance,
        ai: this.deps.ai,
        skillOf: this.deps.skillOf,
        statusOf: this.deps.statusOf,
        monsterOf: this.deps.monsterOf,
        // Town work carries no standing orders and no emergency overrides: the player's
        // expedition policy is about the field, and applying it here would let an order
        // like "never turn back" quietly govern somebody's afternoon in the orchard.
        constraints: [],
        emergency: undefined,
        // Blue-zone rules. Nothing in the town's own reach can kill (REQ-ZON-001).
        environment: { zoneTier: 'blue', lethal: false, canInjure: false },
      },
      guild,
      monsters,
    );

    const result = encounter.run(rng);
    const won = result.outcome === 'victory';

    return {
      groundId: ground.id,
      groundName: ground.name,
      hunterIds,
      won,
      xp: result.xp,
      elapsedSeconds: result.elapsedSeconds,
      log: result.log,
      loot: won && rng.next() < ground.lootChance,
    };
  }

  /**
   * A threat at the walls.
   *
   * `defenderIds` is whoever the guild could actually put on the wall. When that is nobody,
   * the fight is not run at all — an empty party against three wolves is not a fight, it is
   * an arithmetic exercise — and the town simply takes the damage. REQ-TWN-008's "if hunters
   * are away, the Guild AI evaluates severity" is the caller's decision, not this one's; by
   * the time it reaches here the guild has already decided who is standing there.
   */
  defend(
    rng: Rng,
    threat: ThreatDef,
    defenderIds: readonly HunterId[],
  ): DefenseResult {
    if (defenderIds.length === 0) {
      return {
        threatId: threat.id,
        threatName: threat.name,
        severity: threat.severity,
        defenderIds,
        held: false,
        buildingsDamaged: threat.buildingDamage,
        populationLost: threat.populationLoss,
        xp: 0,
        log: [],
        summary: `${threat.name}. Nobody was at the wall.`,
      };
    }

    const guild = defenderIds.map((id) => this.deps.combatantFor(id));
    const monsters = this.spawn(rng, threat.monsters, threat.count);

    const encounter = new CombatEncounter(
      {
        balance: this.deps.balance,
        ai: this.deps.ai,
        skillOf: this.deps.skillOf,
        statusOf: this.deps.statusOf,
        monsterOf: this.deps.monsterOf,
        constraints: [],
        emergency: undefined,
        // Defenders can be hurt — the wall is a real fight — but the town does not kill its
        // own. Losing costs buildings and residents, which is the price REQ-TWN-008 names.
        environment: { zoneTier: 'yellow', lethal: false, canInjure: true },
      },
      guild,
      monsters,
    );

    const result = encounter.run(rng);
    const held = result.outcome === 'victory';

    return {
      threatId: threat.id,
      threatName: threat.name,
      severity: threat.severity,
      defenderIds,
      held,
      buildingsDamaged: held ? 0 : threat.buildingDamage,
      populationLost: held ? 0 : threat.populationLoss,
      xp: result.xp,
      log: result.log,
      summary: held
        ? `${threat.name}. The wall held.`
        : `${threat.name}. The wall did not hold.`,
    };
  }

  private spawn(
    rng: Rng,
    monsterIds: readonly string[],
    count: { readonly min: number; readonly max: number },
  ): Combatant[] {
    const howMany = count.min + Math.floor(rng.next() * (count.max - count.min + 1));
    const spawned: Combatant[] = [];

    for (let i = 0; i < howMany; i++) {
      const id = monsterIds[i % monsterIds.length];
      const def = id === undefined ? undefined : this.deps.monsterOf(id);
      if (!def) continue;
      spawned.push(
        this.deps.monsterCombatant(
          def,
          i,
          this.deps.balance.movement.startingSeparation + i * 0.5,
        ),
      );
    }
    return spawned;
  }
}
