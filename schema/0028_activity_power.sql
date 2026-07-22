-- Welle 3 (Details-Ausbau): Power-Summary je Aktivität + abgeleitete Work.
-- Nur Rad-mit-Powermeter füllt diese Felder; alle NULL-fähig, keine Defaults (6.4-Regel).
-- work_kj ist KEIN Garmin-Feld, sondern abgeleitet (avg_power × Bewegungsdauer) und im UI
-- als "berechnet" gekennzeichnet. power_zones = JSON {z1..z7 Sekunden} analog hr_zones.
ALTER TABLE activities ADD COLUMN avg_power             REAL;
ALTER TABLE activities ADD COLUMN max_power             REAL;
ALTER TABLE activities ADD COLUMN norm_power            REAL;
ALTER TABLE activities ADD COLUMN max_20min_power       REAL;
ALTER TABLE activities ADD COLUMN intensity_factor      REAL;
ALTER TABLE activities ADD COLUMN training_stress_score REAL;
ALTER TABLE activities ADD COLUMN avg_lr_balance        REAL;    -- avgLeftBalance (linker Anteil %)
ALTER TABLE activities ADD COLUMN pedal_strokes         INTEGER;
ALTER TABLE activities ADD COLUMN work_kj               REAL;    -- abgeleitet (berechnet)
ALTER TABLE activities ADD COLUMN power_zones           TEXT;    -- JSON {z1..z7 Sekunden}
