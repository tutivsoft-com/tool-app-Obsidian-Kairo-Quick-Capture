import { Notice, Setting, requestUrl } from "obsidian";

export const CONSTANCE_ACCOUNT_BASE_URL = "https://app.tutivsoft.com";

export interface ConstanceAccountState {
  billingEmail: string;
  billingAccessToken: string;
  billingAccountLinked: boolean;
  billingRegistrationPending?: boolean;
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

interface AuthenticationResult {
  accessToken?: string;
  verificationRequired?: boolean;
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
): Promise<AuthenticationResult> {
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
  if (token) return { accessToken: token };
  if (response.json?.verification_required === true) return { verificationRequired: true };
  throw new Error("Constance did not return an account token.");
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
  const result = await authenticate(mode, email, password, adapter.installationId);
  if (!result.accessToken) {
    adapter.state.billingEmail = email;
    adapter.state.billingAccountLinked = false;
    adapter.state.billingRegistrationPending = true;
    await adapter.persist();
    throw new Error("Registered but not logged in. Check your email, click the confirmation link, then sign in here.");
  }
  await completeBillingSignIn(adapter, email, result.accessToken);
}

async function completeBillingSignIn(adapter: ConstanceAccountAdapter, email: string, token: string): Promise<void> {
  await linkInstallation(adapter, token);
  adapter.state.billingEmail = email;
  adapter.state.billingAccessToken = token;
  adapter.state.billingAccountLinked = true;
  adapter.state.billingRegistrationPending = false;
  await adapter.persist();
  await adapter.syncBalance();
}

export async function verifyBillingAccount(adapter: ConstanceAccountAdapter, verificationToken: string): Promise<void> {
  const token = verificationToken.trim();
  if (!token) throw new Error("Enter the verification token from your billing email.");
  const response = await requestUrl({
    url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/auth/register/verify`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorDetail(response, `Billing account verification failed (HTTP ${response.status})`));
  }
  const accessToken = String(response.json?.access_token || "");
  if (!accessToken) throw new Error("Constance did not return an account token after verification.");
  await completeBillingSignIn(adapter, adapter.state.billingEmail.trim().toLowerCase(), accessToken);
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
    const remaining = Math.max(0, Number(response.json?.data?.remaining) || 0);
    new Notice(`Credit balance before this task: ${(remaining + amount).toLocaleString()} free credits.`);
    new Notice(`Task used ${amount.toLocaleString()} credits. Balance remaining: ${remaining.toLocaleString()} free credits.`);
    return { kind: "ok", remaining };
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
    if (!Number.isFinite(balance)) return { kind: "error" };
    const remaining = Math.max(0, balance);
    new Notice(`Credit balance before this task: ${(remaining + amount).toLocaleString()} purchased credits.`);
    new Notice(`Task used ${amount.toLocaleString()} credits. Balance remaining: ${remaining.toLocaleString()} purchased credits.`);
    return { kind: "ok", balance: remaining };
  } catch (error) {
    console.error("Constance authenticated credit spend failed", error);
    return { kind: "error" };
  }
}

export function addBillingAccountSettings(containerEl: HTMLElement, adapter: ConstanceAccountAdapter): void {
  let password = "";
  const section = containerEl.createDiv({ cls: "constance-account-billing-section" });
  section.createEl("h3", { text: "Account and billing" });
  const state = adapter.state as ConstanceAccountState & Record<string, unknown>;
  const numericBalances = Object.entries(state)
    .filter(([key, value]) => /(?:credit|balance|remaining)/i.test(key) && typeof value === "number")
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${Number(value).toLocaleString()}`);
  const accountStatus = adapter.state.billingAccountLinked
    ? `Signed in as ${adapter.state.billingEmail || "your account"}`
    : state.billingRegistrationPending
      ? `Registered as ${adapter.state.billingEmail} but not signed in. Check your email, click the confirmation link, then sign in here.`
      : "Not signed in.";
  section.createEl("p", {
    cls: "constance-account-status",
    text: numericBalances.length ? `${accountStatus} Balance — ${numericBalances.join("; ")}` : accountStatus,
  });

  new Setting(section)
    .setName("Email")
    .setDesc("Used to register, sign in, restore purchases, and open checkout.")
    .addText((text) => text.setPlaceholder("you@example.com").setValue(adapter.state.billingEmail).onChange(async (value) => {
      adapter.state.billingEmail = value.trim();
      await adapter.persist();
    }));
  new Setting(section)
    .setName("Password")
    .setDesc("Used only for this request. The plugin never saves your password.")
    .addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("At least 8 characters").onChange((value) => { password = value; });
    });
  new Setting(section)
    .setName("Account")
    .setDesc(accountStatus)
    .addButton((button) => button.setButtonText("Register").setDisabled(adapter.state.billingAccountLinked).onClick(async () => {
      button.setDisabled(true);
      try {
        await signInBillingAccount(adapter, password, "register");
        new Notice("Registered and signed in.");
        adapter.refresh?.();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Registration failed.");
        adapter.refresh?.();
      } finally {
        button.setDisabled(false);
      }
    }))
    .addButton((button) => button.setButtonText("Sign in").setDisabled(adapter.state.billingAccountLinked).onClick(async () => {
      button.setDisabled(true);
      try {
        await signInBillingAccount(adapter, password, "login");
        new Notice(`Signed in as ${adapter.state.billingEmail}.`);
        adapter.refresh?.();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Sign-in failed.");
      } finally {
        button.setDisabled(false);
      }
    }))
    .addButton((button) => button.setButtonText("Sign out").setDisabled(!adapter.state.billingAccessToken).onClick(async () => {
      adapter.state.billingAccessToken = "";
      adapter.state.billingAccountLinked = false;
      state.billingRegistrationPending = false;
      await adapter.persist();
      new Notice("Signed out.");
      adapter.refresh?.();
    }));

  const firstHeading = containerEl.querySelector(":scope > h1, :scope > h2");
  if (firstHeading?.nextSibling) containerEl.insertBefore(section, firstHeading.nextSibling);
  else containerEl.prepend(section);
  queueMicrotask(() => {
    const candidates = Array.from(containerEl.querySelectorAll(":scope > .setting-item"));
    for (const item of candidates) {
      const label = item.textContent || "";
      if (/buy|checkout|refresh balance|sync balance|credit pack/i.test(label)) section.appendChild(item);
    }
    for (const summary of Array.from(containerEl.querySelectorAll('[class*="credit"][class*="summary"], [class*="balance"][class*="summary"]'))) {
      if (!section.contains(summary)) section.appendChild(summary);
    }
  });
}
