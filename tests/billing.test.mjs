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

test("free uses reset on the local calendar date", () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", freeUsesRemaining: 0, freeUsesDay: "2026-09-10", purchasedUses: 4 };
  billing.resetFreeUsesIfNeeded(settings, new Date(2026, 8, 11, 0, 1));
  assert.equal(settings.freeUsesDay, "2026-09-11");
  assert.equal(settings.freeUsesRemaining, 3);
  assert.equal(settings.purchasedUses, 4);
});

test("local consumption uses only the daily free allowance", () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", freeUsesRemaining: 1, freeUsesDay: "2026-09-11", purchasedUses: 1 };
  assert.equal(billing.consumeLocalUse(settings, new Date(2026, 8, 11)), "free");
  assert.equal(billing.consumeLocalUse(settings, new Date(2026, 8, 11)), "none");
  assert.equal(billing.consumeLocalUse(settings, new Date(2026, 8, 11)), "none");
  assert.deepEqual([settings.freeUsesRemaining, settings.purchasedUses], [0, 1]);
});

test("concurrent local consumption is serialized", async () => {
  const settings = { constanceDeviceId: "device", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 3, freeUsesDay: "2026-09-11", purchasedUses: 0, pendingSpendEvents: [] };
  const persisted = [];
  let requests = 0;
  globalThis.__kairoRequestUrl = async () => ({ status: 200, json: { data: { remaining: 2 - requests++ } } });
  const plugin = {
    settings,
    async persist() {
      await new Promise((resolve) => setTimeout(resolve, 2));
      persisted.push(settings.freeUsesRemaining);
    },
  };
  try {
    const results = await Promise.all([
      billing.consumeCaptureUse(plugin, "evt-1"),
      billing.consumeCaptureUse(plugin, "evt-2"),
      billing.consumeCaptureUse(plugin, "evt-3"),
    ]);
    assert.deepEqual(results, [true, true, true]);
    assert.equal(settings.freeUsesRemaining, 0);
    assert.equal(persisted.length, 3);
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("authenticated spend sends the linked installation and stable event", async () => {
  let request;
  globalThis.__kairoRequestUrl = async (options) => {
    request = options;
    return { status: 200, json: { data: { credits: { balance: 6 } } } };
  };
  try {
    const plugin = { settings: { constanceDeviceId: "device-1", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true }, async persist() {} };
    assert.deepEqual(await billing.spendConstanceUse(plugin, "evt-stable"), { kind: "ok", balance: 6 });
    assert.deepEqual(JSON.parse(request.body), { app_id: "kairo-quick-capture", installation_id: "device-1", event_id: "evt-stable", amount: 1 });
    assert.equal(request.headers.Authorization, "Bearer token");
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("each post-free capture spends against the server mirror", async () => {
  const requests = [];
  globalThis.__kairoRequestUrl = async (options) => {
    requests.push(options);
    if (requests.length % 2 === 1) return { status: 402, json: {} };
    const balance = 10 - requests.length;
    return { status: 200, json: { data: { credits: { balance } } } };
  };
  const settings = { constanceDeviceId: "device-1", billingEmail: "", billingAccessToken: "token", billingAccountLinked: true, freeUsesRemaining: 0, freeUsesDay: billing.currentDayKey(), purchasedUses: 10, pendingSpendEvents: [] };
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
  assert.equal(billing.CONSTANCE_PLAN_CODES.usd_001, "standard");
  assert.equal(billing.CONSTANCE_PLAN_CODES.usd_010, "ultimate");
  assert.equal(billing.CONSTANCE_PRICE_IDS.usd_001, "pri_01m28hknyche7mcq4vdgjcp4x6");
  assert.equal(billing.CONSTANCE_PRICE_IDS.usd_010, "pri_01m28hkppkk8m3dy56gmmbnrst");
});
