/**
 * The town's physical grid.
 *
 * REQ-TWN-001: the town is *a physical place on a clear grid* — buildings are placed, they
 * occupy cells, and hunters walk between them. That is a stronger claim than it looks. It
 * rules out the shape this system would otherwise drift into: a list of owned buildings with
 * a count, where "placement" is decoration. If a building did not occupy space, nothing
 * would ever be traded off against anything, and the town would be a menu with a picture.
 *
 * So space is the constraint, and it is enforced here rather than in the UI. v1.0 §9 adds
 * four-direction rotation, ghost preview and **free relocation** — moving a building costs
 * nothing, because the design wants the player rearranging their town, not punished for
 * having learned the game since they placed the smithy.
 *
 * This module knows about cells and rectangles and nothing else. What a building *does*
 * belongs to Town; who works in it belongs to Departments. The separation is what keeps
 * REQ-TWN-001 testable without constructing a guild.
 */

import { err, ok, type Result } from '../../core/result.js';
import {
  rotatedFootprint,
  type BuildingDef,
  type Footprint,
  type Rotation,
} from '../../data/townSchema.js';

/** A placed building. `instanceId` exists because a town may hold several bunkhouses. */
export interface Placement {
  readonly instanceId: string;
  readonly buildingId: string;
  /** Top-left cell. */
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly tier: number;
  /**
   * Wrecked by a defense event that went badly (REQ-TWN-008).
   *
   * A damaged building still stands and still occupies its cells — it is a burnt roof, not a
   * cleared plot — but it contributes no capacity and offers no work until it is repaired.
   * Deliberately a boolean rather than a health bar: the player's decision is "repair it or
   * not", and a percentage would imply a granularity nothing else in the town has.
   *
   * Optional so that every save written before defense existed reads as undamaged.
   */
  readonly damaged?: boolean;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface TownGridSnapshot {
  readonly placements: readonly Placement[];
  readonly nextInstance: number;
}

export interface TownGridDeps {
  readonly width: number;
  readonly height: number;
  readonly buildingOf: (buildingId: string) => BuildingDef | undefined;
}

export function rectOf(placement: Placement, footprint: Footprint): Rect {
  const rotated = rotatedFootprint(footprint, placement.rotation);
  return { x: placement.x, y: placement.y, width: rotated.width, height: rotated.height };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

export class TownGrid {
  private readonly placements = new Map<string, Placement>();
  private nextInstance = 1;

  constructor(private readonly deps: TownGridDeps) {}

  get width(): number {
    return this.deps.width;
  }

  get height(): number {
    return this.deps.height;
  }

  all(): readonly Placement[] {
    // Sorted by instance id so a snapshot is stable and two saves of the same town compare
    // equal — the same reason WorldKnowledge sorts its unions.
    return [...this.placements.values()].sort((a, b) =>
      a.instanceId.localeCompare(b.instanceId, 'en'),
    );
  }

  get(instanceId: string): Placement | undefined {
    return this.placements.get(instanceId);
  }

  countOf(buildingId: string): number {
    return this.all().filter((p) => p.buildingId === buildingId).length;
  }

  get size(): number {
    return this.placements.size;
  }

  /** The rectangle a placement occupies, or undefined if its definition is gone. */
  rectFor(placement: Placement): Rect | undefined {
    const def = this.deps.buildingOf(placement.buildingId);
    return def ? rectOf(placement, def.footprint) : undefined;
  }

  /**
   * Whether a rectangle fits — in bounds, and clear of everything except `ignore`.
   *
   * `ignore` is what makes relocation work: a building being moved must not collide with
   * where it currently stands, or nudging it one cell to the left would be illegal.
   */
  fits(rect: Rect, ignore?: string): Result<true, string> {
    if (rect.x < 0 || rect.y < 0) return err('that is off the edge of the town');
    if (rect.x + rect.width > this.width || rect.y + rect.height > this.height) {
      return err(
        `that does not fit inside the town (${this.width}x${this.height}) at ${rect.x},${rect.y}`,
      );
    }

    for (const other of this.all()) {
      if (other.instanceId === ignore) continue;
      const otherRect = this.rectFor(other);
      if (!otherRect) continue;
      if (overlaps(rect, otherRect)) {
        const name = this.deps.buildingOf(other.buildingId)?.name ?? other.buildingId;
        return err(`the ${name} is already standing there`);
      }
    }

    return ok(true);
  }

  /**
   * Where a building could go, as a ghost preview would show it (v1.0 §9).
   * Returned in reading order so "the first free spot" is stable and testable.
   */
  legalPlacements(buildingId: string, rotation: Rotation = 0): readonly Rect[] {
    const def = this.deps.buildingOf(buildingId);
    if (!def) return [];
    const footprint = rotatedFootprint(def.footprint, rotation);

    const out: Rect[] = [];
    for (let y = 0; y + footprint.height <= this.height; y++) {
      for (let x = 0; x + footprint.width <= this.width; x++) {
        const rect = { x, y, width: footprint.width, height: footprint.height };
        if (this.fits(rect).ok) out.push(rect);
      }
    }
    return out;
  }

  /** Place a building. Callers check affordability and unlocks; this checks space. */
  place(
    buildingId: string,
    x: number,
    y: number,
    rotation: Rotation = 0,
    tier = 1,
  ): Result<Placement, string> {
    const def = this.deps.buildingOf(buildingId);
    if (!def) return err(`unknown building "${buildingId}"`);
    if (def.unique && this.countOf(buildingId) > 0) {
      return err(`the town already has a ${def.name}`);
    }
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return err('a building sits on whole cells');
    }

    const footprint = rotatedFootprint(def.footprint, rotation);
    const rect = { x, y, width: footprint.width, height: footprint.height };
    const fits = this.fits(rect);
    if (!fits.ok) return fits;

    const placement: Placement = {
      instanceId: `${buildingId}#${this.nextInstance++}`,
      buildingId,
      x,
      y,
      rotation,
      tier,
    };
    this.placements.set(placement.instanceId, placement);
    return ok(placement);
  }

  /**
   * Move or rotate a placed building. Free, per v1.0 §9.
   *
   * Rotation is part of moving rather than a separate operation because rotating in place
   * can itself collide — a 4x2 longhouse turned sideways needs different cells — and having
   * one path means that check cannot be forgotten in the other.
   */
  relocate(
    instanceId: string,
    x: number,
    y: number,
    rotation?: Rotation,
  ): Result<Placement, string> {
    const current = this.placements.get(instanceId);
    if (!current) return err(`nothing placed as "${instanceId}"`);
    const def = this.deps.buildingOf(current.buildingId);
    if (!def) return err(`unknown building "${current.buildingId}"`);

    const nextRotation = rotation ?? current.rotation;
    const footprint = rotatedFootprint(def.footprint, nextRotation);
    const rect = { x, y, width: footprint.width, height: footprint.height };
    const fits = this.fits(rect, instanceId);
    if (!fits.ok) return fits;

    const moved: Placement = { ...current, x, y, rotation: nextRotation };
    this.placements.set(instanceId, moved);
    return ok(moved);
  }

  /** Raise a placed building to the next tier. */
  setTier(instanceId: string, tier: number): Result<Placement, string> {
    const current = this.placements.get(instanceId);
    if (!current) return err(`nothing placed as "${instanceId}"`);
    const def = this.deps.buildingOf(current.buildingId);
    if (!def) return err(`unknown building "${current.buildingId}"`);
    if (!def.tiers.some((t) => t.tier === tier)) {
      return err(`${def.name} has no tier ${tier}`);
    }

    const raised: Placement = { ...current, tier };
    this.placements.set(instanceId, raised);
    return ok(raised);
  }

  /** Wreck a building (REQ-TWN-008). It keeps its cells and stops contributing. */
  damage(instanceId: string): Result<Placement, string> {
    return this.setDamaged(instanceId, true);
  }

  repair(instanceId: string): Result<Placement, string> {
    return this.setDamaged(instanceId, false);
  }

  /** Everything currently wrecked, so the town panel can list what needs rebuilding. */
  damaged(): readonly Placement[] {
    return this.all().filter((p) => p.damaged === true);
  }

  private setDamaged(instanceId: string, damaged: boolean): Result<Placement, string> {
    const current = this.placements.get(instanceId);
    if (!current) return err(`nothing placed as "${instanceId}"`);

    // Written without the key when undamaged, so a repaired building serialises identically
    // to one that was never hit — the same reason the v4 availability migration omits its
    // optional fields rather than writing nulls.
    const { damaged: _was, ...rest } = current;
    const updated: Placement = damaged ? { ...rest, damaged: true } : { ...rest };
    this.placements.set(instanceId, updated);
    return ok(updated);
  }

  remove(instanceId: string): Result<Placement, string> {
    const current = this.placements.get(instanceId);
    if (!current) return err(`nothing placed as "${instanceId}"`);
    this.placements.delete(instanceId);
    return ok(current);
  }

  /**
   * A text map of the town, one character per cell.
   *
   * Presentation is Phase 9 and this is not it — it exists so a test can assert the town's
   * *shape* rather than its placement list, and so the debug console can print a town. A
   * footprint bug is obvious in a grid and invisible in a list of coordinates.
   */
  render(): readonly string[] {
    const cells: string[][] = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => '.'),
    );

