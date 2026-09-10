import { err, ok, type Result } from '../../core/result.js';
import type { MarketConfig } from '../../data/economySchema.js';
import type { Resources } from './Resources.js';

export interface MarketQuote { readonly resourceId: string; readonly amount: number; readonly unitPrice: number; readonly total: number; readonly side: 'buy' | 'sell' }
export interface MarketSnapshot { readonly stock: Readonly<Record<string, number>>; readonly priceScale: Readonly<Record<string, number>> }

export class Market {
  private readonly stock = new Map<string, number>();
  private readonly priceScale = new Map<string, number>();
  constructor(private readonly config: MarketConfig, private readonly resources: Resources) {
    for (const [id, good] of Object.entries(config.goods)) { this.stock.set(id, good.startingStock); this.priceScale.set(id, 1); }
  }
  quote(resourceId: string, amount: number, side: 'buy' | 'sell'): Result<MarketQuote, string> {
    const good = this.config.goods[resourceId];
    if (!good) return err(`the market does not trade "${resourceId}"`);
    if (!Number.isInteger(amount) || amount <= 0) return err('trade amount must be a positive whole number');
    const spread = side === 'buy' ? this.config.buyMarkup : this.config.sellMarkdown;
    const unitPrice = Math.max(1, Math.round(good.basePrice * (this.priceScale.get(resourceId) ?? 1) * spread));
    return ok({ resourceId, amount, unitPrice, total: unitPrice * amount, side });
  }
  buy(resourceId: string, amount: number): Result<MarketQuote, string> {
    const quote = this.quote(resourceId, amount, 'buy'); if (!quote.ok) return quote;
    if ((this.stock.get(resourceId) ?? 0) < amount) return err('the market does not have that much in stock');
    const paid = this.resources.transact({ debits: { gold: quote.value.total }, credits: { [resourceId]: amount } }); if (!paid.ok) return err(paid.error);
    this.stock.set(resourceId, (this.stock.get(resourceId) ?? 0) - amount); this.move(resourceId, amount);
    return quote;
  }
  sell(resourceId: string, amount: number): Result<MarketQuote, string> {
    const quote = this.quote(resourceId, amount, 'sell'); if (!quote.ok) return quote;
    const paid = this.resources.transact({ debits: { [resourceId]: amount }, credits: { gold: quote.value.total } }); if (!paid.ok) return err(paid.error);
    this.stock.set(resourceId, (this.stock.get(resourceId) ?? 0) + amount); this.move(resourceId, -amount);
    return quote;
  }
  step(steps: number): void {
    const pull = Math.min(1, Math.max(0, steps) * this.config.reversionPerStep);
    for (const [id, scale] of this.priceScale) this.priceScale.set(id, scale + (1 - scale) * pull);
  }
  snapshot(): MarketSnapshot { return { stock: Object.fromEntries(this.stock), priceScale: Object.fromEntries(this.priceScale) }; }
  restore(snapshot: MarketSnapshot | undefined): void {
    if (!snapshot) return;
    for (const [id, good] of Object.entries(this.config.goods)) { this.stock.set(id, Math.max(0, snapshot.stock[id] ?? good.startingStock)); this.priceScale.set(id, this.clamp(snapshot.priceScale[id] ?? 1)); }
  }
  private move(id: string, units: number): void { this.priceScale.set(id, this.clamp((this.priceScale.get(id) ?? 1) + units * this.config.impactPerUnit)); }
  private clamp(value: number): number { return Math.max(this.config.minPriceScale, Math.min(this.config.maxPriceScale, value)); }
}
