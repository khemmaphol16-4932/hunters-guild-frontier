/**
 * A standing expedition order: what the guild does on its own while the player is away
 * (REQ-OFF-001..004), and between the player's own decisions while they are here.
 *
 * REQ-OFF-003 is the reason `allowLethal` exists and defaults to false: hunters can die
 * offline, so the player must say so beforehand. An order into a zone that can kill is
 * skipped — and the Guild Report says it was skipped, and why — unless the player accepted
 * that risk when they wrote the order. REQ-OFF-004 is why nothing here waits for the player:
 * an order that cannot run this time is resolved as "not now", never left pending.
 */

export interface StandingOrder {
  readonly regionId: string;
  readonly objective: string;
  /** Coarse steps between dispatches. */
  readonly everySteps: number;
  /** REQ-OFF-003: the player's standing answer to "may they go where they can die?". */
  readonly allowLethal: boolean;
}

export interface StandingOrdersSnapshot {
  readonly order?: StandingOrder;
  readonly lastDispatchTick?: number;
  /** Whether the Guild AI rebuilds what attacks damage. Absent in older saves (read as on). */
  readonly autoRepair?: boolean;
}

export class StandingOrders {
  private current: StandingOrder | undefined;
  private lastDispatch: number | undefined;
  private repair = true;

  /**
   * REQ-OFF-004: the Guild AI rebuilds damaged buildings itself when the ledger can pay.
   * On by default — a guild that leaves its bunkhouses broken for three days while holding
   * the gold to fix them is not following anyone's policy. The player can turn it off.
   */
  get autoRepair(): boolean { return this.repair; }
  setAutoRepair(on: boolean): void { this.repair = on; }

  get order(): StandingOrder | undefined { return this.current; }

  set(order: StandingOrder | undefined): void {
    this.current = order;
    this.lastDispatch = undefined;
  }

  /** Whether the order is due at `tick`, given the clock's ticks per step. */
  due(tick: number, ticksPerStep: number): boolean {
    if (!this.current) return false;
    if (this.lastDispatch === undefined) return true;
    return tick - this.lastDispatch >= this.current.everySteps * ticksPerStep;
  }

  /** Record an attempt, whether it sent anyone or not — "not now" still counts as resolved. */
  attempted(tick: number): void { this.lastDispatch = tick; }

  snapshot(): StandingOrdersSnapshot {
    return {
      ...(this.current ? { order: this.current } : {}),
      ...(this.lastDispatch !== undefined ? { lastDispatchTick: this.lastDispatch } : {}),
      autoRepair: this.repair,
    };
  }

  restore(snapshot: StandingOrdersSnapshot | undefined): void {
    this.current = snapshot?.order;
    this.lastDispatch = snapshot?.lastDispatchTick;
    this.repair = snapshot?.autoRepair ?? true;
  }
}
