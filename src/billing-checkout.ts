import { diagnostics } from "./diagnostics";
import { Notice, Setting, requestUrl } from "obsidian";
import { CONSTANCE_API } from "./constance-v2";

interface PendingCheckout { version?: number; key?: string; plan?: string; email?: string; checkoutId?: string; opened?: boolean; [key: string]: any }
interface CheckoutState {
  billingEmail: string; billingAccessToken: string; billingRefreshToken: string; billingAccountLinked: boolean;
  pendingAccountCheckout?: PendingCheckout | null; [key: string]: any;
}
export interface CheckoutHost {
  state: CheckoutState; appId: string; installationId: string;
  preparationRoot?: HTMLElement;
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

interface Preparation { key?: string; started: number; timer?: ReturnType<typeof setTimeout>; expiry?: ReturnType<typeof setTimeout>; displayTimer?: ReturnType<typeof setInterval>; stop: boolean }
const preparations = new WeakMap<object, Preparation>();
/** Foreground checks use the original journal. Background recovery stays available. */
export function prepareAccountCheckout(host: CheckoutHost): void {
  const purchase = host.state.pendingAccountCheckout;
  if (!purchase) return;
  const previous = preparations.get(host.state);
  if (previous) { previous.stop = true; clearTimeout(previous.timer); clearTimeout(previous.expiry); clearInterval(previous.displayTimer); }
  const preparation: Preparation = {key:purchase.key,started:Date.now(),stop:false};
  preparations.set(host.state,preparation);
  const root = host.preparationRoot;
  root?.querySelector('.checkout-preparation')?.remove();
  const panel = root?.createDiv({cls:'checkout-preparation checkout-progress'});
  const progress = panel?.createEl?.('progress');
  progress?.setAttribute('aria-label','Purchase in progress');
  progress?.setAttribute('max','3');
  const steps = panel?.createEl?.('p',{text:'1. Open checkout / 2. Complete payment / 3. Verify access',cls:'checkout-progress-steps'});
  let message = 'Please wait while we prepare your secure payment link. Checkout will open automatically. You can cancel this purchase below.';
  let checkButton: any, cancelButton: any;
  const feedback = panel ? new Setting(panel).setName('Preparing your payment') : undefined;
  const refreshMessage = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - preparation.started) / 1000));
    feedback?.setDesc(`${message} Elapsed: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.`);
  };
  feedback?.descEl.setAttribute('role', 'status');
  feedback?.descEl.setAttribute('aria-live', 'polite');
  feedback?.addButton(button => {
    checkButton = button;
    button.setButtonText('Check payment').onClick(async () => {
      button.setDisabled(true);
      try {
        await recoverAccountCheckout(host, false);
        if(!host.state.pendingAccountCheckout)finish(completedMessage());
        else {message='Purchase status checked. We will keep checking for confirmation.';refreshMessage();}
      } catch(error) {diagnostics.failure('billing-checkout.check-view',error);message='Could not check payment yet. Your purchase is saved. Try Check payment again.';refreshMessage();}
      finally {button.setDisabled(!host.state.pendingAccountCheckout);}
    });
  }).addButton(button => {
    cancelButton = button;
    button.setButtonText('Cancel current purchase').onClick(async () => {
      button.setDisabled(true);
      message = 'Checking your purchase and requesting cancellation. Please wait.';
      refreshMessage();
      try {
        await cancelAccountCheckout(host);
        const pending = host.state.pendingAccountCheckout;
        if(!pending) finish(completedMessage());
        else {message=pending.cancelRequested ? 'Cancellation requested. Checking every 5 seconds for confirmation.' : pending.status==='paid' ? 'Payment received. Waiting for your balance update. Do not pay again.' : 'Cancellation is not confirmed yet. We will keep checking your original purchase.'; refreshMessage();}
      } catch (error) {
        diagnostics.failure('billing-checkout.cancel-view', error);
        finish('Cancellation could not be confirmed. Your purchase is saved. Use Check payment before buying again.', true);
      } finally { button.setDisabled(!host.state.pendingAccountCheckout || !!host.state.pendingAccountCheckout.cancelRequested || host.state.pendingAccountCheckout.status === 'paid'); }
    });
  });
  const finish = (text: string, canRetry = false) => {
    preparation.stop=true; clearTimeout(preparation.timer); clearTimeout(expiry); clearInterval(preparation.displayTimer); preparations.delete(host.state);
    message=text; refreshMessage();
    const completed=host.state.lastAccountCheckoutResult;
    if(progress) {
      if(completed?.key===preparation.key && completed.email===owner(host) && completed.fulfilled) {
        progress.value=3;progress.setAttribute('aria-label','Purchase complete');
      } else progress.hidden=true;
    }
    if(checkButton)checkButton.setDisabled(!host.state.pendingAccountCheckout);
    if(cancelButton) cancelButton.setDisabled(!host.state.pendingAccountCheckout || !!host.state.pendingAccountCheckout.cancelRequested || host.state.pendingAccountCheckout.status === 'paid');
    resumeAccountCheckout(host);
  };
  refreshMessage();
  preparation.displayTimer=setInterval(() => {
    if(panel?.isConnected === false) { clearInterval(preparation.displayTimer); return; }
    refreshMessage();
  },1000);
  (preparation.displayTimer as any).unref?.();
  panel?.scrollIntoView?.({block:'nearest'});
  const completedMessage = () => {
    const result=host.state.lastAccountCheckoutResult;
    if(result?.key===preparation.key && result.email===owner(host)) {
      feedback?.setName(result.fulfilled ? 'Purchase complete' : 'Purchase closed');
      return result.fulfilled ? 'Payment confirmed. Your balance has been updated. You can use your purchased credits now.' : `Purchase ${result.status}. Check your balance before buying again.`;
    }
    return 'Purchase status updated. Check your account balance.';
  };
  const tick = async () => {
    if(preparation.stop) return;
    const pending=host.state.pendingAccountCheckout;
    if(!pending) { finish(completedMessage()); return; }
    if(pending.key!==preparation.key || pending.email!==owner(host) || !host.state.billingAccountLinked) { finish('Connect the purchasing account to check this payment.'); return; }
    if(!running.has(host.state)) {
      const work=recoverAccountCheckout(host);
      running.set(host.state,work);
      try { await work; } catch(error) { diagnostics.failure('billing-checkout.prepare',error); message='The payment service is taking longer. Your original purchase is saved. Please wait or cancel below.'; refreshMessage(); }
      finally { if(running.get(host.state)===work) running.delete(host.state); }
    }
    if(preparation.stop) return;
    const current=host.state.pendingAccountCheckout;
    if(!current) { finish(completedMessage()); return; }
    if(current.key!==preparation.key || current.email!==owner(host) || !host.state.billingAccountLinked) { finish('Connect the purchasing account to check this payment.'); return; }
    if(progress) {if(current.opened || current.status==='paid')progress.value=current.status==='paid' ? 2 : 1;else progress.removeAttribute('value');}
    feedback?.setName(current.cancelRequested ? 'Confirming cancellation' : current.status==='paid' ? 'Verifying your payment' : current.opened ? 'Waiting for payment confirmation' : 'Preparing your payment');
    message=current.cancelRequested ? 'Cancellation requested. Checking every 5 seconds for confirmation.' : current.status==='paid' ? 'Payment received. Waiting for your balance update. Do not pay again.' : current.opened ? 'Complete payment in your browser. We check every 5 seconds and will show when your balance is updated. Do not pay again.' : 'Preparing your payment link. Checking every 5 seconds. You can cancel below.';
    refreshMessage();
    if(cancelButton)cancelButton.setDisabled(!!current.cancelRequested || current.status==='paid');
    const remaining=300000-(Date.now()-preparation.started);
    if(remaining<=0) { finish('Confirmation is taking longer than five minutes. Use Check payment to continue checking this purchase. Do not pay again.',true); return; }
    if(remaining<=2000)return;
    preparation.timer=setTimeout(tick,Math.min(5000,remaining));
    (preparation.timer as any).unref?.();
  };
  const expiry=setTimeout(()=>finish('Confirmation is taking longer than five minutes. Use Check payment to continue checking this purchase. Do not pay again.',true),300000);
  preparation.expiry=expiry;
  (expiry as any).unref?.();
  preparation.timer=setTimeout(tick,3000);
  (preparation.timer as any).unref?.();
}

