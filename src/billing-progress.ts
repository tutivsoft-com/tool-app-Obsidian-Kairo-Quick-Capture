/** Display-only checkout feedback. Never infer payment success from elapsed time. */
export function watchCheckoutProgress(host: HTMLElement, state: any): {refresh(): void} {
  const doc = host.ownerDocument;
  const panel = doc.createElement("section"); panel.className = "checkout-progress"; panel.hidden = true;
  const title = doc.createElement("strong"); title.setAttribute("role", "status");
  const elapsed = doc.createElement("time"); elapsed.setAttribute("role", "timer"); elapsed.setAttribute("aria-live", "off");
  const top = doc.createElement("div"); top.className = "checkout-progress-top";
  top.append(title, elapsed);
  const bar = doc.createElement("progress"); bar.setAttribute("aria-label", "Purchase in progress");
  const steps = doc.createElement("p"); steps.className = "checkout-progress-steps";
  steps.textContent = "1. Open checkout / 2. Complete payment / 3. Verify access";
  const detail = doc.createElement("p"); detail.setAttribute("role", "status");
  const estimate = doc.createElement("p"); estimate.className = "checkout-progress-note";
  panel.append(top, bar, steps, detail, estimate); host.appendChild(panel);
  const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };
  let seen = false, started = Date.now(), lastKey = "";
  const refresh = () => {
    const pending = state.pendingAccountCheckout;
    const legacy = ["pendingPriceCheckout", "pendingPaddleCheckout", "previewPendingCheckout"].some(key => !!state[key]);
    if (legacy || pending && pending.version !== 2) {
      elapsed.hidden = true;
      panel.hidden = false; seen = true; bar.hidden = true;
      text(title, "Purchase needs attention");
      text(detail, "An older purchase is retained. Connect its account and check purchase history before buying again.");
      text(estimate, "Contact support if this purchase cannot be confirmed.");
    } else if (pending && state.billingAccountLinked && pending.email === state.billingEmail.trim().toLowerCase()) {
      panel.hidden = false; seen = true; bar.hidden = false; elapsed.hidden = false;
      if (lastKey !== pending.key) {
        const saved = Number(pending.startedAt), now = Date.now();
        started = Number.isFinite(saved) && saved > 0 && saved <= now ? saved : now;
        lastKey = pending.key;
      }
      const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
      elapsed.textContent = "Elapsed " + Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      text(title, pending.cancelRequested ? "Cancellation is being confirmed" : pending.status === "paid" ? "Verifying your payment" : pending.opened ? "Continue in secure checkout" : "Preparing your secure checkout");
      text(detail, pending.cancelRequested ? "Your purchase is retained until Constance confirms cancellation or payment. Check payment before buying again." : pending.status === "paid" ? "Your payment was received. Constance is verifying your access. Please do not pay again." : pending.opened ? "Complete payment in your browser. Your balance updates after Constance verifies your receipt. Please do not pay again while confirmation is pending." : "We are requesting your payment link. Please keep this view open while checkout starts. Your purchase is saved and can be recovered.");
      text(estimate, seconds >= 180 ? "This is taking longer than the 3 minute estimate. Your provider may need more time. Use Check payment before trying again." : "Allow around 3 minutes for checkout and confirmation. This is an estimate; your bank or payment provider may take longer.");
    } else if (seen) {
      bar.hidden = true; elapsed.hidden = true;
      text(title, pending ? "Connect the purchasing account" : "Purchase status updated");
      text(detail, "Review your account balance and purchase history for the confirmed result.");
      text(estimate, "Use the billing controls to refresh your access or review your purchases.");
    }
  };
  const timer = setInterval(() => { if (panel.isConnected === false) clearInterval(timer); else refresh(); }, 1000);
  (timer as any).unref?.();
  refresh();
  return {refresh};
}
