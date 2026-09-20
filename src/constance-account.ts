import { Notice, Setting, requestUrl } from "obsidian";

export const CONSTANCE_ACCOUNT_BASE_URL = "https://app.tutivsoft.com";

export interface ConstanceAccountState {
  billingEmail: string;
  billingAccessToken: string;
  billingAccountLinked: boolean;
}

export interface ConstanceAccountAdapter {
  state: ConstanceAccountState;
  appId: string;
  installationId: string;
  appVersion?: string;
  persist(): Promise<void>;
  syncBalance(): Promise<void>;
  refresh?(): void;
}

export type FreeUsageResult =
  | { kind: "ok"; remaining: number }
  | { kind: "insufficient" }
  | { kind: "auth-required" }
  | { kind: "error" };

export type AccountSpendResult =
  | { kind: "ok"; balance: number }
  | { kind: "insufficient" }
  | { kind: "auth-required" }
  | { kind: "error" };

function errorDetail(response: { json?: any; text?: string }, fallback: string): string {
  return String(response.json?.detail || response.json?.message || response.text || fallback);
}

async function authenticate(
  mode: "login" | "register",
  email: string,
  password: string,
  installationId: string,
): Promise<string> {
  const body = mode === "register"
    ? { email, password, external_customer_id: installationId }
    : { email, password };
  const response = await requestUrl({
    url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/auth/${mode}`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorDetail(response, `Billing ${mode} failed (HTTP ${response.status})`));
  }
  const token = String(response.json?.access_token || "");
  if (!token) throw new Error("Constance did not return an account token.");
  return token;
}

async function linkInstallation(adapter: ConstanceAccountAdapter, token: string): Promise<void> {
  const response = await requestUrl({
    url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/installations/link`,
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      app_id: adapter.appId,
      installation_id: adapter.installationId,
      legacy_external_customer_id: adapter.installationId,
      platform: "obsidian",
      app_version: adapter.appVersion || undefined,
    }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorDetail(response, `Installation link failed (HTTP ${response.status})`));
  }
}

export async function signInBillingAccount(
  adapter: ConstanceAccountAdapter,
  password: string,
  mode: "login" | "register",
): Promise<void> {
  const email = adapter.state.billingEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid billing email.");
  if (password.length < 8) throw new Error("Password must contain at least 8 characters.");
  if (!adapter.installationId) throw new Error("The plugin installation ID is not ready.");
  const token = await authenticate(mode, email, password, adapter.installationId);
  await linkInstallation(adapter, token);
  adapter.state.billingEmail = email;
  adapter.state.billingAccessToken = token;
  adapter.state.billingAccountLinked = true;
  await adapter.persist();
  await adapter.syncBalance();
}

export async function validateBillingSession(adapter: ConstanceAccountAdapter): Promise<boolean> {
  const token = adapter.state.billingAccessToken;
  if (!token || !adapter.state.billingAccountLinked || !adapter.installationId) return false;
  const query = new URLSearchParams({ app_id: adapter.appId, installation_id: adapter.installationId });
  const response = await requestUrl({
    url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/entitlements/me?${query.toString()}`,
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    throw: false,
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    adapter.state.billingAccountLinked = false;
    adapter.state.billingAccessToken = "";
    await adapter.persist();
    return false;
  }
  return response.status >= 200 && response.status < 300;
}

export async function claimAccountFreeUsage(
  state: ConstanceAccountState,
  appId: string,
  installationId: string,
  eventId: string,
  amount: number,
): Promise<FreeUsageResult> {
  if (!state.billingAccessToken || !state.billingAccountLinked) return { kind: "auth-required" };
  try {
    const response = await requestUrl({
      url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/free-usage/claim`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.billingAccessToken}` },
      body: JSON.stringify({ app_id: appId, installation_id: installationId, event_id: eventId, amount }),
      throw: false,
    });
    if (response.status === 402) return { kind: "insufficient" };
    if (response.status === 401 || response.status === 403 || response.status === 404) return { kind: "auth-required" };
    if (response.status < 200 || response.status >= 300) return { kind: "error" };
    return { kind: "ok", remaining: Math.max(0, Number(response.json?.data?.remaining) || 0) };
  } catch (error) {
    console.error("Constance account free-usage claim failed", error);
    return { kind: "error" };
  }
}

/** Spend paid credits only after Constance verifies the signed-in account owns this installation. */
export async function spendAccountCredits(
  state: ConstanceAccountState,
  appId: string,
  installationId: string,
  eventId: string,
  amount: number,
): Promise<AccountSpendResult> {
  if (!state.billingAccessToken || !state.billingAccountLinked) return { kind: "auth-required" };
  try {
    const response = await requestUrl({
      url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/credits/spend`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.billingAccessToken}` },
      body: JSON.stringify({ app_id: appId, installation_id: installationId, event_id: eventId, amount }),
      throw: false,
    });
    if (response.status === 402) return { kind: "insufficient" };
    if (response.status === 401 || response.status === 403 || response.status === 404) return { kind: "auth-required" };
    if (response.status < 200 || response.status >= 300) return { kind: "error" };
    const balance = Number(response.json?.data?.credits?.balance);
    return Number.isFinite(balance) ? { kind: "ok", balance: Math.max(0, balance) } : { kind: "error" };
  } catch (error) {
    console.error("Constance authenticated credit spend failed", error);
    return { kind: "error" };
  }
}

export function addBillingAccountSettings(containerEl: HTMLElement, adapter: ConstanceAccountAdapter): void {
  let password = "";
  new Setting(containerEl)
    .setName("Billing account email")
    .setDesc("Used for sign-in, purchase restore, and checkout. Reinstalling no longer creates a new free allowance.")
    .addText((text) => text.setPlaceholder("you@example.com").setValue(adapter.state.billingEmail).onChange(async (value) => {
      adapter.state.billingEmail = value.trim();
      await adapter.persist();
    }));
  new Setting(containerEl)
    .setName("Billing account password")
    .setDesc("Used only for this sign-in request. The password is never saved by the plugin.")
    .addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("At least 8 characters").onChange((value) => { password = value; });
    });
  const status = adapter.state.billingAccountLinked ? "Signed in and linked" : "Not signed in";
  new Setting(containerEl)
    .setName("Billing account")
    .setDesc(`${status}. The saved bearer session can restore purchases; your password is not stored.`)
    .addButton((button) => button.setButtonText("Sign in").onClick(async () => {
      button.setDisabled(true);
      try {
        await signInBillingAccount(adapter, password, "login");
        new Notice("Billing account signed in and this installation was linked.");
        adapter.refresh?.();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Billing sign-in failed.");
      } finally {
        button.setDisabled(false);
      }
    }))
    .addButton((button) => button.setButtonText("Create account").onClick(async () => {
      button.setDisabled(true);
      try {
        await signInBillingAccount(adapter, password, "register");
        new Notice("Billing account created and this installation was linked.");
        adapter.refresh?.();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Billing account creation failed.");
      } finally {
        button.setDisabled(false);
      }
    }))
    .addButton((button) => button.setButtonText("Sign out").setDisabled(!adapter.state.billingAccessToken).onClick(async () => {
      adapter.state.billingAccessToken = "";
      adapter.state.billingAccountLinked = false;
      await adapter.persist();
      new Notice("Billing account signed out on this installation.");
      adapter.refresh?.();
    }));
}
