-- Favoriten-Flag für Aufgaben (Rechts-Wisch markiert als Favorit)
ALTER TABLE todos ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0; -- 0 = normal, 1 = Favorit
