const SCOPE = "https://www.googleapis.com/auth/drive.file";
const CALLBACK = "/drive/callback";
const timeout = () => AbortSignal.timeout(20_000);
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const ready = (env: Env) => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.DRIVE_TOKEN_KEY);
function page(message: string, status = 200): Response {
  // Messages are fixed application strings, never Google responses or query values.
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>Xanadu Drive</title><h1>Xanadu</h1><p>${message}</p>`, {
    status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" },
  });
}
function base64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function unbase64(text: string): Uint8Array { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
function random(): string { return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""); }
export async function seal(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unbase64(secret), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return `${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}
export async function unseal(value: string, secret: string): Promise<string> {
  const [iv, ciphertext] = value.split(".");
  const key = await crypto.subtle.importKey("raw", unbase64(secret), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv) }, key, unbase64(ciphertext)));
}

export async function driveStatus(env: Env): Promise<Response> {
  const connection = await env.DB.prepare("SELECT email, folder_id FROM drive_connection WHERE id = 1").first();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS count FROM drive_uploads GROUP BY status").all();
  const error = await env.DB.prepare("SELECT last_error FROM drive_uploads WHERE last_error IS NOT NULL AND status != 'uploaded' ORDER BY next_attempt_at DESC LIMIT 1").first<{ last_error: string }>();
  return json({ configured: ready(env), connected: Boolean(connection), connection, uploads: counts.results, error: error?.last_error ?? null });
}

export async function startDriveConnection(env: Env): Promise<Response> {
  if (!ready(env)) return json({ error: "Google Drive setup is not complete on the server. Add Google OAuth credentials first." }, 503);
  const state = random();
  await env.DB.prepare("DELETE FROM drive_oauth WHERE expires_at < ?").bind(Date.now()).run();
  await env.DB.prepare("INSERT INTO drive_oauth(state, verifier, expires_at) VALUES (?, ?, ?)").bind(state, random(), Date.now() + 600_000).run();
  return json({ url: `${env.PUBLIC_URL}/drive/start?state=${state}` });
}

export async function driveBrowserRoute(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!ready(env)) return page("Google Drive setup is not complete on the server.", 503);
  const state = url.searchParams.get("state") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) return page("Connection link is invalid. Start again from Xanadu.", 400);
  if (url.pathname === "/drive/start") {
    const browserToken = random();
    const session = await env.DB.prepare("UPDATE drive_oauth SET browser_token = ? WHERE state = ? AND browser_token IS NULL AND expires_at > ? RETURNING verifier")
      .bind(browserToken, state, Date.now()).first<{ verifier: string }>();
    if (!session) return page("Connection link expired or was already used. Start again from Xanadu.", 400);
    const challenge = base64(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session.verifier)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const target = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    target.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: env.PUBLIC_URL + CALLBACK,
      response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent select_account",
      state, code_challenge: challenge, code_challenge_method: "S256",
      ...(env.DRIVE_ACCOUNT_EMAIL ? { login_hint: env.DRIVE_ACCOUNT_EMAIL } : {}), trigger_onepick: "true", allow_folder_selection: "true",
      file_ids: env.DRIVE_FOLDER_ID, mimetypes: "application/vnd.google-apps.folder",
    }).toString();
    return new Response(null, { status: 302, headers: { Location: target.toString(), "Set-Cookie": `xanadu_drive=${browserToken}; Secure; HttpOnly; SameSite=Lax; Path=/drive; Max-Age=600`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  const cookie = request.headers.get("Cookie")?.match(/(?:^|;\s*)xanadu_drive=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1] ?? "";
  const session = await env.DB.prepare("DELETE FROM drive_oauth WHERE state = ? AND browser_token = ? AND expires_at > ? RETURNING verifier")
    .bind(state, cookie, Date.now()).first<{ verifier: string }>();
  if (!session) return page("Connection expired or browser session did not match. Start again from Xanadu.", 400);
  if (url.searchParams.has("error")) return page("Google authorization was cancelled or blocked. Return to Xanadu to try again.", 400);
  if (!(url.searchParams.get("picked_file_ids") ?? "").split(",").includes(env.DRIVE_FOLDER_ID)) return page("Select the configured Lain folder when connecting. Return to Xanadu and try again.", 400);
  const code = url.searchParams.get("code");
  if (!code) return page("Google did not return an authorization code.", 400);
  try {
    const tokens = await tokenRequest(env, { code, code_verifier: session.verifier, redirect_uri: env.PUBLIC_URL + CALLBACK, grant_type: "authorization_code" });
    if (!tokens.refresh_token) return page("Google did not grant background access. Connect again and approve the requested access.", 400);
    const account = await googleJson<{ user: { emailAddress: string } }>("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)", tokens.access_token);
    if (env.DRIVE_ACCOUNT_EMAIL && account.user.emailAddress.toLowerCase() !== env.DRIVE_ACCOUNT_EMAIL.toLowerCase()) return page("The selected Google account is not the configured destination account. Connect again with your intended account.", 400);
    const folder = await googleJson<{ mimeType: string; trashed?: boolean; capabilities?: { canAddChildren?: boolean } }>(`https://www.googleapis.com/drive/v3/files/${env.DRIVE_FOLDER_ID}?supportsAllDrives=true&fields=mimeType,trashed,capabilities(canAddChildren)`, tokens.access_token);
    if (folder.mimeType !== "application/vnd.google-apps.folder" || folder.trashed || !folder.capabilities?.canAddChildren) return page("Xanadu cannot add files to that folder. Check folder permissions and reconnect.", 400);
    await env.DB.prepare("INSERT INTO drive_connection(id, refresh_token, email, folder_id, connected_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET refresh_token=excluded.refresh_token, email=excluded.email, folder_id=excluded.folder_id, connected_at=excluded.connected_at")
      .bind(await seal(tokens.refresh_token, env.DRIVE_TOKEN_KEY!), account.user.emailAddress, env.DRIVE_FOLDER_ID, Date.now()).run();
    await env.DB.prepare("UPDATE drive_uploads SET next_attempt_at = 0 WHERE status = 'pending'").run();
    return page("Google Drive is connected. New Lain notes and waiting uploads will be saved as .txt files in your chosen folder. You can close this page and return to Xanadu.");
  } catch {
    return page("Could not connect Google Drive. Check that Drive and Picker APIs are enabled and your work account permits this app, then try again.", 502);
  }
}

type Tokens = { access_token: string; refresh_token?: string };
async function tokenRequest(env: Env, params: Record<string, string>): Promise<Tokens> {
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: timeout(), body: new URLSearchParams({ ...params, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! }) });
  if (!response.ok) throw new Error("Google authorization expired or was rejected. Reconnect Google Drive.");
  const tokens = await response.json() as Tokens;
  if (!tokens.access_token) throw new Error("Google returned no access token.");
  return tokens;
}
async function googleJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: timeout() });
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status}). Check folder access or reconnect.`);
  return response.json() as Promise<T>;
}

export function uploadStatement(env: Env, note: { id: string; category: string; raw_text: string; recorded_at: number }): D1PreparedStatement {
  // Called in the same D1 batch as the note insert/reclassification. No historical backfill.
  return env.DB.prepare("INSERT INTO drive_uploads(note_id, raw_text, recorded_at) SELECT ?, ?, ? WHERE ? = 'lain' ON CONFLICT(note_id) DO NOTHING")
    .bind(note.id, note.raw_text, note.recorded_at, note.category);
}

type Upload = { note_id: string; raw_text: string; recorded_at: number; file_id: string | null; attempts: number };
export function uploadBody(job: Upload, folderId: string): { body: string; contentType: string } {
  const boundary = `xanadu_${crypto.randomUUID()}`;
  const metadata = { id: job.file_id, name: `${job.recorded_at}-${job.note_id}.txt`, mimeType: "text/plain", parents: [folderId], appProperties: { xanaduNoteId: job.note_id } };
  return { contentType: `multipart/related; boundary=${boundary}`, body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${job.raw_text}\r\n--${boundary}--\r\n` };
}

