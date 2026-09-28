import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { drainDriveUploads, driveBrowserRoute, seal, unseal, startDriveConnection, uploadStatement } from "../src/drive";

let sqlite: DatabaseSync;
let env: Env;
const folder = "1EtI6zyUcTUAyIslFOQrx6Yg62loGly12";
const note = { id: "a".repeat(64), raw_text: "lain, what day is it today?", category: "lain", recorded_at: 123 };
const key = btoa("x".repeat(32));
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../migrations/0006_drive_uploads.sql", import.meta.url), "utf8"));
  const DB = { prepare(sql: string) {
    let values: any[] = [];
    return {
      bind(...args: any[]) { values = args; return this; },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...values) }; },
      async run() { return sqlite.prepare(sql).run(...values); },
    };
  } };
  env = { DB, GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret", DRIVE_TOKEN_KEY: key, DRIVE_FOLDER_ID: folder, DRIVE_ACCOUNT_EMAIL: "nick.woods@deliveroo.co.uk", PUBLIC_URL: "https://xanadu.example" } as unknown as Env;
});
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });
async function connect() {
  sqlite.prepare("INSERT INTO drive_connection VALUES (1, ?, ?, ?, ?)").run(await seal("refresh-secret", key), env.DRIVE_ACCOUNT_EMAIL, folder, Date.now());
}
function job() { return sqlite.prepare("SELECT * FROM drive_uploads").get(); }
const ok = (body: unknown) => Response.json(body);

describe("Drive upload outbox", () => {
  it("queues only lain notes and deduplicates repeat webhooks", async () => {
    await uploadStatement(env, { ...note, category: "TODO" }).run();
    expect(job()).toBeUndefined();
    await uploadStatement(env, note).run();
    await uploadStatement(env, note).run();
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drive_uploads").get()?.n).toBe(1);
  });
  it("keeps a note pending without authorization and makes no Google requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await uploadStatement(env, note).run();
    await drainDriveUploads(env);
    expect(job()?.status).toBe("pending");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uploads original instructions to the chosen folder and skips completed jobs", async () => {
    await connect(); await uploadStatement(env, note).run();
    const fetch = vi.fn().mockResolvedValueOnce(ok({ access_token: "access" })).mockResolvedValueOnce(ok({ ids: ["file123"] })).mockResolvedValueOnce(ok({ id: "file123" }));
    vi.stubGlobal("fetch", fetch);
    await drainDriveUploads(env); await drainDriveUploads(env);
    expect(job()?.status).toBe("uploaded");
    expect(fetch).toHaveBeenCalledTimes(3);
    const body = fetch.mock.calls[2][1].body;
    expect(body).toContain(note.raw_text);
    expect(body).toContain(`"parents":["${folder}"]`);
    expect(body).toContain(`123-${note.id}.txt`);
  });
  it("retries a timed-out upload using the same persisted Drive ID", async () => {
    await connect(); await uploadStatement(env, note).run();
    const fetch = vi.fn().mockResolvedValueOnce(ok({ access_token: "access" })).mockResolvedValueOnce(ok({ ids: ["file123"] })).mockRejectedValueOnce(new Error("timeout"));
    vi.stubGlobal("fetch", fetch);
    await drainDriveUploads(env);
    expect(job()?.status).toBe("pending"); expect(job()?.file_id).toBe("file123");
    sqlite.exec("UPDATE drive_uploads SET next_attempt_at=0");
    fetch.mockResolvedValueOnce(ok({ access_token: "access" })).mockResolvedValueOnce(new Response(null, { status: 409 })).mockResolvedValueOnce(ok({ parents: [folder], appProperties: { xanaduNoteId: note.id } }));
    await drainDriveUploads(env);
    expect(job()?.status).toBe("uploaded");
    expect(fetch.mock.calls.filter(call => String(call[0]).includes("generateIds"))).toHaveLength(1);
  });
  it("does not claim a live lease, but recovers an abandoned lease", async () => {
    await connect(); await uploadStatement(env, note).run();
    sqlite.prepare("UPDATE drive_uploads SET status='uploading', lease_until=?").run(Date.now()+300000);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await drainDriveUploads(env); expect(fetch).not.toHaveBeenCalled();
    sqlite.exec("UPDATE drive_uploads SET lease_until=0");
    fetch.mockResolvedValueOnce(ok({ access_token: "access" })).mockResolvedValueOnce(ok({ ids: ["file123"] })).mockResolvedValueOnce(ok({ id: "file123" }));
    await drainDriveUploads(env); expect(job()?.status).toBe("uploaded");
  });
  it("keeps the job for reconnect when Google rejects refresh credentials", async () => {
    await connect(); await uploadStatement(env, note).run();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private provider detail", { status: 400 })));
    await drainDriveUploads(env);
    expect(job()?.status).toBe("pending");
    expect(job()?.last_error).toContain("Reconnect");
    expect(job()?.last_error).not.toContain("private");
  });
});

