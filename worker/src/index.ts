import { fallbackClassification, type Category, type ClassifiedNote } from "./classification";
import { classifyNote } from "./openai";

type NoteStatus = "processed" | "classification_error";
type NoteRow = {
  id: string;
  raw_text: string;
  title: string;
  refined_text: string;
  category: Category;
  recorded_at: number;
  created_at: number;
  source: string;
  status: NoteStatus;
  sort_order: number;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }
    if (!authorized(request, env.APP_TOKEN)) return json({ error: "Unauthorized" }, 401);

    try {
      if (request.method === "POST" && url.pathname === "/webhook/pebble") {
        return await ingestPebble(request, env);
      }
      if (url.pathname === "/api/notes" && request.method === "POST") {
        return await ingestSample(request, env);
      }
      if (url.pathname === "/api/notes" && request.method === "GET") {
        return await listNotes(env);
      }
      if (url.pathname === "/api/notes/order" && request.method === "PUT") {
        return await reorderNotes(request, env);
      }
      const retryMatch = url.pathname.match(/^\/api\/notes\/([a-f0-9]{64})\/retry$/);
      if (retryMatch && request.method === "POST") {
        return await retryNote(retryMatch[1], env);
      }
      const noteMatch = url.pathname.match(/^\/api\/notes\/([a-f0-9]{64})$/);
      if (noteMatch && request.method === "PATCH") {
        return await updateNote(noteMatch[1], request, env);
      }
      if (noteMatch && request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(noteMatch[1]).run();
        return new Response(null, { status: 204 });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "Internal server error" }, 500);
    }
  },
};

async function ingestPebble(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return json({ error: "Expected multipart/form-data" }, 415);
  }
  const form = await request.formData();
  const rawText = String(form.get("transcription") ?? "").trim();
  const timestamp = Number(form.get("recordedAt"));
  const recordedAt = Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
  const source = String(form.get("client") ?? "ring").slice(0, 30);
  return ingest(rawText, recordedAt, source, env);
}

async function ingestSample(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "Expected application/json" }, 415);
  }
  const body = (await request.json()) as { transcription?: unknown; recordedAt?: unknown };
  const rawText = typeof body.transcription === "string" ? body.transcription.trim() : "";
  const suppliedTimestamp = Number(body.recordedAt);
  const recordedAt = Number.isFinite(suppliedTimestamp) && suppliedTimestamp > 0 ? suppliedTimestamp : Date.now();
  return ingest(rawText, recordedAt, "android-sample", env);
}

async function ingest(rawText: string, recordedAt: number, source: string, env: Env): Promise<Response> {
  if (!rawText) return json({ error: "Missing transcription" }, 400);
  if (rawText.length > 20_000) return json({ error: "Transcription is too long" }, 413);

  const id = await stableId(recordedAt, rawText);
  const existing = await env.DB.prepare("SELECT id FROM notes WHERE id = ?").bind(id).first<{ id: string }>();
  if (existing) return json({ id, duplicate: true });

  let classification: ClassifiedNote;
  let status: NoteStatus = "processed";
  try {
    classification = await classifyNote(rawText, env.OPENAI_API_KEY);
  } catch (error) {
    console.error("Classification failed", error);
    classification = fallbackClassification(rawText);
    status = "classification_error";
  }

  const note: NoteRow = {
    id,
    raw_text: rawText,
    title: classification.title,
    refined_text: classification.refinedText,
    category: classification.category,
    recorded_at: recordedAt,
    created_at: Date.now(),
    source,
    status,
    sort_order: recordedAt,
  };
  await env.DB.prepare(
    `INSERT INTO notes (id, raw_text, title, refined_text, category, recorded_at, created_at, source, status, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  ).bind(
    note.id, note.raw_text, note.title, note.refined_text, note.category, note.recorded_at,
    note.created_at, note.source, note.status, note.sort_order,
  ).run();
  return json(note, 201);
}

async function listNotes(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, raw_text, title, refined_text, category, recorded_at, created_at, source, status, sort_order
     FROM notes ORDER BY sort_order DESC, recorded_at DESC LIMIT 500`,
  ).all<NoteRow>();
  return json({ notes: result.results });
}

async function retryNote(id: string, env: Env): Promise<Response> {
  const note = await env.DB.prepare(
    `SELECT id, raw_text, title, refined_text, category, recorded_at, created_at, source, status, sort_order
     FROM notes WHERE id = ?`,
  ).bind(id).first<NoteRow>();
  if (!note) return json({ error: "Note not found" }, 404);

  try {
    const classification = await classifyNote(note.raw_text, env.OPENAI_API_KEY);
    const updated: NoteRow = { ...note, ...classification, status: "processed" };
    await env.DB.prepare(
      "UPDATE notes SET title = ?, refined_text = ?, category = ?, status = ? WHERE id = ?",
    ).bind(updated.title, updated.refined_text, updated.category, updated.status, id).run();
    return json(updated);
  } catch (error) {
    console.error("Classification retry failed", error);
    return json({ error: "Classification retry failed" }, 502);
  }
}

async function updateNote(id: string, request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Expected application/json" }, 415);
  }
  const existing = await env.DB.prepare(
    `SELECT id, raw_text, title, refined_text, category, recorded_at, created_at, source, status, sort_order
     FROM notes WHERE id = ?`,
  ).bind(id).first<NoteRow>();
  if (!existing) return json({ error: "Note not found" }, 404);

  const body = (await request.json()) as { title?: unknown; raw_text?: unknown; refined_text?: unknown };
  const title = typeof body.title === "string" ? body.title.trim() : existing.title;
  const rawText = typeof body.raw_text === "string" ? body.raw_text.trim() : existing.raw_text;
  const refinedText = typeof body.refined_text === "string" ? body.refined_text.trim() : existing.refined_text;
  if (!title || !rawText || !refinedText) return json({ error: "Title, refined text, and transcript cannot be empty" }, 400);
  if (title.length > 200 || rawText.length > 20_000 || refinedText.length > 20_000) return json({ error: "Edited note is too long" }, 413);

  await env.DB.prepare("UPDATE notes SET title = ?, raw_text = ?, refined_text = ? WHERE id = ?")
    .bind(title, rawText, refinedText, id).run();
  return json({ ...existing, title, raw_text: rawText, refined_text: refinedText });
}

async function reorderNotes(request: Request, env: Env): Promise<Response> {
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Expected application/json" }, 415);
  }
  const body = (await request.json()) as { ids?: unknown };
  if (!Array.isArray(body.ids) || body.ids.length > 500 ||
      body.ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))) {
    return json({ error: "ids must be a list of note IDs" }, 400);
  }
  const ids = [...new Set(body.ids as string[])];
  const statements = ids.map((id, index) =>
    env.DB.prepare("UPDATE notes SET sort_order = ? WHERE id = ?")
      .bind(ids.length - index, id),
  );
  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true });
}

function authorized(request: Request, token: string): boolean {
  return Boolean(token) && request.headers.get("Authorization") === `Bearer ${token}`;
}

async function stableId(recordedAt: number, rawText: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${recordedAt}\n${rawText}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}
