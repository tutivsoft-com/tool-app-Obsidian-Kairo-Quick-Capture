# Kairo Quick Capture 3.4.84 desktop acceptance

On 24 November 2026, **20 of 23 desktop case groups passed** in Obsidian **1.15.1** on Windows. Three case groups reproduced two defects in the published Kairo Quick Capture **3.4.84** build. The run used a fresh vault containing synthetic notes and captures. The isolated Obsidian process exited after the restart check.

The official Community registry maps plugin ID `kairo-quick-capture` to this repository. The [3.4.84 release](https://github.com/tutivsoft-com/tool-app-Obsidian-Kairo-Quick-Capture/releases/tag/3.4.84) tag resolves to `1caa510a6f995c69f71fd13ac8d90231cf9de5c8`. The installed downloads matched the tagged files, the published release digests, and the runtime files at public `main` before this evidence commit. The JavaScript bundle passed a syntax check.

| Installed asset | SHA-256 |
| --- | --- |
| `main.js` | `27d3b8378705422cf996a6b1be44d220c3793dc22e0b9378d60e5f0e327d147d` |
| `manifest.json` | `70e5000881afec2c39a50c731c98208ac23325e80397a7e4c65df20662533833` |
| `styles.css` | `98260abee8f68c4d5f91089db85bc8ae7efa12d1b5aeba09974e76ef513a0bd4` |

## Reproduced defects

- Two successive guest saves in one scratchpad showed two **Copy diagnostic** buttons. Both remained visible after the next blank save. Both valid captures stayed in the local queue. [Screenshot](screens/06-duplicate-diagnostic.jpg)
- Under an injected local write failure, running **Deliver queued captures** while the save was pending caused one fixture reservation request and wrote the capture to the vault even though the scratchpad reported a failed save. In a separate run with two scratchpads, the succeeding second save persisted both captures to the on-disk queue, including the rejected first capture. A single failed save without the concurrent action preserved the editor text and created zero queued items or fixture reservations.

The diagnostic and capture-durability corrections require a reviewed Community release before users on 3.4.84 receive them.

## Case results

| # | Case | Result | Observation |
| --- | --- | --- | --- |
| 1 | Installed bundle and ribbon | Pass | Manifest read 3.4.84. Seven Kairo commands appeared in the palette. The ribbon opened Quick capture. |
| 2 | Basic capture and guest queue | Pass | Blank Save showed validation. Save kept the scratchpad open, cleared the text, and queued the valid capture. Diagnostic and capture copy controls worked. Guest retry preserved the item. The account link opened settings. |
| 3 | Simple settings and account setup | Pass | Simple hid advanced controls. Password reset and verification resend reached the fixture. Registration prompted for verification, then login and balance refresh succeeded with fixture responses. |
| 4 | Advanced preferences and destination validation | Pass | The shortcut, vault folder, inbox name, timestamp, and template were saved. Validation reported the missing destination with creation disabled. Both startup choices reached the desktop adapter. Show automatic windows toggled both ways. |
| 5 | Inbox delivery | Pass | The delivery command wrote to the default inbox. Status-bar click and queue Retry delivered to the configured inbox. A later retry added no duplicate. |
| 6 | Daily note and capture keys | Pass | Automatic delivery wrote to the nested daily-note path. The Enter setting controlled save or newline. Shift+Enter and the alternate Ctrl+Enter mode worked. Both close-after-save choices worked. |
| 7 | Service failure and retry | Pass | A simulated delivery outage left the capture visible in the queue and preserved it across plugin reload. Manual retry after recovery delivered one copy. |
| 8 | Help and diagnostics | Pass | The Help command, five disclosures, recovery link target, Help actions, Copy diagnostic log, Toggle debug logging, Copy full log, and settings debug control worked. |
| 9 | Settings and status-bar controls | Pass | Show queue, Flush now, Open quick capture, and Enter on the status bar triggered the expected actions. |
| 10 | Explorer note and folder actions | Pass | The note action filled one link. The folder action recursively included both Markdown notes. |
| 11 | Editor context menu | Pass | The editor actions filled the selected text or the current note link. |
| 12 | Mixed Explorer selection | Pass | A folder and selected child produced two eligible note links. The overlapping child appeared once. |
| 13 | Obsidian hotkey and Windows registration | Pass | Ctrl+Shift+K opened Quick capture. The configured accelerator was registered with Windows. |
| 14 | Catalog, purchase status, and cancellation | Pass | USD offers loaded from the fixture. The unpriced offer was disabled. Check payment requested status. Cancel current purchase closed the fixture checkout. |
| 15 | Fulfillment and sign-out | Pass | The fixture checkout reached Purchase complete and recorded its granted credit amount. Sign-out disabled guest purchase buttons. |
| 16 | Diagnostic button reuse | Fail | The second guest save added a duplicate button. Blank validation left both buttons visible. |
| 17 | Date and timestamp settings | Pass | All three date formats generated their corresponding paths. All three timestamp options saved. The footer displayed 3.4.84. |
| 18 | Catalog outage and account recovery failure | Pass | The unavailable catalog hid purchase controls. The recovery request reached the failure fixture. Restoring responses allowed the account to reconnect. |
| 19 | Single local write failure | Pass | The failed Save and close kept the scratchpad open with its text, zero queued items, and zero fixture reservations. |
| 20 | Windows global shortcut | Pass | Windows key input for Ctrl+Alt+Shift+F10 opened Quick capture. |
| 21 | Manual delivery during failed save | Fail | The capture generated one fixture reservation and appeared in the vault despite the local save failure. |
| 22 | Second save during failed first save | Fail | The on-disk queue contained the rejected first capture as well as the accepted second capture. |
| 23 | Full desktop restart | Pass | The guest queue and advanced and manual-delivery preferences reopened. The restored capture was visible in the queue and the installed version remained 3.4.84. |

Constance account, email requests, pricing, billing, and checkout responses came from a local fixture. Email delivery and payment settlement were outside the fixture. The desktop startup control was tested at the adapter boundary.

## Screenshots

| View | Evidence |
| --- | --- |
| Guest scratchpad and capture actions | [01 Quick capture](screens/01-quick-capture.jpg) |
| Local queue while signed out | [02 Guest queue](screens/02-guest-queue.jpg) |
| Simple settings | [03 Simple settings](screens/03-simple-settings.jpg) |
| Connected fixture account and offers | [04 Account and offers](screens/04-connected-account.jpg) |
| Advanced shortcut, destination, and formatting settings | [05 Advanced destination](screens/05-advanced-destination.jpg) |
| Duplicate diagnostic controls after the second save | [06 Diagnostic defect](screens/06-duplicate-diagnostic.jpg) |
| Delivered synthetic inbox entry | [07 Inbox delivery](screens/07-delivered-inbox-note.jpg) |
| Delivered synthetic daily-note entries | [08 Daily-note delivery](screens/08-delivered-daily-note.jpg) |
| Retained capture after a simulated service failure | [09 Offline queue](screens/09-offline-queue.jpg) |
| Help and troubleshooting | [10 Help](screens/10-help-and-troubleshooting.jpg) |
