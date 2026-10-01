import { resumeAccountCheckout } from "./billing-checkout";
import { refreshBillingSession } from "./constance-account";
import { openAccountCheckout } from "./billing-checkout";
import { Notice } from "obsidian";
import { authenticatedBillingRequest, clearBillingSession, spendAccountCredits, claimAccountFreeUsage } from "./constance-account";

const CONSTANCE_BASE_URL = "https://app.tutivsoft.com";
export const CONSTANCE_APP_ID = "kairo-quick-capture";
export const FREE_USES_PER_DAY = 5;

// App-specific one-time price ids provisioned in Constance for Kairo.
export const CONSTANCE_PRICE_IDS = {
  usd_001: "pri_01m28hknyche7mcq4vdgjcp4x6",
  usd_010: "pri_01m28hkppkk8m3dy56gmmbnrst",
} as const;

// Catalog-owned plan codes used by the authenticated checkout endpoint.
export const CONSTANCE_PLAN_CODES = {
  usd_001: "one_time",
  usd_010: "standard",
} as const;

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
  const current = previous.catch(() => undefined).then(work);
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
  const response = await authenticatedBillingRequest(plugin.settings, () => plugin.persist(), {
    url: `${CONSTANCE_BASE_URL}/api/v1/billing/entitlements/me?${new URLSearchParams({ app_id: CONSTANCE_APP_ID, installation_id: plugin.settings.constanceDeviceId }).toString()}`,
    method: "GET",
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Entitlement sync failed: HTTP ${response.status}`);
  const data = response.json?.data;
  const freeUsage = data?.free_usage;
  const freeRemaining = Number(freeUsage?.remaining);
  const freeDay = typeof freeUsage?.period_key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(freeUsage.period_key)
    ? freeUsage.period_key
    : undefined;
  return {
    purchasedUses: Math.max(0, Number(data?.credits?.balance) || 0),
    freeUsesRemaining: Number.isFinite(freeRemaining) ? Math.max(0, Math.min(FREE_USES_PER_DAY, Math.trunc(freeRemaining))) : undefined,
    freeUsesDay: freeDay,
  };
}

export async function syncPurchasedUses(plugin: BillingPlugin, strict = false): Promise<void> {
  resumeAccountCheckout({ state: plugin.settings, appId: CONSTANCE_APP_ID, installationId: plugin.settings.constanceDeviceId,
    persist: () => plugin.persist(), syncBalance: () => syncPurchasedUses(plugin), refreshSession: () => refreshBillingSession(plugin.settings, () => plugin.persist()) });

  return withBillingLock(plugin, async () => {
    if (!plugin.settings.constanceDeviceId) return;
    try {
      if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) { if (strict) throw new Error("Connect your account before refreshing."); return; }
      const snapshot = await fetchEntitlements(plugin);
      plugin.settings.purchasedUses = snapshot.purchasedUses;
      if (snapshot.freeUsesRemaining !== undefined) plugin.settings.freeUsesRemaining = snapshot.freeUsesRemaining;
      if (snapshot.freeUsesDay) plugin.settings.freeUsesDay = snapshot.freeUsesDay;
      await plugin.persist();
    } catch (error) {
      console.error("Kairo: Constance entitlement sync failed", error);
      if (strict) throw error;
    }
  });
}

export async function retryPendingSpendEvents(plugin: BillingPlugin): Promise<void> {
  for (const pending of [...(plugin.settings.pendingSpendEvents ?? [])]) {
    const result = await spendConstanceUse(plugin, pending.eventId);
    if (result.kind === "error") break;
    if (result.kind === "ok") plugin.settings.completedCaptureCharges = [...new Set([...(plugin.settings.completedCaptureCharges ?? []), pending.eventId])];
    plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents.filter((item) => item.eventId !== pending.eventId);
    plugin.settings.purchasedUses = result.kind === "ok" ? result.balance : 0;
    await plugin.persist();
  }
}

export async function spendConstanceUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<SpendResult> {
  const result = await spendAccountCredits({ state: plugin.settings, persist: () => plugin.persist(), appId: CONSTANCE_APP_ID, installationId: plugin.settings.constanceDeviceId, syncBalance: async () => {} }, CONSTANCE_APP_ID, plugin.settings.constanceDeviceId, eventId, 1);
  if (result.kind === "auth-required") { await clearBillingSession(plugin.settings, () => plugin.persist()); return { kind: "error" }; }
  return result.kind === "ok" || result.kind === "insufficient" || result.kind === "error" ? result : { kind: "error" };
}

export async function consumeCaptureUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<boolean> {
  return withBillingLock(plugin, async () => {
    if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) {
      new Notice("Kairo: sign in or create a billing account in plugin settings before capturing.");
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
      new Notice("Kairo: your billing session expired. Sign in again in plugin settings.");
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
      new Notice("Kairo: a previous capture spend is still being reconciled. Try again when the connection is restored.");
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
      new Notice("Kairo: no uses remain. Buy a use pack in plugin settings.");
      return false;
    }

    new Notice("Kairo: billing could not be verified. Nothing was captured.");
    return false;
  });
}

export async function pollAuthenticatedCheckout(plugin: BillingPlugin, checkoutId: string): Promise<boolean> {
  if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) return false;
  const response = await authenticatedBillingRequest(plugin.settings, () => plugin.persist(), {
    url: `${CONSTANCE_BASE_URL}/api/v1/billing/checkouts/${encodeURIComponent(checkoutId)}`,
    method: "GET",
    throw: false,
  });
  return response.status >= 200 && response.status < 300 && response.json?.data?.settled === true;
}

export function openBuyCheckout(plugin: BillingPlugin, tier: keyof typeof CONSTANCE_PRICE_IDS): void {
  void openAccountCheckout({
    state: plugin.settings, appId: CONSTANCE_APP_ID, installationId: plugin.settings.constanceDeviceId,
    persist: () => plugin.persist(), syncBalance: () => syncPurchasedUses(plugin), refreshSession: () => refreshBillingSession(plugin.settings, () => plugin.persist()),
  }, CONSTANCE_PLAN_CODES[tier]);
}
