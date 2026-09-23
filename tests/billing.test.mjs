import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "kairo-billing-test-"));
const bundledBilling = path.join(temporaryDirectory, "billing.mjs");
await build({
  entryPoints: [path.resolve("src/billing.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundledBilling,
  alias: { obsidian: path.resolve("tests/obsidian-stub.mjs") },
});
const billing = await import(`${pathToFileURL(bundledBilling).href}?test=${Date.now()}`);

test.after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test("free uses reset on the UTC calendar date", () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 0, freeUsesDay: "2026-09-10", purchasedUses: 4 };
  billing.resetFreeUsesIfNeeded(settings, new Date(Date.UTC(2026, 8, 11, 0, 1)));
  assert.equal(settings.freeUsesDay, "2026-09-11");
  assert.equal(settings.freeUsesRemaining, 3);
  assert.equal(settings.purchasedUses, 4);
});

test("local consumption uses only the daily free allowance", () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 1, freeUsesDay: "2026-09-11", purchasedUses: 1 };
  const testDay = new Date(Date.UTC(2026, 8, 11));
  assert.equal(billing.consumeLocalUse(settings, testDay), "free");
  assert.equal(billing.consumeLocalUse(settings, testDay), "none");
  assert.equal(billing.consumeLocalUse(settings, testDay), "none");
  assert.deepEqual([settings.freeUsesRemaining, settings.purchasedUses], [0, 1]);
});

test("entitlement polling restores the server free-use and paid balances", async () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 3, freeUsesDay: "2026-09-21", purchasedUses: 0, pendingSpendEvents: [] };
  const plugin = { settings, async persist() {} };
  globalThis.__kairoRequestUrl = async () => ({ status: 200, json: { data: {
    credits: { balance: 9 },
    free_usage: { remaining: 1, period_key: "2026-09-22" },
  } } });
  try {
    await billing.syncPurchasedUses(plugin);
    assert.deepEqual([settings.freeUsesRemaining, settings.freeUsesDay, settings.purchasedUses], [1, "2026-09-22", 9]);
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("concurrent local consumption is serialized", async () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 3, freeUsesDay: "2026-09-11", purchasedUses: 0 };
  const persisted = [];
  const plugin = {
    settings,
    async persist() {
      await new Promise((resolve) => setTimeout(resolve, 2));
      persisted.push(settings.freeUsesRemaining);
    },
  };
  let freeClaims = 0;
  globalThis.__kairoRequestUrl = async () => ({ status: 200, json: { data: { remaining: Math.max(0, 2 - freeClaims++) } } });
  const results = await Promise.all([
    billing.consumeCaptureUse(plugin, "evt-1"),
    billing.consumeCaptureUse(plugin, "evt-2"),
    billing.consumeCaptureUse(plugin, "evt-3"),
  ]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(settings.freeUsesRemaining, 0);
  assert.equal(persisted.length, 3);
  delete globalThis.__kairoRequestUrl;
});

test("an authenticated spend uses the stable event id and bearer session", async () => {
  const requests = [];
    globalThis.__kairoRequestUrl = async (options) => {
    requests.push(options);
    return { status: 200, json: { data: { credits: { balance: 6 } } } };
  };
  try {
    const plugin = { settings: { constanceDeviceId: "device-1", billingAccessToken: "token", billingAccountLinked: true }, async persist() {} };
    assert.deepEqual(await billing.spendConstanceUse(plugin, "evt-stable"), { kind: "ok", balance: 6 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.Authorization, "Bearer token");
    assert.equal(JSON.parse(requests[0].body).event_id, "evt-stable");
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("each post-free capture spends against the server mirror", async () => {
  const requests = [];
  globalThis.__kairoRequestUrl = async (options) => {
    requests.push(options);
    if (options.url.includes("free-usage")) return { status: 402, json: {} };
    const balance = 10 - requests.length;
    return { status: 200, json: { data: { credits: { balance } } } };
  };
  const settings = { constanceDeviceId: "device-1", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 0, freeUsesDay: billing.currentDayKey(), purchasedUses: 10 };
  const plugin = { settings, async persist() {} };
  try {
    assert.equal(await billing.consumeCaptureUse(plugin, "evt-paid-1"), true);
    assert.equal(await billing.consumeCaptureUse(plugin, "evt-paid-2"), true);
    assert.equal(requests.length, 4);
    assert.equal(settings.purchasedUses, 6);
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("catalog price ids are Kairo's provisioned one-time prices", () => {
  assert.equal(billing.CONSTANCE_APP_ID, "kairo-quick-capture");
  assert.equal(billing.CONSTANCE_PLAN_CODES.usd_001, "one_time");
  assert.equal(billing.CONSTANCE_PLAN_CODES.usd_010, "standard");
  assert.equal(billing.CONSTANCE_PRICE_IDS.usd_001, "pri_01m28hknyche7mcq4vdgjcp4x6");
  assert.equal(billing.CONSTANCE_PRICE_IDS.usd_010, "pri_01m28hkppkk8m3dy56gmmbnrst");
});
