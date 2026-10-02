import { App, Modal, Notice, Setting, requestUrl } from "obsidian";
import * as account from "./constance-account";
const BASE = "https://app.tutivsoft.com/api/v1";
export type NativeDimensions = Record<string, number>;
type State = { billingEmail:string; billingAccessToken: string; billingAccountLinked: boolean; constanceDeviceId: string; billingRefreshToken?: string };
export type WriteEvidence = {path:string;binary?:boolean;before?:string;after?:string;marker?:string};
export type Journal = {retry_of?:string;free_units:number;paid_units:number;amount:number;evidence?:WriteEvidence[]; event_id: string; app_id: string; result_digest: string; source_digest: string; state: string; account: string; dimensions: NativeDimensions };
type Extended = State & { installationCredential?: string; operationJournal?: Journal[] };
export type NativeHost = { app: App; settings: State; persistNative(): Promise<void> };
export async function digest(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2,"0")).join("");
}
export function codePoints(value: string): number { return Array.from(value).length; }
export function nativeCost(appId:string,dimensions:NativeDimensions):number{
  if(appId==="cairn-vault-linter")return Math.max(1,Math.ceil(dimensions.files/5),Math.ceil(dimensions.edits/20));
  if(appId==="meridian-timeline")return Math.max(1,Math.ceil(dimensions.notes/20));
  return 1;
}
export function jobId(): string { return `native_${crypto.randomUUID()}`; }
async function api(host: NativeHost, path: string, body?: unknown, publicRequest = false): Promise<any> {
  if (!publicRequest && (!host.settings.billingAccessToken || !host.settings.billingAccountLinked)) throw new Error("Keep this preview open. Sign in and verify your email in settings, then return to this exact result.");
  const send = () => requestUrl({ url: BASE + path, method: body === undefined ? "GET" : "POST", throw:false,
    headers: { "Content-Type":"application/json", ...(!publicRequest ? { Authorization:`Bearer ${host.settings.billingAccessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let response = await send();
  if (response.status === 401 && host.settings.billingRefreshToken) {
    const refresh = account.refreshBillingSession;
    if (refresh && await refresh(host.settings as any, () => host.persistNative())) { await host.persistNative(); response = await send(); }
  }
  if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(response.json?.detail?.message || `Authorization unavailable (${response.status}). Your preview is retained; nothing new was applied.`),{status:response.status});
  if (!response.json?.data) throw new Error("Authorization response is incomplete.");
  return response.json.data;
}
class SplitModal extends Modal {
  constructor(app: App, private split: any, private resolve: (confirmed: boolean) => void) { super(app); }
  onOpen(): void {
    this.contentEl.createEl("h2",{text:"Confirm useful operation"});
    this.contentEl.createEl("p",{text:`This exact result uses ${this.split.free_units} free units and ${this.split.paid_units} purchased units. Full reveal consumes the operation once; applying that result again does not. Purchased credits do not expire.`});
    new Setting(this.contentEl).addButton(b=>b.setButtonText("Confirm").setCta().onClick(()=>{ this.resolve(true); this.close(); }));
  }
  onClose(): void { this.resolve(false); this.contentEl.empty(); }
}
export interface NativeReservation { source: "free" | "purchased"; markWriting(evidence?:WriteEvidence[]): Promise<boolean>; commit(): Promise<{kind:"committed"|"pending"}>; rollback(): Promise<void>; }
export async function reserveNative(host: NativeHost, appId: string, eventId: string, source: string, result: string, dimensions: NativeDimensions, reveal = false): Promise<NativeReservation | null> {
  const state = host.settings as Extended;
  try {
    const source_digest = await digest(source), result_digest = await digest(result);
    const amount=nativeCost(appId,dimensions);
    const owner=state.billingEmail.trim().toLowerCase();
    await recoverNative(host);
    const originalEventId=eventId;
    const lineage=(state.operationJournal||[]).filter(j=>j.event_id===originalEventId||j.retry_of===originalEventId);
    if(lineage.some(j=>j.account!==owner))throw new Error("This operation belongs to another account. Sign in to the original account; its preview and journal are retained.");
    if(lineage.some(j=>j.app_id!==appId||j.result_digest!==result_digest||j.source_digest!==source_digest||j.amount!==amount||JSON.stringify(j.dimensions)!==JSON.stringify(dimensions)))throw new Error("Source or operation changed. Keep the original preview; review a merge or start a separately priced run.");
    let existing=lineage.length?lineage[lineage.length-1]:undefined;
    if(existing?.state==="released"){eventId=jobId();existing=undefined;}
    if(existing?.state==="uncertain_released")throw new Error("The server released an operation after a local write may have started. Reconcile the vault output before retrying; no new reservation was created.");
    else if(existing){eventId=existing.event_id;}
    const lineageIds=new Set(lineage.map(j=>j.event_id));
    if(state.operationJournal?.some(j=>j.app_id===appId&&j.account===owner&&!lineageIds.has(j.event_id)&&["requesting","writing","verified","reserved"].includes(j.state)))throw new Error("A previous write is uncertain. Reconcile its output before starting another operation; no reservation was refunded.");
    if (!state.installationCredential) {
      const installation = await api(host,"/public/installations",{app_id:appId,installation_id:state.constanceDeviceId},true);
      if (typeof installation.installation_credential !== "string") throw new Error("Installation proof unavailable.");
      state.installationCredential = installation.installation_credential; await host.persistNative();
    }
    const body = {app_id:appId,installation_id:state.constanceDeviceId,event_id:eventId,amount,source_digest,result_digest,dimensions,installation_credential:state.installationCredential};
    const quote = await api(host,"/billing/operations/quote",body);
    if(quote.event_id!==eventId||quote.app_id!==appId||quote.installation_id!==state.constanceDeviceId||quote.source_digest!==source_digest||quote.result_digest!==result_digest||quote.amount!==amount)throw new Error("Quote identity conflicts with the preserved operation. Nothing was confirmed or written.");
    if(!Number.isInteger(quote.free_units)||!Number.isInteger(quote.paid_units)||quote.free_units<0||quote.paid_units<0||quote.free_units+quote.paid_units!==amount)throw new Error("Invalid server cost split.");
    if(quote.allowed===false)throw new Error(quote.message || "This operation is not authorized. Keep the preview and sign in to the original account, reduce the selection, or purchase.");
    if(existing && existing.state!=="released" && (existing.free_units!==quote.free_units||existing.paid_units!==quote.paid_units))throw new Error("The original confirmed split changed. Nothing was written; reconcile the original operation.");
    if ((!existing || existing.state==="released") && !await new Promise<boolean>(resolve=>new SplitModal(host.app,quote,resolve).open())) return null;
    const journal: Journal = existing || {event_id:eventId,app_id:appId,source_digest,result_digest,amount,free_units:quote.free_units,paid_units:quote.paid_units,dimensions,state:"requesting",account:owner,...(eventId!==originalEventId?{retry_of:originalEventId}:{})};
    if (!existing) { state.operationJournal = [...(state.operationJournal || []),journal]; await host.persistNative(); }
    const reserved = await api(host,"/billing/operations/reserve",{...body,expected_free_units:quote.free_units,expected_paid_units:quote.paid_units});
    assertJournalIdentity(reserved,journal,state.constanceDeviceId);
    if(reserved.state==="released"){journal.state="released";await host.persistNative();throw new Error("The server released this operation. Nothing was written; confirm a fresh exact quote before reauthorizing the preserved result.");} if(!["reserved","committed"].includes(reserved.state))throw new Error("Operation authorization is unavailable. Nothing was written; reconcile the preserved result.");
    if(reserved.free_units!==quote.free_units||reserved.paid_units!==quote.paid_units)throw new Error("Allowance changed after confirmation. Nothing was written; refresh the exact quote before continuing.");
    if(!["writing","verified","committed"].includes(journal.state))journal.state=reserved.state;
    await host.persistNative();
    const settleRequest = async (action: string) => api(host,`/billing/operations/${encodeURIComponent(eventId)}/${action}`,{app_id:appId,installation_id:state.constanceDeviceId,result_digest});
    const settle=async(action:string)=>{const response=await settleRequest(action);assertJournalIdentity(response,journal,state.constanceDeviceId);return response;};
    const reservation: NativeReservation = {
      source: reserved.paid_units > 0 ? "purchased" : "free",
      markWriting: async(evidence)=>{ if(!["reserved","committed"].includes(journal.state))throw new Error("No active operation hold. Nothing was written."); if(journal.state==="committed"&&journal.evidence?.length){new Notice("This immutable result already completed its write. Access the existing output; no write was replayed.");return false;} if(journal.state!=="committed")journal.state="writing"; journal.evidence=evidence; await host.persistNative(); return true; },
      commit:async()=>{
        if (journal.state === "committed") return {kind:"committed"};
        journal.state="verified"; await host.persistNative();
        try { const committed=await settle("commit"); if(committed.result_digest!==result_digest||committed.source_digest!==source_digest||committed.event_id!==eventId)throw new Error("Commit identity mismatch"); if(committed.state!=="committed") throw new Error("Commit incomplete"); journal.state="committed"; await host.persistNative(); return {kind:"committed"}; }
        catch { return {kind:"pending"}; }
      },
      rollback:async()=>{
        if (["writing","verified","committed"].includes(journal.state)) { new Notice("Write outcome requires reconciliation. Reservation retained; no blind refund or replay."); return; }
        const released=await settle("release"); journal.state=released.state; await host.persistNative();
      }
    };
    if (reveal && (await reservation.commit()).kind !== "committed") throw new Error("Full reveal is pending. Retry this exact preview after reconnecting.");
    return reservation;
  } catch(error) { new Notice(error instanceof Error ? error.message : String(error)); return null; }
}
function assertJournalIdentity(remote:any,journal:Journal,installationId:string):void{
  if(remote.event_id!==journal.event_id||remote.app_id!==journal.app_id||remote.installation_id!==installationId||remote.source_digest!==journal.source_digest||remote.result_digest!==journal.result_digest||remote.amount!==journal.amount||remote.free_units!==journal.free_units||remote.paid_units!==journal.paid_units)throw Object.assign(new Error("Operation response conflicts with its immutable journal."),{identityMismatch:true});
}
export async function recoverNative(host:NativeHost):Promise<void>{
  const state=host.settings as Extended;if(!state.billingAccessToken||!state.billingAccountLinked)return;
  for(const journal of state.operationJournal || []){
    if(!["requesting","writing","verified","reserved"].includes(journal.state)||journal.account!==state.billingEmail.trim().toLowerCase())continue;
    try {
      const remote=await api(host,`/billing/operations/${encodeURIComponent(journal.event_id)}?app_id=${encodeURIComponent(journal.app_id)}&installation_id=${encodeURIComponent(state.constanceDeviceId)}`);
      assertJournalIdentity(remote,journal,state.constanceDeviceId);
      if(remote.state==="committed"){journal.state="committed";await host.persistNative();continue;}
      if(remote.state==="released"){
        if(journal.state==="writing"||journal.evidence?.length){journal.state="uncertain_released";await host.persistNative();continue;}
        journal.state="released";await host.persistNative();continue;
      }
      if(journal.state==="requesting" && remote.state==="reserved"){journal.state="reserved";await host.persistNative();continue;}
      if(journal.state!=="verified"){
        if(!journal.evidence?.length)continue;
        const outcomes=await Promise.all(journal.evidence.map(async evidence=>{
          try {const adapter=host.app.vault.adapter;const bytes=evidence.binary ? await adapter.readBinary(evidence.path) : await adapter.read(evidence.path);
            if(evidence.marker && typeof bytes==="string" && bytes.includes(evidence.marker))return "after";
            const hash=await digest(bytes);return hash===evidence.after ? "after" : hash===evidence.before ? "before" : "unknown";
          }catch{return "unknown";}
        }));
        if(outcomes.length===0||outcomes.some(outcome=>outcome!=="after"))continue;
      }
      const remoteCommit=await api(host,`/billing/operations/${encodeURIComponent(journal.event_id)}/commit`,{app_id:journal.app_id,installation_id:state.constanceDeviceId,result_digest:journal.result_digest});
      assertJournalIdentity(remoteCommit,journal,state.constanceDeviceId);
      if(remoteCommit.state==="committed"&&remoteCommit.result_digest===journal.result_digest&&remoteCommit.source_digest===journal.source_digest){journal.state="committed";await host.persistNative();}
    }catch(error){
      if(journal.state==="requesting" && !(error as any)?.identityMismatch && (!(error as any)?.status || (error as any).status===404 || (error as any).status>=500))try {
        const remote=await api(host,"/billing/operations/reserve",{app_id:journal.app_id,installation_id:state.constanceDeviceId,event_id:journal.event_id,amount:journal.amount,source_digest:journal.source_digest,result_digest:journal.result_digest,dimensions:journal.dimensions,expected_free_units:journal.free_units,expected_paid_units:journal.paid_units,installation_credential:state.installationCredential});
        assertJournalIdentity(remote,journal,state.constanceDeviceId);journal.state=remote.state;await host.persistNative();
      }catch{ /* Replay only the durable authorization request, never content writes. */ }
    }
  }
}
export function joinCurrentPacks(catalog:any, legacyLive?:any, legacyAppId?:string): any[] {
  const publicPacks=Array.isArray(catalog?.data?.packs)?catalog.data.packs:catalog?.packs;
  if (Array.isArray(publicPacks)) return publicPacks.map((pack:any)=>{
    const priceId=typeof pack?.price_id==="string"?pack.price_id:"";
    const units=Number(pack?.native_units);
    const unit=typeof pack?.unit==="string"&&pack.unit.trim()?pack.unit.trim():"units";
    const available=pack?.available===true&&!!priceId&&Number.isSafeInteger(units)&&units>0&&typeof pack?.formatted_total==="string"&&pack.formatted_total.length>0;
    return {pack,price:pack,priceId,units,unit,available};
  });
  // Read-only compatibility for migrated test fixtures; the settings UI uses only public-products.
  const configured=Array.isArray(catalog?.one_time_packs)?catalog.one_time_packs:[];
  const prices=Array.isArray(legacyLive?.[legacyAppId||catalog?.app_id])?legacyLive[legacyAppId||catalog?.app_id]:[];
  const unit=typeof catalog?.credit_unit_name==="string"&&catalog.credit_unit_name.trim()?catalog.credit_unit_name.trim():"credits";
  return configured.map((pack:any)=>{
    const priceId=typeof pack.price_id==="string"?pack.price_id:"";
    const price=priceId?prices.find((item:any)=>item?.price_id===priceId&&item?.interval==="one_time"):undefined;
    const units=Number(pack.credits);
    const available=!!priceId&&Number.isSafeInteger(units)&&units>0&&price?.status==="active"&&price.checkout_available===true&&typeof price.amount==="string"&&price.amount.length>0&&(!pack.product_id||price.product_id===pack.product_id);
    return {pack,price,priceId,units,unit,available};
  });
}
export async function renderNativePacks(container: HTMLElement, host: NativeHost, appId: string, buy: (priceId:string)=>Promise<void>): Promise<void> {
  const root=container.createDiv(); root.createEl("p",{text:"Loading current Paddle prices…"});
  try {
    const catalog=await api(host,`/billing/public-products?app_id=${encodeURIComponent(appId)}`,undefined,true);
    const offers=joinCurrentPacks(catalog);
    if(!offers.length)throw new Error("No configured one-time offers");
    root.empty();
    for(const {pack,price,priceId,units,unit,available} of offers) {
      const details=[pack?.description,Number.isSafeInteger(units)&&units>0?`${units.toLocaleString()} ${unit}`:"",available?"":pack?.availability_reason||"Current price unavailable"].filter(Boolean).join(" · ");
      new Setting(root).setName(pack?.name||pack?.code||"One-time offer").setDesc(details).addButton(b=>b.setButtonText(available?pack.formatted_total:"Pricing unavailable").setDisabled(!available).onClick(()=>void buy(priceId)));
    }
  } catch { root.empty(); root.createEl("p",{text:"Pricing temporarily unavailable. Buying is disabled; keep your preview open."}); }
}