describe("Drive authorization", () => {
  it("encrypts refresh credentials and rejects a wrong encryption key", async () => {
    const encrypted = await seal("refresh-secret", key);
    expect(encrypted).not.toContain("refresh-secret");
    expect(await unseal(encrypted, key)).toBe("refresh-secret");
    await expect(unseal(encrypted, btoa("y".repeat(32)))).rejects.toThrow();
  });
  async function session() {
    const response = await startDriveConnection(env);
    const { url } = await response.json() as { url: string };
    const started = await driveBrowserRoute(new Request(url), env);
    return { state: new URL(url).searchParams.get("state")!, cookie: started.headers.get("Set-Cookie")!.split(";")[0], started, url };
  }
  it("uses offline, folder-scoped OAuth and a one-use launch ticket", async () => {
    const { started, url } = await session();
    const google = new URL(started.headers.get("Location")!);
    expect(google.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
    expect(google.searchParams.get("file_ids")).toBe(folder);
    expect(google.searchParams.get("access_type")).toBe("offline");
    expect(google.searchParams.get("code_challenge_method")).toBe("S256");
    expect((await driveBrowserRoute(new Request(url), env)).status).toBe(400);
  });
  it("rejects a callback without the browser cookie before exchanging credentials", async () => {
    const { state } = await session(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await driveBrowserRoute(new Request(`https://xanadu.example/drive/callback?state=${state}&code=test`), env)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects the wrong account without replacing the connection", async () => {
    const { state, cookie } = await session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ access_token: "access", refresh_token: "refresh" })).mockResolvedValueOnce(ok({ user: { emailAddress: "wrong@example.com" } })));
    const response = await driveBrowserRoute(new Request(`https://xanadu.example/drive/callback?state=${state}&code=test&picked_file_ids=${folder}`, { headers: { Cookie: cookie } }), env);
    expect(response.status).toBe(400);
    expect(sqlite.prepare("SELECT * FROM drive_connection").get()).toBeUndefined();
  });
  it("validates writable folder access, saves encrypted credentials, rejects replay", async () => {
    const { state, cookie } = await session();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(ok({ access_token: "access", refresh_token: "refresh" })).mockResolvedValueOnce(ok({ user: { emailAddress: env.DRIVE_ACCOUNT_EMAIL } })).mockResolvedValueOnce(ok({ mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: true } })));
    const request = new Request(`https://xanadu.example/drive/callback?state=${state}&code=test&picked_file_ids=${folder}`, { headers: { Cookie: cookie } });
    expect((await driveBrowserRoute(request, env)).status).toBe(200);
    const row = sqlite.prepare("SELECT * FROM drive_connection").get()!;
    expect(await unseal(String(row.refresh_token), key)).toBe("refresh");
    expect((await driveBrowserRoute(request, env)).status).toBe(400);
  });
});
