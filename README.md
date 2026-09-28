# Xanadu

A small open-source Android app and Cloudflare Worker that turns Pebble Index
transcripts into focused lists such as `Thoughts`, `TODO`, `Watch next`, `Ideas`, and `Quotes`.
Each note keeps the raw transcript and receives an LLM-generated title, category, and polished version.

```text
Index ring → Pebble app → HTTPS webhook → Cloudflare Worker + OpenAI → Xanadu
```

The app keeps a local SQLite copy for offline reading. Notes can be edited,
reordered, retried, and copied to the clipboard as plain text.

## Requirements

- Android Studio with Android SDK 37
- Node.js 22+
- Cloudflare account with Workers and D1
- OpenAI API project with billing enabled

## Deploy the Worker

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create pebble-note-sorter
```

Put the returned database ID in `worker/wrangler.jsonc`, then run:

```sh
npx wrangler d1 migrations apply pebble-note-sorter --remote
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN
npx wrangler deploy
```

Keep both secrets private. `APP_TOKEN` is the bearer token used by Pebble and
the Android app; it is not an OpenAI key.

## Configure Pebble

In Pebble’s Index webhook settings:

- URL: `https://YOUR-WORKER.workers.dev/webhook/pebble`
- Header: `Authorization: Bearer YOUR_APP_TOKEN`
- Send: transcription only
- Trigger: all recordings

## Build the Android app

Open `android/` in Android Studio and run the `app` configuration on a device.
On first launch, enter the Worker URL and the same `APP_TOKEN`. The app is
called **Xanadu** and uses a green-on-black terminal theme.

From the command line:

```sh
cd android
./gradlew assembleDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk` on an Android 8+ device.

## Development

```sh
cd worker
npm test
npm run typecheck
```

The classifier prompt and fixed categories live in
`worker/src/classification.ts`. OpenAI credentials stay in the Worker and are
never bundled into the APK.

## License

MIT. See [LICENSE](LICENSE).

## Lain and live updates

Notes beginning with `lain` (including `lane`, `layne`, and `laine`) go to the
`lain` category, with priority over other categories. The LLM also recognizes
likely transcription variants. Apply migration `0005_add_lain_category.sql`
before deploying this version, then install the rebuilt Android app.

While Xanadu is visible, an authenticated WebSocket refreshes the list as soon
as the Worker saves a webhook note after classification. The connection stops
in the background and reconnects/syncs on return. A one-minute foreground sync
also recovers missed notifications. Deployment creates the `NoteEvents` Durable
Object via the migration in `wrangler.jsonc`.

Lain notes can upload to Google Drive server-side, independently of the phone's
lock state. Apply migration `0006_drive_uploads.sql` and complete the
[one-time Google setup](docs/LAIN_DRIVE.md), then connect using the cloud icon.
