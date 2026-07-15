-- Aufgaben / To-Dos
CREATE TABLE todos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  due_date     TEXT,                      -- ISO-Datum YYYY-MM-DD, NULL = ohne Termin
  done         INTEGER NOT NULL DEFAULT 0, -- 0 = offen, 1 = erledigt
  employer_id  INTEGER REFERENCES employers(id), -- Bereich, optional
  project_id   INTEGER REFERENCES projects(id),  -- Projekt, optional
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_todos_done ON todos(done);
CREATE INDEX idx_todos_due  ON todos(due_date);
