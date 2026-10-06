import { diagnostics } from "./diagnostics";
import { resumeAccountCheckout } from "./billing-checkout";
import { refreshBillingSession } from "./constance-account";
import { Notice } from "obsidian";
import { authenticatedBillingRequest, clearBillingSession, spendAccountCredits, claimAccountFreeUsage } from "./constance-account";

const CONSTANCE_BASE_URL = "https://app.tutivsoft.com";
export const CONSTANCE_APP_ID = "kairo-quick-capture";
export const FREE_USES_PER_DAY = 5;

export interface BillingSettings {
  constanceDeviceId: string;
  billingEmail: string;
  billingAccessToken: string;
  billingRefreshToken: string;
  billingAccessTokenExpiresAt: number;
  billingAccountLinked: boolean;
  freeUsesRemaining: number;
  freeUsesDay: string;
  purchasedUses: number;
  pendingSpendEvents: Array<{ eventId: string; amount: number }>;
  pendingFreeCaptureClaim?: string;
  completedCaptureCharges?: string[];
}

export type SpendResult =
  | { kind: "ok"; balance: number }
  | { kind: "insufficient" }
  | { kind: "error" };

export type LocalUseResult = "free" | "none";

type BillingPlugin = {
  settings: BillingSettings;
  persist(): Promise<void>;
  pollAfterCheckout?(checkoutId?: string): void;
};

type AuthenticatedCheckoutResult =
  | { kind: "ok"; checkoutUrl: string; checkoutId?: string }
  | { kind: "error" }
  | { kind: "auth-required" };

const billingLocks = new WeakMap<object, Promise<unknown>>();

function withBillingLock<T>(plugin: BillingPlugin, work: () => Promise<T>): Promise<T> {
  const previous = billingLocks.get(plugin) ?? Promise.resolve();
  const current = previous.catch((rejectedError1) => { diagnostics.failure("billing.rejected_2", rejectedError1); return (undefined); }).then(work);
  billingLocks.set(plugin, current);
  return current.finally(() => {
    if (billingLocks.get(plugin) === current) billingLocks.delete(plugin);
  });
}

export function currentDayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function generateSecureDeviceId(): string {
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateEventId(): string {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return `evt_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function normalizeBillingSettings(settings: BillingSettings, date = new Date()): void {
  settings.constanceDeviceId = typeof settings.constanceDeviceId === "string" ? settings.constanceDeviceId : "";
  settings.billingEmail = typeof settings.billingEmail === "string" ? settings.billingEmail : "";
  settings.billingAccessToken = typeof settings.billingAccessToken === "string" ? settings.billingAccessToken : "";
  settings.billingRefreshToken = typeof settings.billingRefreshToken === "string" ? settings.billingRefreshToken : "";
  settings.billingAccessTokenExpiresAt = Number.isFinite(settings.billingAccessTokenExpiresAt) ? settings.billingAccessTokenExpiresAt : 0;
  settings.billingAccountLinked = settings.billingAccountLinked === true && Boolean(settings.billingAccessToken);
  settings.freeUsesRemaining = Number.isFinite(settings.freeUsesRemaining)
    ? Math.max(0, Math.min(FREE_USES_PER_DAY, Math.trunc(settings.freeUsesRemaining)))
    : FREE_USES_PER_DAY;
  settings.purchasedUses = Number.isFinite(settings.purchasedUses)
    ? Math.max(0, Math.trunc(settings.purchasedUses))
    : 0;
  settings.pendingSpendEvents = Array.isArray(settings.pendingSpendEvents)
    ? settings.pendingSpendEvents.filter((item) => item && typeof item.eventId === "string" && Number.isInteger(item.amount) && item.amount > 0)
    : [];
  if (typeof settings.freeUsesDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(settings.freeUsesDay)) {
    settings.freeUsesDay = currentDayKey(date);
    settings.freeUsesRemaining = FREE_USES_PER_DAY;
  }
  resetFreeUsesIfNeeded(settings, date);
}

export function resetFreeUsesIfNeeded(settings: BillingSettings, date = new Date()): void {
  const today = currentDayKey(date);
  if (settings.freeUsesDay !== today) {
    settings.freeUsesDay = today;
  }
}

export function consumeLocalUse(settings: BillingSettings, date = new Date()): LocalUseResult {
  resetFreeUsesIfNeeded(settings, date);
  if (settings.freeUsesRemaining > 0) {
    settings.freeUsesRemaining -= 1;
    return "free";
  }
  return "none";
}

interface EntitlementSnapshot {
  purchasedUses: number;
  freeUsesRemaining?: number;
  freeUsesDay?: string;
}

async function fetchEntitlements(plugin: BillingPlugin): Promise<EntitlementSnapshot> {
const diagnosticEnd1 = diagnostics?.start?.("billing.fetchEntitlements") ?? (() => {});
try {

  const response = await authenticatedBillingRequest(plugin.settings, () => plugin.persist(), {
    url: `${CONSTANCE_BASE_URL}/api/v1/billing/entitlements/me?${new URLSearchParams({ app_id: CONSTANCE_APP_ID, installation_id: plugin.settings.constanceDeviceId }).toString()}`,
    method: "GET",
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Your account could not be updated. Check your connection and try again.`);
  const data = response.json?.data;
  const freeUsage = data?.free_usage;
  const freeRemaining = Number(freeUsage?.remaining);
  const paid = data?.credits?.total_available ?? data?.credits?.balance;
  if (freeUsage?.remaining == null || !Number.isFinite(freeRemaining) || freeRemaining < 0 || paid == null || String(paid).trim() === "" || !Number.isFinite(Number(paid)) || Number(paid) < 0) throw new Error("Your balance could not be updated. Refresh it and try again.");
  const freeDay = typeof freeUsage?.period_key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(freeUsage.period_key)
    ? freeUsage.period_key
    : undefined;
  return {
    purchasedUses: Math.max(0, Number(data?.credits?.total_available ?? data?.credits?.balance) || 0),
    freeUsesRemaining: Number.isFinite(freeRemaining) ? Math.max(0, Math.min(FREE_USES_PER_DAY, Math.trunc(freeRemaining))) : undefined,
    freeUsesDay: freeDay,
  };

} catch (diagnosticError1) { diagnostics?.failure?.("billing.fetchEntitlements", diagnosticError1); throw diagnosticError1; } finally { diagnosticEnd1(); }
}

