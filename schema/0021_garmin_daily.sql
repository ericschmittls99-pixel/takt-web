-- Tageswerte aus Garmin (usersummary daily). PK = calendar_date. Alle Werte NULL-fähig.
-- Siehe PROJECT_OVERVIEW 6.4.
CREATE TABLE IF NOT EXISTS garmin_daily (
  calendar_date          TEXT PRIMARY KEY,
  steps                  INTEGER,
  step_goal              INTEGER,
  resting_hr             INTEGER,
  resting_hr_7d_avg      INTEGER,
  min_hr                 INTEGER,
  max_hr                 INTEGER,
  calories_total         REAL,
  calories_active        REAL,
  calories_bmr           REAL,
  intensity_moderate_min INTEGER,
  intensity_vigorous_min INTEGER,
  stress_avg             INTEGER,
  stress_max             INTEGER,
  bb_high                INTEGER,
  bb_low                 INTEGER,
  bb_wake                INTEGER,
  bb_charged             INTEGER,
  bb_drained             INTEGER,
  spo2_avg               INTEGER,
  respiration_waking_avg REAL,
  floors_ascended        REAL,
  sleeping_sec           INTEGER
);
