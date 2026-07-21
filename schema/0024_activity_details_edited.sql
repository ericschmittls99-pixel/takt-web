-- Markiert manuell bearbeitete Deep-Dive-Payloads (z. B. Übungssätze). Ist edited=1,
-- überschreibt der Garmin-Sync die activity_details NICHT mehr (siehe garmin/sync.py).
ALTER TABLE activity_details ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
