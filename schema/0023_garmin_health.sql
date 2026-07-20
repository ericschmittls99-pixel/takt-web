-- Health/Fitness-Trend. PK = calendar_date. Bewusst schlank (keine Dopplung mit garmin_daily:
-- Ruhepuls-Trend kommt aus garmin_daily.resting_hr). vo2max aus Aktivitäten fortgeschrieben,
-- Gewicht/BMI/Körperfett vorerst leer. Siehe PROJECT_OVERVIEW 6.4.
CREATE TABLE IF NOT EXISTS garmin_health (
  calendar_date TEXT PRIMARY KEY,
  vo2max        REAL,
  weight_g      REAL,
  bmi           REAL,
  body_fat      REAL
);
