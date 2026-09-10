import { ContentValidationError } from './schema.js';
import type { EconomyReward } from './economySchema.js';
export interface FactionDef { readonly id: string; readonly name: string }
export interface ContractTemplate { readonly id: string; readonly name: string; readonly factionId: string; readonly regionId: string; readonly objective: 'clear' | 'survive' | 'slay'; readonly reward: EconomyReward; readonly reputation: number }
export interface ContractData { readonly factions: readonly FactionDef[]; readonly templates: readonly ContractTemplate[] }
export function parseContracts(raw: unknown): ContractData {
  if (typeof raw !== 'object' || raw === null) throw new ContentValidationError('contracts.json', 'must be an object');
  const root = raw as Record<string, unknown>; const factionsRaw = root['factions']; const templatesRaw = root['templates'];
  if (!Array.isArray(factionsRaw) || !Array.isArray(templatesRaw)) throw new ContentValidationError('contracts.json', 'factions and templates must be arrays');
  const str = (o: Record<string, unknown>, k: string, p: string): string => { const v=o[k]; if(typeof v!=='string'||!v) throw new ContentValidationError(`${p}.${k}`,'must be a string'); return v; };
  const factions = factionsRaw.map((v,i):FactionDef=>{if(typeof v!=='object'||v===null)throw new ContentValidationError(`contracts.json.factions[${i}]`,'must be an object');const o=v as Record<string,unknown>;return{id:str(o,'id',`factions[${i}]`),name:str(o,'name',`factions[${i}]`)}});
  const templates = templatesRaw.map((v,i):ContractTemplate=>{const p=`contracts.json.templates[${i}]`;if(typeof v!=='object'||v===null)throw new ContentValidationError(p,'must be an object');const o=v as Record<string,unknown>;const objective=str(o,'objective',p);if(!['clear','survive','slay'].includes(objective))throw new ContentValidationError(`${p}.objective`,'invalid objective');const rr=o['reward'];if(typeof rr!=='object'||rr===null)throw new ContentValidationError(`${p}.reward`,'must be an object');const r=rr as Record<string,unknown>;const num=(x:unknown,path:string)=>{if(typeof x!=='number'||x<0)throw new ContentValidationError(path,'must be non-negative');return x};return{id:str(o,'id',p),name:str(o,'name',p),factionId:str(o,'factionId',p),regionId:str(o,'regionId',p),objective:objective as ContractTemplate['objective'],reward:{gold:num(r['gold'],`${p}.reward.gold`),food:num(r['food'],`${p}.reward.food`),materials:num(r['materials'],`${p}.reward.materials`)},reputation:num(o['reputation'],`${p}.reputation`)}});
  return { factions, templates };
}
