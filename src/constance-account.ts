import { CONSTANCE_API, accountBalance } from "./constance-v2";
import { applySettingsLayout } from "./settings-layout";
import { diagnostics } from "./diagnostics";
import { renderAccountGuidance } from "./account-guidance";
import { resumeAccountCheckout } from "./billing-checkout";
import { Notice, Setting, requestUrl, RequestUrlParam } from "obsidian";

const pendingConnections = new WeakSet<object>();
async function connectWithinDeadline(state: object, operation: () => Promise<unknown>, refresh: () => void): Promise<void> {
  if (pendingConnections.has(state)) throw new Error("account_connection_pending");
  pendingConnections.add(state);
  const request = Promise.resolve().then(operation);
  const finish = () => { pendingConnections.delete(state); try { refresh(); } catch (_) {} };
  request.then(finish, finish);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([request, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("account_connection_pending")), 15000);
  })]); } finally { if (timer !== undefined) clearTimeout(timer); }
}

export const CONSTANCE_ACCOUNT_BASE_URL = "https://app.tutivsoft.com";

export interface ConstanceAccountState {
  billingEmail: string;
  billingAccessToken: string;
  billingRefreshToken: string;
  billingAccessTokenExpiresAt?: number;
  billingAccountLinked: boolean;
  billingRegistrationPending?: boolean;
  billingV2InstallationId?: string;
  billingV2InstallationToken?: string;
  billingV2InstallationOwner?: string;
  billingV2Installations?: Record<string, { id: string; token: string }>;
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

export type AuthenticatedCheckoutResult =
  | { kind: "ok"; checkoutUrl: string; checkoutId?: string }
  | { kind: "fallback" }
  | { kind: "auth-required" };

class ConstanceAccountError extends Error {
  readonly status: number;
  code?: string;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ConstanceAccountError";
    this.status = status;
  }
}

function errorDetail(response: { json?: any; text?: string }, fallback: string): string {
  const payload = response.json?.error || response.json?.data || response.json;
  const detail = payload?.detail;
  const code = detail?.code || payload?.code;
  if (code === "invalid_credentials") return "The email or password is incorrect. Use Forgot password? to reset it.";
  if (code === "email_verification_required") return "Email not verified. Click the link in your email, then Connect again.";
  return String(detail?.message || (typeof detail === "string" ? detail : "") || payload?.message || fallback);
}

async function linkAuthenticatedInstallation(adapter: ConstanceAccountAdapter, token: string): Promise<void> {
const diagnosticEnd1 = diagnostics?.start?.("constance-account.linkAuthenticatedInstallation") ?? (() => {});
try {

  try {
    await linkInstallation(adapter, token);
  } catch (error) {
diagnostics.failure("constance-account.caught_1", error);
    if (error instanceof ConstanceAccountError && error.status === 401) {
      adapter.state.billingAccessToken = "";
      adapter.state.billingRefreshToken = "";
      adapter.state.billingAccountLinked = false;
      await adapter.persist();
    }
    throw error;
  }

} catch (diagnosticError1) { diagnostics?.failure?.("constance-account.linkAuthenticatedInstallation", diagnosticError1); throw diagnosticError1; } finally { diagnosticEnd1(); }
}

async function authenticate(mode: "login" | "register" | "connect", email: string, password: string, appId: string): Promise<AuthenticationResult> {
  const action = mode === "connect" ? "login" : mode;
  const response = await requestUrl({ url: `${CONSTANCE_API}/auth/${action}`, method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, app_id: appId, ...(action === "login" ? { mode: "customer" } : {}) }), throw: false });
  if (response.status < 200 || response.status >= 300) {
    const error = new ConstanceAccountError(errorDetail(response, "Could not connect your account. Try again."), response.status);
    error.code = response.json?.error?.code || response.json?.detail?.code || response.json?.data?.detail?.code;
    if (mode === "connect" && error.code === "invalid_credentials") return authenticate("register", email, password, appId);
    throw error;
  }
  if (action === "register" && response.status === 202) return { verificationRequired: true };
  const data = response.json?.data;
  if (data?.access_token && data?.refresh_token) return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  throw new Error("Could not sign in. Try connecting again.");
}

