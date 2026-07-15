-- Bereiche (Arbeitgeber) erhalten Farbe, Icon, Typ (Arbeit/Privat) und Wochenziel.
-- Das Bundesland wandert in die globalen App-Einstellungen (0011) und entfällt hier.

ALTER TABLE employers ADD COLUMN color TEXT NOT NULL DEFAULT '#2563EB';
ALTER TABLE employers ADD COLUMN icon TEXT NOT NULL DEFAULT '💼';
ALTER TABLE employers ADD COLUMN kind TEXT NOT NULL DEFAULT 'work';           -- 'work' | 'private'
ALTER TABLE employers ADD COLUMN weekly_goal_min INTEGER NOT NULL DEFAULT 0;  -- nur für kind='private'

-- Bestehende Bereiche behalten ihre bisherigen (aus der id abgeleiteten) Farben.
UPDATE employers SET color = '#7C5CFF', icon = '🏥' WHERE id = 1; -- FMC
UPDATE employers SET color = '#22C55E', icon = '💼' WHERE id = 2; -- bhyo

ALTER TABLE employers DROP COLUMN bundesland;
