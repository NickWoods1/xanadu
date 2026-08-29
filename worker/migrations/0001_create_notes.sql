CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Thoughts', 'TODO', 'Ideas', 'Words')),
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'classification_error'))
);

CREATE INDEX notes_recorded_at_idx ON notes(recorded_at DESC);
