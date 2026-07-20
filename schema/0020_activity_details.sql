-- Deep-Dive-Payload je Aktivität (JSON): hr_curve (~200 Punkte), hr_zones_sec,
-- splits (Lauf/Rad), exercise_sets (Kraft). Siehe PROJECT_OVERVIEW 6.4.
CREATE TABLE IF NOT EXISTS activity_details (
  activity_id INTEGER PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  payload     TEXT
);
