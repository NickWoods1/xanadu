CREATE TABLE drive_connection (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  refresh_token TEXT NOT NULL,
  email TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL
);
CREATE TABLE drive_oauth (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  browser_token TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE drive_uploads (
  note_id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  file_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploading', 'uploaded')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  uploaded_at INTEGER
);
CREATE INDEX drive_uploads_pending ON drive_uploads(status, next_attempt_at, lease_until);