export async function drainDriveUploads(env: Env): Promise<void> {
  if (!ready(env)) return;
  const connection = await env.DB.prepare("SELECT refresh_token, folder_id FROM drive_connection WHERE id = 1").first<{ refresh_token: string; folder_id: string }>();
  if (!connection) return;
  // Each job has its own lease; concurrent webhooks/cron invocations cannot allocate different file IDs.
  let accessToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const lease = random();
    const now = Date.now();
    const job = await env.DB.prepare(`UPDATE drive_uploads SET status='uploading', lease=?, lease_until=?, attempts=attempts+1
      WHERE note_id = (SELECT note_id FROM drive_uploads WHERE (status='pending' AND next_attempt_at <= ?) OR (status='uploading' AND lease_until < ?) ORDER BY recorded_at LIMIT 1)
      RETURNING note_id, raw_text, recorded_at, file_id, attempts`).bind(lease, now + 300_000, now, now).first<Upload>();
    if (!job) return;
    try {
      if (!accessToken) accessToken = (await tokenRequest(env, { grant_type: "refresh_token", refresh_token: await unseal(connection.refresh_token, env.DRIVE_TOKEN_KEY!) })).access_token;
      if (!job.file_id) {
        const ids = await googleJson<{ ids: string[] }>("https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files", accessToken);
        if (!ids.ids?.[0]) throw new Error("Google Drive returned no file ID.");
        const saved = await env.DB.prepare("UPDATE drive_uploads SET file_id=? WHERE note_id=? AND lease=? AND status='uploading' RETURNING file_id")
          .bind(ids.ids[0], job.note_id, lease).first<{ file_id: string }>();
        if (!saved) continue;
        job.file_id = saved.file_id;
      }
      const payload = uploadBody(job, connection.folder_id);
      const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": payload.contentType }, body: payload.body, signal: timeout() });
      if (response.status === 409) {
        const existing = await googleJson<{ parents?: string[]; appProperties?: { xanaduNoteId?: string } }>(`https://www.googleapis.com/drive/v3/files/${job.file_id}?supportsAllDrives=true&fields=parents,appProperties`, accessToken);
        if (!existing.parents?.includes(connection.folder_id) || existing.appProperties?.xanaduNoteId !== job.note_id) throw new Error("Drive file conflict; upload needs attention.");
      } else if (!response.ok) throw new Error(`Drive upload failed (${response.status}). Check folder access or reconnect.`);
      await env.DB.prepare("UPDATE drive_uploads SET status='uploaded', uploaded_at=?, last_error=NULL, lease=NULL, lease_until=0 WHERE note_id=? AND lease=?")
        .bind(Date.now(), job.note_id, lease).run();
    } catch (error) {
      // Never include raw provider response bodies, credentials, or transcripts in error messages.
      const message = error instanceof Error && /^(Google |Drive )/.test(error.message) ? error.message : "Drive upload could not finish; it will retry automatically.";
      await env.DB.prepare("UPDATE drive_uploads SET status='pending', next_attempt_at=?, last_error=?, lease=NULL, lease_until=0 WHERE note_id=? AND lease=?")
        .bind(Date.now() + Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attempts - 1, 6)), message, job.note_id, lease).run();
      if (!accessToken) return;
    }
  }
}