export async function syncPurchasedUses(plugin: BillingPlugin, strict = false): Promise<void> {
const diagnosticEnd2 = diagnostics?.start?.("billing.syncPurchasedUses") ?? (() => {});
try {

  resumeAccountCheckout({ state: plugin.settings, appId: CONSTANCE_APP_ID, installationId: plugin.settings.constanceDeviceId,
    persist: () => plugin.persist(), syncBalance: () => syncPurchasedUses(plugin), refreshSession: () => refreshBillingSession(plugin.settings, () => plugin.persist()) });

  return await (withBillingLock(plugin, async () => {
const diagnosticEnd3 = diagnostics?.start?.("billing.background.6074") ?? (() => {});
try {

    if (!plugin.settings.constanceDeviceId) return;
    try {
      if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) { if (strict) throw new Error("Connect your account before refreshing."); return; }
      const snapshot = await fetchEntitlements(plugin);
      plugin.settings.purchasedUses = snapshot.purchasedUses;
      if (snapshot.freeUsesRemaining !== undefined) plugin.settings.freeUsesRemaining = snapshot.freeUsesRemaining;
      if (snapshot.freeUsesDay) plugin.settings.freeUsesDay = snapshot.freeUsesDay;
      await plugin.persist();
    } catch (error) {
diagnostics.failure("billing.caught_extra_1", error);
      diagnostics?.legacy?.("error", "billing.kairo_constance_entitlement_sync_failed");
      if (strict) throw error;
    }

} catch (diagnosticError3) { diagnostics?.failure?.("billing.background.6074", diagnosticError3); throw diagnosticError3; } finally { diagnosticEnd3(); }
}));

} catch (diagnosticError2) { diagnostics?.failure?.("billing.syncPurchasedUses", diagnosticError2); throw diagnosticError2; } finally { diagnosticEnd2(); }
}

export async function retryPendingSpendEvents(plugin: BillingPlugin): Promise<void> {
const diagnosticEnd4 = diagnostics?.start?.("billing.retryPendingSpendEvents") ?? (() => {});
try {

  for (const pending of [...(plugin.settings.pendingSpendEvents ?? [])]) {
    const result = await spendConstanceUse(plugin, pending.eventId);
    if (result.kind === "error") break;
    if (result.kind === "ok") plugin.settings.completedCaptureCharges = [...new Set([...(plugin.settings.completedCaptureCharges ?? []), pending.eventId])];
    plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents.filter((item) => item.eventId !== pending.eventId);
    plugin.settings.purchasedUses = result.kind === "ok" ? result.balance : 0;
    await plugin.persist();
  }

} catch (diagnosticError4) { diagnostics?.failure?.("billing.retryPendingSpendEvents", diagnosticError4); throw diagnosticError4; } finally { diagnosticEnd4(); }
}

export async function spendConstanceUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<SpendResult> {
const diagnosticEnd5 = diagnostics?.start?.("billing.spendConstanceUse") ?? (() => {});
try {

  const result = await spendAccountCredits({ state: plugin.settings, persist: () => plugin.persist(), appId: CONSTANCE_APP_ID, installationId: plugin.settings.constanceDeviceId, syncBalance: async () => {} }, CONSTANCE_APP_ID, plugin.settings.constanceDeviceId, eventId, 1);
  if (result.kind === "auth-required") { await clearBillingSession(plugin.settings, () => plugin.persist()); return { kind: "error" }; }
  return await (result.kind === "ok" || result.kind === "insufficient" || result.kind === "error" ? result : { kind: "error" });

} catch (diagnosticError5) { diagnostics?.failure?.("billing.spendConstanceUse", diagnosticError5); throw diagnosticError5; } finally { diagnosticEnd5(); }
}

