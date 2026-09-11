import { Notice, requestUrl } from "obsidian";

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
  freeUsesRemaining: number;
  freeUsesDay: string;
  purchasedUses: number;
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

export function buildSpendPayload(deviceId: string, eventId: string): {
  app_id: string;
  external_customer_id: string;
  machine_id: string;
  amount: 1;
  event_id: string;
} {
  return {
    app_id: CONSTANCE_APP_ID,
    external_customer_id: deviceId,
    machine_id: deviceId,
    amount: 1,
    event_id: eventId,
  };
}

export function normalizeBillingSettings(settings: BillingSettings, date = new Date()): void {
  settings.constanceDeviceId = typeof settings.constanceDeviceId === "string" ? settings.constanceDeviceId : "";
  settings.billingEmail = typeof settings.billingEmail === "string" ? settings.billingEmail : "";
  settings.freeUsesRemaining = Number.isFinite(settings.freeUsesRemaining)
    ? Math.max(0, Math.min(FREE_USES_PER_DAY, Math.trunc(settings.freeUsesRemaining)))
    : FREE_USES_PER_DAY;
  settings.purchasedUses = Number.isFinite(settings.purchasedUses)
    ? Math.max(0, Math.trunc(settings.purchasedUses))
    : 0;
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

async function fetchEntitlements(deviceId: string): Promise<number> {
  const response = await requestUrl({
    url: `${CONSTANCE_BASE_URL}/api/v1/public/browser/entitlements`,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: CONSTANCE_APP_ID, external_customer_id: deviceId, machine_id: deviceId }),
    throw: false,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Entitlement sync failed: HTTP ${response.status}`);
  return Math.max(0, Number(response.json?.data?.credits?.balance) || 0);
}

export async function syncPurchasedUses(plugin: BillingPlugin): Promise<void> {
  return withBillingLock(plugin, async () => {
    if (!plugin.settings.constanceDeviceId) return;
    try {
      plugin.settings.purchasedUses = await fetchEntitlements(plugin.settings.constanceDeviceId);
      await plugin.persist();
    } catch (error) {
      console.error("Kairo: Constance entitlement sync failed", error);
    }
  });
}

export async function spendConstanceUse(deviceId: string, eventId = generateEventId()): Promise<SpendResult> {
  if (!deviceId) return { kind: "error" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await requestUrl({
        url: `${CONSTANCE_BASE_URL}/api/v1/public/browser/credits/spend`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": eventId },
        body: JSON.stringify(buildSpendPayload(deviceId, eventId)),
        throw: false,
      });
      if (response.status === 402 || response.status === 404) return { kind: "insufficient" };
      if (response.status >= 200 && response.status < 300) {
        return { kind: "ok", balance: Math.max(0, Number(response.json?.data?.credits?.balance) || 0) };
      }
      if (response.status < 500 || attempt === 1) return { kind: "error" };
    } catch (error) {
      if (attempt === 1) {
        console.error("Kairo: Constance credit spend failed", error);
        return { kind: "error" };
      }
    }
  }
  return { kind: "error" };
}

export async function consumeCaptureUse(plugin: BillingPlugin, eventId = generateEventId()): Promise<boolean> {
  return withBillingLock(plugin, async () => {
    const localUse = consumeLocalUse(plugin.settings);
    if (localUse !== "none") {
      await plugin.persist();
      return true;
    }

    const result = await spendConstanceUse(plugin.settings.constanceDeviceId, eventId);
    if (result.kind === "ok") {
      plugin.settings.purchasedUses = result.balance;
      await plugin.persist();
      return true;
    }
    if (result.kind === "insufficient") {
      plugin.settings.purchasedUses = 0;
      await plugin.persist();
      new Notice("Kairo: no uses remain. Buy a use pack in plugin settings.");
      return false;
    }

    // Capturing is local and should remain useful offline. A transient billing
    // outage therefore fails open for this one accepted capture; the next
    // online sync reconciles the purchased-use display mirror. The mirror is
    // never spent locally: every post-free capture must reach Constance so a
    // server credit cannot be reused after a balance refresh.
    console.warn("Kairo: billing unavailable; allowing local capture and reconciling later.");
    return true;
  });
}

export function openBuyCheckout(plugin: BillingPlugin, tier: keyof typeof CONSTANCE_PRICE_IDS): void {
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