async function linkInstallation(adapter: ConstanceAccountAdapter, token: string): Promise<void> {
  const state = adapter.state;
  const owner = state.billingEmail.trim().toLowerCase();
  const current = () => state.billingAccessToken === token && state.billingEmail.trim().toLowerCase() === owner;
  if (!current()) throw new Error("Account connection changed.");
  if (state.billingV2InstallationOwner && state.billingV2InstallationId && state.billingV2InstallationToken) {
    state.billingV2Installations ||= {};
    state.billingV2Installations[state.billingV2InstallationOwner] = { id: state.billingV2InstallationId, token: state.billingV2InstallationToken };
  }
  if (state.billingV2InstallationOwner !== owner) {
    const saved = state.billingV2Installations?.[owner];
    state.billingV2InstallationId = saved?.id;
    state.billingV2InstallationToken = saved?.token;
    state.billingV2InstallationOwner = owner;
  }
  if (!state.billingV2InstallationId || !state.billingV2InstallationToken) {
    const created = await requestUrl({ url: `${CONSTANCE_API}/public/installations`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: adapter.appId }), throw: false });
    const data = created.json?.data;
    if (created.status !== 201 || !data?.installation_id || !data?.installation_token) throw new ConstanceAccountError(errorDetail(created, "Could not register this installation."), created.status);
    if (!current()) throw new Error("Account connection changed.");
    state.billingV2InstallationId = String(data.installation_id);
    state.billingV2InstallationToken = String(data.installation_token);
    state.billingV2InstallationOwner = owner;
    await adapter.persist();
  }
  // Save again before every retry, including after a previous persistence failure.
  await adapter.persist();
  if (!current()) throw new Error("Account connection changed.");
  const response = await requestUrl({ url: `${CONSTANCE_API}/billing/installations/link`, method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ installation_id: state.billingV2InstallationId, token: state.billingV2InstallationToken }), throw: false });
  if (response.status < 200 || response.status >= 300) throw new ConstanceAccountError(errorDetail(response, "Could not connect this installation."), response.status);
  if (response.json?.data?.linked !== true || response.json.data.installation_id !== state.billingV2InstallationId) throw new Error("Installation ownership could not be verified.");
}

export async function signInBillingAccount(
  adapter: ConstanceAccountAdapter,
  password: string,
  mode: "login" | "register" | "connect",
): Promise<void> {
const diagnosticEnd4 = diagnostics?.start?.("constance-account.signInBillingAccount") ?? (() => {});
try {

  const email = adapter.state.billingEmail.trim().toLowerCase();
  const journalState = adapter.state as ConstanceAccountState & Record<string, any>;
  const owner = String(journalState.pendingBillingOwnerEmail || "").toLowerCase();
  if (owner && owner !== email) throw new Error(`A pending action belongs to ${owner}. Connect that account to resume it first.`);
  const unfinished = (journalState.operationJournal || []).filter((item: any) => ["requesting", "reserved", "writing", "verified", "uncertain_released"].includes(item.state));
  if (unfinished.some((item: any) => item.account !== email)) throw new Error("A saved conversion belongs to another account. Connect that account first.");
  const pending = [journalState.pendingAccountCheckout, journalState.pendingPriceCheckout, journalState.pendingPaddleCheckout, journalState.previewPendingCheckout, ...(journalState.pendingSpendEvents || [])].filter(Boolean);
  if (pending.some(item => String(item.owner || item.email || journalState.billingV2InstallationOwner || email).trim().toLowerCase() !== email)) throw new Error("A pending action belongs to another account. Connect that account first.");

  if (!email || !email.includes("@")) throw new Error("Enter a valid email address.");
  if (Array.from(password).length < 1 || Array.from(password).length > 256) throw new Error("Enter a password of up to 256 characters. New accounts require at least 12 characters.");
  if (!adapter.installationId) throw new Error("The plugin is still starting. Try again shortly.");
  const result = await authenticate(mode, email, password, adapter.appId);
  if (!result.accessToken) {
    clearBillingSession(adapter.state);
    adapter.state.billingEmail = email;
    adapter.state.billingAccountLinked = false;
    adapter.state.billingRegistrationPending = true;
    await adapter.persist();
    throw new Error("Registered but not logged in. Check your email, click the confirmation link, then sign in here.");
  }
  await completeBillingSignIn(adapter, email, result);

} catch (diagnosticError4) { diagnostics?.failure?.("constance-account.signInBillingAccount", diagnosticError4); throw diagnosticError4; } finally { diagnosticEnd4(); }
}

