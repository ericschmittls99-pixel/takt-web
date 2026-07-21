-- EINMALIGER Backfill-Aufräumer (WP4a-2). KEIN dauerhafter Sync-Mechanismus.
-- Setzt Garmin-Aktivitäten VOR dem Stichtag (app_settings.start_date) von 'inbox' auf
-- 'history': reine Puls-Historie, nie Zeitbuchung/Saldo. Aktivitäten >= Stichtag bleiben 'inbox'.
-- Idempotent: ein zweiter Lauf findet keine passenden inbox-Zeilen mehr.
UPDATE activities
SET status = 'history'
WHERE status = 'inbox'
  AND start_ts < (SELECT value FROM app_settings WHERE key = 'start_date');
