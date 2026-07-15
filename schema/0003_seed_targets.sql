-- Soll-Vorgaben für beide Arbeitgeber: weekly_soll_min = 1200 (20 h/Woche = 4 h/Tag).
-- Idempotent: legt eine Vorgabe nur an, wenn für den Arbeitgeber noch keine existiert.

-- FMC (employer_id = 1)
INSERT INTO targets (employer_id, weekly_soll_min, valid_from)
SELECT 1, 1200, '2026-01-01'
WHERE NOT EXISTS (SELECT 1 FROM targets WHERE employer_id = 1);

-- bhyo (employer_id = 2)
INSERT INTO targets (employer_id, weekly_soll_min, valid_from)
SELECT 2, 1200, '2026-01-01'
WHERE NOT EXISTS (SELECT 1 FROM targets WHERE employer_id = 2);