async function completeBillingSignIn(adapter: ConstanceAccountAdapter, email: string, session: AuthenticationResult): Promise<void> {
const diagnosticEnd5 = diagnostics?.start?.("constance-account.completeBillingSignIn") ?? (() => {});
try {

  if (!session.accessToken || !session.refreshToken) throw new Error("Could not complete sign-in. Try connecting again.");
  adapter.state.billingEmail = email;
  adapter.state.billingAccessToken = session.accessToken;
  adapter.state.billingRefreshToken = session.refreshToken;
  adapter.state.billingAccessTokenExpiresAt = Date.now() + (session.expiresIn || 900) * 1000;
  adapter.state.billingAccountLinked = false;
  adapter.state.billingRegistrationPending = false;
  await adapter.persist();
  if (adapter.state.billingAccessToken !== session.accessToken || adapter.state.billingEmail !== email) throw new Error("Account connection changed. Connect again.");
  await linkAuthenticatedInstallation(adapter, session.accessToken);
  if (adapter.state.billingAccessToken !== session.accessToken || adapter.state.billingEmail !== email) throw new Error("Account connection changed. Connect again.");
  adapter.state.billingAccountLinked = true;
  await adapter.persist();
  await adapter.syncBalance();

} catch (diagnosticError5) { diagnostics?.failure?.("constance-account.completeBillingSignIn", diagnosticError5); throw diagnosticError5; } finally { diagnosticEnd5(); }
}

export async function verifyBillingAccount(adapter: ConstanceAccountAdapter, verificationToken: string): Promise<void> {
const diagnosticEnd6 = diagnostics?.start?.("constance-account.verifyBillingAccount") ?? (() => {});
try {

  const token = verificationToken.trim();
  if (!token) throw new Error("Enter the verification code from your email.");
  const response = await (diagnostics?.request?.("network.constance-account.verifyBillingAccount", requestUrl, {
    url: `${CONSTANCE_API}/auth/verify`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    throw: false,
  }) ?? requestUrl({
    url: `${CONSTANCE_API}/auth/verify`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    throw: false,
  }));
  if (response.status < 200 || response.status >= 300) {
    throw new ConstanceAccountError(errorDetail(response, `Your account could not be verified. Try connecting again.`), response.status);
  }
  if (response.json?.data?.verified !== true) throw new Error("Email verification could not be confirmed.");
  clearBillingSession(adapter.state);
  adapter.state.billingRegistrationPending = false;
  await adapter.persist();
  new Notice("Email verified. Connect again to sign in.");

} catch (diagnosticError6) { diagnostics?.failure?.("constance-account.verifyBillingAccount", diagnosticError6); throw diagnosticError6; } finally { diagnosticEnd6(); }
}

export function clearBillingSession(input: ConstanceAccountState | ConstanceAccountAdapter, _persist?: any): void {
  const state = "state" in input ? input.state : input;
  state.billingAccessToken = "";
  state.billingRefreshToken = "";
  state.billingAccessTokenExpiresAt = 0;
  state.billingAccountLinked = false;
}

