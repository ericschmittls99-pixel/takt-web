-- WP-Intraday (9.3.2): Tagesverläufe Body Battery + Stress aus dailyStress/{date}.
-- Eigene Tabelle (nicht an garmin_daily angehängt), weil Intraday ein anderer Datentyp
-- ist als die Tagesaggregate: garmin_daily bleibt schlank/aggregatlastig, die Kurven
-- (JSON-Arrays ~180 Punkte) liegen isoliert und unabhängig vom Tages-Upsert.
-- Beide NULL-fähig; Stress -1 (keine Messung) wird vorm Speichern entfernt.
CREATE TABLE IF NOT EXISTS garmin_intraday (
  calendar_date       TEXT PRIMARY KEY,
  body_battery_curve  TEXT,   -- JSON [{t,v}] (~180 Punkte, 3-Min-Raster downgesampelt)
  stress_curve        TEXT    -- JSON [{t,v}]
);
