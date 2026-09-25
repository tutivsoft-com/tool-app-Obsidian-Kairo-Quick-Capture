# Kairo Quick Capture Software Architecture

Version: 3.4.24

## Runtime boundary

Kairo is an Obsidian desktop community plugin. Obsidian owns the vault API, plugin lifecycle, settings, command palette, and modal host. Kairo only resolves paths within the currently open vault. Optional desktop shortcut and launch-at-login behavior use Electron when the host exposes it.

## Main components

- main.ts registers commands, settings, setup and capture modals, destination resolution, safe append behavior, and the retry queue.
- src/core.ts contains pure path normalization, daily-note naming, timestamp formatting, template rendering, append formatting, and diagnostic summarization.
- src/constance-account.ts handles account sign-in, verification, entitlement-related requests, and account credit operations.
- src/billing.ts serializes usage operations, claims free captures, spends paid credits, reconciles uncertain spend events, and starts checkout.
- src/plugin-support.ts exposes help/settings commands and keeps debug diagnostics free of capture text.
- tests/ covers capture formatting, queue behavior, billing claims, and idempotent spends.

## Capture flow

1. The user opens the capture modal from an Obsidian command or an optional desktop accelerator.
2. Kairo requires a verified billing account and asks Constance to claim a free usage event or spend one purchased credit.
3. After that succeeds, Kairo renders the configured template and safely appends to the selected inbox or daily note.
4. If the vault write fails, Kairo persists the rendered entry in an ordered local queue and retries it while Obsidian is available. The capture marker and destination comparison protect against duplicate writes and concurrent edits.
5. Billing failures fail closed before vault delivery; a retry of an already-accepted local queue item does not make another usage claim.

## Storage and network boundaries

Settings, billing session state, pending spend events, and retry-queue entries are stored in Obsidian plugin data. Retry entries contain the capture text, so local OS and vault permissions protect them; Kairo does not encrypt that queue. Billing requests contain account/app identifiers and usage-event metadata. They do not contain the capture body, vault path, or note content. There is no AI or telemetry path.

## Build and release layout

TypeScript in main.ts and src/ is bundled with esbuild into publish/main.js. The publish folder contains the matching manifest, stylesheet, license, source snapshot, and public product documentation. Release metadata is checked by scripts/check-release.mjs; release assets are main.js, manifest.json, and styles.css.

<!-- one-click-workflow:start -->
## Workflow defaults (v3.4.24)

Kairo opens its capture form directly; there is no first-run setup screen. Destination validation is available on demand in Settings.
<!-- one-click-workflow:end -->
