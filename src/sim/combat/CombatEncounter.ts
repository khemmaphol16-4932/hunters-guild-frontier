/**
 * One combat encounter, stepped deterministically.
 *
 * v1.0 §7: real-time auto-combat with meaningful pre-combat strategy and live observation.
 * §18: given the same seed and state, online and offline resolution produce equivalent
 * outcomes — so every random draw here comes from the injected stream and every step is the
 * fixed tick, never a frame delta (DL-003).
 *
 * The encounter owns no policy and no identity: it asks `HunterAI` what each hunter wants to
 * do and applies the result. That separation is what lets the same encounter run at 60fps
 * with a renderer attached or flat-out inside offline catch-up, unchanged.
 *
 * Monsters use threat-based targeting including bosses (REQ-AI-004); their sophistication is
 * in skills, phases and telegraphs, never in arbitrary target switching.
 */

import type { CombatBalance, MonsterDef, StatusDef } from '../../data/combatSchema.js';
import type { SkillDef } from '../../data/schema.js';
import type { Rng } from '../../core/rng.js';
import type { HunterId } from '../../core/ids.js';
import type { Combatant } from '../../core/combat/Combatant.js';
import {
  addThreat,
  distanceBetween,
  healthFraction,
  isActive,
  stat,
  threatAgainst,
} from '../../core/combat/Combatant.js';
import { DamagePipeline } from '../../systems/combat/damage.js';
import type {
  CombatAction,
  CombatEnvironment,
  CombatObjective,
  CombatView,
  HunterAI,
} from '../../ai/hunter/hunterAI.js';
import { NEUTRAL_OBJECTIVE, SAFE_ENVIRONMENT } from '../../ai/hunter/hunterAI.js';
import type { HardConstraint } from '../../ai/policy/pipeline.js';
import type { EmergencyPolicy } from '../../ai/policy/emergency.js';

export interface CombatLogEntry {
  readonly atSeconds: number;
  readonly actorId: string;
  readonly text: string;
  /** REQ-UX-004: highlights, not every action, are what a replay timeline shows. */
  readonly highlight: boolean;
  readonly reasonCodes: readonly string[];
}

/**
 * The slice of the event bus combat writes to.
 *
 * Narrowed to these five deliberately. The Chronicle is a *passive* recorder (§19,
 * CONFLICT_AUDIT) — it subscribes and never feeds back — and handing combat the whole bus
 * would make it easy to start emitting things that do.
 */
export interface CombatEventSink {
  emit(event: 'combat.nearDeath', payload: { hunterId: HunterId }): void;
  emit(event: 'combat.rescued', payload: { hunterId: HunterId; byHunterId: HunterId }): void;
  emit(event: 'combat.rescuePerformed', payload: { hunterId: HunterId; targetId: HunterId }): void;
  emit(
    event: 'combat.bossDefeated',
    payload: { hunterId: HunterId; bossId: string; worldBoss: boolean },
  ): void;
  emit(
    event: 'combat.companionLost',
    payload: { hunterId: HunterId; lostHunterId: HunterId },
  ): void;
}

export type EncounterOutcome = 'victory' | 'defeat' | 'withdrawal' | 'timeout' | 'ongoing';

export interface EncounterResult {
  readonly outcome: EncounterOutcome;
  readonly elapsedSeconds: number;
  readonly log: readonly CombatLogEntry[];
  readonly survivors: readonly Combatant[];
  readonly downed: readonly Combatant[];
  readonly dead: readonly Combatant[];
  readonly xp: number;
}

