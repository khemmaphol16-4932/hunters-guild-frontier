/**
 * The Guild Report (REQ-UX-006, REQ-OFF-005).
 *
 * What happened while the player was not watching — offline, or across a stretch of live
 * time — in the order the design lists it: expeditions, deaths, injuries, rare loot,
 * discoveries, contracts, attacks, chronicle events, reputation, research and the economy.
 *
 * A recorder rather than a query: it listens to the same domain events the Chronicle and the
 * Monument hear, and diffs the ledger and reputation across the window. Nothing here decides
 * anything. The report is the account; the systems already acted.
 */

import type { Session } from './Session.js';
import type { HunterId, ItemId } from '../core/ids.js';

export interface ReportExpedition {
  readonly regionName: string;
  readonly summary: string;
  readonly completed: boolean;
  readonly wiped: boolean;
}

export interface GuildReport {
  readonly steps: number;
  readonly offline: boolean;
  readonly headline: string;
  readonly expeditions: readonly ReportExpedition[];
  /** Standing orders that could not run, and why (REQ-OFF-003/004). */
  readonly skippedOrders: readonly string[];
  readonly deaths: readonly string[];
  readonly injuries: readonly string[];
  readonly rareLoot: readonly string[];
  readonly discoveries: readonly string[];
  readonly contracts: readonly string[];
  readonly defenses: readonly { readonly summary: string; readonly held: boolean }[];
  /** Defenses the walls did not hold. */
  readonly breaches: number;
  readonly hunts: { readonly outings: number; readonly won: number };
  readonly chronicle: readonly string[];
  readonly reputation: { readonly from: number; readonly to: number };
  readonly research: readonly string[];
  readonly stagesReached: readonly string[];
  readonly population: { readonly from: number; readonly to: number };
  /** Net change per resource over the window, zero changes omitted. */
  readonly economy: Readonly<Record<string, number>>;
  readonly crafted: readonly string[];
  readonly recovered: number;
  /** Buildings the Guild AI rebuilt, and ones it could not afford to. */
  readonly repairs: readonly string[];
}

export class ReportRecorder {
  private readonly startTick: number;
  private readonly startResources: Readonly<Record<string, number>>;
  private readonly startReputation: number;
  private readonly startPopulation: number;
  private readonly names = new Map<string, string>();
  private readonly unsubscribes: (() => void)[] = [];

  private steps = 0;
  private readonly expeditions: ReportExpedition[] = [];
  private readonly skipped: string[] = [];
  private readonly deaths: string[] = [];
  private readonly injuries: string[] = [];
  private readonly rareLoot: string[] = [];
  private readonly discoveries: string[] = [];
  private readonly contracts = new Map<string, string>();
  private readonly defenses: { summary: string; held: boolean }[] = [];
  private huntsOut = 0;
  private huntsWon = 0;
  private readonly research: string[] = [];
  private readonly stages: string[] = [];
  private readonly crafted: string[] = [];
  private recovered = 0;
  private breaches = 0;
  private readonly repairs: string[] = [];

  constructor(private readonly session: Session, private readonly offline: boolean) {
    this.startTick = session.clock.tick;
    this.startResources = session.resources.all();
    this.startReputation = session.reputation.current;
    this.startPopulation = session.population.size;
    for (const hunter of session.roster.all()) this.names.set(hunter.id, hunter.name);

    const events = session.events;
    this.unsubscribes.push(
      events.on('loot.rareFound', ({ itemId, rarity }) => {
        const item = session.armoury.get(itemId as ItemId);
        const line = `${item?.name ?? itemId} (${rarity})`;
        if (!this.rareLoot.includes(line)) this.rareLoot.push(line);
      }),
      events.on('zone.firstEntered', ({ zoneId }) => {
        const name = session.content.worldRegionsById.get(zoneId)?.name ?? zoneId;
        if (!this.discoveries.includes(name)) this.discoveries.push(name);
      }),
      events.on('contract.completed', ({ contractId, name, succeeded }) => {
        this.contracts.set(contractId, `${succeeded ? 'Completed' : 'Failed'}: ${name}`);
      }),
      events.on('research.completed', ({ name }) => { this.research.push(name); }),
      events.on('town.stageReached', ({ name }) => { this.stages.push(name); }),
    );
  }