const refreshes = new WeakMap<ConstanceAccountState, Promise<boolean>>();
export async function refreshBillingSession(state: ConstanceAccountState, persist: () => Promise<void> = async () => {}): Promise<boolean> {
const diagnosticEnd7 = diagnostics?.start?.("constance-account.refreshBillingSession") ?? (() => {});
try {

  if (!state.billingRefreshToken) return false;
  const pendingRefresh = refreshes.get(state);
  if (pendingRefresh) return await pendingRefresh;
  const originalToken = state.billingRefreshToken;
  const refreshInFlight = (async () => {
const diagnosticEnd8 = diagnostics?.start?.("constance-account.background.8317") ?? (() => {});
try {

    let response;
    try {
      response = await (diagnostics?.request?.("network.constance-account.refreshBillingSession", requestUrl, { url: `${CONSTANCE_API}/auth/refresh`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: originalToken }), throw: false }) ?? requestUrl({ url: `${CONSTANCE_API}/auth/refresh`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: originalToken }), throw: false }));
    } catch (caughtError2) {
diagnostics.failure("constance-account.caught_3", caughtError2); return false; }
    if (state.billingRefreshToken !== originalToken) return false;
    if (response.status === 401 || response.status === 403) { clearBillingSession(state); await persist(); return false; }
    if (response.status < 200 || response.status >= 300) return false;
    const access = String(response.json?.data?.access_token || "");
    const refresh = String(response.json?.data?.refresh_token || "");
    if (!access || !refresh) { clearBillingSession(state); await persist(); return false; }
    state.billingAccessToken = access;
    state.billingRefreshToken = refresh;
    state.billingAccessTokenExpiresAt = Date.now() + (Number(response.json?.data?.expires_in) || 900) * 1000;
    await persist();
    return true;

} catch (diagnosticError8) { diagnostics?.failure?.("constance-account.background.8317", diagnosticError8); throw diagnosticError8; } finally { diagnosticEnd8(); }
})();
  refreshes.set(state, refreshInFlight);
  try { return await refreshInFlight; } finally { refreshes.delete(state); }

} catch (diagnosticError7) { diagnostics?.failure?.("constance-account.refreshBillingSession", diagnosticError7); throw diagnosticError7; } finally { diagnosticEnd7(); }
}

export async function requestAuthenticatedBilling(state: ConstanceAccountState, persist: (() => Promise<void>) | any, options: any = undefined): Promise<any> {
if (!options) { options = persist; persist = async () => {}; }
const diagnosticEnd9 = diagnostics?.start?.("constance-account.requestAuthenticatedBilling") ?? (() => {});
try {

  if (state.billingRefreshToken && (!state.billingAccessToken || Date.now() >= Number(state.billingAccessTokenExpiresAt || 0) - 60_000)) {
    if (!await refreshBillingSession(state, persist) && state.billingRefreshToken) return { status: 503 };
  }
  const send = () => (diagnostics?.request?.("network.constance-account.requestAuthenticatedBilling", requestUrl, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${state.billingAccessToken}` }, throw: false }) ?? requestUrl({ ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${state.billingAccessToken}` }, throw: false }));
  if (!state.billingAccessToken) return { status: 401 };
  let response = await send();
  if (response.status === 401 && state.billingRefreshToken) {
    if (await refreshBillingSession(state, persist)) response = await send();
    else if (state.billingRefreshToken) return { status: 503 };
  }
  return await (response);

} catch (diagnosticError9) { diagnostics?.failure?.("constance-account.requestAuthenticatedBilling", diagnosticError9); throw diagnosticError9; } finally { diagnosticEnd9(); }
}

