import { Notice, requestUrl } from "obsidian";
import { spendAccountCredits } from "./constance-account";
import { claimAccountFreeUsage } from "./constance-account";

const CONSTANCE_BASE_URL = "https://app.tutivsoft.com";
export const CONSTANCE_APP_ID = "kairo-quick-capture";
export const FREE_USES_PER_DAY = 3;

// App-specific one-time price ids provisioned in Constance for Kairo.
export const CONSTANCE_PRICE_IDS = {
  usd_001: "pri_01m28hknyche7mcq4vdgjcp4x6", // $1 -> 100 uses
  usd_010: "pri_01m28hkppkk8m3dy56gmmbnrst", // $10 -> 1,000 uses
} as const;

export interface BillingSettings {
  constanceDeviceId: string;
  billingEmail: string;
  billingAccessToken: string;
  billingAccountLinked: boolean;
  freeUsesRemaining: number;
  freeUsesDay: string;
  purchasedUses: number;
  pendingSpendEvents: Array<{ eventId: string; amount: number }>;
}

export type SpendResult =
  | { kind: "ok"; balance: number }
  | { kind: "insufficient" }
  | { kind: "error" };

export type LocalUseResult = "free" | "none";

type BillingPlugin = {
  settings: BillingSettings;
  persist(): Promise<void>;
  pollAfterCheckout?(): void;
};

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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
    settings.freeUsesRemaining = FREE_USES_PER_DAY;
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

async function fetchEntitlements(plugin: BillingPlugin): Promise<number> {
  const response = await requestUrl({
    url: `${CONSTANCE_BASE_URL}/api/v1/billing/entitlements/me?${new URLSearchParams({ app_id: CONSTANCE_APP_ID, installation_id: plugin.settings.constanceDeviceId }).toString()}`,
    method: "GET",
    headers: { Authorization: `Bearer ${plugin.settings.billingAccessToken}` },
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Entitlement sync failed: HTTP ${response.status}`);
  return Math.max(0, Number(response.json?.data?.credits?.balance) || 0);
}

export async function syncPurchasedUses(plugin: BillingPlugin): Promise<void> {
  return withBillingLock(plugin, async () => {
    if (!plugin.settings.constanceDeviceId) return;
    try {
      if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) return;
      plugin.settings.purchasedUses = await fetchEntitlements(plugin);
      await plugin.persist();
    } catch (error) {
      console.error("Kairo: Constance entitlement sync failed", error);
    }
  });
}

export async function retryPendingSpendEvents(plugin: BillingPlugin): Promise<void> {
  for (const pending of [...(plugin.settings.pendingSpendEvents ?? [])]) {
    const result = await spendConstanceUse(plugin, pending.eventId);
    if (result.kind === "error") break;
    plugin.settings.pendingSpendEvents = plugin.settings.pendingSpendEvents.filter((item) => item.eventId !== pending.eventId);
    plugin.settings.purchasedUses = result.kind === "ok" ? result.balance : 0;
    await plugin.persist();
  }
}

export async function spendConstanceUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<SpendResult> {
  const result = await spendAccountCredits(plugin.settings, CONSTANCE_APP_ID, plugin.settings.constanceDeviceId, eventId, 1);
  if (result.kind === "auth-required") { plugin.settings.billingAccessToken = ""; plugin.settings.billingAccountLinked = false; await plugin.persist(); return { kind: "error" }; }
  return result.kind === "ok" || result.kind === "insufficient" || result.kind === "error" ? result : { kind: "error" };
}

export async function consumeCaptureUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<boolean> {
  return withBillingLock(plugin, async () => {
    if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) {
      new Notice("Kairo: sign in or create a billing account in plugin settings before capturing.");
      return false;
    }
    const free = await claimAccountFreeUsage(plugin.settings, CONSTANCE_APP_ID, plugin.settings.constanceDeviceId, eventId, 1);
    if (free.kind === "ok") {
      plugin.settings.freeUsesDay = currentDayKey();
      plugin.settings.freeUsesRemaining = free.remaining;
      await plugin.persist();
      return true;
    }
    if (free.kind === "auth-required") {
      plugin.settings.billingAccessToken = "";
      plugin.settings.billingAccountLinked = false;
      await plugin.persist();
      new Notice("Kairo: your billing session expired. Sign in again in plugin settings.");
      return false;
    }
    if (free.kind === "error") {
      new Notice("Kairo: the account allowance could not be verified. Nothing was captured.");
      return false;
    }

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

export function openBuyCheckout(plugin: BillingPlugin, tier: keyof typeof CONSTANCE_PRICE_IDS): void {
  if (!plugin.settings.billingAccessToken || !plugin.settings.billingAccountLinked) {
    new Notice("Sign in or create a billing account in Kairo settings before buying uses.");
    return;
  }
  const email = plugin.settings.billingEmail.trim();
  if (!email || !email.includes("@")) {
    new Notice("Enter a valid billing email in Kairo settings first.");
    return;
  }
  const priceId = CONSTANCE_PRICE_IDS[tier];
  if (!priceId.startsWith("pri_")) {
    new Notice("Kairo billing is not available for this pack yet.");
    return;
  }
  const params = new URLSearchParams({ app_id: CONSTANCE_APP_ID, price_id: priceId, email, external_customer_id: plugin.settings.constanceDeviceId, });
  window.open(`${CONSTANCE_BASE_URL}/buy?${params.toString()}`, "_blank");
  plugin.pollAfterCheckout?.();
}
