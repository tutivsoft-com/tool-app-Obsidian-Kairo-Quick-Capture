# Changelog

## 3.4.18 - 2026-09-23

- Simplified Obsidian command palette labels by removing repeated plugin-name prefixes.

## 3.4.17 - 2026-09-23

- Used authenticated checkout with catalog pack codes verified against the live Constance catalog.
- Prevented failed queue persistence from leaving a capture eligible for later delivery.
- Clarified billing behavior when storage or billing verification fails.

## 3.4.16 - 2026-09-22

- Added Constance email-verification completion for new billing accounts and
  prevented linked-account email drift during checkout.
- Synced the authoritative UTC daily free-use balance during entitlement polls.
- Rebuilt the publish bundle and synchronized current billing/version docs.

## 3.4.15 - 2026-09-21

- Incremented release metadata without rebuilding the plugin.

## 3.4.14 - 2026-09-21

- Corrected the public build entrypoint so Obsidian can reproduce the tagged bundle from the public source tree.

## 3.4.13 - 2026-09-21

- Replaced navigator-based diagnostics with Obsidian's Platform API.
- Made the public release build reproducible so Obsidian's artifact check matches the tagged main.js.

## 3.4.9 - 2026-09-20

- Prepared the next patch version across source, publish, and public metadata.
- No runtime behavior changed in this documentation and version bump.

## 3.4.8 - 2026-09-20

- Synchronized the Kairo source and publish version surfaces and prepared the
  next source-inclusive TutivSoft release.

## 3.4.7 - 2026-09-12

- Incremented and synchronized the canonical, package, manifest, and publish version surfaces after the billing rollout. No runtime behavior changed in this metadata release.
- Restored the publish entrypoint re-export and rebuilt the public mirror.
- Added regression coverage confirming retries reuse the durable capture event
  ID and request body.

## 3.4.6 — 2026-09-11

- Removed the optional settings-page section heading after Obsidian review disallowed generic heading labels there.
- Rebuilt the public runtime mirror with the corrected 3.4.6 manifest and live billing catalog.

## 3.4.5 — 2026-09-11

- Renamed the settings-page section heading to the neutral `General` label required by the Obsidian review guidelines.
- Rebuilt the public runtime mirror with the corrected 3.4.5 manifest and live billing catalog.

## 3.4.4 — 2026-09-11

- Renamed the settings-page heading to the generic `Settings` label required by the Obsidian review guidelines.
- Rebuilt the public runtime mirror with the corrected 3.4.4 manifest and live billing catalog.

## 3.4.3 — 2026-09-11

- Fixed the Obsidian review blocker by using the supported `Setting.setHeading()` API for the settings-page title.
- Rebuilt the public runtime mirror with the corrected 3.4.3 manifest and live billing catalog.

## 3.4.2 — 2026-09-11

- Released Kairo with live billing configured for the Constance catalog and the final 3.4.2 version surfaces.
- Kept the provisioned $1/100-use and $10/1,000-use Paddle price IDs synchronized in source and publish.

## 3.4.1 — 2026-09-11

- Finalized Kairo billing against the live Constance catalog: $1/100-use price `pri_01m28hknyche7mcq4vdgjcp4x6` and $10/1,000-use price `pri_01m28hkppkk8m3dy56gmmbnrst`.
- Updated and rebuilt the publish mirror for the live catalog release.
