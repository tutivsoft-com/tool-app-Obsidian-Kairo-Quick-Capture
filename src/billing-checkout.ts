import { diagnostics } from "./diagnostics";
import { Notice, requestUrl } from "obsidian";
import { CONSTANCE_API } from "./constance-v2";

interface PendingCheckout { version?: number; key?: string; plan?: string; email?: string; checkoutId?: string; opened?: boolean; [key: string]: any }
interface CheckoutState {
  billingEmail: string; billingAccessToken: string; billingRefreshToken: string; billingAccountLinked: boolean;
  pendingAccountCheckout?: PendingCheckout | null; [key: string]: any;
}
export interface CheckoutHost {
  state: CheckoutState; appId: string; installationId: string;
  persist(): Promise<void>; syncBalance(): Promise<void>; refreshSession(): Promise<boolean>;
}
const running = new WeakMap<object, Promise<void>>();
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const owner = (host: CheckoutHost) => host.state.billingEmail.trim().toLowerCase();
function legacyPending(host: CheckoutHost): boolean {
  return ["pendingPriceCheckout", "pendingPaddleCheckout", "previewPendingCheckout"].some(key => !!host.state[key])
    || !!host.state.pendingAccountCheckout && host.state.pendingAccountCheckout.version !== 2;
}
async function send(host: CheckoutHost, path: string, body?: unknown): Promise<any> {
  const originalOwner = owner(host);
  const request = () => !host.state.billingAccountLinked || owner(host) !== originalOwner ? Promise.resolve({ status: 401 }) : requestUrl({ url: `${CONSTANCE_API}${path}`, method: body ? "POST" : "GET", throw: false,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${host.state.billingAccessToken}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let response = await request();
  if (response.status === 401 && await host.refreshSession()) response = await request();
  return response;
}
export function resumeAccountCheckout(host: CheckoutHost): void {
  const pending = host.state.pendingAccountCheckout;
  if (!pending || legacyPending(host) || !host.state.billingAccountLinked || pending.email !== owner(host) || timers.has(host.state)) return;
  const timer = setTimeout(() => {
    timers.delete(host.state);
    if (running.has(host.state)) { resumeAccountCheckout(host); return; }
    const operation = recoverAccountCheckout(host);
    running.set(host.state, operation);
    void operation.catch(error => diagnostics.failure("billing-checkout.recover", error)).finally(() => { running.delete(host.state); resumeAccountCheckout(host); });
  }, 15000);
  timers.set(host.state, timer);
  (timer as any).unref?.();
}
/** Retain old purchase journals without replaying their keys or price IDs into v2. */
export async function recoverAccountCheckout(host: CheckoutHost, allowOpen = true): Promise<void> {
  const pending = host.state.pendingAccountCheckout;
  if (!pending || legacyPending(host) || !host.state.billingAccountLinked || pending.email !== owner(host)) return;
  const current = () => host.state.pendingAccountCheckout === pending && pending.email === owner(host) && host.state.billingAccountLinked;
  await host.persist();
  if (!current()) return;
  let response;
  if (!pending.checkoutId) {
    response = await send(host, "/checkouts", { app_id: host.appId, offer_code: pending.plan, retry_key: pending.key, return_url: null });
    const data = response.json?.data;
    const rejected = ["offer_unavailable", "payment_provider_disabled", "new_sales_disabled",
      "owner_membership_required", "account_unavailable", "merchant_not_qualified",
      "country_not_qualified", "currency_not_qualified", "return_url_not_allowed",
      "provider_price_unavailable", "provider_price_readback_unavailable", "provider_grant_mapping_unavailable"];
    if (current() && rejected.includes(response.json?.error?.code)) {
      host.state.pendingAccountCheckout = null;
      await host.persist();
      new Notice("This offer is unavailable. Refresh the plans and choose an available offer.");
      return;
    }
    if (!current() || response.status !== 202 || !validCheckout(data, host, pending)) return;
    pending.checkoutId = data.checkout_id;
    await host.persist();
  }
  response = await send(host, `/checkouts/${encodeURIComponent(pending.checkoutId!)}`);
  const data = response.json?.data;
  if (!current() || response.status !== 200 || !validCheckout(data, host, pending) || data.checkout_id !== pending.checkoutId) return;
  pending.status = data.status;
  pending.cancelRequested = data.checkout_instructions?.cancellation_requested === true;
  await host.persist();
  if (!current()) return;
  if (data.fulfillment_status === "fulfilled") {
    await host.syncBalance();
    if (!current()) return;
    host.state.pendingAccountCheckout = null;
    await host.persist();
  } else if (["cancelled", "canceled", "failed", "expired", "voided", "rejected", "declined"].includes(data.status)) {
    host.state.pendingAccountCheckout = null;
    await host.persist();
  } else if (allowOpen && data.status !== "paid" && !pending.cancelRequested && typeof data.checkout_url === "string" && /^https:\/\//.test(data.checkout_url) && !pending.opened) {
    window.open(data.checkout_url, "_blank", "noopener");
    pending.opened = true;
    await host.persist();
  }
}
function validCheckout(data: any, host: CheckoutHost, pending: PendingCheckout): boolean {
  return data?.app_id === host.appId && data?.offer?.code === pending.plan && typeof data?.checkout_id === "string" && !!data.checkout_id;
}
export async function openAccountCheckout(host: CheckoutHost, plan: string): Promise<void> {
  if (running.has(host.state)) return running.get(host.state);
  if (!host.state.billingAccountLinked) { new Notice("Connect your account first."); return; }
  if (legacyPending(host)) { new Notice("An older purchase is unresolved. Connect its account and contact support before another purchase."); return; }
  let saved = host.state.pendingAccountCheckout;
  if (saved && saved.email !== owner(host)) { new Notice("Connect the account that owns the pending purchase first."); return; }
  const operation = (async () => {
    if (saved && saved.plan !== plan) {
      try { await recoverAccountCheckout(host, false); }
      catch (error) { diagnostics.failure("billing-checkout.refresh", error); }
      saved = host.state.pendingAccountCheckout;
      if (saved) {
        new Notice("A purchase is still pending. Use Cancel current purchase, then wait for confirmation before choosing another pack.");
        resumeAccountCheckout(host);
        return;
      }
    }
    host.state.pendingAccountCheckout = saved || { version: 2, key: `checkout_${globalThis.crypto.randomUUID()}`, plan, email: owner(host), startedAt: Date.now() };
    // A manual retry reopens the same purchase; background recovery still opens once.
    if (saved) saved.opened = false;
    try { await recoverAccountCheckout(host); }
    catch (error) { diagnostics.failure("billing-checkout.open", error); new Notice("Checkout is still being confirmed. Retry the same purchase to recover it safely."); }
    finally { resumeAccountCheckout(host); }
  })();
  running.set(host.state, operation);
  try { await operation; } finally { running.delete(host.state); }
}

/** Keep the journal until Constance confirms paid fulfillment or vendor cancellation. */
export async function cancelAccountCheckout(host: CheckoutHost): Promise<void> {
  if (running.has(host.state)) { await running.get(host.state); }
  if (!host.state.billingAccountLinked) { new Notice("Connect your account first."); return; }
  if (legacyPending(host)) { new Notice("An older purchase needs account support before it can be cancelled."); return; }
  const operation = (async () => {
    try {
      await recoverAccountCheckout(host, false);
      const pending = host.state.pendingAccountCheckout;
      if (!pending) { new Notice("Purchase status updated. You can choose another pack."); return; }
      if (!pending.checkoutId || pending.email !== owner(host)) { new Notice("Purchase confirmation is pending. Check status again shortly."); return; }
      const response = await send(host, `/checkouts/${encodeURIComponent(pending.checkoutId)}/cancel`, {});
      if (response.status !== 200) { new Notice("Checkout could not be cancelled yet. Check purchase status before trying again."); return; }
      await recoverAccountCheckout(host, false);
      new Notice(host.state.pendingAccountCheckout
        ? "Cancellation requested. Constance will confirm it before another purchase can start."
        : "Purchase status updated. You can choose another pack.");
    } catch (error) { diagnostics.failure("billing-checkout.cancel", error); new Notice("Cancellation is still being confirmed. Your purchase is retained; check status again shortly."); }
    finally { resumeAccountCheckout(host); }
  })();
  running.set(host.state, operation);
  try { await operation; } finally { running.delete(host.state); }
}

export const openAccountCheckoutByPrice = openAccountCheckout;
