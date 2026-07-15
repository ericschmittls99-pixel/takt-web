-- Globale App-Einstellungen als Key-Value-Store.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Standardwerte (idempotent).
INSERT INTO app_settings (key, value)
SELECT 'accent_color', '#22C55E' WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'accent_color');

INSERT INTO app_settings (key, value)
SELECT 'start_date', '2026-01-01' WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'start_date');

-- Feiertags-Bundesland (Kürzel wie 'RP', 'BW', 'BY' …).
INSERT INTO app_settings (key, value)
SELECT 'bundesland', 'RP' WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'bundesland');

-- Abwesenheitstypen mit Farbe & Icon (JSON-Array).
INSERT INTO app_settings (key, value)
SELECT 'absence_types',
  '[{"key":"urlaub","label":"Urlaub","color":"#F59E0B","icon":"☀️"},{"key":"krank","label":"Krank","color":"#E5484D","icon":"🤒"},{"key":"sonstiges","label":"Sonstiges","color":"#5B6577","icon":"📌"}]'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'absence_types');
