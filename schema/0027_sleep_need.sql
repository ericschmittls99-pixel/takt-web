-- Sleep Need (Sleep Coach) — liegt bereits in dailySleepDTO.sleepNeed, kein neuer Endpunkt.
ALTER TABLE garmin_sleep ADD COLUMN sleep_need_baseline INTEGER;
ALTER TABLE garmin_sleep ADD COLUMN sleep_need_actual INTEGER;
ALTER TABLE garmin_sleep ADD COLUMN sleep_need_feedback TEXT;
