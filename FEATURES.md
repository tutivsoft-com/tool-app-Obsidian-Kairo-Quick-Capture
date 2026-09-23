# Kairo Quick Capture Features

Version: 3.4.19

## Capture

- Opens a small, keyboard-friendly modal from the command palette.
- Supports plain text, pasted text, URLs, and multiline content.
- Offers Save, Save and close, and Cancel.
- Supports an Obsidian command hotkey and an optional desktop-wide accelerator while Obsidian is running.
- Keeps launch-at-login optional and off by default.

## Destination and formatting

- Routes captures to one configured inbox file or to a dated daily note.
- Supports a configurable vault folder, relative destination path, date filename format, timestamp format, and capture template.
- Template fields are time, source, text, and id.
- Validates the configured destination during setup.
- Creates a missing destination only when the user enables that setting.

## Delivery reliability

- Appends instead of replacing existing note content.
- Compares the destination before writing so a concurrent change is not silently overwritten.
- Adds a unique capture marker so retries can recognize an item that has already been delivered.
- Stores failed vault writes in an ordered local queue and retries automatically while Obsidian is open.
- Provides a queue viewer, manual flush command, and a copyable diagnostic summary that omits capture text by default.

## Usage and privacy

- Requires a signed-in Constance billing account to verify each accepted capture.
- Grants three free captures per UTC calendar day; later accepted captures use one purchased credit each.
- Sends billing identity and event metadata for allowance and credit operations, never capture text or vault paths.
- Keeps captured text in the current vault or local plugin data. The queue is plain local data and is not encrypted by Kairo.
- Has no AI processing, cloud queue, or promise of capture while Obsidian is closed.
- A billing verification failure stops delivery for that attempt. A vault-write failure after a successful allowance or spend can be retried locally without another claim.

## Platform and limitations

- Built for desktop Obsidian. The standard Obsidian command remains available when the optional global shortcut is unavailable.
- Launch-at-login and global shortcut support depend on the host Electron APIs and operating-system permissions.
- It cannot select or write to a vault other than the one currently open in Obsidian.
