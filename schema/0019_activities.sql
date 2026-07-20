-- Quellenneutrale Aktivitäten/Workouts (Garmin-Sync + manuell). Siehe PROJECT_OVERVIEW 6.4.
-- Messfelder sind NULL-fähig (kein bedeutungstragender Default). Zuordnungsfelder (status,
-- employer_id, project_id, note, entry_id) gehören WP2 und werden vom Sync NIE überschrieben.
CREATE TABLE IF NOT EXISTS activities (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  source             TEXT    NOT NULL,                 -- 'garmin' | 'manual'
  garmin_activity_id TEXT    UNIQUE,                   -- natürlicher Sync-Schlüssel (NULL bei manuell)
  start_ts           TEXT,                             -- lokale Zeit (startTimeLocal)
  type               TEXT,
  name               TEXT,
  duration_sec       REAL,
  distance_m         REAL,
  calories           REAL,
  avg_hr             REAL,
  max_hr             REAL,
  elevation_gain_m   REAL,
  training_load      REAL,
  aerobic_te         REAL,
  anaerobic_te       REAL,
  moderate_min       INTEGER,
  vigorous_min       INTEGER,
  vo2max             REAL,
  total_reps         INTEGER,
  total_sets         INTEGER,
  -- Zuordnung (WP2) – nicht vom Sync angefasst:
  status             TEXT    NOT NULL DEFAULT 'inbox', -- 'inbox' | 'assigned' | 'ignored'
  employer_id        INTEGER REFERENCES employers(id),
  project_id         INTEGER REFERENCES projects(id),
  note               TEXT,
  entry_id           INTEGER REFERENCES time_entries(id)
);
-- garmin_activity_id ist über UNIQUE bereits indiziert. Zusätzlich für häufige Filter:
CREATE INDEX IF NOT EXISTS idx_activities_status   ON activities(status);
CREATE INDEX IF NOT EXISTS idx_activities_start_ts ON activities(start_ts);