export interface EncounterDeps {
  readonly balance: CombatBalance;
  readonly ai: HunterAI;
  readonly skillOf: (id: string) => SkillDef | undefined;
  readonly statusOf: (id: string) => StatusDef | undefined;
  readonly monsterOf: (id: string) => MonsterDef | undefined;
  readonly constraints: readonly HardConstraint<CombatAction, CombatView>[];
  readonly emergency: EmergencyPolicy | undefined;
  /** Where the fight is (§140-M). Defaults to a safe zone when the caller has none. */
  readonly environment?: CombatEnvironment;
  /**
   * The monster id that is a *world* boss in this fight, when one is present (REQ-BOS-003).
   * The encounter is the one place a boss kill is reported; knowing which boss is the world
   * boss here is what stops a caller reporting the same kill a second time.
   */
  readonly worldBossId?: string;
  /** What the guild sent this party to do (§28). Defaults to neutral. */
  readonly objective?: CombatObjective;
  /**
   * The guild's memory (§19). Optional so an encounter can be run headless for balance
   * work without writing to anyone's Chronicle, but supplied in play: a fight nobody
   * remembers is exactly what REQ-PRIME-005 says a hunter's history must not be.
   */
  readonly events?: CombatEventSink;
  /** Called on every meaningful decision, so the caller can audit it (v1.0 §14). */
  readonly onDecision?: (combatant: Combatant, explanation: string, codes: readonly string[]) => void;
}

export class CombatEncounter {
  private readonly damage: DamagePipeline;
  private readonly log: CombatLogEntry[] = [];
  private elapsed = 0;
  private finished: EncounterOutcome = 'ongoing';
  /** Elapsed time at which the whole standing party first committed to breaking off. */
  private disengagingSince: number | undefined;

  constructor(
    private readonly deps: EncounterDeps,
    private readonly guild: Combatant[],
    private readonly monsters: Combatant[],
  ) {
    this.damage = new DamagePipeline(deps.balance);
  }

  get outcome(): EncounterOutcome {
    return this.finished;
  }

  get elapsedSeconds(): number {
    return this.elapsed;
  }

  get entries(): readonly CombatLogEntry[] {
    return this.log;
  }

  all(): readonly Combatant[] {
    return [...this.guild, ...this.monsters];
  }

  /** Run to completion. Used by expeditions and by offline catch-up alike. */
  run(rng: Rng): EncounterResult {
    const step = this.deps.balance.tickSeconds;
    const maxSteps = Math.ceil(this.deps.balance.maxEncounterSeconds / step);

    for (let i = 0; i < maxSteps && this.finished === 'ongoing'; i++) {
      this.step(rng, step);
    }
    if (this.finished === 'ongoing') this.finished = 'timeout';

    return this.result();
  }

  /** Advance one fixed tick. Public so a live view can drive it a frame at a time. */
  step(rng: Rng, dt: number): void {
    if (this.finished !== 'ongoing') return;
    this.elapsed += dt;

    for (const c of this.all()) {
      if (c.dead) continue;
      this.tickTimers(c, dt);
      this.tickStatuses(rng, c, dt);
    }

    for (const c of this.all()) {
      if (c.dead) continue;
      if (c.downed) {
        this.tickDowned(c, dt);
        continue;
      }
      if (c.side === 'guild') this.actHunter(rng, c, dt);
      else this.actMonster(rng, c, dt);
    }

    this.checkOutcome();
  }

  // -------------------------------------------------------------------------
  // Per-tick upkeep
  // -------------------------------------------------------------------------

  private tickTimers(c: Combatant, dt: number): void {
    c.secondsSinceAttacked += dt;
    c.aiCooldown = Math.max(0, c.aiCooldown - dt);
    c.attackCooldown = Math.max(0, c.attackCooldown - dt);
    c.resource = Math.min(c.maxResource, c.resource + this.deps.balance.resource.regenPerSecond * dt);

    for (const [skillId, remaining] of c.cooldowns) {
      const next = remaining - dt;
      if (next <= 0) c.cooldowns.delete(skillId);
      else c.cooldowns.set(skillId, next);
    }

    // Threat decays, so a tank has to keep working (REQ-AI-003).
    const decay = 1 - this.deps.balance.threat.decayPerSecond * dt;
    for (const [enemyId, value] of c.threat) c.threat.set(enemyId, value * decay);

    if (c.telegraph) c.telegraph.remaining -= dt;
  }

