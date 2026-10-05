import { requestUrl } from "obsidian";
export interface AccountGuidanceHost { appId: string; connected: boolean; defaultAllowance: number; unit: string; workflow: string }
/** The same account setup panel across Obsidian apps; hidden after connection. */
export function renderAccountGuidance(section: HTMLElement, host: AccountGuidanceHost): void {
  if (host.connected) return;
  section.createEl("h4", { text: "Get started" });
  section.createEl("p", { text: "Create an account or sign in below, verify your email if requested, then connect your account." });
  const label = section.createEl("p", { text: `Default lifetime allowance (4 October 2026): ${host.defaultAllowance.toLocaleString()} ${host.unit} once per registered account. Connect to confirm your remaining balance.` });
  section.createEl("p", { text: "Your free allowance is our thank-you for trying the app. A registered, connected account is required to help prevent abuse. Your lifetime allowance is shared across installations and is used before purchased credits." });
  section.createEl("p", { text: host.workflow });
  section.createEl("p", { text: "When you are ready, you can add more credits at affordable prices. Current offers and prices appear below." });
  void requestUrl({ url: `https://app.tutivsoft.com/api/v1/billing/policy?app_id=${encodeURIComponent(host.appId)}`, method: "GET", throw: false }).then(response => {
    const p = response.status === 200 ? response.json?.data?.account_free_usage : null;
    if (!p || !Number.isFinite(p.allowance) || p.allowance < 0) return;
    label.setText(p.enabled ? `Current free allowance: ${Number(p.allowance).toLocaleString()} ${p.unit} per registered account (${p.period}). Connect to see your remaining balance.` : "A registered, connected account is required. Check the current credit options below.");
  }).catch(() => {});
}
