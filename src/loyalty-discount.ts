// Static offer copy only; no expiry, pricing, or checkout behavior.
export function renderLoyaltyDiscount(root: HTMLElement, pricesBelow = true): HTMLElement {
  const doc = root.ownerDocument;
  const box = doc.createElement("div");
  box.className = "loyalty-discount-offer";
  box.style.cssText = "padding:14px;margin:12px 0;border:1px solid var(--interactive-accent,var(--accent,var(--brand,#6366f1)));border-radius:8px;background:var(--background-secondary,var(--surface,transparent));line-height:1.5";
  const title = doc.createElement("strong");
  title.textContent = "Thank you for choosing this app!";
  const offer = doc.createElement("p");
  offer.style.margin = "8px 0";
  offer.append(doc.createTextNode(pricesBelow ? "Get 50% off all prices below with coupon " : "Get 50% off with coupon "));
  const code = doc.createElement("code");
  code.textContent = "OBSLOYALE3";
  offer.append(code, doc.createTextNode("."));
  const instructions = doc.createElement("p");
  instructions.style.margin = "8px 0";
  instructions.textContent = "On the payment page, click Add discount on the left and enter the coupon code.";
  const validity = doc.createElement("p");
  validity.style.margin = "8px 0";
  validity.textContent = "Valid until the end of this quarter.";
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Copy code";
  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.marginLeft = "8px";
  button.addEventListener("click", async () => {
    try {
      await doc.defaultView?.navigator.clipboard.writeText("OBSLOYALE3");
      if (!doc.defaultView?.navigator.clipboard) throw new Error("Clipboard unavailable");
      status.textContent = "Code copied.";
    } catch (error) {
      const focused = doc.activeElement;
      const field = doc.createElement("textarea");
      field.value = "OBSLOYALE3";
      field.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      doc.body.appendChild(field);
      field.select();
      let copied = false;
      try { copied = doc.execCommand("copy"); }
      catch (copyError) { console.error("Coupon copy failed", copyError); }
      finally { field.remove(); if (focused instanceof HTMLElement) focused.focus(); }
      status.textContent = copied ? "Code copied." : "Select and copy OBSLOYALE3 manually.";
    }
  });
  box.append(title, offer, instructions, validity, button, status);
  root.appendChild(box);
  return box;
}
