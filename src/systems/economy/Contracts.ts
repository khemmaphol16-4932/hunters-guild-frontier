import { err, ok, type Result } from '../../core/result.js';
import type { Rng } from '../../core/rng.js';
import type { ContractData, ContractTemplate } from '../../data/contractSchema.js';
import type { CapabilityAxis } from '../../data/progressionSchema.js';
import type { Role } from '../../data/schema.js';

/** A template offered to the guild. `id` is the template; `offerId` is this particular offer. */
export interface ContractOffer extends ContractTemplate {
  readonly offerId: string;
  readonly clientName: string;
}

export interface ContractAnalysis {
  readonly offer: ContractOffer;
  readonly recommendation: 'ready' | 'risky' | 'unavailable';
  readonly reasons: readonly string[];
}

/** A contract the guild is not yet trusted with, and what it would take (progressive disclosure). */
export interface LockedContract {
  readonly template: ContractTemplate;
  readonly clientName: string;
  readonly missing: readonly string[];
}

export interface ContractsSnapshot {
  readonly offers: readonly ContractOffer[];
  readonly active: ContractOffer | undefined;
  readonly sequence: number;
  /** When clients last posted work. Absent in saves before v22. */
  readonly refreshedAtTick?: number;
}

/** A party member as a challenge contract sees them. */
export interface ChallengeMember {
  readonly name: string;
  readonly level: number;
  readonly role: Role;
}

export interface ContractsDeps {
  readonly data: ContractData;
  readonly regionLevel: (id: string) => number | undefined;
  readonly rosterLevels: () => readonly number[];
  readonly capability: () => Readonly<Record<CapabilityAxis, number>>;
  readonly reputation: () => number;
  readonly standing: (factionId: string) => number;
  readonly currentTick: () => number;
  readonly ticksPerStep: () => number;
}

/**
 * The contract board (REQ-CON-001, REQ-CAP-001, REQ-END-004).
 *
 * The Guild AI analyses; only the player accepts. One contract is active at a time, and an
 * expedition to the contract's region with its objective resolves it.
 *
 * **Who offers what** follows the guild's record. Each template names the reputation,
 * capability readings and client standing it needs; the board draws from the templates the
 * guild currently qualifies for, weighted toward the higher tiers it has earned. This is the
 * sentence in REQ-CAP-001 that the first version skipped — capability "drives contract
 * generation" — and it is also what gives the capability vector a consumer beyond a readout.
 *
 * **When** follows the clock: clients post new work every `board.refreshSteps` coarse steps.
 * The first board used the same three offers for the whole save.
 *
 * `abandon` exists because the first version had no way out: accept a contract for a region
 * the guild then never visits and every other contract was blocked for the rest of the save.
 */
export class Contracts {
  private offers: ContractOffer[] = [];
  private current: ContractOffer | undefined;
  private sequence = 1;
  private refreshedAtTick: number | undefined;

  constructor(private readonly deps: ContractsDeps) {}

  /** What stands between the guild and a template. Empty when it qualifies. */
  missingFor(template: ContractTemplate): readonly string[] {
    const missing: string[] = [];
    const req = template.requires;
    const reputation = this.deps.reputation();
    if (req.reputation !== undefined && reputation < req.reputation) {
      missing.push(`reputation ${req.reputation} (the guild has ${reputation.toFixed(1)})`);
    }
    if (req.capability) {
      const vector = this.deps.capability();
      for (const [axis, min] of Object.entries(req.capability) as [CapabilityAxis, number][]) {
        if (vector[axis] < min) missing.push(`${axis} capability ${min} (the guild reads ${vector[axis].toFixed(1)})`);
      }
    }
    if (req.standing !== undefined) {
      const standing = this.deps.standing(template.factionId);
      if (standing < req.standing) {
        missing.push(`standing ${req.standing} with ${this.clientName(template)} (currently ${standing})`);
      }
    }
    return missing;
  }

  /** Templates the guild qualifies for, other than the one it is already working. */
  eligible(): readonly ContractTemplate[] {
    return this.deps.data.templates.filter(
      (template) => template.id !== this.current?.id && this.missingFor(template).length === 0,
    );
  }

  /** The nearest locked work: templates one tier above the best the guild can take. */
  locked(): readonly LockedContract[] {
    const best = Math.max(0, ...this.eligible().map((template) => template.tier));
    return this.deps.data.templates
      .filter((template) => template.tier > best && template.tier <= best + 1)
      .map((template) => ({ template, clientName: this.clientName(template), missing: this.missingFor(template) }))
      .filter((entry) => entry.missing.length > 0);
  }

  /** True when the board is empty or clients are due to post new work. */
  due(): boolean {
    if (this.offers.length === 0) return true;
    if (this.refreshedAtTick === undefined) return true;
    const interval = this.deps.data.board.refreshSteps * this.deps.ticksPerStep();
    return this.deps.currentTick() - this.refreshedAtTick >= interval;
  }

