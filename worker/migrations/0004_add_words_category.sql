ALTER TABLE notes RENAME TO notes_old;

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  title TEXT NOT NULL,
  refined_text TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Watch next', 'Weight', 'TODO', 'Presents', 'Talking points',
    'Bars and Restaurants', 'Thoughts', 'Words', 'Quotes', 'Films', 'Ideas',
    'Fiction Ideas', 'Names', 'Aphorisms and maxims', 'Misc'
  )),
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'classification_error')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO notes (id, raw_text, title, refined_text, category, recorded_at, created_at, source, status, sort_order)
SELECT id, raw_text, title, refined_text,
  CASE
    WHEN category = 'Quotes' AND lower(raw_text) LIKE 'words.%' THEN 'Words'
    WHEN category IN (
      'Watch next', 'Weight', 'TODO', 'Presents', 'Talking points',
      'Bars and Restaurants', 'Thoughts', 'Words', 'Quotes', 'Films', 'Ideas',
      'Fiction Ideas', 'Names', 'Aphorisms and maxims', 'Misc'
    ) THEN category
    ELSE 'Misc'
  END,
  recorded_at, created_at, source, status, sort_order
FROM notes_old;

DROP TABLE notes_old;
CREATE INDEX notes_recorded_at_idx ON notes(recorded_at DESC);
CREATE INDEX notes_sort_order_idx ON notes(sort_order DESC, recorded_at DESC);
