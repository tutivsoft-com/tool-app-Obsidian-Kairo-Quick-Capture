# Kairo Quick Capture

Version: `3.4.42`

Kairo is a local-first Obsidian scratchpad for capturing text and links into an inbox file or daily note. It supports plain text, pasted text, URLs, and multiline notes without an AI service.

## Features

- Open a keyboard-friendly capture modal, or prefill it from selected note text and links.
- Capture multiple selected Markdown files or folders from Obsidian's file explorer.
- Append to an inbox or create and append to a daily note using a configurable template.
- Queue failed deliveries locally and retry them when the vault is available.
- Use idempotent delivery markers and destination-change checks to reduce duplicate writes and accidental overwrites.
- View queued captures and copy diagnostics that exclude captured text.

## Install

Install Kairo Quick Capture from Obsidian's Community plugins browser. To install a development build, copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/kairo-quick-capture/`, then enable the plugin in Community plugins settings.

Kairo is desktop-only because its optional global shortcut and launch-at-login features use Electron when available. The normal Obsidian command remains available if the operating system rejects the shortcut.

## First run

Choose and validate a destination in plugin settings. Kairo does not open a setup window or write a test capture. It writes only inside the currently open vault. The default inbox is `Inbox.md`; daily notes default to `Daily/YYYY-MM-DD.md`. Templates support `{{time}}`, `{{source}}`, `{{text}}`, and `{{id}}`.

## Billing and usage

Kairo uses authenticated Constance account and entitlement services for its optional one-time capture credits. Offers, provider amounts, and grants are supplied by the service and shown in settings; the client does not contain fixed purchase prices. Each paid capture uses a server-issued price ID and a persisted checkout identity.

Capture delivery reserves usage before writing, verifies the result, then commits. An uncertain write retains its original operation identity for reconciliation before retry. Billing requests do not contain capture text, vault paths, or note content. Kairo has no AI path, analytics, or cloud queue.

## Commands

- **Kairo Quick Capture: Open quick capture**
- **Kairo Quick Capture: Flush queued captures**
- **Kairo Quick Capture: Show queued captures**
- **Kairo Quick Capture: Run setup**

## Privacy

Captured text is stored only in the configured vault destination or in Obsidian plugin data while queued. Queue data is local and inherits the operating system and vault permissions. Billing requests contain account/install identifiers and operation metadata, never capture content.

## License

MIT. See [LICENSE](LICENSE).