export async function createAuthenticatedCheckout(
  adapter: ConstanceAccountAdapter,
  planCode: string,
  idempotencyKey: string,
): Promise<AuthenticatedCheckoutResult> {
const diagnosticEnd10 = diagnostics?.start?.("constance-account.createAuthenticatedCheckout") ?? (() => {});
try {

  if (!adapter.state.billingAccessToken || !adapter.state.billingAccountLinked) return { kind: "auth-required" };
  const pending = (adapter.state as any).pendingAccountCheckout;
  if (pending?.version !== 2 || pending?.key !== idempotencyKey || pending?.plan !== planCode || pending?.email !== adapter.state.billingEmail.trim().toLowerCase()) return { kind: "fallback" };
  await adapter.persist();
  const response = await requestAuthenticatedBilling(adapter.state, adapter.persist, {
    url: `${CONSTANCE_API}/checkouts`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ app_id: adapter.appId, offer_code: planCode, retry_key: idempotencyKey, return_url: null }),
    throw: false,
  });
  if (response.status === 401 || response.status === 403) return { kind: "auth-required" };
  if (response.status < 200 || response.status >= 300) return { kind: "fallback" };
  const data = response.json?.data;
  const checkoutUrl = typeof data?.checkout_url === "string" ? data.checkout_url : "";
  return data?.app_id === adapter.appId && data?.offer?.code === planCode && data?.checkout_id
    ? { kind: "ok", checkoutUrl, checkoutId: data?.checkout_id ? String(data.checkout_id) : undefined }
    : { kind: "fallback" };

} catch (diagnosticError10) { diagnostics?.failure?.("constance-account.createAuthenticatedCheckout", diagnosticError10); throw diagnosticError10; } finally { diagnosticEnd10(); }
}

export async function pollAuthenticatedCheckout(adapter: ConstanceAccountAdapter, checkoutId: string): Promise<boolean> {
const diagnosticEnd11 = diagnostics?.start?.("constance-account.pollAuthenticatedCheckout") ?? (() => {});
try {

  if (!adapter.state.billingAccessToken || !adapter.state.billingAccountLinked) return false;
  const response = await requestAuthenticatedBilling(adapter.state, adapter.persist, {
    url: `${CONSTANCE_API}/checkouts/${encodeURIComponent(checkoutId)}`,
    method: "GET",
    throw: false,
  });
  return await (response.status >= 200 && response.status < 300 && response.json?.data?.app_id === adapter.appId && response.json?.data?.checkout_id === checkoutId && response.json?.data?.fulfillment_status === "fulfilled");

} catch (diagnosticError11) { diagnostics?.failure?.("constance-account.pollAuthenticatedCheckout", diagnosticError11); throw diagnosticError11; } finally { diagnosticEnd11(); }
}

