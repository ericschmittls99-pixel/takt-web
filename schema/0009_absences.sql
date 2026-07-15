-- Abwesenheiten (Urlaub, Krank, Feiertag, …), datumsbereichsweise.
-- Zählen wie erfasste Aktivitäten, sobald sie in der Vergangenheit liegen
-- (füllen das Tages-Soll des betroffenen Bereichs).
--   employer_id NULL = gilt für alle Bereiche
CREATE TABLE absences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date   TEXT NOT NULL,             -- YYYY-MM-DD (inklusive)
  end_date     TEXT NOT NULL,             -- YYYY-MM-DD (inklusive)
  type         TEXT NOT NULL,             -- urlaub | krank | feiertag | sonstiges
  employer_id  INTEGER REFERENCES employers(id),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_absences_start ON absences(start_date);
