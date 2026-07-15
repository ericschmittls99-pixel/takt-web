-- Testprojekte (oberste Ebene) für beide Arbeitgeber.
-- Idempotent: legt ein Projekt nur an, wenn Name + Arbeitgeber noch nicht existieren.

-- FMC (employer_id = 1)
INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 1, NULL, 'Dialyse-Station', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 1 AND name = 'Dialyse-Station');

INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 1, NULL, 'Qualitätsmanagement', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 1 AND name = 'Qualitätsmanagement');

INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 1, NULL, 'Fortbildung', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 1 AND name = 'Fortbildung');

INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 1, NULL, 'Dokumentation', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 1 AND name = 'Dokumentation');

-- bhyo (employer_id = 2)
INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 2, NULL, 'App-Entwicklung', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 2 AND name = 'App-Entwicklung');

INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 2, NULL, 'Kundensupport', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 2 AND name = 'Kundensupport');

INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 2, NULL, 'Marketing', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 2 AND name = 'Marketing');

INSERT INTO projects (employer_id, parent_id, name, level)
SELECT 2, NULL, 'Backoffice', 1
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE employer_id = 2 AND name = 'Backoffice');
