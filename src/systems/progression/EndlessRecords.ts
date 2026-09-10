/**
 * Personal records for endless expeditions (REQ-END-003).
 *
 * One best per region and objective: how deep, when, and who went. REQ-END-003 makes records
 * personal — the guild against its own history — so there is no ranking, no global board and
 * no score beyond the depth itself.
 *
 * Records survive New Game+. They are the player's history rather than the world's, and a
 * new generation trying to beat the old one's depth is exactly the kind of legacy goal v1.0
 * §12 asks endgame to favour.
 */

export interface EndlessRecord {
  readonly regionId: string;
  readonly objectiveId: string;
  readonly depth: number;
  readonly routesCleared: number;
  readonly tick: number;
  readonly cycle: number;
  readonly party: readonly string[];
}

export interface EndlessRecordsSnapshot { readonly records: readonly EndlessRecord[] }

export interface RecordOutcome {
  readonly improved: boolean;
  readonly previous: EndlessRecord | undefined;
  readonly current: EndlessRecord;
}

export class EndlessRecords {
  private readonly best = new Map<string, EndlessRecord>();

  get(regionId: string, objectiveId: string): EndlessRecord | undefined {
    return this.best.get(key(regionId, objectiveId));
  }

  all(): readonly EndlessRecord[] {
    return [...this.best.values()].sort(
      (a, b) => b.depth - a.depth || a.regionId.localeCompare(b.regionId) || a.objectiveId.localeCompare(b.objectiveId),
    );
  }

  /** Offer a run. It becomes the record only if it went deeper (ties go to the earlier run). */
  submit(run: EndlessRecord): RecordOutcome {
    const previous = this.get(run.regionId, run.objectiveId);
    if (previous && previous.depth >= run.depth) return { improved: false, previous, current: previous };
    this.best.set(key(run.regionId, run.objectiveId), run);
    return { improved: true, previous, current: run };
  }

  snapshot(): EndlessRecordsSnapshot { return { records: this.all() }; }

  restore(snapshot: EndlessRecordsSnapshot | undefined): void {
    this.best.clear();
    for (const record of snapshot?.records ?? []) this.best.set(key(record.regionId, record.objectiveId), record);
  }
}

function key(regionId: string, objectiveId: string): string {
  return `${regionId}|${objectiveId}`;
}
