-- Datumsbezogene Ausnahmen zum Standardwochen-Plan (planned_blocks).
-- Damit lässt sich ein Plan-Block "nur für diesen einen Tag" ändern, verschieben
-- oder löschen, ohne die Standardwoche anzufassen.
--
--   source_block_id  -> überschreibt genau diesen planned_blocks-Eintrag an diesem Tag
--                       (NULL = eigenständiger Zusatz-Block nur für diesen Tag)
--   deleted = 1      -> versteckt den Quell-Block an diesem Tag (kein Ersatz)
--   employer_id/…    -> Daten des Ersatz-/Zusatzblocks (bei deleted=1 egal)
CREATE TABLE planned_overrides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  date            TEXT NOT NULL,             -- YYYY-MM-DD
  source_block_id INTEGER REFERENCES planned_blocks(id),
  deleted         INTEGER NOT NULL DEFAULT 0,
  employer_id     INTEGER REFERENCES employers(id),
  project_id      INTEGER REFERENCES projects(id),
  start_min       INTEGER,
  end_min         INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_overrides_date ON planned_overrides(date);
CREATE INDEX idx_overrides_source ON planned_overrides(source_block_id);
