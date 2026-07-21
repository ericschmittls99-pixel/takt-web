-- Notiz + Einzelschritte je To-Do. steps = JSON-Array [{ "text": string, "done": 0|1 }].
ALTER TABLE todos ADD COLUMN note TEXT;
ALTER TABLE todos ADD COLUMN steps TEXT;
