ALTER TABLE notes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE notes SET sort_order = recorded_at;

UPDATE notes
SET title = 'Temporary Title - Not LLM Processed Yet'
WHERE status = 'classification_error';

CREATE INDEX notes_sort_order_idx ON notes(sort_order DESC, recorded_at DESC);