    for (const placement of this.all()) {
      const rect = this.rectFor(placement);
      if (!rect) continue;
      const glyph = placement.buildingId[0]?.toUpperCase() ?? '?';
      for (let y = rect.y; y < rect.y + rect.height; y++) {
        for (let x = rect.x; x < rect.x + rect.width; x++) {
          const row = cells[y];
          if (row) row[x] = glyph;
        }
      }
    }

    return cells.map((row) => row.join(''));
  }

  /** Cells not covered by any building. */
  freeCells(): number {
    let used = 0;
    for (const placement of this.all()) {
      const rect = this.rectFor(placement);
      if (rect) used += rect.width * rect.height;
    }
    return this.width * this.height - used;
  }

  clear(): void {
    this.placements.clear();
    this.nextInstance = 1;
  }

  snapshot(): TownGridSnapshot {
    return { placements: this.all(), nextInstance: this.nextInstance };
  }

  restore(snapshot: TownGridSnapshot | undefined): void {
    this.clear();
    for (const placement of snapshot?.placements ?? []) {
      // Restored without re-checking fit. A save is history, not a proposal: refusing to
      // load a town because a later content change shrank the grid would cost the player
      // their guild, and REQ-TEC-004 puts the save above the invariant here.
      this.placements.set(placement.instanceId, placement);
    }
    this.nextInstance = Math.max(
      snapshot?.nextInstance ?? 1,
      // Defensive: a save written before instance numbering changed must not reissue an id.
      ...[...this.placements.keys()].map((id) => Number(id.split('#')[1] ?? 0) + 1),
      1,
    );
  }
}
