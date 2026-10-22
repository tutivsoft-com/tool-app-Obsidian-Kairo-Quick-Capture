import { App, Notice } from "obsidian";
import { diagnostics } from "./diagnostics";
import { requestAuthenticatedBilling } from "./constance-account";
import { CONSTANCE_API, BILLING_UNIT } from "./constance-v2";
import { addLivePacks, joinPublicPacks } from "./billing-catalog";
export type NativeDimensions = Record<string,number>;
export type WriteEvidence = {path:string;binary?:boolean;before?:string;after?:string;marker?:string};
export type Journal = {protocol?:string;event_id:string;app_id:string;source_digest:string;result_digest:string;amount:number;
  free_units:number;paid_units:number;state:string;account:string;dimensions:NativeDimensions;evidence?:WriteEvidence[];operation_id?:string};
type State = {billingEmail:string;billingAccessToken:string;billingRefreshToken:string;
  billingAccountLinked:boolean;constanceDeviceId:string;operationJournal?:Journal[];pendingSpendEvents?:unknown[];pendingFreeUsageEvents?:unknown[]};
export type NativeHost={app:App;settings:State;persistNative():Promise<void>;syncBalance?():Promise<void>};
export interface NativeReservation {source:"free"|"purchased";markWriting(evidence?:WriteEvidence[]):Promise<boolean>;commit():Promise<{kind:"committed"|"pending"}>;rollback():Promise<void>}
export async function digest(value:string|ArrayBuffer):Promise<string>{
  const bytes=typeof value==="string"?new TextEncoder().encode(value):value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
}
export function codePoints(value:string):number{return Array.from(value).length;}
export function nativeCost(appId:string,d:NativeDimensions):number{if(appId==="cairn-vault-linter")return Math.max(1,Math.ceil(d.files/5),Math.ceil(d.edits/20));if(appId==="meridian-timeline")return Math.max(1,Math.ceil(d.notes/20));return 1;}
export function jobId():string{return "v2native_"+crypto.randomUUID();}
const pendingStates=["requesting","reserved","writing","verified","uncertain_released"];
const owner=(host:NativeHost)=>host.settings.billingEmail.trim().toLowerCase();
async function api(host:NativeHost,path:string,body?:unknown):Promise<any>{
  const response=await requestAuthenticatedBilling(host.settings,()=>host.persistNative(),{url:CONSTANCE_API+path,
    method:body===undefined?"GET":"POST",throw:false,...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(response.status<200||response.status>=300||!response.json?.data)throw new Error("Your account could not be verified. Your saved operation will be retried safely.");
  return response.json.data;
}
function validate(row:any,journal:Journal):void{
  if(row?.app_id!==journal.app_id||row.unit!==BILLING_UNIT||row.units!==journal.amount||typeof row.operation_id!=="string"||!row.operation_id
    ||journal.operation_id&&journal.operation_id!==row.operation_id||!["reserved","committed","released","denied"].includes(row.state)
    ||!Number.isSafeInteger(row.free_units)||!Number.isSafeInteger(row.paid_units)||row.free_units<0||row.paid_units<0
    ||(["reserved","committed"].includes(row.state)&&row.free_units+row.paid_units!==journal.amount)
    ||journal.free_units>=0&&(journal.free_units!==row.free_units||journal.paid_units!==row.paid_units))throw new Error("The operation receipt did not match the saved conversion.");
  journal.operation_id=row.operation_id;journal.free_units=row.free_units;journal.paid_units=row.paid_units;
}
async function reserve(host:NativeHost,journal:Journal):Promise<any>{
  const row=await api(host,"/billing/operations",{app_id:journal.app_id,unit:BILLING_UNIT,units:journal.amount,retry_key:journal.event_id});
  if(owner(host)!==journal.account||!host.settings.billingAccountLinked)throw new Error("The account changed during confirmation.");
  validate(row,journal);await host.persistNative();return row;
}
async function settle(host:NativeHost,journal:Journal,action:string):Promise<any>{
  if(owner(host)!==journal.account||!host.settings.billingAccountLinked)throw new Error("Reconnect the original account.");
  if(!journal.operation_id)throw new Error("The saved operation has no verified identity.");
  const row=await api(host,"/billing/operations/"+encodeURIComponent(journal.operation_id)+"/"+action,{});
  if(owner(host)!==journal.account||!host.settings.billingAccountLinked)throw new Error("The account changed during confirmation.");
  validate(row,journal);return row;
}
async function writesMatch(host:NativeHost,journal:Journal):Promise<boolean>{
  if(!journal.evidence?.length)return false;
  for(const evidence of journal.evidence){
    try{
      const adapter=host.app.vault.adapter;
      const value=evidence.binary?await adapter.readBinary(evidence.path):await adapter.read(evidence.path);
      if(evidence.marker&&typeof value==="string"&&value.includes(evidence.marker))continue;
      if(await digest(value)!==evidence.after)return false;
    }catch(_){return false;}
  }
  return true;
}
export async function recoverNative(host:NativeHost):Promise<void>{
  if(!host.settings.billingAccountLinked)return;
  for(const journal of host.settings.operationJournal||[]){
    if(journal.protocol!=="v2"||journal.account!==owner(host)||!pendingStates.includes(journal.state))continue;
    try{
      const row=journal.operation_id?await api(host,"/billing/operations/"+encodeURIComponent(journal.operation_id)):await reserve(host,journal);
      validate(row,journal);
      if(row.state==="committed"||row.state==="denied")journal.state=row.state;
      else if(row.state==="released")journal.state=journal.evidence?.length?"uncertain_released":"released";
      else if(journal.state==="verified"||journal.state==="writing"&&await writesMatch(host,journal)){
        if((await settle(host,journal,"commit")).state==="committed")journal.state="committed";
      }else if(journal.state==="requesting")journal.state="reserved";
      await host.persistNative();
    }catch(error){diagnostics.failure("native.recover",error);}
  }
}
export async function reserveLegacyNative(..._args:unknown[]):Promise<NativeReservation|null>{
  new Notice("An older conversion is unresolved. Connect its original account and contact support before starting another conversion.");return null;
}
export async function reserveNative(host:NativeHost,appId:string,eventId:string,source:string,result:string,dimensions:NativeDimensions,reveal=false):Promise<NativeReservation|null>{
  try{
    const state=host.settings;if(!state.billingAccountLinked)throw new Error("Connect your account in plugin settings first.");
    await recoverNative(host);
    if(state.pendingSpendEvents?.length||state.pendingFreeUsageEvents?.length||(state.operationJournal||[]).some(j=>j.protocol!=="v2"&&pendingStates.includes(j.state)))return reserveLegacyNative();
    const account=owner(host),source_digest=await digest(source),result_digest=await digest(result);
    let journal=(state.operationJournal||[]).find(j=>j.event_id===eventId||j.protocol==="v2"&&j.account===account&&j.source_digest===source_digest&&j.result_digest===result_digest&&pendingStates.includes(j.state));
    if(journal&&(journal.protocol!=="v2"||journal.account!==account||journal.app_id!==appId||journal.source_digest!==source_digest||journal.result_digest!==result_digest||JSON.stringify(journal.dimensions)!==JSON.stringify(dimensions)))throw new Error("The saved conversion belongs to another source or account.");
    if(!journal){
      if((state.operationJournal||[]).some(j=>j.account===account&&pendingStates.includes(j.state)))throw new Error("Recover the previous conversion before starting another one.");
      if(!eventId.startsWith("v2native_"))throw new Error("An older conversion cannot be replayed as a new operation.");
      journal={protocol:"v2",event_id:eventId,app_id:appId,account,source_digest,result_digest,dimensions,amount:nativeCost(appId,dimensions),free_units:-1,paid_units:-1,state:"requesting"};
      state.operationJournal=[...(state.operationJournal||[]),journal];await host.persistNative();
    }
    if(["released","uncertain_released","denied"].includes(journal.state))throw new Error("This conversion cannot be replayed. Check its saved output before trying again.");
    const retained=journal,row=await reserve(host,retained);
    if(!["reserved","committed"].includes(row.state)){retained.state=row.state;await host.persistNative();throw new Error("No conversion credit is available. Refresh your balance.");}
    if(!["writing","verified","committed"].includes(retained.state))retained.state=row.state;
    await host.persistNative();
    const reservation:NativeReservation={source:row.paid_units?"purchased":"free",
      markWriting:async evidence=>{
        if(retained.state==="committed"&&retained.evidence?.length)return false;
        if(retained.state!=="reserved")throw new Error("The conversion reservation is no longer writable.");
        retained.state="writing";retained.evidence=evidence;await host.persistNative();return true;
      },
      commit:async()=>{
        if(retained.state==="committed")return {kind:"committed"};
        if(retained.state!=="writing"&&!reveal)throw new Error("The conversion has not been written.");
        if(!reveal&&!await writesMatch(host,retained))return {kind:"pending"};
        retained.state="verified";await host.persistNative();
        try{if((await settle(host,retained,"commit")).state!=="committed")return {kind:"pending"};retained.state="committed";await host.persistNative();return {kind:"committed"};}
        catch(error){diagnostics.failure("native.commit",error);return {kind:"pending"};}
      },
      rollback:async()=>{
        if(retained.state!=="reserved")return;
        const row=await settle(host,retained,"release");retained.state=row.state;await host.persistNative();
      }};
    if(reveal&&(await reservation.commit()).kind!=="committed")throw new Error("Confirmation is pending.");
    return reservation;
  }catch(error){diagnostics.failure("native.reserve",error);new Notice(error instanceof Error?error.message:String(error));return null;}
}
export function joinCurrentPacks(data:any,_legacy?:any,appId?:string):any[]{return joinPublicPacks(data,appId||data?.app_id);}
export async function renderNativePacks(container:HTMLElement,host:NativeHost,appId:string,_buy:(price:string)=>Promise<void>):Promise<void>{
  addLivePacks(container,{appId,installationId:host.settings.constanceDeviceId,state:host.settings,persist:()=>host.persistNative(),syncBalance:async()=>{const {syncEntitlements}=await import("./constance-v2");await syncEntitlements(host.settings,()=>host.persistNative());}});
}
