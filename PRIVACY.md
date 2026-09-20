# Privacy and threat model

Kairo keeps capture content local. It has no AI, analytics, account, or credential features. Optional billing requests go only to TutivSoft Constance and contain the fixed app id `kairo-quick-capture`, a random installation id, a one-credit spend amount, and an idempotency event id. Captured text is never included in billing requests. Checkout may receive the billing email entered by the user for a receipt.

The queue is intentionally recoverable after restart, but it is not encrypted. Protect the vault and Obsidian profile using the operating system's account and disk protections. Kairo never puts passwords, API keys, or diagnostics into capture files. Copyable diagnostics omit capture content.

Writes use a read/mtime-check/modify sequence. If the destination changes during that sequence, Kairo refuses to replace it and queues the complete capture. Each entry has a private id marker so a retry that follows a successful write is recognized as already delivered.

The optional Electron integrations are limited to a local global shortcut and launch-at-login setting. Kairo does not inspect the active window, clipboard, or source application outside Obsidian.
