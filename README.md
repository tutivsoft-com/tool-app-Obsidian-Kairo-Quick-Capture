# Kairo Quick Capture

Capture text locally and deliver it to the configured inbox or daily note.

## Use

Install or update Kairo Quick Capture through Community plugins in desktop Obsidian and enable it. Updates retain existing preferences and local recovery records. Run **Open quick capture** from the command palette, click the pencil icon in the ribbon, or press **Ctrl+Shift+K** (**Cmd+Shift+K** on macOS). To capture selected text or links to Markdown notes, use the Kairo actions in the editor or file menus.

Captures save to a local queue, including offline. Connect your account and go online to deliver them to `Inbox.md` by default, or choose a different inbox or daily-note destination in settings. **Show queued captures** lets you read or copy pending captures. Use **Deliver queued captures** to retry delivery manually.

## Account and billing

Connect your Constance account in plugin settings. If you create an account, confirm the email link and then connect again. Authentication, current offers, free allowance, purchased balance and payment confirmation use the Constance v2 service at https://app.tutivsoft.com.

Current paid names, descriptions, prices, currencies and included units come from the payment provider through Constance. Refresh the displayed offers before buying. If current pricing cannot be verified, buying is unavailable. Only canonical payment fulfillment grants credits. A completed purchase stays saved until the refreshed balance is saved and acknowledged. Pending requests retain their original identity after a retry or restart. Account and Buy credits use separate theme-aware sections with standard Obsidian controls. Balance summaries stay with Account. Purchase progress and elapsed time appear directly below the offers. Automatic checks begin after three seconds, then every five seconds for up to five minutes. Check payment and Cancel current purchase are the only purchase-status actions. Completion requires canonical fulfillment, a saved refreshed balance and acknowledgement of the original purchase. A browser return or timer does not grant credits.

New purchases use Paddle and USD. Existing historical purchases retain their original provider. No payment credentials are bundled in the plugin.

## Privacy and recovery

Account requests send authentication and billing information to Constance. Passwords are not saved. Session credentials and recovery state are kept in local plugin settings. Billing requests do not contain note or image contents. The main processing workflow stays local. Basic app usage events use the existing analytics service without note contents. The local diagnostic buffer is separate from automatic startup and plugin error reports sent to Datadog. Reports include the plugin version, platform, error details and recent action names. Credentials are redacted; details from a failed operation can include file paths or content.

Uncertain older billing records are retained and are never replayed as new v2 charges. Connect the original account and contact support if an earlier operation needs recovery.

## Version 3.4.84

Fix capture saves, manual delivery, templates, and destination checks.

Requires desktop Obsidian 1.5.0 or later. [GitHub release 3.4.84](https://github.com/tutivsoft-com/tool-app-Obsidian-Kairo-Quick-Capture/releases/tag/3.4.84).

## Support

Choose **Open Help** in the plugin settings or run **Open documentation** from the command palette. For a billing problem, retain the original purchase or operation identity and use the [Constance account portal](https://app.tutivsoft.com). Keep passwords and session tokens private.
