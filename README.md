# Kairo Quick Capture

Version: `3.4.41`

Kairo is a local-first Obsidian scratchpad for capturing text, pasted content, and links into an inbox or daily note. Captures stay in the current vault.

## Features

- Capture selected text or Markdown links from Obsidian context menus.
- Append to an inbox or daily note with configurable templates.
- Queue failed writes and safely reconcile retries without duplicate delivery.
- Use an optional desktop shortcut or the Obsidian command palette.

## Install

Install **Kairo Quick Capture** from Obsidian's Community plugins browser. For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the [GitHub release](https://github.com/tutivsoft-com/tool-app-Obsidian-Kairo-Quick-Capture/releases), place them in `<vault>/.obsidian/plugins/kairo-quick-capture/`, and enable the plugin.

## Billing and usage

Kairo includes three free captures per UTC calendar day. Additional captures use credits in your linked account. Current one-time offers provide 50, 150, 450, or 1,200 captures for USD $2, $4, $8, or $14. Offer descriptions, amounts, and availability are loaded from the configured Paddle catalog when settings open; checkout uses the selected provider price. Balances remain attached to your verified account when you reinstall or reconnect.

Kairo sends billing metadata only. Captured text and vault paths are not sent to the billing service. A capture write follows a durable reserve, write, verification, and commit flow; uncertain outcomes keep the same operation identity for recovery.

## Privacy

Kairo has no AI path, analytics, or cloud queue. Queued captures are stored locally in Obsidian plugin data. Anyone who can read the vault or Obsidian profile can read that queue.

## Commands

- **Kairo Quick Capture: Open quick capture**
- **Kairo Quick Capture: Flush queued captures**
- **Kairo Quick Capture: Show queued captures**
- **Kairo Quick Capture: Run setup**

## License

MIT. See [LICENSE](LICENSE).