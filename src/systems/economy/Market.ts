import { err, ok, type Result } from '../../core/result.js';
import type { MarketConfig } from '../../data/economySchema.js';
import type { Resources } from './Resources.js';

export interface MarketQuote {
  readonly resourceId: string;
  readonly amount: number;
  /** Average price per unit across the order. Not an integer once the order moves the price. */
  readonly unitPrice: number;
  readonly total: number;
  readonly side: 'buy' | 'sell';
}
export interface MarketSnapshot { readonly stock: Readonly<Record<string, number>>; readonly priceScale: Readonly<Record<string, number>> }

/**
 * A small, controlled market (REQ-ECO-005): finite stock, a spread, and prices that move with
 * the guild's own trading inside a clamped band.
 *
 * **Every unit is priced where the price actually is when that unit trades.** An order walks
 * the price one unit at a time, so a large buy pays the rising price it causes and a large
 * sell accepts the falling one. The first version priced the whole order at the pre-trade
 * price and applied the impact afterwards, which made "buy 150, sell 150" earn 300 gold per
 * round trip with no time passing — an infinite-money loop the 1-unit balance soak could not
 * see (DL-046).
 *
 * With per-unit pricing a round trip walks the same stretch of price twice, once up and once
 * down, and at every point on it the buy price exceeds the sell price. `parseEconomy` refuses
 * a config whose spread is too thin for that to hold across a single unit of impact.
 */
export class Market {
  private readonly stock = new Map<string, number>();
  private readonly priceScale = new Map<string, number>();

  constructor(private readonly config: MarketConfig, private readonly resources: Resources) {
    for (const [id, good] of Object.entries(config.goods)) {
      this.stock.set(id, good.startingStock);
      this.priceScale.set(id, 1);
    }
  }

  /** Current price scale for a good — 1 is baseline. Exposed for reports and the balance soak. */
  scaleOf(resourceId: string): number { return this.priceScale.get(resourceId) ?? 1; }
  stockOf(resourceId: string): number { return this.stock.get(resourceId) ?? 0; }

  quote(resourceId: string, amount: number, side: 'buy' | 'sell'): Result<MarketQuote, string> {
    const walked = this.walk(resourceId, amount, side);
    if (!walked.ok) return walked;
    return ok({ resourceId, amount, unitPrice: walked.value.total / amount, total: walked.value.total, side });
  }

  buy(resourceId: string, amount: number): Result<MarketQuote, string> {
    const walked = this.walk(resourceId, amount, 'buy');
    if (!walked.ok) return walked;
    if (this.stockOf(resourceId) < amount) return err('the market does not have that much in stock');
    const paid = this.resources.transact({
      debits: { gold: walked.value.total },
      credits: { [resourceId]: amount },
      overflow: 'reject',
    });
    if (!paid.ok) return err(paid.error);
    this.stock.set(resourceId, this.stockOf(resourceId) - amount);
    this.priceScale.set(resourceId, walked.value.endScale);
    return ok({ resourceId, amount, unitPrice: walked.value.total / amount, total: walked.value.total, side: 'buy' });
  }

  sell(resourceId: string, amount: number): Result<MarketQuote, string> {
    const walked = this.walk(resourceId, amount, 'sell');
    if (!walked.ok) return walked;
    const paid = this.resources.transact({
      debits: { [resourceId]: amount },
      credits: { gold: walked.value.total },
      overflow: 'reject',
    });
    if (!paid.ok) return err(paid.error);
    this.stock.set(resourceId, this.stockOf(resourceId) + amount);
    this.priceScale.set(resourceId, walked.value.endScale);
    return ok({ resourceId, amount, unitPrice: walked.value.total / amount, total: walked.value.total, side: 'sell' });
  }

  step(steps: number): void {
    const pull = Math.min(1, Math.max(0, steps) * this.config.reversionPerStep);
    for (const [id, scale] of this.priceScale) this.priceScale.set(id, scale + (1 - scale) * pull);
    // Merchants restock toward their usual stock, and move on what the guild dumped on them.
    // Stock used to change only through the guild's own trades, so a good bought out once was
    // gone for the rest of the save.
    const restock = Math.min(1, Math.max(0, steps) * this.config.restockPerStep);
    for (const [id, good] of Object.entries(this.config.goods)) {
      const stock = this.stockOf(id);
      const next = stock + (good.startingStock - stock) * restock;
      this.stock.set(id, next > stock ? Math.floor(next) : Math.ceil(next));
    }
  }

  snapshot(): MarketSnapshot { return { stock: Object.fromEntries(this.stock), priceScale: Object.fromEntries(this.priceScale) }; }

  restore(snapshot: MarketSnapshot | undefined): void {
    if (!snapshot) return;
    for (const [id, good] of Object.entries(this.config.goods)) {
      this.stock.set(id, Math.max(0, snapshot.stock[id] ?? good.startingStock));
      this.priceScale.set(id, this.clamp(snapshot.priceScale[id] ?? 1));
    }
  }

  /**
   * Price an order unit by unit without committing it.
   *
   * Buys round the total up and sells round it down, so rounding can only ever favour the
   * market. Once the price reaches its clamp every remaining unit costs the same, so the loop
   * is bounded by the width of the band rather than by the size of the order.
   */
  private walk(resourceId: string, amount: number, side: 'buy' | 'sell'): Result<{ total: number; endScale: number }, string> {
    const good = this.config.goods[resourceId];
    if (!good) return err(`the market does not trade "${resourceId}"`);
    if (!Number.isInteger(amount) || amount <= 0) return err('trade amount must be a positive whole number');

    const spread = side === 'buy' ? this.config.buyMarkup : this.config.sellMarkdown;
    const direction = side === 'buy' ? 1 : -1;
    const bound = side === 'buy' ? this.config.maxPriceScale : this.config.minPriceScale;
    let scale = this.scaleOf(resourceId);
    let sum = 0;
    let remaining = amount;
    while (remaining > 0) {
      if (scale === bound) {
        sum += remaining * good.basePrice * scale * spread;
        break;
      }
      sum += good.basePrice * scale * spread;
      scale = this.clamp(scale + direction * this.config.impactPerUnit);
      remaining -= 1;
    }
    const total = Math.max(1, side === 'buy' ? Math.ceil(sum - 1e-9) : Math.floor(sum + 1e-9));
    return ok({ total, endScale: scale });
  }

  private clamp(value: number): number { return Math.max(this.config.minPriceScale, Math.min(this.config.maxPriceScale, value)); }
}
