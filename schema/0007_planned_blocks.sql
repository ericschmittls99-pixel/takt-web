-- Geplante Blöcke (Soll), wiederkehrend pro Wochentag.
-- weekday: 0 = Sonntag … 6 = Samstag (entspricht JS Date.getDay()).
CREATE TABLE planned_blocks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id  INTEGER NOT NULL REFERENCES employers(id),
  project_id   INTEGER REFERENCES projects(id),
  weekday      INTEGER NOT NULL,          -- 0..6 (So..Sa)
  start_min    INTEGER NOT NULL,          -- Minuten ab Mitternacht
  end_min      INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_planned_weekday ON planned_blocks(weekday);
