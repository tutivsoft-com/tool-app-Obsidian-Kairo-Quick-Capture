# Kairo Quick Capture

Save quick captures locally and deliver them to a configured inbox or daily note, retaining queued work when delivery is unavailable.

Current version: **3.4.64**.

## First use

Enable the plugin, click the Kairo pencil button in the left ribbon, and type your idea. No destination setup is required: the default is Inbox.md in the vault root. Ctrl+Shift+K (Cmd+Shift+K on macOS) also opens capture. Save keeps the window open; Save and close finishes the capture. Enter saves by default and follows the Close after saving preference. Ctrl+Enter (Cmd+Enter on macOS) or Shift+Enter adds a new line. Switch off Enter saves capture in settings to restore Enter for new lines and Ctrl/Cmd+Enter for saving.

A standard top-right notice appears once whenever Obsidian loads the vault. It shows your configured global shortcut (Ctrl+Shift+Space by default), explains that Obsidian must stay running and may be minimized, and includes Open capture. Plugin reloads do not repeat it. The same guidance is visible in Simple and Advanced settings under Capture from another app. The status bar opens capture or shows the number of saved captures waiting for delivery. Signed-out and offline captures are saved immediately in the queue, where you can read and copy their text. Connect your account when you want Kairo to deliver them to your note. Settings → Kairo Quick Capture → Open Help explains the flow; configuration is optional.

Capture text is persisted locally before account delivery checks. Delivery uses the configured inbox or daily-note destination and a stable marker to avoid duplicate retries. Automatic delivery and creation of missing destinations default to on; saved opt-outs remain effective. Launch at login defaults off.

## Account and processing

Processing is local. This plugin has no AI provider integration. Constance handles account and billing operations.

A completed delivered capture consumes one account capture unit. Vault delivery preserves reserve, write verification and idempotent recovery. Keeping a local queued capture is distinct from successful vault delivery.

Connect the existing Constance account in settings; registration can require email verification before signing in again. Billing account passwords are sent for authentication and are not persisted. Access/refresh session data and a stable installation identity are saved locally. Account free usage and purchased balance are determined by Constance; cached values and checkout return URLs do not create entitlement. Catalog displays current formatted names, prices, availability and exact price IDs. Unknown usage and checkout results retain their original identities for recovery.

## Diagnostics

Help is available in settings and through Open documentation. Open plugin settings and Copy diagnostic log are command-palette fallbacks. Debug logging defaults off for a new installation; failures and full Error objects/stacks still appear in the local developer console. Timed information is enabled by the debug preference. The copyable diagnostic buffer keeps at most 1,000 summarized events and excludes raw error text, stacks, note text, paths and credentials. Full console exceptions can contain whatever the failed operation placed in its error. Logs are not uploaded automatically.

## Documentation


License terms are in LICENSE.
