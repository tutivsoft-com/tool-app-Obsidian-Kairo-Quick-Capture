# Privacy and threat model

Kairo keeps capture content local. It has no AI or analytics. Optional billing uses a signed-in TutivSoft Constance account; requests contain the fixed app id `kairo-quick-capture`, a random installation id, a one-credit usage event, and an idempotency event id. Captured text is never included in billing requests. The billing account password is submitted only for sign-in and is not retained as a password by Kairo. Checkout may receive the billing email entered by the user for a receipt.

The queue is intentionally recoverable after restart, but it is not encrypted. Protect the vault and Obsidian profile using the operating system's account and disk protections. Kairo never puts passwords, API keys, or diagnostics into capture files. Copyable diagnostics omit capture content.

Writes use a read/mtime-check/modify sequence. If the destination changes during that sequence, Kairo refuses to replace it and queues the complete capture. Each entry has a private id marker so a retry that follows a successful write is recognized as already delivered.

Each capture requires an online allowance or credit verification. If billing cannot be verified, Kairo does not deliver that capture. A vault-write failure after successful verification may be retried locally without a second claim.

The optional Electron integrations are limited to a local global shortcut and launch-at-login setting. Kairo does not inspect the active window, clipboard, or source application outside Obsidian.

<!-- one-click-workflow:start -->
## Workflow defaults (v3.4.24)

Kairo opens its capture form directly; there is no first-run setup screen. Destination validation is available on demand in Settings.
<!-- one-click-workflow:end -->
