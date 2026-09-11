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
  const settings = { constanceDeviceId: "device", billingEmail: "", freeUsesRemaining: 3, freeUsesDay: "2026-09-11", purchasedUses: 0 };
  const persisted = [];
  const plugin = {
    settings,
    async persist() {
      await new Promise((resolve) => setTimeout(resolve, 2));
      persisted.push(settings.freeUsesRemaining);
    },
  };
  const results = await Promise.all([
    billing.consumeCaptureUse(plugin, "evt-1"),
    billing.consumeCaptureUse(plugin, "evt-2"),
    billing.consumeCaptureUse(plugin, "evt-3"),
  ]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(settings.freeUsesRemaining, 0);
  assert.equal(persisted.length, 3);
});

test("spend payload follows the unsigned same-install contract", () => {
  assert.deepEqual(billing.buildSpendPayload("device-1", "evt-1"), {
    app_id: "kairo-quick-capture",
    external_customer_id: "device-1",
    machine_id: "device-1",
    amount: 1,
    event_id: "evt-1",
  });
});

test("a spend retry reuses the same idempotency key and body", async () => {
  const requests = [];
  let attempts = 0;
  globalThis.__kairoRequestUrl = async (options) => {
    requests.push(options);
    attempts += 1;
    if (attempts === 1) throw new Error("simulated transport failure");
    return { status: 200, json: { data: { credits: { balance: 6 } } } };
  };
  try {
    assert.deepEqual(await billing.spendConstanceUse("device-1", "evt-stable"), { kind: "ok", balance: 6 });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].headers["Idempotency-Key"], "evt-stable");
    assert.equal(requests[1].headers["Idempotency-Key"], "evt-stable");
    assert.equal(requests[0].body, requests[1].body);
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("each post-free capture spends against the server mirror", async () => {
  const requests = [];
  globalThis.__kairoRequestUrl = async (options) => {
    requests.push(options);
    const balance = 10 - requests.length;
    return { status: 200, json: { data: { credits: { balance } } } };
  };
  const settings = { constanceDeviceId: "device-1", billingEmail: "", freeUsesRemaining: 0, freeUsesDay: "2026-09-11", purchasedUses: 10 };
  const plugin = { settings, async persist() {} };
  try {
    assert.equal(await billing.consumeCaptureUse(plugin, "evt-paid-1"), true);
    assert.equal(await billing.consumeCaptureUse(plugin, "evt-paid-2"), true);
    assert.equal(requests.length, 2);
    assert.equal(settings.purchasedUses, 8);
  } finally {
    delete globalThis.__kairoRequestUrl;
  }
});

test("catalog price ids are Kairo's provisioned one-time prices", () => {
  assert.equal(billing.CONSTANCE_APP_ID, "kairo-quick-capture");
  assert.equal(billing.CONSTANCE_PRICE_IDS.usd_001, "pri_01m28hknyche7mcq4vdgjcp4x6");
  assert.equal(billing.CONSTANCE_PRICE_IDS.usd_010, "pri_01m28hkppkk8m3dy56gmmbnrst");
});
