ALTER TABLE notes RENAME TO notes_old;

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  title TEXT NOT NULL,
  refined_text TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Watch next', 'Weight', 'TODO', 'Presents', 'Talking points',
    'Bars and Restaurants', 'Thoughts', 'Words', 'Quotes', 'Films', 'Ideas',
    'Fiction Ideas', 'Names', 'Aphorisms and maxims', 'lain', 'Misc'
  )),
  recorded_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processed', 'classification_error')),
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO notes SELECT * FROM notes_old;

DROP TABLE notes_old;
CREATE INDEX notes_recorded_at_idx ON notes(recorded_at DESC);
CREATE INDEX notes_sort_order_idx ON notes(sort_order DESC, recorded_at DESC);
