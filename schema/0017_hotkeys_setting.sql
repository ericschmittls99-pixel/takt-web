-- Tastenkürzel-Belegung (Key-Value in app_settings, JSON: CommandId → Kombi).
INSERT INTO app_settings (key, value)
SELECT 'hotkeys',
  '{"open-spotlight":"mod+k","nav-mein-tag":"mod+1","nav-todos":"mod+2","nav-calendar":"mod+3","nav-auswertung":"mod+4","nav-verwalten":"mod+5","toggle-theme":"mod+j","new-entry":"mod+e","toggle-tracking":"mod+enter","new-todo":"mod+shift+e"}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'hotkeys');