export function resumeAccountCheckout(host: CheckoutHost): void {
  const pending = host.state.pendingAccountCheckout;
  if (!pending || legacyPending(host) || !host.state.billingAccountLinked || pending.email !== owner(host) || timers.has(host.state) || preparations.has(host.state)) return;
  const timer = setTimeout(() => {
    timers.delete(host.state);
    if (running.has(host.state)) { resumeAccountCheckout(host); return; }
    const operation = recoverAccountCheckout(host);
    running.set(host.state, operation);
    void operation.catch(error => diagnostics.failure("billing-checkout.recover", error)).finally(() => { running.delete(host.state); resumeAccountCheckout(host); });
  }, 60000);
  timers.set(host.state, timer);
  (timer as any).unref?.();
}
/** Retain old purchase journals without replaying their keys or price IDs into v2. */
export async function recoverAccountCheckout(host: CheckoutHost, allowOpen = true, createOnly = false): Promise<void> {
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
  if (createOnly) return;
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
    host.state.lastAccountCheckoutResult = {key:pending.key,email:pending.email,status:data.status,fulfilled:true};
    host.state.pendingAccountCheckout = null;
    await host.persist();
  } else if (["cancelled", "canceled", "failed", "expired", "voided", "rejected", "declined"].includes(data.status)) {
    host.state.lastAccountCheckoutResult = {key:pending.key,email:pending.email,status:data.status,fulfilled:false};
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
    prepareAccountCheckout(host);
    try { await recoverAccountCheckout(host, true, true); }
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
