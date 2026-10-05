import { renderAccountGuidance } from "./account-guidance";
import { resumeAccountCheckout } from "./billing-checkout";
import { Notice, Setting, requestUrl } from "obsidian";

export const CONSTANCE_ACCOUNT_BASE_URL = "https://app.tutivsoft.com";

export interface ConstanceAccountState {
  billingEmail: string;
  billingAccessToken: string;
  billingRefreshToken: string;
  billingAccessTokenExpiresAt: number;
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
  refreshToken?: string;
  expiresIn?: number;
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

class ConstanceAccountError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ConstanceAccountError";
    this.status = status;
  }
}

function errorDetail(response: { json?: any; text?: string }, fallback: string): string {
  const payload = response.json?.data || response.json;
  const detail = payload?.detail;
  const code = detail?.code || payload?.code;
  if (code === "invalid_credentials") return "The email or password is incorrect. Use Forgot password? to reset it.";
  if (code === "email_verification_required") return "Email not verified. Click the link in your email, then Connect again.";
  return String(detail?.message || (typeof detail === "string" ? detail : "") || payload?.message || fallback);
}

async function linkAuthenticatedInstallation(adapter: ConstanceAccountAdapter, token: string): Promise<void> {
  try {
    await linkInstallation(adapter, token);
  } catch (error) {
    if (error instanceof ConstanceAccountError && error.status === 401) {
      adapter.state.billingAccessToken = "";
      adapter.state.billingRefreshToken = "";
      adapter.state.billingAccountLinked = false;
      await adapter.persist();
    }
    throw error;
  }
}

async function authenticate(
  mode: "login" | "register" | "connect",
  email: string,
  password: string,
  installationId: string,
): Promise<AuthenticationResult> {
  const body = mode !== "login"
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
    throw new ConstanceAccountError(errorDetail(response, `Billing ${mode} failed (HTTP ${response.status})`), response.status);
  }
  if (response.json?.verification_required === true) return { verificationRequired: true };
  const token = String(response.json?.access_token || "");
  if (token) return { accessToken: token, refreshToken: String(response.json?.refresh_token || ""), expiresIn: Number(response.json?.expires_in) || 900 };
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
    throw new ConstanceAccountError(errorDetail(response, `Installation link failed (HTTP ${response.status})`), response.status);
  }
}

export async function signInBillingAccount(
  adapter: ConstanceAccountAdapter,
  password: string,
  mode: "login" | "register" | "connect",
): Promise<void> {
  const email = adapter.state.billingEmail.trim().toLowerCase();
  const journalState = adapter.state as ConstanceAccountState & Record<string, any>;
  const owner = String(journalState.pendingBillingOwnerEmail || "").toLowerCase();
  if (owner && owner !== email) throw new Error(`An unfinished billing request belongs to ${owner}. Connect that account to recover it first.`);

  if (!email || !email.includes("@")) throw new Error("Enter a valid billing email.");
  if (Array.from(password).length < 8 || Array.from(password).length > 128) throw new Error("Password must be between 8 and 128 characters.");
  if (!adapter.installationId) throw new Error("The plugin installation ID is not ready.");
  const result = await authenticate(mode, email, password, adapter.installationId);
  if (!result.accessToken) {
    adapter.state.billingEmail = email;
    await clearBillingSession(adapter.state, () => adapter.persist());
    adapter.state.billingRegistrationPending = true;
    await adapter.persist();
    throw new Error("Registered but not logged in. Check your email, click the confirmation link, then sign in here.");
  }
  await completeBillingSignIn(adapter, email, result.accessToken, result.refreshToken || "", result.expiresIn || 900);
}

async function completeBillingSignIn(adapter: ConstanceAccountAdapter, email: string, token: string, refreshToken: string, expiresIn: number): Promise<void> {
  adapter.state.billingEmail = email;
  adapter.state.billingAccessToken = token;
  adapter.state.billingRefreshToken = refreshToken;
  adapter.state.billingAccessTokenExpiresAt = Date.now() + expiresIn * 1000;
  adapter.state.billingAccountLinked = false;
  adapter.state.billingRegistrationPending = false;
  await adapter.persist();
  await linkAuthenticatedInstallation(adapter, token);
  adapter.state.billingAccountLinked = true;
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
    throw new ConstanceAccountError(errorDetail(response, `Billing account verification failed (HTTP ${response.status})`), response.status);
  }
  const accessToken = String(response.json?.access_token || "");
  if (!accessToken) throw new Error("Constance did not return an account token after verification.");
  await completeBillingSignIn(adapter, adapter.state.billingEmail.trim().toLowerCase(), accessToken, String(response.json?.refresh_token || ""), Number(response.json?.expires_in) || 900);
}

