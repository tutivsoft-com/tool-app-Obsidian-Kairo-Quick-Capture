// The URL can be replaced by the CLI harness when testing the real local API.
export const CONSTANCE_API = "https://app.tutivsoft.com/api/v2";
export const BILLING_UNIT = "captures";

/** Preserve the UI's balance shape while using the server's held-unit rules. */
export function accountBalance(data: any, appId: string): any {
  const balances = data?.balances;
  if (data?.app_id !== appId || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(balances)) throw new Error("Account balance could not be verified.");
  const rows = balances.filter((row: any) => row?.unit === BILLING_UNIT);
  if (rows.length !== 1) throw new Error("Account balance could not be verified.");
  const row = rows[0];
  if (![row.free_remaining, row.free_held, row.paid_balance, row.paid_held, row.spendable, row.deficit].every(Number.isSafeInteger)
    || [row.free_remaining, row.free_held, row.paid_held, row.spendable, row.deficit].some(n => n < 0)
    || row.free_held > row.free_remaining) throw new Error("Account balance could not be verified.");
  const free = Math.max(0, row.free_remaining - row.free_held);
  const paid = Math.max(0, row.paid_balance - row.paid_held);
  if (row.spendable !== free + paid) throw new Error("Account balance could not be verified.");
  return { ...data, free_usage: { remaining: row.deficit ? 0 : free }, credits: { balance: row.deficit ? 0 : paid, total_available: row.deficit ? 0 : paid } };
}

const balanceLocks = new WeakMap<object, Promise<any>>();
export function syncEntitlements(state: any, persist: () => Promise<void>): Promise<any> {
 const previous = balanceLocks.get(state) || Promise.resolve();
 const operation = previous.catch(() => {}).then(() => syncEntitlementsInternal(state,persist));
 balanceLocks.set(state,operation);
 return operation.finally(() => {if(balanceLocks.get(state)===operation)balanceLocks.delete(state);});
}
async function syncEntitlementsInternal(state: any, persist: () => Promise<void>): Promise<any> {
 const {requestAuthenticatedBilling} = await import("./constance-account");
 if (!state.billingAccountLinked) throw new Error("Connect your account first.");
 const {resumeAccountCheckout} = await import("./billing-checkout");
 const {refreshBillingSession} = await import("./constance-account");
 resumeAccountCheckout({state,appId:"kairo-quick-capture",installationId:state.constanceDeviceId||state.deviceId,persist,syncBalance:()=>syncEntitlements(state,persist),refreshSession:()=>refreshBillingSession(state,persist)});
 const originalOwner = state.billingEmail.trim().toLowerCase();
 const response = await requestAuthenticatedBilling(state,persist,{url:CONSTANCE_API+"/billing/entitlements/me?app_id=kairo-quick-capture",method:"GET",throw:false});
 if (response.status !== 200 || !state.billingAccountLinked || state.billingEmail.trim().toLowerCase() !== originalOwner) throw new Error("Balance refresh is pending. Reconnect or try again.");
 const data=accountBalance(response.json?.data,"kairo-quick-capture");
 state.freeUsesRemaining = data.free_usage.remaining;
 state.purchasedUses = data.credits.balance;
 await persist();
 if (!state.billingAccountLinked || state.billingEmail.trim().toLowerCase() !== originalOwner) throw new Error("Account changed while saving balance.");
 const ack=await requestAuthenticatedBilling(state,persist,{url:CONSTANCE_API+"/billing/sync",method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({app_id:"kairo-quick-capture",revision:data.revision}),throw:false});
 if(ack.status!==200 || !Number.isSafeInteger(ack.json?.data?.recorded_revision) || ack.json.data.recorded_revision < data.revision) throw new Error("Balance saved. Server acknowledgement is pending.");
 return data;
}
