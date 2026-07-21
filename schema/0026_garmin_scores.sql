-- Kategorie-2-Scores (WP4b). Tageszeitreihe, PK calendar_date. Alle Werte NULL-fähig,
-- keine bedeutungstragenden Defaults (wie 6.4-Regel). Siehe PROJECT_OVERVIEW.
CREATE TABLE IF NOT EXISTS garmin_scores (
  calendar_date             TEXT PRIMARY KEY,
  -- Training Readiness
  training_readiness_score  INTEGER,
  tr_level                  TEXT,
  tr_recovery_time          INTEGER,
  tr_acute_load             INTEGER,
  tr_acwr_percent           INTEGER,
  -- Training Status
  training_status_code      INTEGER,
  ts_weekly_load            INTEGER,
  ts_load_balance           TEXT,      -- JSON (verschachtelte Load-Balance/ACWR-Struktur)
  -- Endurance / Hill
  endurance_score           INTEGER,
  hill_score                INTEGER,
  hill_strength             INTEGER,
  hill_endurance            INTEGER,
  -- VO2max (maßgebliche tägliche Quelle: maxmet/daily)
  vo2max                    REAL,
  -- Fitness Age
  fitness_age               REAL,
  fitness_age_chronological INTEGER,
  -- Race Predictions (Sekunden)
  race_5k_sec               INTEGER,
  race_10k_sec              INTEGER,
  race_hm_sec               INTEGER,
  race_m_sec                INTEGER
);