  private tickStatuses(rng: Rng, c: Combatant, dt: number): void {
    for (let i = c.statuses.length - 1; i >= 0; i--) {
      const active = c.statuses[i];
      if (!active) continue;

      const def = this.deps.statusOf(active.statusId);
      active.remainingSeconds -= dt;

      if (def?.kind === 'damageOverTime' && def.tickSeconds !== undefined) {
        active.nextTickIn -= dt;
        if (active.nextTickIn <= 0) {
          active.nextTickIn += def.tickSeconds;
          const amount = Math.max(
            1,
            Math.round(active.sourceAttack * def.magnitude * active.stacks),
          );
          this.applyDamage(rng, c, amount, active.sourceId, `${def.name}`);
        }
      }

      if (active.remainingSeconds <= 0) c.statuses.splice(i, 1);
    }
  }

  private tickDowned(c: Combatant, dt: number): void {
    c.downedRemaining -= dt;
    if (c.downedRemaining > 0) return;

    // REQ-CBT-012: the downed timer expiring is death. Whether that is permanent is the
    // zone's business, not combat's — the expedition decides, per REQ-ZON-001.
    c.dead = true;
    c.downed = false;
    this.record(c, `${c.name} did not get back up.`, true, ['death']);

    // Deliberately no `combat.companionLost` here. Whether a hunter is *permanently* lost is
    // the zone's decision, not combat's (REQ-ZON-001) — and an encounter ends the instant the
    // last hunter falls, so in a wipe this path never runs at all. Emitting the loss from
    // here recorded nothing in the cases that matter most. `sendExpedition` owns it, because
    // that is where death is actually adjudicated.
  }

  // -------------------------------------------------------------------------
  // Hunters
  // -------------------------------------------------------------------------

  private actHunter(rng: Rng, c: Combatant, dt: number): void {
    if (c.rescuingId) {
      this.continueRescue(c, dt);
      return;
    }
    if (c.aiCooldown > 0) return;
    c.aiCooldown = this.deps.balance.ai.reevaluateEverySeconds;

    const view: CombatView = {
      self: c,
      allies: this.guild,
      enemies: this.monsters,
      elapsedSeconds: this.elapsed,
      incomingTelegraphs: this.monsters
        .filter((m) => m.telegraph && !m.dead)
        .map((m) => ({
          casterId: m.id,
          secondsRemaining: m.telegraph?.remaining ?? 0,
          aoe: this.skillIsAoe(m),
        })),
      environment: this.deps.environment ?? SAFE_ENVIRONMENT,
      objective: this.deps.objective ?? NEUTRAL_OBJECTIVE,
      constraints: this.deps.constraints,
      emergency: this.deps.emergency,
    };

    const decision = this.deps.ai.decide(view);
    if (!decision) return;

    this.deps.onDecision?.(c, decision.explanation, decision.reasonCodes);
    this.perform(rng, c, decision.action, decision.explanation, decision.reasonCodes);
  }

