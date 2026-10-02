# Kairo Quick Capture

Version: 3.4.44 — validated locally for publication; release pending.

## Current purchase behavior

Purchase settings load the current public product catalog from Constance. Each available offer supplies its exact Paddle price ID, native-unit grant, unit name, and formatted amount. The client displays backend-provided amounts, enables only offers marked available, and submits the selected price ID through authenticated checkout with quantity one. Existing account balances and granted credits remain associated with the account.

<!-- SETTINGS-CURRENT-2026-09-30 -->

## Preview and lifetime allowance

Guests see a bounded preview held only in memory. Keep the originating window open through registration, email verification and sign-in, then retry that exact result without regeneration. Guests cannot save, apply, export or queue useful output. Closing the preview or restarting loses unrevealed guest content.

Constance verifies each capture's free allowance or purchased-credit spend and provides current Paddle offers. The plugin loads its configured offers, joins them to live Paddle prices by exact price ID, and uses that ID for authenticated checkout. Kairo does not use Constance as an AI service.

One delivered capture is one native unit; free payload <=2,000 Unicode codepoints. Background queue delivery requires explicit credit-consumption opt-in.

Capture delivery follows durable reserve → write → verify → commit. Unknown writes retain their journal for status/output reconciliation and retry the same operation identity. Billing sends account/install identity, native dimensions and source/result digests, never capture text, vault paths, or note content.

## Current settings

Settings default to **Simple** and remember the selected mode. Simple contains everyday controls and account/billing. **Advanced** contains specialist parameters, diagnostics, and less frequent preferences. Inline help explains choices.

Kairo has no AI feature and does not request AI provider keys. Its Constance connection handles account access and Paddle billing only.
<!-- SETTINGS-CURRENT-2026-09-30:END -->

<!-- BILLING-CURRENT-2026-09-30 -->
## Current local account and billing behavior

Use **Connect** with your email and password. A new account is registered; an existing account is authenticated. New users must follow the emailed verification link and Connect again. Incorrect passwords offer password recovery; passwords are never saved. Paid purchases and free allowances belong to the authenticated account, not a locally entered email or an editable cached balance. Reinstalling does not replenish the same account's allowance.

Constance is the billing authority. Credit units remain app-specific: characters, OCR pages, searches, conversions, repair/protection batches, or captures. Checkout return URLs and cached balances never grant credits. Payment fulfillment comes from the server’s verified Paddle webhook, and balances refresh from authenticated entitlements. Unknown usage or checkout results reuse the persisted operation ID; they must not create a new debit or alternative checkout.


<!-- BILLING-CURRENT-2026-09-30:END -->


Kairo is a local-first Obsidian scratchpad for capturing fleeting thoughts quickly and delivering them to an inbox file or dated daily note. It supports plain text, pasted text, URLs, and multiline notes without an AI service. Each accepted capture needs an online billing allowance or credit verification.

## What it does

- Opens a small, keyboard-friendly capture modal with Save, Save and close, and Cancel actions.
- Lets you right-click selected note text to prefill a capture, or right-click a Markdown note to capture its Obsidian link.
- Lets you capture links for multiple selected Markdown notes or folders from the File Explorer context menu.
- Registers an optional desktop accelerator while Obsidian is running, plus an Obsidian command hotkey fallback.
- Appends to an inbox file or creates/appends to a daily note using a configurable template.
- Stores failed captures in an ordered local queue and retries automatically every minute and when Obsidian is ready.
- Uses an id marker and a destination-change check to avoid duplicate delivery and accidental overwrites.
- Provides an on-demand setup command, queue viewer, copyable non-content diagnostics, and optional launch-at-login.

## First run

Choose and validate the destination in plugin settings. Kairo does not open a first-run setup window or write a test capture. Missing files are created only when **Create missing destinations** is enabled. Kairo writes only inside the currently open vault; it cannot select or modify a different vault from an Obsidian plugin.

Default destination is `Inbox.md` at the vault root. Daily notes default to `Daily/YYYY-MM-DD.md`. Templates support `{{time}}`, `{{source}}`, `{{text}}`, and `{{id}}`.

## Billing and usage

Kairo links a random installation to the verified Constance account and uses
authenticated entitlements and durable native capture reservations. It sends
the app and installation IDs, operation dimensions, and opaque event IDs; it
never sends captured text to Constance. Account registration may require email
verification. Refresh tokens keep sessions active through access-token expiry.

Purchase settings fetch current one-time offers from Constance, display the
provider's amount and grant, and enable only available rows. The current
approved packs grant 50, 150, 450, or 1,200 captures for USD $2, $4, $8, or
$14. The selected exact price ID is submitted through authenticated
`/api/v1/billing/checkout-price` with quantity one and a persisted idempotency
key. Settlement polling and restart recovery reuse that checkout identity.
Client code does not contain price amounts.

Capture delivery reserves usage before writing, verifies the result, then
commits. An uncertain write retains its original operation ID and is
reconciled before a retry, preventing a second usage claim.
Confirmed exhaustion blocks a capture; a temporary billing failure blocks
the capture until the allowance or balance can be verified. If a paid spend
request has an uncertain result, Kairo keeps its event id for reconciliation
before allowing another paid capture. The installation id is local plugin
data and is not a hardware fingerprint.

## Privacy and threat model

Kairo has no AI path, analytics, or cloud queue. The billing account password
is used for sign-in and is not retained as a password by Kairo. Captured text is
written only to the configured current-vault destination or Obsidian's plugin
data while queued. Queue data is plain local application data and inherits the
operating system and vault permissions. Anyone who can read the vault or
Obsidian profile can read queued captures. Billing requests contain no capture
content; checkout may receive the billing email entered by the user for the
receipt.

The destination-change check protects against Kairo overwriting a file changed between its read and append preparation. A hidden `<!-- kairo:... -->` marker makes retries idempotent. If a write fails, the complete capture remains in the local queue. Diagnostics include only the queue id, destination path, and error reason; they intentionally exclude captured text.

The plugin does not promise capture while Obsidian is fully closed: an Obsidian plugin cannot execute code before Obsidian starts. Captures queued during an unavailable vault are delivered automatically after Obsidian opens and the vault is available. The global accelerator is best-effort and is disabled if Electron rejects the requested shortcut.

## Commands

- **Kairo Quick Capture: Open quick capture**
- **Kairo Quick Capture: Flush queued captures**
- **Kairo Quick Capture: Show queued captures**
- **Kairo Quick Capture: Run setup**

## License

MIT. See [LICENSE](LICENSE).

<!-- one-click-workflow:start -->
## Workflow defaults (v3.4.44)

Kairo opens its capture form directly; there is no first-run setup screen. Destination validation is available on demand in Settings.
<!-- one-click-workflow:end -->

## Account, billing, and credit feedback

Account and billing controls appear at the top of settings. Select Connect with your email and password; verify the emailed link if requested, then Connect again. The settings page shows the current balance and provides balance refresh, sign-out, and purchase controls. Metered actions show the available balance and report the amount used with the remaining balance when the action completes.


## Settings modes

Simple mode contains shortcut, destination, save behavior, and queue access. Advanced adds vault prefix, date formats, capture template, startup, validation, and diagnostics. Only the selected destination type is shown. Account, purchases, and balance refresh remain available in both modes. Settings save immediately; the selected mode persists.

## Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the matching published release and place them in `.obsidian/plugins/kairo-quick-capture/`, then enable the plugin in Obsidian.
