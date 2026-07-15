-- Manuelle Sortierreihenfolge der Bereiche (wird überall angewandt, wo Bereiche gelistet werden).
ALTER TABLE employers ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
UPDATE employers SET sort_order = id;
