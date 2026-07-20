-- Sport-Flag je Bereich. Nur bei kind='private' setzbar (Toggle in Verwalten);
-- Sport-Bereiche verhalten sich weiter wie private Bereiche und speisen zusätzlich den Puls-Tab.
ALTER TABLE employers ADD COLUMN is_sport INTEGER NOT NULL DEFAULT 0;
