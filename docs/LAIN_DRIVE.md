# Lain → Google Drive

Xanadu uploads new `lain` notes as UTF-8 `.txt` files to:

- Account: your personal Google account, selected during authorization
- Folder: https://drive.google.com/drive/folders/1ESK6xpMZ8j0koKIvlwxnI4dzgU_KkvkX

Uploads run on the Cloudflare Worker after Pebble delivers its webhook. Xanadu
can be closed and the phone locked. Pebble must still deliver the recording.
The file contains the original transcript, including the Lain cue; no generated
answer or literary rewrite is substituted.

## One-time Google configuration

1. Create/select a project in https://console.cloud.google.com/ . Enable the
   **Google Drive API** and **Google Picker API** in that same project.
2. Configure **Google Auth Platform → Branding / Audience** for Xanadu. If the
   project is for your personal account, choose External and add your personal
   Google email as a test user.
3. Create an OAuth client of type **Web application**. Add this exact authorized
   redirect URI (no trailing slash):

   ```text
   https://pebble-note-sorter.pebble-note-sorter-worker.workers.dev/drive/callback
   ```

4. Configure server secrets without putting them in source control or chat:

   ```sh
   cd worker
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```

   `DRIVE_TOKEN_KEY` must also be a base64-encoded random 32-byte secret, set once
   by the installer. Do not replace it while a connection exists: it encrypts
   the stored refresh token. A replacement requires reconnecting Google Drive.
5. In Xanadu, tap the cloud-upload icon → **connect google drive**. Select the
   personal account and configured folder and approve access. The browser confirms the
   connection. Return to Xanadu; it refreshes connection status on resume.
6. Record a new `lain, ...` note. Its file should appear after webhook processing;
   the cloud-upload screen shows completed/waiting uploads and any error.

Only `drive.file` is requested. Google's hosted Picker grants access to the
selected folder; pasting a folder ID alone does not grant access. Xanadu checks
the signed-in account and write access before storing a connection.

External apps left in Google's Testing state receive refresh tokens that normally
expire after seven days for this scope. For ongoing use, configure a suitable
production/internal app under Google's policies rather than relying on a testing
token. Revoked, expired, or admin-blocked access requires reconnection.

## Delivery behavior

The note and pending-upload record are committed in one D1 transaction. Immediate
processing is attempted after a successful webhook, and a minute-based scheduled
job recovers pending work with exponential backoff up to one hour. Pending notes
also wait safely before Google is connected. Reclassification into lain queues
an upload. Existing history is not automatically backfilled.

Each job reserves a Drive file ID before uploading; retrying uses the same ID to
avoid duplicate files after timeouts. Expiring leases coordinate concurrent
webhooks and scheduled jobs. Credentials are encrypted at rest using AES-GCM.
OAuth launch links expire after ten minutes, are single-use, and use browser
state binding and PKCE. No Google refresh token or client secret is sent to Android.

Files are named `<recorded_at>-<note_id>.txt`. Each upload is a snapshot of the
transcript when it first entered lain. Editing or deleting a Xanadu note does
not edit/delete its queued or uploaded Drive copy.

## Deployment and validation

Apply D1 migration `0006_drive_uploads.sql`, deploy the Worker with its cron
trigger, and install Android version 0.8.0 or later. Node 22+ is required for the
SQLite-backed upload/OAuth tests (`npm test`). A real end-to-end Google upload
can only be verified after the account authorization is completed.

References:
- [Google offline OAuth](https://developers.google.com/identity/protocols/oauth2/web-server#offline)
- [Hosted Picker authorization](https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker)
- [Drive upload retry IDs](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Refresh token expiration](https://developers.google.com/identity/protocols/oauth2)