  /**
   * Post a new board: `board.size` offers drawn without replacement from eligible templates,
   * each weighted by its tier so earned work turns up more often than beginner work.
   */
  refresh(rng: Rng): readonly ContractOffer[] {
    const pool = [...this.eligible()];
    const drawn: ContractTemplate[] = [];
    while (drawn.length < this.deps.data.board.size && pool.length > 0) {
      const total = pool.reduce((sum, template) => sum + template.tier, 0);
      let roll = rng.next() * total;
      let index = pool.findIndex((template) => (roll -= template.tier) < 0);
      if (index < 0) index = pool.length - 1;
      const [picked] = pool.splice(index, 1);
      if (picked) drawn.push(picked);
    }
    this.offers = drawn.map((template) => ({
      ...template,
      offerId: `contract_${this.sequence++}`,
      clientName: this.clientName(template),
    }));
    this.refreshedAtTick = this.deps.currentTick();
    return this.available();
  }

  available(): readonly ContractOffer[] { return [...this.offers]; }
  active(): ContractOffer | undefined { return this.current; }

  analyse(offer: ContractOffer): ContractAnalysis {
    const levels = this.deps.rosterLevels();
    const best = Math.max(0, ...levels);
    const needed = this.deps.regionLevel(offer.regionId);
    const reasons = [
      needed === undefined
        ? `best hunter level ${best}; the region's danger is unknown`
        : `best hunter level ${best}; region recommends ${needed}`,
      `${offer.clientName} offers ${offer.reward.gold} gold` +
        (offer.reward.extras ? ` and ${Object.entries(offer.reward.extras).map(([id, n]) => `${n} ${id.replace(/_/g, ' ')}`).join(', ')}` : ''),
    ];
    let recommendation: ContractAnalysis['recommendation'] =
      best === 0 ? 'unavailable' : needed === undefined || best < needed ? 'risky' : 'ready';

    const challenge = offer.challenge;
    if (challenge) {
      reasons.push(`challenge: ${challenge.summary}`);
      if (challenge.maxMemberLevel !== undefined) {
        const qualifying = levels.filter((level) => level <= challenge.maxMemberLevel!).length;
        reasons.push(`${qualifying} hunter(s) at or below level ${challenge.maxMemberLevel}`);
        if (qualifying === 0) recommendation = 'unavailable';
        else if (recommendation === 'ready' && needed !== undefined) {
          const bestQualifying = Math.max(...levels.filter((level) => level <= challenge.maxMemberLevel!));
          if (bestQualifying < needed) recommendation = 'risky';
        }
      }
      if (challenge.maxPartySize !== undefined && recommendation === 'ready') recommendation = 'risky';
    }
    return { offer, recommendation, reasons };
  }

  /** What a party does wrong for a challenge contract. Empty when it complies. */
  challengeViolations(template: ContractTemplate, members: readonly ChallengeMember[]): readonly string[] {
    const challenge = template.challenge;
    if (!challenge) return [];
    const problems: string[] = [];
    if (challenge.maxPartySize !== undefined && members.length > challenge.maxPartySize) {
      problems.push(`at most ${challenge.maxPartySize} hunters may go (the party has ${members.length})`);
    }
    if (challenge.maxMemberLevel !== undefined) {
      for (const member of members) {
        if (member.level > challenge.maxMemberLevel) {
          problems.push(`${member.name} is level ${member.level}; the limit is ${challenge.maxMemberLevel}`);
        }
      }
    }
    for (const role of challenge.forbiddenRoles ?? []) {
      for (const member of members) {
        if (member.role === role) problems.push(`${member.name} would go as a ${role}, which is forbidden`);
      }
    }
    return problems;
  }

  accept(offerId: string): Result<ContractOffer, string> {
    if (this.current) return err('the guild already has an active contract');
    const index = this.offers.findIndex((offer) => offer.offerId === offerId);
    const offer = this.offers[index];
    if (index < 0 || !offer) return err('that contract is no longer offered');
    this.offers.splice(index, 1);
    this.current = offer;
    return ok(offer);
  }

  /** Give up the active contract. The caller applies the standing cost. */
  abandon(): Result<ContractOffer, string> {
    const current = this.current;
    if (!current) return err('the guild has no active contract');
    this.current = undefined;
    return ok(current);
  }

  resolve(regionId: string, objective: string): ContractOffer | undefined {
    if (!this.current || this.current.regionId !== regionId || this.current.objective !== objective) return undefined;
    const done = this.current;
    this.current = undefined;
    return done;
  }

  snapshot(): ContractsSnapshot {
    return {
      offers: this.available(),
      active: this.current,
      sequence: this.sequence,
      ...(this.refreshedAtTick !== undefined ? { refreshedAtTick: this.refreshedAtTick } : {}),
    };
  }

  restore(snapshot: ContractsSnapshot | undefined): void {
    this.offers = snapshot ? [...snapshot.offers] : [];
    this.current = snapshot?.active;
    this.sequence = Math.max(1, snapshot?.sequence ?? 1);
    this.refreshedAtTick = snapshot?.refreshedAtTick;
  }

  private clientName(template: ContractTemplate): string {
    return this.deps.data.factions.find((faction) => faction.id === template.factionId)?.name ?? template.factionId;
  }
}
