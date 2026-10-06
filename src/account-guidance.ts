import { diagnostics } from "./diagnostics";
import { requestUrl } from "obsidian";
export interface AccountGuidanceHost { appId: string; connected: boolean; defaultAllowance: number; unit: string; workflow: string }
/** Compact common setup; the connected view keeps the next action visible. */
export function renderAccountGuidance(section: HTMLElement, host: AccountGuidanceHost): void {
const diagnosticAction1 = () => {

  const guide = section.createDiv({ cls: "ui-account-intro" });
  guide.createEl("h4", { text: host.connected ? "Ready to use" : "Get started" });
  if (host.connected) { guide.createEl("p", { text: host.workflow }); return; }
  guide.createEl("p", { text: "Enter your email and password below, then choose Connect to sign in or create an account." });
  const label = guide.createEl("p", { text: `Free credits: ${host.defaultAllowance.toLocaleString()} ${host.unit} per account. Connect to check what remains.` });
  const help = guide.createEl("details");
  help.createEl("summary", { text: "Email not received?" });
  help.createEl("p", { text: "Check spam and confirm the email address below. Use the emailed verification link, return here, and Connect again. Correct the email below if needed. If the link expired or no email arrived, open your account page for available recovery options." });
  help.createEl("a", { text: "Open account page", href: "https://app.tutivsoft.com", attr: { target: "_blank", rel: "noopener noreferrer" } });
  help.createEl("p", { text: "Forgot your password? Use the reset link below. Do not create another account to restore purchases." });
  const details = guide.createEl("details"); details.createEl("summary", { text: "About the allowance and purchases" });
  details.createEl("p", { text: host.workflow });
  details.createEl("p", { text: "Connect your account to load your free and purchased credits. Free credits are used first, then purchased credits. Your balance stays with your account after reinstalling. Current quantities and prices are shown in Account." });
  void diagnostics.guard("account-guidance.background_1", () => ((diagnostics?.request?.("network.account-guidance.renderAccountGuidance", requestUrl, { url: `https://app.tutivsoft.com/api/v1/billing/policy?app_id=${encodeURIComponent(host.appId)}`, method: "GET", throw: false }) ?? requestUrl({ url: `https://app.tutivsoft.com/api/v1/billing/policy?app_id=${encodeURIComponent(host.appId)}`, method: "GET", throw: false })).then(response => {
    const p = response.status === 200 ? response.json?.data?.account_free_usage : null;
    if (!p || !Number.isFinite(p.allowance) || p.allowance < 0) return;
    const unit = String(p.unit).replace(/_/g, " ");
    label.setText(p.enabled ? `Free credits: ${Number(p.allowance).toLocaleString()} ${unit} per account. Connect to check what remains.` : "Connect to check your account access and available credits.");
  }).catch((rejectedError1) => {
diagnostics.failure("account-guidance.rejected_2", rejectedError1);})));

}; return diagnostics?.run ? diagnostics.run("account-guidance.renderAccountGuidance", diagnosticAction1) : diagnosticAction1();
}