  private perform(
    rng: Rng,
    actor: Combatant,
    action: CombatAction,
    explanation: string,
    codes: readonly string[],
  ): void {
    const target = this.all().find((t) => t.id === action.targetId);
    actor.disengaging = action.kind === 'retreat';

    switch (action.kind) {
      case 'wait':
        return;

      case 'approach': {
        if (!target) return;
        const speed = this.deps.balance.movement.unitsPerSecond * this.deps.balance.ai.reevaluateEverySeconds;
        const direction = target.position > actor.position ? 1 : -1;
        actor.position += direction * speed;
        return;
      }

      case 'dodge':
      case 'retreat': {
        // Both are movement away from the enemy line; they differ in intent and in how far
        // the hunter means to go, which the AI has already decided by choosing one.
        const speed =
          this.deps.balance.movement.unitsPerSecond * this.deps.balance.ai.reevaluateEverySeconds;
        const nearest = this.monsters.filter((m) => !m.dead)[0];
        const direction = nearest && nearest.position > actor.position ? -1 : 1;
        actor.position += direction * speed * (action.kind === 'retreat' ? 1.5 : 1);

        // Backing off sheds threat: a hunter who leaves the line stops being the problem.
        for (const monster of this.monsters) {
          const held = actor.threat.get(monster.id);
          if (held !== undefined) actor.threat.set(monster.id, held * 0.6);
        }
        this.record(actor, explanation, action.kind === 'retreat', codes);
        return;
      }

      case 'rescue': {
        if (!target) return;
        actor.rescuingId = target.id;
        actor.rescueProgress = 0;
        this.record(actor, explanation, true, codes);
        return;
      }

      case 'attack': {
        if (!target) return;
        actor.targetId = target.id;
        const result = this.damage.resolve(rng, {
          attacker: actor,
          defender: target,
          type: 'physical',
          power: 1,
        });
        this.landAttack(rng, actor, target, result.hit ? result.amount : 0, result.critical, 'a strike');
        return;
      }

      case 'skill': {
        const skill = action.skill;
        if (!skill || !target) return;

        actor.resource -= skill.resourceCost;
        actor.cooldowns.set(skill.id, skill.cooldownSeconds);

        if (skill.tags.includes('restorative')) {
          const healed = this.damage.resolveHealing(rng, actor, 1.4);
          const before = target.health;
          target.health = Math.min(target.maxHealth, target.health + healed);
          const actual = target.health - before;

          // Healing generates threat (REQ-AI-003) — this is why a healer needs a tank.
          for (const monster of this.monsters) {
            if (!monster.dead) {
              addThreat(actor, monster.id, actual * this.deps.balance.threat.perHealing);
            }
          }
          this.record(actor, explanation, actual > target.maxHealth * 0.2, codes);
          return;
        }

        if (skill.tags.includes('threat')) {
          // REQ-AI-003: taunt adds significant threat, which is how Tank Peel works.
          for (const monster of this.monsters) {
            if (monster.dead) continue;
            addThreat(actor, monster.id, this.deps.balance.threat.tauntFlat);
            monster.targetId = actor.id;
          }
          this.record(actor, explanation, true, codes);
          return;
        }

        if (skill.tags.includes('defensive') || skill.targeting === 'self') {
          this.record(actor, explanation, false, codes);
          return;
        }

        actor.targetId = target.id;
        const type = skill.tags.includes('magical') ? 'magic' : 'physical';
        const result = this.damage.resolve(rng, {
          attacker: actor,
          defender: target,
          type,
          power: 1.6,
        });
        this.landAttack(rng, actor, target, result.hit ? result.amount : 0, result.critical, skill.name);
        return;
      }
    }
  }

