-- Abwesenheiten: ganzer Tag oder Zeitfenster.
ALTER TABLE absences ADD COLUMN all_day INTEGER NOT NULL DEFAULT 1; -- 1 = ganzer Tag
ALTER TABLE absences ADD COLUMN start_min INTEGER;                  -- bei all_day=0
ALTER TABLE absences ADD COLUMN end_min INTEGER;
