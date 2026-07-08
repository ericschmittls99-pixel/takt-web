-- Arbeitgeber
CREATE TABLE employers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  bundesland  TEXT NOT NULL
);

-- Projekte: vierstufige Hierarchie über parent_id (NULL = oberste Ebene)
CREATE TABLE projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id  INTEGER NOT NULL REFERENCES employers(id),
  parent_id    INTEGER REFERENCES projects(id),
  name         TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1
);

-- Zeiteinträge (Ist)
CREATE TABLE time_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id  INTEGER NOT NULL REFERENCES employers(id),
  project_id   INTEGER REFERENCES projects(id),
  start_ts     TEXT NOT NULL,             -- ISO 8601
  end_ts       TEXT,                      -- NULL = läuft gerade
  duration_min INTEGER,                   -- wird beim Stoppen berechnet
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Soll-Vorgaben pro Arbeitgeber
CREATE TABLE targets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id     INTEGER NOT NULL REFERENCES employers(id),
  weekly_soll_min INTEGER NOT NULL,       -- Soll-Minuten pro Woche
  valid_from      TEXT NOT NULL
);

CREATE INDEX idx_entries_employer ON time_entries(employer_id);
CREATE INDEX idx_entries_start    ON time_entries(start_ts);

-- Startdaten: deine zwei Arbeitgeber
INSERT INTO employers (name, bundesland) VALUES
  ('FMC',  'Rheinland-Pfalz'),
  ('bhyo', 'Baden-Württemberg');
