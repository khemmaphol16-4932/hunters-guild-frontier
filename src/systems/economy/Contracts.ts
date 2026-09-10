import { err, ok, type Result } from '../../core/result.js';
import type { ContractData, ContractTemplate } from '../../data/contractSchema.js';
export interface ContractOffer extends ContractTemplate { readonly offerId: string; readonly clientName: string }
export interface ContractAnalysis { readonly offer: ContractOffer; readonly recommendation: 'ready'|'risky'|'unavailable'; readonly reasons: readonly string[] }
export interface ContractsSnapshot { readonly offers: readonly ContractOffer[]; readonly active: ContractOffer | undefined; readonly sequence: number }
export class Contracts {
  private offers: ContractOffer[]=[]; private current: ContractOffer|undefined; private sequence=1;
  constructor(private readonly data: ContractData, private readonly regionLevel:(id:string)=>number|undefined, private readonly rosterLevels:()=>readonly number[]) {}
  refresh(): readonly ContractOffer[] { this.offers=this.data.templates.map(t=>({...t,offerId:`contract_${this.sequence++}`,clientName:this.data.factions.find(f=>f.id===t.factionId)?.name??t.factionId}));return this.available(); }
  available():readonly ContractOffer[]{return [...this.offers]} active():ContractOffer|undefined{return this.current}
  analyse(offer:ContractOffer):ContractAnalysis{const levels=this.rosterLevels();const best=Math.max(0,...levels);const needed=this.regionLevel(offer.regionId)??Infinity;const reasons=[`best hunter level ${best}; region recommends ${needed}`,`${offer.clientName} offers ${offer.reward.gold} gold`];return{offer,recommendation:best===0?'unavailable':best<needed?'risky':'ready',reasons}}
  accept(id:string):Result<ContractOffer,string>{if(this.current)return err('the guild already has an active contract');const i=this.offers.findIndex(o=>o.offerId===id);if(i<0)return err('that contract is no longer offered');const [offer]=this.offers.splice(i,1);if(!offer)return err('that contract is no longer offered');this.current=offer;return ok(offer)}
  resolve(regionId:string,objective:string):ContractOffer|undefined{if(!this.current||this.current.regionId!==regionId||this.current.objective!==objective)return undefined;const done=this.current;this.current=undefined;return done}
  snapshot():ContractsSnapshot{return{offers:this.available(),active:this.current,sequence:this.sequence}} restore(s:ContractsSnapshot|undefined):void{this.offers=s?[...s.offers]:[];this.current=s?.active;this.sequence=Math.max(1,s?.sequence??1)}
}