export async function consumeCaptureUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<boolean> {
const diagnosticEnd6 = diagnostics?.start?.("billing.consumeCaptureUse") ?? (() => {});
try {

  return await (withBillingLock(plugin, async () => {
const diagnosticEnd7 = diagnostics?.start?.("billing.background.8276") ?? (() => {});
try {

    if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) {
      new Notice("Kairo: sign in or create an account in plugin settings before capturing.");
      return false;
    }
    if (plugin.settings.completedCaptureCharges?.includes(eventId)) return true;
    if ((plugin.settings.pendingSpendEvents ?? []).some(item => item.eventId === eventId)) {
      const result = await spendConstanceUse(plugin, eventId);
      if (result.kind !== "ok") return false;
      plugin.settings.completedCaptureCharges = [...new Set([...(plugin.settings.completedCaptureCharges ?? []), eventId])];
      plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents.filter(item => item.eventId !== eventId);
      plugin.settings.purchasedUses = result.balance;
      await plugin.persist(); return true;
    }
    if (plugin.settings.pendingFreeCaptureClaim && plugin.settings.pendingFreeCaptureClaim !== eventId) {
      new Notice("A previous capture is pending. Retry the saved capture before starting another."); return false;
    }
    eventId = plugin.settings.pendingFreeCaptureClaim || eventId;
    plugin.settings.pendingFreeCaptureClaim = eventId;
    await plugin.persist();
    const free = await claimAccountFreeUsage({ state: plugin.settings, persist: () => plugin.persist(), appId: CONSTANCE_APP_ID, installationId: plugin.settings.constanceDeviceId, syncBalance: async () => {} }, CONSTANCE_APP_ID, plugin.settings.constanceDeviceId, eventId, 1);
    if (free.kind === "ok") {
      plugin.settings.completedCaptureCharges = [...new Set([...(plugin.settings.completedCaptureCharges ?? []), eventId])];
      plugin.settings.pendingFreeCaptureClaim = undefined;
      plugin.settings.freeUsesDay = currentDayKey();
      plugin.settings.freeUsesRemaining = free.remaining;
      await plugin.persist();
      return true;
    }
    if (free.kind === "auth-required") {
      await clearBillingSession(plugin.settings, () => plugin.persist());
      new Notice("Kairo: your session expired. Sign in again in plugin settings.");
      return false;
    }
    if (free.kind === "error") {
      new Notice("Kairo: the account allowance could not be verified. Nothing was captured.");
      return false;
    }

    plugin.settings.pendingFreeCaptureClaim = undefined;
    await plugin.persist();
    plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents ?? [];
    await retryPendingSpendEvents(plugin);
    if (plugin.settings.pendingSpendEvents.length > 0) {
      new Notice("Kairo: a previous charge is still being confirmed. Try again when connected.");
      return false;
    }
    plugin.settings.pendingSpendEvents.push({ eventId, amount: 1 });
    await plugin.persist();
    const result = await spendConstanceUse(plugin, eventId);
    if (result.kind === "ok") {
      plugin.settings.completedCaptureCharges = [...new Set([...(plugin.settings.completedCaptureCharges ?? []), eventId])];
      plugin.settings.purchasedUses = result.balance;
      plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents.filter((item) => item.eventId !== eventId);
      await plugin.persist();
      return true;
    }
    if (result.kind === "insufficient") {
      plugin.settings.purchasedUses = 0;
      plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents.filter((item) => item.eventId !== eventId);
      await plugin.persist();
      new Notice("Kairo: no capture credits remain. Add credits in plugin settings.");
      return false;
    }

    new Notice("Kairo: your account could not be verified. Nothing was captured.");
    return false;

} catch (diagnosticError7) { diagnostics?.failure?.("billing.background.8276", diagnosticError7); throw diagnosticError7; } finally { diagnosticEnd7(); }
}));

} catch (diagnosticError6) { diagnostics?.failure?.("billing.consumeCaptureUse", diagnosticError6); throw diagnosticError6; } finally { diagnosticEnd6(); }
}

export async function pollAuthenticatedCheckout(plugin: BillingPlugin, checkoutId: string): Promise<boolean> {
const diagnosticEnd8 = diagnostics?.start?.("billing.pollAuthenticatedCheckout") ?? (() => {});
try {

  if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) return false;
  const response = await authenticatedBillingRequest(plugin.settings, () => plugin.persist(), {
    url: `${CONSTANCE_BASE_URL}/api/v1/billing/checkouts/${encodeURIComponent(checkoutId)}`,
    method: "GET",
    throw: false,
  });
  return await (response.status >= 200 && response.status < 300 && response.json?.data?.settled === true);

} catch (diagnosticError8) { diagnostics?.failure?.("billing.pollAuthenticatedCheckout", diagnosticError8); throw diagnosticError8; } finally { diagnosticEnd8(); }
}