export async function validateBillingSession(adapter: ConstanceAccountAdapter): Promise<boolean> {
const diagnosticEnd12 = diagnostics?.start?.("constance-account.validateBillingSession") ?? (() => {});
try {

  resumeAccountCheckout({ ...adapter, refreshSession: () => refreshBillingSession(adapter.state, adapter.persist) });

  const token = adapter.state.billingAccessToken;
  if (!token || !adapter.state.billingAccountLinked || !adapter.installationId) return false;
  const query = new URLSearchParams({ app_id: adapter.appId, installation_id: adapter.installationId });
  const response = await requestAuthenticatedBilling(adapter.state, adapter.persist, {
    url: `${CONSTANCE_API}/billing/entitlements/me?${query.toString()}`,
    method: "GET",
    throw: false,
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    clearBillingSession(adapter.state);
    await adapter.persist();
    return false;
  }
  return await (response.status >= 200 && response.status < 300);

} catch (diagnosticError12) { diagnostics?.failure?.("constance-account.validateBillingSession", diagnosticError12); throw diagnosticError12; } finally { diagnosticEnd12(); }
}

export async function claimAccountFreeUsage(..._args: any[]): Promise<FreeUsageResult> { return {kind:"error"}; }

/** Spend paid credits only after Constance verifies the signed-in account owns this installation. */
export async function spendAccountCredits(..._args: any[]): Promise<AccountSpendResult> { return {kind:"error"}; }

export function addBillingAccountSettings(containerEl: HTMLElement, adapter: ConstanceAccountAdapter): void {
  resumeAccountCheckout({ ...adapter, refreshSession: () => refreshBillingSession(adapter.state, adapter.persist) });

  let password = "";
  const section = containerEl.createDiv({ cls: "constance-account-billing-section" });

  renderAccountGuidance(section, {appId:adapter.appId,connected:Boolean(adapter.state.billingAccountLinked && adapter.state.billingAccessToken),defaultAllowance:5,unit:"captures",workflow:"Start with 5 captures on your account. Free credits are used automatically before purchased credits."});
  section.createEl("h3", { text: "Account and billing" });
  const state = adapter.state as ConstanceAccountState & Record<string, unknown>;
  const accountStatus = adapter.state.billingAccountLinked
    ? `Signed in as ${adapter.state.billingEmail || "your account"}`
    : state.billingRegistrationPending
      ? `Registered as ${adapter.state.billingEmail} but not signed in. Check your email, click the confirmation link, then sign in here.`
      : "Not signed in.";
  section.createEl("p", {
    cls: "constance-account-status",
    text: accountStatus,
  });

  if (!adapter.state.billingAccountLinked) {
  new Setting(section)
    .setName("Email")
    .setDesc("Use the email associated with your account and purchases.")
    .addText((text) => text.setPlaceholder("you@example.com").setValue(adapter.state.billingEmail).setDisabled(adapter.state.billingAccountLinked).onChange(async (value) => {
return diagnostics.guard("constance-account.control_4", async () => {
const diagnosticEnd15 = diagnostics?.start?.("control.email.onChange") ?? (() => {});
try {

      const journalState = adapter.state as ConstanceAccountState & Record<string, any>;
      const hasPending = Object.entries(journalState).some(([key, value]) => /^pending/i.test(key) && key !== "pendingBillingOwnerEmail" && !!value && (Array.isArray(value) ? value.length > 0 : typeof value === "object" ? Object.keys(value).length > 0 : true));
      if (hasPending && !journalState.pendingBillingOwnerEmail) journalState.pendingBillingOwnerEmail = adapter.state.billingEmail;
      if (!hasPending) journalState.pendingBillingOwnerEmail = undefined;
      adapter.state.billingEmail = value.trim();
      await adapter.persist();

} catch (diagnosticError15) { diagnostics?.failure?.("control.email.onChange", diagnosticError15); throw diagnosticError15; } finally { diagnosticEnd15(); }

});
}));
  new Setting(section)
    .setName("Password")
    .setDesc("Your password is used to sign in and is not saved by the plugin.")
    .addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.maxLength = 256;
      text.setPlaceholder("12 or more characters for a new account").onChange((value) => {
return diagnostics.guard("constance-account.control_5", () => {
const diagnosticAction16 = () => {
 password = value;
}; return diagnostics?.run ? diagnostics.run("control.19062.onChange", diagnosticAction16) : diagnosticAction16();

});
});
    });
  }
  new Setting(section)
    .setName("Account")
    .setDesc(accountStatus)
    .addButton((button) => { if (adapter.state.billingAccountLinked) { button.buttonEl.remove(); return; } button.setButtonText("Connect").setDisabled(adapter.state.billingAccountLinked).onClick(async () => {
return diagnostics.guard("constance-account.control_6", async () => {
const diagnosticEnd17 = diagnostics?.start?.("control.connect.onClick") ?? (() => {});
try {

      button.setDisabled(true);
      try {
        await connectWithinDeadline(adapter.state, () => signInBillingAccount(adapter, password, "connect"), () => adapter.refresh?.());
        password = "";
        new Notice(adapter.state.billingRegistrationPending ? "Check your email and follow the verification link, then Connect again." : `Connected as ${adapter.state.billingEmail}.`);
        adapter.refresh?.();
      } catch (error) {
diagnostics.failure("constance-account.caught_7", error);
        new Notice(error instanceof Error ? error.message : "Account connection failed. Try again.");
        // Keep the account unlinked and allow the existing Connect action to retry.
        adapter.refresh?.();
      } finally { button.setDisabled(adapter.state.billingAccountLinked || pendingConnections.has(adapter.state)); }

} catch (diagnosticError17) { diagnostics?.failure?.("control.connect.onClick", diagnosticError17); throw diagnosticError17; } finally { diagnosticEnd17(); }

});
}); })
    .addButton((button) => button.setButtonText("Sign out").setDisabled(!adapter.state.billingAccessToken).onClick(async () => {
return diagnostics.guard("constance-account.control_8", async () => {
const diagnosticEnd18 = diagnostics?.start?.("control.account.onClick") ?? (() => {});
try {

      const refreshToken = adapter.state.billingRefreshToken;
      const accessToken = adapter.state.billingAccessToken;
      clearBillingSession(adapter.state);
      state.billingRegistrationPending = false;
      await adapter.persist();
      if (refreshToken) void diagnostics.guard("constance-account.background_9", () => ((diagnostics?.request?.("network.constance-account.addBillingAccountSettings", requestUrl, { url: `${CONSTANCE_API}/auth/logout`, method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({}), throw: false }) ?? requestUrl({ url: `${CONSTANCE_API}/auth/logout`, method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({}), throw: false })).catch((rejectedError1) => {
diagnostics.failure("constance-account.rejected_2", rejectedError1);})));
      new Notice("Signed out.");
      adapter.refresh?.();

} catch (diagnosticError18) { diagnostics?.failure?.("control.account.onClick", diagnosticError18); throw diagnosticError18; } finally { diagnosticEnd18(); }

});
}));

  if (!adapter.state.billingAccountLinked) {
    for (const [purpose, name] of [["reset", "Forgot password?"], ["verify", "Resend verification email"]] as const) {
      new Setting(section).setName(name).addButton(button => button.setButtonText("Send email").onClick(async () => {
        try {
          const response = await requestUrl({ url: `${CONSTANCE_API}/auth/recovery`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: adapter.state.billingEmail.trim(), purpose }), throw: false });
          if (response.status !== 202) throw new Error("Email could not be requested. Try again.");
          new Notice("If eligible, an email has been queued. Check your inbox and spam.");
        } catch (error) { diagnostics.failure("constance-account.recovery", error); }
      }));
    }
  }

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
  queueMicrotask(() => applySettingsLayout(containerEl, adapter.appId, adapter.appVersion));
}

