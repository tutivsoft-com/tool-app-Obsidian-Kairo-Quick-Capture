# Kairo Quick Capture — Product Requirements

Status: implemented — 3.3.0 MVP released

## Product promise

Kairo lets a user capture a thought in seconds from anywhere on the desktop, even when the Obsidian window is closed, and reliably delivers it to the user’s configured inbox or daily note.

## Product principles

- Capture must be faster than opening Obsidian.
- The capture path must work offline and must not require AI.
- Never lose text because a vault, destination, or Obsidian process is unavailable.
- Keep the interface to one small window and a few obvious actions.
- Do not silently send captured content to a cloud service.

## Target users and use cases

- A user has a fleeting idea while working in another application.
- A user wants to capture clipboard text, a URL, or a short task without context switching.
- A user wants everything captured today in one inbox or daily note.
- A user captures thoughts while Obsidian is closed or busy.

## MVP requirements

### Capture window

1. Provide a configurable global keyboard shortcut to show, focus, and hide the scratchpad.
2. Open as a small floating desktop window that stays above other windows while active.
3. Focus the text area automatically and support keyboard-only submission and dismissal.
4. Provide clear actions for Save, Save and close, and Cancel.
5. Support plain text, pasted text, URLs, and multiline notes without truncation.
6. Show a compact status indicator for saving, saved, queued, or failed.

### Vault delivery

7. Let the user select a vault folder and configure either an inbox file or a daily-note folder.
8. Support a configurable capture template with timestamp, source application when available, and captured text.
9. Append to the selected destination without overwriting existing content.
10. Create a missing daily note or inbox file only after explicit configuration permits it.
11. Write safely and detect a destination change before replacing file contents.
12. Queue captures locally when the vault is unavailable, then retry automatically when it becomes available.
13. Preserve capture order and show queued items that still need delivery.
14. Prevent accidental duplicate delivery when a retry follows a successful write.

### Configuration

15. Provide simple settings for shortcut, vault, destination mode, daily-note format, template, timestamp format, and launch behavior.
16. Provide a first-run setup flow that validates the vault and writes a test capture only after confirmation.
17. Allow the user to choose whether the window closes after saving.
18. Allow optional launch-at-login on supported desktop platforms, disabled by default.
19. Provide a command to open settings and a command to flush queued captures.

### Reliability and accessibility

20. Recover queued captures after application restart.
21. Make the window usable with keyboard navigation, visible focus, readable contrast, and screen readers.
22. Never place passwords, API keys, or sensitive diagnostics in capture files or logs.
23. Provide a visible error with a copyable diagnostic summary without exposing captured text by default.

## Optional AI features

AI is not part of the capture path or required for the MVP. A later opt-in assistant may:

- suggest a title;
- suggest tags or a destination folder;
- convert a capture into a short task or structured note;
- summarize a long pasted capture.

AI must run only after the capture is safely stored, require an explicit per-capture action, explain that content leaves the vault, and charge credits only for an accepted AI request. Failed requests must not affect the saved capture.

## Useful post-MVP features

- Capture current window title and source URL with user permission.
- Quick actions such as “task”, “quote”, “link”, and “journal”.
- Multiple vault profiles.
- Tray/menu-bar controls and pause mode.
- Search, edit, retry, and export for queued captures.
- Optional local-only classification if a supported local model is available.

## Out of scope for the MVP

- Full note editing, rich text, attachments, or handwriting.
- Cloud synchronization of the scratchpad queue.
- Automatic AI processing without user action.
- Mobile capture; desktop reliability comes first.

## Acceptance criteria

- A new user can complete setup and save a capture in under one minute.
- A normal capture reaches the configured note in two interactions or fewer after the shortcut is pressed.
- Captures made while Obsidian is closed are delivered after the vault becomes available.
- A failed write leaves the complete text in a recoverable queue.
- Repeated retries never create duplicate entries.
- The MVP remains fully useful with AI disabled and without an internet connection.
