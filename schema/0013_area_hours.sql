-- Pro-Wochentag-Sollzeit je Arbeitsbereich (Minuten). weekday: 0=So … 6=Sa (JS getDay).
-- 0 Minuten = kein Arbeitstag. Nur relevant für kind='work'.
CREATE TABLE IF NOT EXISTS area_hours (
  employer_id INTEGER NOT NULL REFERENCES employers(id),
  weekday     INTEGER NOT NULL,
  minutes     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (employer_id, weekday)
);

-- Seed aus den bisherigen Wochen-Soll-Vorgaben: gleichmäßig auf Mo–Fr, Wochenende 0.
-- Ein INSERT pro Wochentag (D1-SQLite mag keine großen Compound-SELECTs/VALUES-Tabellen).
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 0, 0 FROM employers e;
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 1, COALESCE((SELECT t.weekly_soll_min FROM targets t WHERE t.employer_id = e.id ORDER BY t.valid_from DESC LIMIT 1), 0) / 5 FROM employers e;
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 2, COALESCE((SELECT t.weekly_soll_min FROM targets t WHERE t.employer_id = e.id ORDER BY t.valid_from DESC LIMIT 1), 0) / 5 FROM employers e;
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 3, COALESCE((SELECT t.weekly_soll_min FROM targets t WHERE t.employer_id = e.id ORDER BY t.valid_from DESC LIMIT 1), 0) / 5 FROM employers e;
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 4, COALESCE((SELECT t.weekly_soll_min FROM targets t WHERE t.employer_id = e.id ORDER BY t.valid_from DESC LIMIT 1), 0) / 5 FROM employers e;
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 5, COALESCE((SELECT t.weekly_soll_min FROM targets t WHERE t.employer_id = e.id ORDER BY t.valid_from DESC LIMIT 1), 0) / 5 FROM employers e;
INSERT OR IGNORE INTO area_hours (employer_id, weekday, minutes)
SELECT e.id, 6, 0 FROM employers e;
