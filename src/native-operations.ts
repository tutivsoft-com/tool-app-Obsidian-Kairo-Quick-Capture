import { renderLoyaltyDiscount } from "./loyalty-discount";
import { diagnostics } from "./diagnostics";
import { App, Notice, Setting, requestUrl } from "obsidian";
import * as account from "./constance-account";
const BASE = "https://app.tutivsoft.com/api/v1";
export type NativeDimensions = Record<string, number>;
type State = { billingEmail:string; billingAccessToken: string; billingAccountLinked: boolean; constanceDeviceId: string; billingRefreshToken?: string };
export type WriteEvidence = {path:string;binary?:boolean;before?:string;after?:string;marker?:string};
export type Journal = {protocol?:"usage";retry_of?:string;free_units:number;paid_units:number;amount:number;evidence?:WriteEvidence[]; event_id: string; app_id: string; result_digest: string; source_digest: string; state: string; account: string; dimensions: NativeDimensions };
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
const diagnosticEnd1 = diagnostics?.start?.("native-operations.api") ?? (() => {});
try {

  if (!publicRequest && (!host.settings.billingAccessToken || !host.settings.billingAccountLinked)) throw new Error("Keep this preview open. Sign in and verify your email in Settings, then return here to continue.");
  const send = () => (diagnostics?.request?.("network.native-operations.api", requestUrl, { url: BASE + path, method: body === undefined ? "GET" : "POST", throw:false,
    headers: { "Content-Type":"application/json", ...(!publicRequest ? { Authorization:`Bearer ${host.settings.billingAccessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }) ?? requestUrl({ url: BASE + path, method: body === undefined ? "GET" : "POST", throw:false,
    headers: { "Content-Type":"application/json", ...(!publicRequest ? { Authorization:`Bearer ${host.settings.billingAccessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }));
  let response = await send();
  if (response.status === 401 && host.settings.billingRefreshToken) {
    const refresh = account.refreshBillingSession;
    if (refresh && await refresh(host.settings as any, () => host.persistNative())) { await host.persistNative(); response = await send(); }
  }
  if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(response.json?.detail?.message || `Your account could not be verified. Your preview is saved and no new changes were applied.`),{status:response.status});
  if (!response.json?.data) throw new Error("Your account could not be verified. Reconnect and try again.");
  return await (response.json.data);

} catch (diagnosticError1) { diagnostics?.failure?.("native-operations.api", diagnosticError1); throw diagnosticError1; } finally { diagnosticEnd1(); }
}
export interface NativeReservation { source: "free" | "purchased"; markWriting(evidence?:WriteEvidence[]): Promise<boolean>; commit(): Promise<{kind:"committed"|"pending"}>; rollback(): Promise<void>; }
export async function reserveLegacyNative(host: NativeHost, appId: string, eventId: string, source: string, result: string, dimensions: NativeDimensions, reveal = false): Promise<NativeReservation | null> {
const diagnosticEnd2 = diagnostics?.start?.("native-operations.reserveLegacyNative") ?? (() => {});
try {

  const state = host.settings as Extended;
  try {
    const source_digest = await digest(source), result_digest = await digest(result);
    const amount=nativeCost(appId,dimensions);
    const owner=state.billingEmail.trim().toLowerCase();
    await recoverNative(host);
    const originalEventId=eventId;
    const lineage=(state.operationJournal||[]).filter(j=>j.event_id===originalEventId||j.retry_of===originalEventId);
    if(lineage.some(j=>j.account!==owner))throw new Error("Sign in to the account that started this action. Your preview and recovery data are saved.");
    if(lineage.some(j=>j.app_id!==appId||j.result_digest!==result_digest||j.source_digest!==source_digest||j.amount!==amount||JSON.stringify(j.dimensions)!==JSON.stringify(dimensions)))throw new Error("The source or selected action changed. Review your edits before starting a new action, which may use additional credits.");
    let existing=lineage.length?lineage[lineage.length-1]:undefined;
    if(existing?.state==="released"){eventId=jobId();existing=undefined;}
    if(existing?.state==="uncertain_released")throw new Error("This action could not be confirmed. Check your vault for saved changes before retrying.");
    else if(existing){eventId=existing.event_id;}
    const lineageIds=new Set(lineage.map(j=>j.event_id));
    if(state.operationJournal?.some(j=>j.app_id===appId&&j.account===owner&&!lineageIds.has(j.event_id)&&["requesting","writing","verified","reserved"].includes(j.state)))throw new Error("The previous changes could not be confirmed. Check your vault before starting another action. Its credits are still reserved.");
    if (!state.installationCredential) {
      const installation = await api(host,"/public/installations",{app_id:appId,installation_id:state.constanceDeviceId},true);
      if (typeof installation.installation_credential !== "string") throw new Error("This installation could not be verified. Reconnect your account.");
      state.installationCredential = installation.installation_credential; await host.persistNative();
    }
    const body = {app_id:appId,installation_id:state.constanceDeviceId,event_id:eventId,amount,source_digest,result_digest,dimensions,installation_credential:state.installationCredential};
    const quote = await api(host,"/billing/operations/quote",body);
    if(quote.event_id!==eventId||quote.app_id!==appId||quote.installation_id!==state.constanceDeviceId||quote.source_digest!==source_digest||quote.result_digest!==result_digest||quote.amount!==amount)throw new Error("The price could not be matched to this action. Nothing was confirmed or saved.");
    if(!Number.isInteger(quote.free_units)||!Number.isInteger(quote.paid_units)||quote.free_units<0||quote.paid_units<0||(quote.free_units+quote.paid_units!==amount && !(quote.retained_access === true && quote.free_units === 0 && quote.paid_units === 0)))throw new Error("The credit amount could not be verified. Refresh your balance and retry.");
    if(quote.allowed===false)throw new Error(quote.message || "This action could not proceed. Keep the preview open, then sign in to the original account, select fewer items, or add credits.");
    if(existing && existing.state!=="released" && (existing.free_units!==quote.free_units||existing.paid_units!==quote.paid_units))throw new Error("The credit amount changed. Nothing was saved. Refresh your balance before continuing.");

    const journal: Journal = existing || {event_id:eventId,app_id:appId,source_digest,result_digest,amount,free_units:quote.free_units,paid_units:quote.paid_units,dimensions,state:"requesting",account:owner,...(eventId!==originalEventId?{retry_of:originalEventId}:{})};
    if (!existing) { state.operationJournal = [...(state.operationJournal || []),journal]; await host.persistNative(); }
    const reserved = await api(host,"/billing/operations/reserve",{...body,expected_free_units:quote.free_units,expected_paid_units:quote.paid_units});
    assertJournalIdentity(reserved,journal,state.constanceDeviceId);
    if(reserved.state==="released"){journal.state="released";await host.persistNative();throw new Error("This action expired. Nothing was saved. Refresh the price before continuing with this result.");} if(!["reserved","committed"].includes(reserved.state))throw new Error("This action could not be confirmed. Nothing was saved. Reconnect and retry this result.");
    if(reserved.free_units!==quote.free_units||reserved.paid_units!==quote.paid_units)throw new Error("Your available credits changed. Nothing was saved. Refresh the price before continuing.");
    if(!["writing","verified","committed"].includes(journal.state))journal.state=reserved.state;
    await host.persistNative();
    const settleRequest = async (action: string) => { const diagnosticEnd3 = diagnostics?.start?.("native-operations.settleRequest") ?? (() => {}); try { return await (api(host,`/billing/operations/${encodeURIComponent(eventId)}/${action}`,{app_id:appId,installation_id:state.constanceDeviceId,result_digest})); } catch (diagnosticError3) { diagnostics?.failure?.("native-operations.settleRequest", diagnosticError3); throw diagnosticError3; } finally { diagnosticEnd3(); } };
    const settle=async(action:string)=>{
const diagnosticEnd4 = diagnostics?.start?.("native-operations.settle") ?? (() => {});
try {
const response=await settleRequest(action);assertJournalIdentity(response,journal,state.constanceDeviceId);return await (response);
} catch (diagnosticError4) { diagnostics?.failure?.("native-operations.settle", diagnosticError4); throw diagnosticError4; } finally { diagnosticEnd4(); }
};
    const reservation: NativeReservation = {
      source: reserved.paid_units > 0 ? "purchased" : "free",
      markWriting: async(evidence)=>{
const diagnosticEnd5 = diagnostics?.start?.("native-operations.background.8612") ?? (() => {});
try {
 if(!["reserved","committed"].includes(journal.state))throw new Error("The reserved credits are no longer available. Nothing was saved. Refresh your balance and retry."); if(journal.state==="committed"&&journal.evidence?.length){new Notice("This result is already saved. Open the existing output.");return false;} if(journal.state!=="committed")journal.state="writing"; journal.evidence=evidence; await host.persistNative(); return true;
} catch (diagnosticError5) { diagnostics?.failure?.("native-operations.background.8612", diagnosticError5); throw diagnosticError5; } finally { diagnosticEnd5(); }
},
      commit:async()=>{
const diagnosticEnd6 = diagnostics?.start?.("native-operations.background.9080") ?? (() => {});
try {

        if (journal.state === "committed") return {kind:"committed"};
        journal.state="verified"; await host.persistNative();
        try { const committed=await settle("commit"); if(committed.result_digest!==result_digest||committed.source_digest!==source_digest||committed.event_id!==eventId)throw new Error("The action could not be matched to your saved result."); if(committed.state!=="committed") throw new Error("The action could not be confirmed. Reconnect and retry."); journal.state="committed"; await host.persistNative(); return {kind:"committed"}; }
        catch (caughtError1) {
diagnostics.failure("native-operations.caught_2", caughtError1); return {kind:"pending"}; }

} catch (diagnosticError6) { diagnostics?.failure?.("native-operations.background.9080", diagnosticError6); throw diagnosticError6; } finally { diagnosticEnd6(); }
},
      rollback:async()=>{
const diagnosticEnd7 = diagnostics?.start?.("native-operations.background.9659") ?? (() => {});
try {

        if (["writing","verified","committed"].includes(journal.state)) { new Notice("The saved changes could not be confirmed. Check the output before retrying. Its credits are still reserved."); return; }
        const released=await settle("release"); journal.state=released.state; await host.persistNative();

} catch (diagnosticError7) { diagnostics?.failure?.("native-operations.background.9659", diagnosticError7); throw diagnosticError7; } finally { diagnosticEnd7(); }
}
    };
    if (reveal && (await reservation.commit()).kind !== "committed") throw new Error("The full result is not yet available. Reconnect and retry this preview.");
    return await (reservation);
  } catch(error) {
diagnostics.failure("native-operations.caught_3", error); new Notice(error instanceof Error ? error.message : String(error)); return null; }

} catch (diagnosticError2) { diagnostics?.failure?.("native-operations.reserveLegacyNative", diagnosticError2); throw diagnosticError2; } finally { diagnosticEnd2(); }
}

/** Shared authenticated free-first ledger; old reservation journals retain their original recovery path. */
export async function reserveNative(host: NativeHost, appId: string, eventId: string, source: string, result: string, dimensions: NativeDimensions, reveal = false): Promise<NativeReservation | null> {
const diagnosticEnd8 = diagnostics?.start?.("native-operations.reserveNative") ?? (() => {});
try {

  const state = host.settings as Extended;
  const prior = (state.operationJournal || []).find(j => j.event_id === eventId || j.retry_of === eventId);
  if (prior && prior.protocol !== "usage") return await (reserveLegacyNative(host, appId, eventId, source, result, dimensions, reveal));
  try {
    if (!state.billingAccountLinked || !state.billingAccessToken) throw new Error("Open plugin settings and choose Connect to sign in or create an account and use your free allowance.");
    await recoverNative(host);
    const owner = state.billingEmail.trim().toLowerCase(), source_digest = await digest(source), result_digest = await digest(result), amount = nativeCost(appId, dimensions);
    const pendingExact = (state.operationJournal || []).find(j => j.protocol === "usage" && j.app_id === appId && j.account === owner && j.source_digest === source_digest && j.result_digest === result_digest && j.amount === amount && JSON.stringify(j.dimensions) === JSON.stringify(dimensions) && (["requesting", "reserved", "writing", "verified"].includes(j.state) || (j.state === "committed" && Boolean(j.evidence?.length))));
    if (pendingExact) eventId = pendingExact.event_id;
    let journal = (state.operationJournal || []).find(j => j.event_id === eventId);
    if (journal && (journal.account !== owner || journal.app_id !== appId || journal.source_digest !== source_digest || journal.result_digest !== result_digest || journal.amount !== amount || JSON.stringify(journal.dimensions) !== JSON.stringify(dimensions))) throw new Error("The account or source changed. Resume the original action before starting a new one.");
    if (journal?.state === "uncertain_released") throw new Error("The previous changes could not be confirmed. Check the output before retrying. No new charge or changes were made.");
    if ((state.operationJournal || []).some(j => j.app_id === appId && j.account === owner && j.event_id !== eventId && ["requesting", "reserved", "writing", "verified"].includes(j.state))) throw new Error("Recover the previous pending operation before starting another one.");
    if (!journal) {
      journal = { protocol: "usage", event_id: eventId, app_id: appId, source_digest, result_digest, amount, free_units: -1, paid_units: -1, dimensions, state: "requesting", account: owner };
      state.operationJournal = [...(state.operationJournal || []), journal];
      await host.persistNative();
    }
    if (journal.state === "released") throw new Error("This canceled operation cannot be replayed. Start a new operation.");
    let row;
    try { row = await api(host, "/billing/usage/reserve", usageBody(journal, state)); }
    catch(error) {
diagnostics.failure("native-operations.caught_4", error); if ((error as any)?.status === 402) { journal.state="denied"; await host.persistNative(); } throw error; }
    adoptUsageSplit(row, journal, state.constanceDeviceId);
    applyUsageBalance(row,state);
    if (row.state === "released") { journal.state = journal.evidence?.length ? "uncertain_released" : "released"; await host.persistNative(); throw new Error("This action expired. Check its original result before retrying."); }
    if (!["reserved", "committed"].includes(row.state)) throw new Error("This action could not be verified. Reconnect and try again.");
    if (!["writing", "verified", "committed"].includes(journal.state)) journal.state = row.state;
    await host.persistNative();
    const retained = journal;
    const settle = async (action: string) => {
const diagnosticEnd9 = diagnostics?.start?.("native-operations.settle") ?? (() => {});
try {
 const response = await api(host, `/billing/usage/${encodeURIComponent(eventId)}/${action}`, { app_id: appId, installation_id: state.constanceDeviceId, result_digest }); assertJournalIdentity(response, retained, state.constanceDeviceId); applyUsageBalance(response,state); return await (response);
} catch (diagnosticError9) { diagnostics?.failure?.("native-operations.settle", diagnosticError9); throw diagnosticError9; } finally { diagnosticEnd9(); }
};
    const reservation: NativeReservation = {
      source: row.paid_units > 0 ? "purchased" : "free",
      markWriting: async evidence => {
const diagnosticEnd10 = diagnostics?.start?.("native-operations.background.14371") ?? (() => {});
try {

        if (!["reserved", "committed"].includes(retained.state)) throw new Error("The reserved credits are no longer available. Nothing was saved. Refresh your balance and retry.");
        if (retained.state === "committed" && retained.evidence?.length) return false;
        if (retained.state !== "committed") retained.state = "writing";
        retained.evidence = evidence; await host.persistNative(); return true;

} catch (diagnosticError10) { diagnostics?.failure?.("native-operations.background.14371", diagnosticError10); throw diagnosticError10; } finally { diagnosticEnd10(); }
},
      commit: async () => {
const diagnosticEnd11 = diagnostics?.start?.("native-operations.background.14784") ?? (() => {});
try {

        if (retained.state === "committed") return { kind: "committed" };
        retained.state = "verified"; await host.persistNative();
        try { const committed = await settle("commit"); if (committed.state !== "committed") throw new Error("Commit pending"); retained.state = "committed"; await host.persistNative(); return { kind: "committed" }; } catch (caughtError5) {
diagnostics.failure("native-operations.caught_6", caughtError5); return { kind: "pending" }; }

} catch (diagnosticError11) { diagnostics?.failure?.("native-operations.background.14784", diagnosticError11); throw diagnosticError11; } finally { diagnosticEnd11(); }
},
      rollback: async () => {
const diagnosticEnd12 = diagnostics?.start?.("native-operations.background.15218") ?? (() => {});
try {

        if (["writing", "verified", "committed"].includes(retained.state)) { new Notice("The saved changes could not be confirmed. Check the output or contact support to review the charge."); return; }
        const released = await settle("release"); retained.state = released.state; await host.persistNative();

} catch (diagnosticError12) { diagnostics?.failure?.("native-operations.background.15218", diagnosticError12); throw diagnosticError12; } finally { diagnosticEnd12(); }
}
    };
    if (reveal && (await reservation.commit()).kind !== "committed") throw new Error("This action is awaiting confirmation. Reconnect and retry the same result.");
    return await (reservation);
  } catch (error) {
diagnostics.failure("native-operations.caught_7", error); new Notice(error instanceof Error ? error.message : String(error)); return null; }

} catch (diagnosticError8) { diagnostics?.failure?.("native-operations.reserveNative", diagnosticError8); throw diagnosticError8; } finally { diagnosticEnd8(); }
}
function applyUsageBalance(remote: any, state: Extended): void {
  const cached = state as Extended & Record<string, any>;
  const remaining = remote.free_usage?.remaining, balance = remote.credits?.balance;
  if (Number.isSafeInteger(remaining) && remaining >= 0) {
    for (const key of ["freeUsesRemaining", "freeConversionsRemaining"]) if (key in cached) cached[key] = remaining;
    if ("freeRepairBatchesUsed" in cached && Number.isSafeInteger(remote.free_usage?.allowance)) cached.freeRepairBatchesUsed = Math.max(0, remote.free_usage.allowance - remaining);
    if ("freeUsesUsed" in cached && Number.isSafeInteger(remote.free_usage?.allowance)) cached.freeUsesUsed = Math.max(0, remote.free_usage.allowance - remaining);
  }
  if (Number.isSafeInteger(balance) && balance >= 0) for (const key of ["purchasedUses", "purchasedConversions", "purchasedRepairBatches"]) if (key in cached) cached[key] = balance;
}
function usageBody(journal: Journal, state: Extended): Record<string, unknown> {
  return { app_id: journal.app_id, installation_id: state.constanceDeviceId, event_id: journal.event_id, amount: journal.amount, source_digest: journal.source_digest, result_digest: journal.result_digest, dimensions: journal.dimensions };
}
function adoptUsageSplit(remote: any, journal: Journal, installationId: string): void {
  if (!Number.isSafeInteger(remote.free_units) || !Number.isSafeInteger(remote.paid_units) || remote.free_units < 0 || remote.paid_units < 0 || (remote.free_units + remote.paid_units !== journal.amount && !(remote.retained_access === true && remote.free_units === 0 && remote.paid_units === 0))) throw new Error("Credit usage could not be confirmed. Refresh your balance and retry.");
  const expected = { ...journal, free_units: remote.free_units, paid_units: remote.paid_units };
  assertJournalIdentity(remote, expected, installationId);
  if (journal.free_units >= 0 && (journal.free_units !== remote.free_units || journal.paid_units !== remote.paid_units)) throw new Error("The credit amount for this action changed. Refresh your balance before continuing.");
  journal.free_units = remote.free_units; journal.paid_units = remote.paid_units;
}
function assertJournalIdentity(remote:any,journal:Journal,installationId:string):void{
  if(remote.event_id!==journal.event_id||remote.app_id!==journal.app_id||remote.installation_id!==installationId||remote.source_digest!==journal.source_digest||remote.result_digest!==journal.result_digest||remote.amount!==journal.amount||remote.free_units!==journal.free_units||remote.paid_units!==journal.paid_units)throw Object.assign(new Error("This action could not be matched to its saved result. Resume the original action."),{identityMismatch:true});
}
export async function recoverNative(host:NativeHost):Promise<void>{
const diagnosticEnd13 = diagnostics?.start?.("native-operations.recoverNative") ?? (() => {});
try {

  const state=host.settings as Extended;if(!state.billingAccessToken||!state.billingAccountLinked)return;
  for(const journal of state.operationJournal || []){
    if(!["requesting","writing","verified","reserved"].includes(journal.state)||journal.account!==state.billingEmail.trim().toLowerCase())continue;
    try {
      const remote=await api(host,`/billing/${journal.protocol === "usage" ? "usage" : "operations"}/${encodeURIComponent(journal.event_id)}?app_id=${encodeURIComponent(journal.app_id)}&installation_id=${encodeURIComponent(state.constanceDeviceId)}`);
      if(journal.protocol === "usage") adoptUsageSplit(remote,journal,state.constanceDeviceId); else assertJournalIdentity(remote,journal,state.constanceDeviceId);
      if(remote.state==="committed"){if(journal.protocol === "usage")applyUsageBalance(remote,state);journal.state="committed";await host.persistNative();continue;}
      if(remote.state==="released"){
        if(journal.state==="writing"||journal.evidence?.length){journal.state="uncertain_released";await host.persistNative();continue;}
        journal.state="released";await host.persistNative();continue;
      }
      if(journal.state==="requesting" && remote.state==="reserved"){journal.state="reserved";await host.persistNative();continue;}
      if(journal.state!=="verified"){
        if(!journal.evidence?.length)continue;
        const outcomes=await Promise.all(journal.evidence.map(async evidence=>{
const diagnosticEnd14 = diagnostics?.start?.("native-operations.background.19943") ?? (() => {});
try {

          try {const adapter=host.app.vault.adapter;const bytes=evidence.binary ? await adapter.readBinary(evidence.path) : await adapter.read(evidence.path);
            if(evidence.marker && typeof bytes==="string" && bytes.includes(evidence.marker))return "after";
            const hash=await digest(bytes);return hash===evidence.after ? "after" : hash===evidence.before ? "before" : "unknown";
          }catch (caughtError8){
diagnostics.failure("native-operations.caught_9", caughtError8);return "unknown";}

} catch (diagnosticError14) { diagnostics?.failure?.("native-operations.background.19943", diagnosticError14); throw diagnosticError14; } finally { diagnosticEnd14(); }
}));
        if(outcomes.length===0||outcomes.some(outcome=>outcome!=="after"))continue;
      }
      const remoteCommit=await api(host,`/billing/${journal.protocol === "usage" ? "usage" : "operations"}/${encodeURIComponent(journal.event_id)}/commit`,{app_id:journal.app_id,installation_id:state.constanceDeviceId,result_digest:journal.result_digest});
      assertJournalIdentity(remoteCommit,journal,state.constanceDeviceId);
      if(remoteCommit.state==="committed"&&remoteCommit.result_digest===journal.result_digest&&remoteCommit.source_digest===journal.source_digest){if(journal.protocol === "usage")applyUsageBalance(remoteCommit,state);journal.state="committed";await host.persistNative();}
    }catch(error){
diagnostics.failure("native-operations.caught_10", error);
      if(journal.state==="requesting" && !(error as any)?.identityMismatch && (!(error as any)?.status || (error as any).status===404 || (error as any).status>=500))try {
        const remote=await api(host,journal.protocol === "usage" ? "/billing/usage/reserve" : "/billing/operations/reserve",journal.protocol === "usage" ? usageBody(journal,state) : {app_id:journal.app_id,installation_id:state.constanceDeviceId,event_id:journal.event_id,amount:journal.amount,source_digest:journal.source_digest,result_digest:journal.result_digest,dimensions:journal.dimensions,expected_free_units:journal.free_units,expected_paid_units:journal.paid_units,installation_credential:state.installationCredential});
        if(journal.protocol === "usage") adoptUsageSplit(remote,journal,state.constanceDeviceId); else assertJournalIdentity(remote,journal,state.constanceDeviceId);journal.state=remote.state;await host.persistNative();
      }catch (caughtError11){
diagnostics.failure("native-operations.caught_12", caughtError11); /* Replay only the durable authorization request, never content writes. */ }
    }
  }

} catch (diagnosticError13) { diagnostics?.failure?.("native-operations.recoverNative", diagnosticError13); throw diagnosticError13; } finally { diagnosticEnd13(); }
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
const diagnosticEnd15 = diagnostics?.start?.("native-operations.renderNativePacks") ?? (() => {});
try {

  const root=container.createDiv({ cls: "ui-billing-packs" }); renderLoyaltyDiscount(root); root.createEl("p",{text:"Loading prices…"});
  try {
    const catalog=await api(host,`/billing/public-products?app_id=${encodeURIComponent(appId)}`,undefined,true);
    const offers=joinCurrentPacks(catalog);
    if(!offers.length)throw new Error("No credit packs are currently available.");
    root.empty(); renderLoyaltyDiscount(root);
    for(const {pack,price,priceId,units,unit,available} of offers) {
      const details=[pack?.description,Number.isSafeInteger(units)&&units>0?`${units.toLocaleString()} ${unit}`:"",available?"":pack?.availability_reason||"Current price unavailable"].filter(Boolean).join(" · ");
      new Setting(root).setName(pack?.price_name||pack?.name||pack?.code||"Credit pack").setDesc(details).addButton(b=>b.setButtonText(available?pack.formatted_total:"Pricing unavailable").setDisabled(!available).onClick(()=>{
return diagnostics.guard("native-operations.control_13", () => { const diagnosticAction16 = () => (void diagnostics.guard("native-operations.background_14", () => (buy(priceId)))); return diagnostics?.run ? diagnostics.run("control.24887.onClick", diagnosticAction16) : diagnosticAction16();
});
}));
    }
  } catch (caughtError15) {
diagnostics.failure("native-operations.caught_16", caughtError15); root.empty(); renderLoyaltyDiscount(root); root.createEl("p",{text:"Pricing temporarily unavailable. Buying is disabled; keep your preview open."}); }

} catch (diagnosticError15) { diagnostics?.failure?.("native-operations.renderNativePacks", diagnosticError15); throw diagnosticError15; } finally { diagnosticEnd15(); }
}
