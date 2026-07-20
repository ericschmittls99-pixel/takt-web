-- Schlaf aus Garmin (dailySleepData). PK = calendar_date. Summary als Spalten,
-- kompakte Kurven (15-Min-Raster) als JSON in curves. Siehe PROJECT_OVERVIEW 6.4.
CREATE TABLE IF NOT EXISTS garmin_sleep (
  calendar_date       TEXT PRIMARY KEY,
  total_sec           INTEGER,
  deep_sec            INTEGER,
  light_sec           INTEGER,
  rem_sec             INTEGER,
  awake_sec           INTEGER,
  score               INTEGER,
  score_qualifier     TEXT,
  avg_stress          REAL,
  avg_hr              REAL,
  avg_respiration     REAL,
  avg_spo2            REAL,
  hrv_overnight_avg   REAL,
  hrv_status          TEXT,
  body_battery_change INTEGER,
  resting_hr          INTEGER,
  restless_moments    INTEGER,
  curves              TEXT   -- JSON: { hr, stress, body_battery, movement, levels }
);
