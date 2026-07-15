-- Manuelle Sortierung (Drag & Drop). REAL, damit zwischen zwei Einträgen
-- per Mittelwert eingefügt werden kann. Bestehende Zeilen nach id vorbelegen.
ALTER TABLE todos ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
UPDATE todos SET sort_order = id;