const refreshes = new WeakMap<ConstanceAccountState, Promise<boolean>>();

export async function clearBillingSession(state: ConstanceAccountState, persist: () => Promise<void>): Promise<void> {
  state.billingAccessToken = "";
  state.billingRefreshToken = "";
  state.billingAccessTokenExpiresAt = 0;
  state.billingAccountLinked = false;
  await persist();
}

const billingRefreshes = new WeakMap<ConstanceAccountState, Promise<boolean>>();

export async function refreshBillingSession(state: ConstanceAccountState, persist?: () => Promise<void>, force = false): Promise<boolean> {
  if (!force && state.billingAccessToken && (!state.billingRefreshToken || state.billingAccessTokenExpiresAt > Date.now() + 30000)) return true;
  const pending = billingRefreshes.get(state);
  if (pending) { const ok = await pending; if (ok) await persist?.(); return ok; }
  const original = state.billingRefreshToken;
  if (!original) return false;
  const operation = (async () => {
    try {
      const response = await requestUrl({
        url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/auth/refresh`, method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: original }), throw: false,
      });
      if (state.billingRefreshToken !== original) return false;
      if (response.status === 401 || response.status === 403) {
        state.billingAccessToken = ""; state.billingRefreshToken = ""; state.billingAccountLinked = false;
        await persist?.(); return false;
      }
      if (response.status < 200 || response.status >= 300) return false;
      const access = String(response.json?.access_token || "");
      const refresh = String(response.json?.refresh_token || "");
      if (!access || !refresh) return false;
      state.billingAccessToken = access; state.billingRefreshToken = refresh;
      state.billingAccessTokenExpiresAt = Date.now() + (Number(response.json?.expires_in) || 900) * 1000;
      await persist?.(); return true;
    } catch { return false; }
  })();
  billingRefreshes.set(state, operation);
  try { return await operation; } finally { billingRefreshes.delete(state); }
}

export async function authenticatedBillingRequest(
  state: ConstanceAccountState, persist: () => Promise<void>, options: Exclude<Parameters<typeof requestUrl>[0], string>,
): Promise<Awaited<ReturnType<typeof requestUrl>>> {
  if (!await refreshBillingSession(state, persist)) return { status: state.billingRefreshToken ? 503 : 401, headers: {}, arrayBuffer: new ArrayBuffer(0), text: "", json: {} };
  const send = () => requestUrl({ ...options, headers: { ...options.headers, Authorization: `Bearer ${state.billingAccessToken}` }, throw: false });
  let response = await send();
  if (response.status === 401 && await refreshBillingSession(state, persist, true)) response = await send();
  return response;
}

export async function validateBillingSession(adapter: ConstanceAccountAdapter): Promise<boolean> {
  resumeAccountCheckout({ ...adapter, refreshSession: () => refreshBillingSession(adapter.state, adapter.persist) });

  if (!adapter.state.billingAccessToken || !adapter.state.billingAccountLinked || !adapter.installationId) return false;
  const query = new URLSearchParams({ app_id: adapter.appId, installation_id: adapter.installationId });
  const response = await authenticatedBillingRequest(adapter.state, () => adapter.persist(), {
    url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/entitlements/me?${query.toString()}`,
    method: "GET",
    throw: false,
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    if (adapter.state.billingRefreshToken) return false;
    await clearBillingSession(adapter.state, () => adapter.persist());
    return false;
  }
  return response.status >= 200 && response.status < 300;
}

export async function claimAccountFreeUsage(
  adapter: ConstanceAccountAdapter,
  appId: string,
  installationId: string,
  eventId: string,
  amount: number,
): Promise<FreeUsageResult> {
  const state = adapter.state;
  if (!state.billingAccessToken || !state.billingAccountLinked) return { kind: "auth-required" };
  try {
    const response = await authenticatedBillingRequest(state, () => adapter.persist(), {
      url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/free-usage/claim`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, installation_id: installationId, event_id: eventId, amount }),
      throw: false,
    });
    if (response.status === 402) return { kind: "insufficient" };
    if ((response.status === 401 || response.status === 403) && state.billingRefreshToken) return { kind: "error" };
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
  adapter: ConstanceAccountAdapter,
  appId: string,
  installationId: string,
  eventId: string,
  amount: number,
): Promise<AccountSpendResult> {
  const state = adapter.state;
  if (!state.billingAccessToken || !state.billingAccountLinked) return { kind: "auth-required" };
  try {
    const response = await authenticatedBillingRequest(state, () => adapter.persist(), {
      url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/billing/credits/spend`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, installation_id: installationId, event_id: eventId, amount }),
      throw: false,
    });
    if (response.status === 402) return { kind: "insufficient" };
    if ((response.status === 401 || response.status === 403) && state.billingRefreshToken) return { kind: "error" };
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
  resumeAccountCheckout({ ...adapter, refreshSession: () => refreshBillingSession(adapter.state, adapter.persist) });

  let password = "";
  const section = containerEl.createDiv({ cls: "constance-account-billing-section" });
  section.createEl("h3", { text: "Account and billing" });
  renderAccountGuidance(section, {appId:adapter.appId,connected:Boolean(adapter.state.billingAccountLinked && adapter.state.billingAccessToken),defaultAllowance:5,unit:"captures",workflow:"Start with 5 captures over the lifetime of your account. Free credits are used automatically before purchased credits."});
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
    text: adapter.state.billingAccountLinked && adapter.state.billingAccessToken && numericBalances.length ? `${accountStatus} Balance — ${numericBalances.join("; ")}` : accountStatus,
  });

  new Setting(section)
    .setName("Email")
    .setDesc("Used to register, sign in, restore purchases, and open checkout.")
    .addText((text) => text.setPlaceholder("you@example.com").setValue(adapter.state.billingEmail).onChange(async (value) => {
      if (adapter.state.billingAccountLinked && value.trim().toLowerCase() !== adapter.state.billingEmail.trim().toLowerCase()) {
        new Notice("Sign out before changing the billing account email.");
        text.setValue(adapter.state.billingEmail);
        return;
      }
      const journalState = adapter.state as ConstanceAccountState & Record<string, any>;
      const hasPending = Object.entries(journalState).some(([key, value]) => /^pending/i.test(key) && key !== "pendingBillingOwnerEmail" && !!value && (Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.keys(value).length > 0 : true));
      if (hasPending && !journalState.pendingBillingOwnerEmail) journalState.pendingBillingOwnerEmail = adapter.state.billingEmail;
      if (!hasPending) journalState.pendingBillingOwnerEmail = undefined;
      adapter.state.billingEmail = value.trim();
      await adapter.persist();
    }));
  new Setting(section)
    .setName("Password")
    .setDesc("Used only for this request. The plugin never saves your password.")
    .addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.maxLength = 256;
      text.setPlaceholder("8 to 128 characters").onChange((value) => { password = value; });
    });
  new Setting(section)
    .setName("Account")
    .setDesc(accountStatus)
    .addButton((button) => button.setButtonText("Connect").setDisabled(adapter.state.billingAccountLinked).onClick(async () => {
      button.setDisabled(true);
      try {
        await signInBillingAccount(adapter, password, "connect");
        password = "";
        new Notice(adapter.state.billingRegistrationPending ? "Check your email and follow the verification link, then Connect again." : `Connected as ${adapter.state.billingEmail}.`);
        adapter.refresh?.();
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "Connection failed. Please try again.");
        adapter.refresh?.();
      } finally { button.setDisabled(adapter.state.billingAccountLinked); }
    }))
    .addButton((button) => button.setButtonText("Sign out").setDisabled(!adapter.state.billingAccessToken).onClick(async () => {
      const refreshToken = adapter.state.billingRefreshToken;
      if (refreshToken) {
        try { await requestUrl({ url: `${CONSTANCE_ACCOUNT_BASE_URL}/api/v1/auth/logout`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: refreshToken, all_devices: false }), throw: false }); } catch { /* Local sign-out still proceeds. */ }
      }
      await clearBillingSession(adapter.state, () => adapter.persist());
      state.billingRegistrationPending = false;
      await adapter.persist();
      new Notice("Signed out.");
      adapter.refresh?.();
    }));

  new Setting(section).setName("Forgot password?").setDesc("Reset your billing account password in Constance.")
    .addButton((button) => button.setButtonText("Open reset page").onClick(() => window.open(`${CONSTANCE_ACCOUNT_BASE_URL}/password-reset`, "_blank")));

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
