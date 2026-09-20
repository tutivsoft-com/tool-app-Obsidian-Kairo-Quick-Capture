# Kairo Quick Capture

Version: `3.4.12`

Kairo is a local-first Obsidian scratchpad for capturing fleeting thoughts quickly and delivering them to an inbox file or dated daily note. It supports plain text, pasted text, URLs, and multiline notes without an internet connection or AI service.

## What it does

- Opens a small, keyboard-friendly capture modal with Save, Save and close, and Cancel actions.
- Registers an optional desktop accelerator while Obsidian is running, plus an Obsidian command hotkey fallback.
- Appends to an inbox file or creates/appends to a daily note using a configurable template.
- Stores failed captures in an ordered local queue and retries automatically every minute and when Obsidian is ready.
- Uses an id marker and a destination-change check to avoid duplicate delivery and accidental overwrites.
- Provides a first-run setup flow, queue viewer, copyable non-content diagnostics, and optional launch-at-login.
- Includes optional one-time billing: 3 free captures per local calendar day, then 1 credit per accepted capture.

## Install for development

1. Run `npm install` and `npm run build`.
2. Copy `publish/main.js`, `publish/manifest.json`, and `publish/styles.css` into `<vault>/.obsidian/plugins/kairo-quick-capture/`.
3. Enable **Kairo Quick Capture** in Obsidian's Community plugins settings.

The plugin is desktop-only because the optional global accelerator and launch-at-login integrations use Electron when available. The normal Obsidian command remains available if an operating system rejects the accelerator.

## First run

Open **Kairo: Run setup**, choose the destination in plugin settings, validate it, and use **Confirm and write test capture**. Missing files are never created unless **Create missing destinations** is enabled. Kairo writes only inside the currently open vault; it cannot select or modify a different vault from an Obsidian plugin.

Default destination is `Inbox.md` at the vault root. Daily notes default to `Daily/YYYY-MM-DD.md`. Templates support `{{time}}`, `{{source}}`, `{{text}}`, and `{{id}}`.

## Billing and usage

Kairo uses TutivSoft Constance's unsigned browser-relay endpoints for one-time
capture credits. The app id is `kairo-quick-capture`, and the client sends only
the app id, a random installation id, the spend amount, and an idempotency event
id when checking or spending purchased uses. It never sends captured text to
Constance.

Each local calendar day starts with 3 free captures. After those are used, each
capture consumes 1 purchased credit. The available one-time packs are $1 for
100 uses and $10 for 1,000 uses. Checkout is linked to Kairo's provisioned
Constance catalog prices.

A capture is charged once when it is accepted by Kairo—either delivered to its
destination or durably placed in the local retry queue. Queue retries do not
charge again. Confirmed exhaustion blocks a capture; a temporary billing
failure keeps local capture available and is reconciled on the next balance
sync. The installation id is local plugin data and is not a hardware
fingerprint.

## Privacy and threat model

Kairo has no AI path, telemetry, passwords, or cloud queue. Captured text is
written only to the configured current-vault destination or Obsidian's plugin
data while queued. Queue data is plain local application data and inherits the
operating system and vault permissions. Anyone who can read the vault or
Obsidian profile can read queued captures. Billing requests contain no capture
content; checkout may receive the billing email entered by the user for the
receipt.

The destination-change check protects against Kairo overwriting a file changed between its read and append preparation. A hidden `<!-- kairo:... -->` marker makes retries idempotent. If a write fails, the complete capture remains in the local queue. Diagnostics include only the queue id, destination path, and error reason; they intentionally exclude captured text.

The plugin does not promise capture while Obsidian is fully closed: an Obsidian plugin cannot execute code before Obsidian starts. Captures queued during an unavailable vault are delivered automatically after Obsidian opens and the vault is available. The global accelerator is best-effort and is disabled if Electron rejects the requested shortcut.

## Commands

- **Kairo: Open quick capture**
- **Kairo: Flush queued captures**
- **Kairo: Show queued captures**
- **Kairo: Run Kairo setup**

## License

MIT. See [LICENSE](LICENSE).
