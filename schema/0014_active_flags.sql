-- Aktiv/Inaktiv für Bereiche & Projekte (Soft-Disable: fallen aus künftigen Auswahllisten,
-- alte Buchungen bleiben erhalten). 1 = aktiv.
ALTER TABLE employers ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects  ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