  private continueRescue(rescuer: Combatant, dt: number): void {
    const target = this.guild.find((c) => c.id === rescuer.rescuingId);

    // The rescue is abandoned if the target died or was already saved — a hunter should not
    // stand over a corpse because they committed two seconds ago.
    if (!target || target.dead || !target.downed) {
      rescuer.rescuingId = undefined;
      rescuer.rescueProgress = 0;
      return;
    }

    rescuer.rescueProgress += dt;
    if (rescuer.rescueProgress < this.deps.balance.downed.rescueSeconds) return;

    target.downed = false;
    target.health = Math.max(1, Math.round(target.maxHealth * this.deps.balance.downed.reviveHealthFraction));
    rescuer.rescuingId = undefined;
    rescuer.rescueProgress = 0;

    this.record(rescuer, `${rescuer.name} pulled ${target.name} back to their feet.`, true, [
      'rescue_completed',
    ]);

    // Both sides of a rescue are worth remembering, and they are separate events because
    // they mean different things in the two Chronicles: one hunter was saved, the other
    // went in for them (§19).
    if (rescuer.hunterId && target.hunterId) {
      this.deps.events?.emit('combat.rescued', {
        hunterId: target.hunterId,
        byHunterId: rescuer.hunterId,
      });
      this.deps.events?.emit('combat.rescuePerformed', {
        hunterId: rescuer.hunterId,
        targetId: target.hunterId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Monsters
  // -------------------------------------------------------------------------

  private actMonster(rng: Rng, c: Combatant, dt: number): void {
    const def = c.monsterId ? this.deps.monsterOf(c.monsterId) : undefined;
    if (!def) return;

    this.updatePhase(c, def);

    // A telegraphed skill resolves when its wind-up ends (REQ-BOS-001).
    if (c.telegraph) {
      if (c.telegraph.remaining > 0) return;
      const skill = def.skills.find((s) => s.id === c.telegraph?.skillId);
      c.telegraph = undefined;
      if (skill) this.resolveMonsterSkill(rng, c, def, skill);
      return;
    }

    const target = this.selectByThreat(c);
    if (!target) return;
    c.targetId = target.id;

    // Close if out of reach — this is what makes a ranged monster meaningfully different.
    const reach = this.deps.balance.movement.rangeBands[def.rangeBand];
    if (distanceBetween(c, target) > reach) {
      const direction = target.position > c.position ? 1 : -1;
      c.position += direction * this.deps.balance.movement.unitsPerSecond * dt;
      return;
    }

    if (c.attackCooldown > 0) return;

    const phase = def.phases[c.phase - 1];
    const cooldownMultiplier = phase?.cooldownMultiplier ?? 1;

    const ready = def.skills.find((s) => (c.cooldowns.get(s.id) ?? 0) <= 0);
    if (ready) {
      c.cooldowns.set(ready.id, ready.cooldown * cooldownMultiplier);
      if (ready.telegraphSeconds !== undefined) {
        c.telegraph = { skillId: ready.id, remaining: ready.telegraphSeconds };
        this.record(c, `${c.name} begins ${ready.name}.`, true, ['telegraph']);
        return;
      }
      this.resolveMonsterSkill(rng, c, def, ready);
      return;
    }

    c.attackCooldown = def.attackCooldown * cooldownMultiplier;
    const result = this.damage.resolve(rng, {
      attacker: c,
      defender: target,
      type: 'physical',
      power: 1,
    });
    this.landAttack(rng, c, target, result.hit ? result.amount : 0, result.critical, 'a strike');
  }

  private resolveMonsterSkill(
    rng: Rng,
    caster: Combatant,
    def: MonsterDef,
    skill: MonsterDef['skills'][number],
  ): void {
    if (skill.healPower !== undefined && skill.healPower > 0) {
      const hurt = this.monsters
        .filter((m) => !m.dead && healthFraction(m) < 1)
        .sort((a, b) => healthFraction(a) - healthFraction(b))[0];
      if (hurt) {
        const healed = Math.round(stat(caster, 'magicAttack', 20) * skill.healPower);
        hurt.health = Math.min(hurt.maxHealth, hurt.health + healed);
        this.record(caster, `${caster.name} mended ${hurt.name}.`, false, ['monster_heal']);
      }
      return;
    }

    const phase = def.phases[caster.phase - 1];
    const power = skill.power * (phase?.attackMultiplier ?? 1);
    const targets = skill.aoe
      ? this.guild.filter((c) => !c.dead && !c.downed)
      : [this.selectByThreat(caster)].filter((c): c is Combatant => c !== undefined);

    // A telegraph that never reports landing leaves the replay timeline with a wind-up and
    // no payoff, which reads as the boss having done nothing (REQ-UX-004).
    if (skill.telegraphSeconds !== undefined) {
      this.record(
        caster,
        targets.length === 0
          ? `${skill.name} found nothing.`
          : `${skill.name} lands on ${targets.map((t) => t.name).join(', ')}.`,
        true,
        ['telegraph_resolved'],
      );
    }

    for (const target of targets) {
      const result = this.damage.resolve(rng, {
        attacker: caster,
        defender: target,
        type: 'physical',
        power,
      });
      this.landAttack(rng, caster, target, result.hit ? result.amount : 0, result.critical, skill.name);

      if (result.hit && skill.status && skill.statusChance !== undefined) {
        this.applyStatus(rng, target, skill.status, skill.statusChance, caster);
      }
    }
  }

  /**
   * REQ-AI-003/004: highest threat, for every monster including bosses.
   * A boss that must ignore threat declares an explicit exception in its data rather than
   * bypassing this.
   */
  private selectByThreat(monster: Combatant): Combatant | undefined {
    const living = this.guild.filter(isActive);
    if (living.length === 0) return undefined;

    // REQ-AI-006 applies to hunters, not monsters — but a monster still holds its target
    // while that target lives, so threat changes cause *pressure*, not instant flipping.
    const locked = living.find((c) => c.id === monster.targetId);
    const highest = living.reduce((best, c) =>
      threatAgainst(c, monster.id) > threatAgainst(best, monster.id) ? c : best,
    );

    if (!locked) return highest;
    // Only switch when the challenger clearly leads, so threat is sticky rather than jittery.
    return threatAgainst(highest, monster.id) > threatAgainst(locked, monster.id) * 1.3
      ? highest
      : locked;
  }

  private updatePhase(c: Combatant, def: MonsterDef): void {
    const fraction = healthFraction(c);
    let phase = 0;
    for (const [index, definition] of def.phases.entries()) {
      if (fraction <= definition.belowHealthFraction) phase = index + 1;
    }
    if (phase === c.phase) return;

    c.phase = phase;
    const name = def.phases[phase - 1]?.name;
    if (name) this.record(c, `${c.name} enters ${name}.`, true, ['boss_phase']);
  }

  // -------------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------------

  private landAttack(
    rng: Rng,
    attacker: Combatant,
    target: Combatant,
    amount: number,
    critical: boolean,
    label: string,
  ): void {
    if (amount <= 0) {
      this.record(attacker, `${attacker.name} missed ${target.name}.`, false, ['missed']);
      return;
    }

    this.applyDamage(rng, target, amount, attacker.id, label);
    addThreat(attacker, target.id, amount * this.deps.balance.threat.perDamage);

    if (critical) {
      this.record(attacker, `${attacker.name} landed a critical ${label} on ${target.name}.`, true, [
        'critical_hit',
      ]);
    }
  }

  private applyDamage(
    _rng: Rng,
    target: Combatant,
    amount: number,
    sourceId: string,
    label: string,
  ): void {
    if (target.dead || target.downed) return;

    target.health -= amount;
    target.secondsSinceAttacked = 0;

    if (target.health > 0) return;

    target.health = 0;

    if (target.side === 'monster') {
      target.dead = true;
      this.record(target, `${target.name} fell to ${label}.`, true, ['monster_defeated']);
      // REQ-AI-006 / DL-004: this is the moment a hunter may retarget.
      for (const hunter of this.guild) {
        if (hunter.targetId === target.id) hunter.targetId = undefined;
      }

      const def = target.monsterId ? this.deps.monsterOf(target.monsterId) : undefined;
      if (def?.tier === 'boss') {
        // Everyone who was still standing for it earns the memory.
        for (const hunter of this.guild) {
          if (hunter.hunterId && !hunter.dead) {
            this.deps.events?.emit('combat.bossDefeated', {
              hunterId: hunter.hunterId,
              bossId: def.id,
              worldBoss: def.id === this.deps.worldBossId,
            });
          }
        }
      }
      return;
    }

    // REQ-CBT-012: a hunter at zero is Downed, not dead. Rescue is still possible.
    target.downed = true;
    target.downedRemaining = this.deps.balance.downed.timerSeconds;
    target.rescuingId = undefined;
    this.record(target, `${target.name} went down.`, true, ['downed', `source:${sourceId}`]);
    if (target.hunterId) this.deps.events?.emit('combat.nearDeath', { hunterId: target.hunterId });
  }

  private applyStatus(
    rng: Rng,
    target: Combatant,
    statusId: string,
    chance: number,
    source: Combatant,
  ): void {
    const def = this.deps.statusOf(statusId);
    if (!def) return;

    // REQ-CBT-010: generic resistance is a boss-side stat only.
    const resistance = stat(target, 'statusResistance', 0);
    if (!rng.bool(Math.max(0, chance * (1 - resistance)))) return;

    // REQ-CBT-009: hard CC diminishes and eventually stops landing.
    let duration = def.durationSeconds;
    if (def.tier === 'hard' && def.diminishing) {
      const history = target.ccHistory.get(statusId);
      const applications = history && history.windowEndsAt > this.elapsed ? history.applications : 0;

      if (applications >= def.diminishing.immuneAfterApplications) return;
      duration *= Math.pow(1 - def.diminishing.reductionPerApplication, applications);

      target.ccHistory.set(statusId, {
        applications: applications + 1,
        windowEndsAt: this.elapsed + def.diminishing.windowSeconds,
      });
    }

    const existing = target.statuses.find((s) => s.statusId === statusId);
    if (existing) {
      existing.remainingSeconds = duration;
      if (def.stacking === 'stack') existing.stacks = Math.min(def.maxStacks, existing.stacks + 1);
      return;
    }

    target.statuses.push({
      statusId,
      stacks: 1,
      remainingSeconds: duration,
      nextTickIn: def.tickSeconds ?? 0,
      sourceAttack: stat(source, 'physicalAttack', 10),
      sourceId: source.id,
    });
  }

  private skillIsAoe(monster: Combatant): boolean {
    const def = monster.monsterId ? this.deps.monsterOf(monster.monsterId) : undefined;
    const skill = def?.skills.find((s) => s.id === monster.telegraph?.skillId);
    return skill?.aoe ?? false;
  }

  // -------------------------------------------------------------------------
  // Outcome
  // -------------------------------------------------------------------------

  private checkOutcome(): void {
    if (this.monsters.every((m) => m.dead)) {
      this.finished = 'victory';
      return;
    }
    if (this.guild.every((c) => c.dead || c.downed)) {
      this.finished = 'defeat';
      return;
    }

    // Everyone still standing has decided to leave. Ending here rather than letting them
    // kite to the encounter cap is what gives retreat a consequence: the party keeps what
    // it has left, abandons the fight, and the expedition decides what that costs.
    //
    // But breaking off is *contested*, and has to be. When the withdrawal completed the
    // instant the last hunter decided to leave, escape was free and unfailable — across 25
    // runs of a hopelessly outmatched party in a BLACK zone, every single one withdrew
    // intact and not one hunter ever died. Permanent death cannot be a rule the AI is
    // always able to opt out of. So the party must *sustain* the withdrawal while the
    // monsters keep acting, and a hunter can still fall during it.
    const standing = this.guild.filter(isActive);
    const allLeaving = standing.length > 0 && standing.every((c) => c.disengaging);

    if (!allLeaving) {
      this.disengagingSince = undefined;
      return;
    }

    if (this.disengagingSince === undefined) {
      this.disengagingSince = this.elapsed;
      this.record(standing[0] as Combatant, 'The party starts to break off.', false, [
        'disengage_started',
      ]);
      return;
    }

    if (this.elapsed - this.disengagingSince < this.deps.balance.movement.disengageSeconds) return;

    this.finished = 'withdrawal';
    this.record(standing[0] as Combatant, 'The party broke contact and pulled out.', true, [
      'party_withdrew',
    ]);
  }

  private result(): EncounterResult {
    const xp = this.monsters
      .filter((m) => m.dead)
      .reduce((sum, m) => sum + (this.deps.monsterOf(m.monsterId ?? '')?.xp ?? 0), 0);

    return {
      outcome: this.finished,
      elapsedSeconds: this.elapsed,
      log: this.log,
      survivors: this.guild.filter(isActive),
      downed: this.guild.filter((c) => c.downed),
      dead: this.guild.filter((c) => c.dead),
      xp,
    };
  }

  private record(
    actor: Combatant,
    text: string,
    highlight: boolean,
    reasonCodes: readonly string[],
  ): void {
    this.log.push({
      atSeconds: Math.round(this.elapsed * 10) / 10,
      actorId: actor.id,
      text,
      highlight,
      reasonCodes,
    });
  }
}