/** A single welcome with an actionable setup link; account guidance stays in settings until connected. */
export async function showAccountWelcome(plugin: import("obsidian").Plugin, state: ConstanceAccountState, persist: () => Promise<void>): Promise<void> {
const diagnosticEnd20 = diagnostics?.start?.("constance-account.showAccountWelcome") ?? (() => {});
try {

  const openSetup = (): void => {
    const settings = (plugin.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    settings.open(); settings.openTabById(plugin.manifest.id);
  };
  plugin.addCommand({ id: "open-account-setup", name: "Get started: connect your account", callback: openSetup });
  // PluginSupport owns the single first-use welcome and persists through the host.

} catch (diagnosticError20) { diagnostics?.failure?.("constance-account.showAccountWelcome", diagnosticError20); throw diagnosticError20; } finally { diagnosticEnd20(); }
}

export const authenticatedBillingRequest = requestAuthenticatedBilling;
export const verifyBillingAccountRegistration = verifyBillingAccount;
export async function activeBillingToken(adapter: ConstanceAccountAdapter, force = false): Promise<string> {
 if (force || !adapter.state.billingAccessToken) await refreshBillingSession(adapter.state, adapter.persist);
 return adapter.state.billingAccessToken;
}
export const ensureBillingAccessToken = activeBillingToken;
export async function billingRequest(adapter: ConstanceAccountAdapter, options: any): Promise<any> {
 const response = await requestAuthenticatedBilling(adapter.state, adapter.persist, options);
 if (response.status === 200 && options.url.includes("/billing/entitlements/me")) return {...response,json:{data:accountBalance(response.json?.data,adapter.appId)}};
 return response;
}
export async function signOutBillingAccount(adapter: ConstanceAccountAdapter): Promise<void> { clearBillingSession(adapter.state); await adapter.persist(); }
export async function registerBillingAccount(adapter: ConstanceAccountAdapter, password: string): Promise<void> { await signInBillingAccount(adapter,password,"register"); }
export function registerBillingPersister(_state: ConstanceAccountState, _persist: () => Promise<void>): void {}

export const refreshBillingAccessToken = refreshBillingSession;