  addSteps(steps: number): void { this.steps += steps; }
  noteSkipped(reason: string): void { if (!this.skipped.includes(reason)) this.skipped.push(reason); }
  noteRecovered(count: number): void { this.recovered += count; }
  noteCrafted(names: readonly string[]): void { this.crafted.push(...names); }
  noteRepair(line: string): void { this.repairs.push(line); }

  noteExpedition(entry: ReportExpedition, aftermath: readonly { hunterId: HunterId; died: boolean; injured: boolean }[]): void {
    this.expeditions.push(entry);
    for (const after of aftermath) {
      const name = this.names.get(after.hunterId) ?? this.session.roster.get(after.hunterId)?.name ?? after.hunterId;
      if (after.died) this.deaths.push(`${name}, in ${entry.regionName}`);
      else if (after.injured) this.injuries.push(`${name}, in ${entry.regionName}`);
    }
  }

  noteHunts(results: readonly { won: boolean }[]): void {
    this.huntsOut += results.length;
    this.huntsWon += results.filter((r) => r.won).length;
  }

  noteDefense(summary: string, held: boolean): void {
    this.defenses.push({ summary, held });
    if (!held) this.breaches += 1;
  }

  finish(): GuildReport {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes.length = 0;

    const endResources = this.session.resources.all();
    const economy: Record<string, number> = {};
    for (const [id, amount] of Object.entries(endResources)) {
      const delta = Math.round((amount - (this.startResources[id] ?? 0)) * 10) / 10;
      if (delta !== 0) economy[id] = delta;
    }

    // Major and historic Chronicle entries written inside the window (v1.0 §11 levels).
    const chronicle: string[] = [];
    for (const record of this.session.chronicle.all()) {
      const name = this.names.get(record.hunterId) ?? this.session.roster.get(record.hunterId)?.name ?? record.hunterId;
      for (const entry of record.notable) {
        if (entry.tick > this.startTick && entry.level !== 'minor') chronicle.push(`${name}: ${entry.text}`);
      }
    }

    const report: Omit<GuildReport, 'headline'> = {
      breaches: this.breaches,
      steps: this.steps,
      offline: this.offline,
      expeditions: this.expeditions,
      skippedOrders: this.skipped,
      deaths: this.deaths,
      injuries: this.injuries,
      rareLoot: this.rareLoot,
      discoveries: this.discoveries,
      contracts: [...this.contracts.values()],
      defenses: this.defenses,
      hunts: { outings: this.huntsOut, won: this.huntsWon },
      chronicle: chronicle.slice(0, 20),
      reputation: { from: this.startReputation, to: this.session.reputation.current },
      research: this.research,
      stagesReached: this.stages,
      population: { from: this.startPopulation, to: this.session.population.size },
      economy,
      crafted: this.crafted,
      recovered: this.recovered,
      repairs: this.repairs,
    };
    return { ...report, headline: headline(report) };
  }
}

/** One sentence, most important thing first (REQ-UX-005's priority, applied to prose). */
function headline(report: Omit<GuildReport, 'headline'>): string {
  if (report.deaths.length > 0) {
    return `${report.deaths.length} hunter${report.deaths.length === 1 ? '' : 's'} did not come home.`;
  }
  if (report.breaches > 0) return `The walls were breached ${report.breaches === 1 ? 'once' : `${report.breaches} times`}.`;
  if (report.stagesReached.length > 0) return `The town became a ${report.stagesReached.at(-1)}.`;
  if (report.rareLoot.length > 0) return `The guild found ${report.rareLoot[0]}.`;
  if (report.expeditions.length > 0) return `${report.expeditions.length} expedition${report.expeditions.length === 1 ? '' : 's'} went out; everyone came home.`;
  if (report.steps > 0) return 'A quiet stretch. The town kept working.';
  return 'Nothing has happened yet.';
}
