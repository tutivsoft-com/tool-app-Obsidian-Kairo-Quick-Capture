# Kairo Quick Capture

Capture text locally and deliver it to the configured inbox or daily note.

## Use

Install or update the plugin through Obsidian Community plugins, enable it, and open its settings. Use the existing plugin commands for the selected note, text or files. Existing preferences and local recovery records are retained.

## Account and billing

Connect your Constance account in plugin settings. If you create an account, confirm the email link and then connect again. Authentication, current offers, free allowance, purchased balance and payment confirmation use the Constance v2 service at https://app.tutivsoft.com.

Current paid names, descriptions, prices, currencies and included units come from the payment provider through Constance. Refresh the displayed offers before buying. If current pricing cannot be verified, buying is unavailable. Only canonical payment fulfillment grants credits. A completed purchase stays saved until the refreshed balance is saved and acknowledged. Pending requests retain their original identity after a retry or restart. Account and Buy credits use separate theme-aware sections with standard Obsidian controls. Balance summaries stay with Account. Purchase progress and elapsed time appear directly below the offers. Automatic checks begin after three seconds, then every five seconds for up to five minutes. Check payment and Cancel current purchase are the only purchase-status actions. Completion requires canonical fulfillment, a saved refreshed balance and acknowledgement of the original purchase. A browser return or timer does not grant credits.

New purchases use Paddle and USD. Existing historical purchases retain their original provider. No payment credentials are bundled in the plugin.

## Privacy and recovery

Account requests send authentication and billing information to Constance. Passwords are not saved. Session credentials and recovery state are kept in local plugin settings. Billing requests do not contain note or image contents. The main processing workflow stays local. Basic app usage events use the existing analytics service without note contents. The local diagnostic buffer is separate from automatic startup and plugin error reports sent to Datadog. Reports include the plugin version, platform, error details and recent action names. Credentials are redacted; details from a failed operation can include file paths or content.

Uncertain older billing records are retained and are never replayed as new v2 charges. Connect the original account and contact support if an earlier operation needs recovery.

## Release

Version 3.4.83: Capture delivery retains queued text and recovery, with refreshed balances and current diagnostics.

Use the matching GitHub release for installation availability. Community directory review is separate from source validation.

## Support

Use the plugin's Help or Open documentation command and the support links in its manifest. For a billing problem, retain the original purchase or operation identity and use the account portal. Do not share passwords or session tokens.
