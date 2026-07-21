# Takt — Projektübersicht & Vision

> Handout für Entwickler:innen. Beschreibt **was Takt ist**, **was bisher gebaut wurde**
> und **wohin die Reise geht** (integrierte Life-Tracking-App), inklusive der geplanten
> **Garmin-Anbindung**.

---

## 1. Kurzfassung (TL;DR)

**Takt** (App-Titel „Mein Tag") ist eine persönliche **Zeiterfassungs-App**: erfasste und
geplante Aktivitäten, aufgeteilt in **Bereiche** (z. B. Arbeitgeber, private Lebensbereiche)
und **Projekte**, mit **Soll/Ist-Saldo**, Kalender/Planner, To-Dos und Auswertungen.

Das Ziel ist die Weiterentwicklung zu einer **integrierten Life-Tracking-App**: Zeit ist nur
eine Dimension. Als Nächstes kommt **Garmin Connect** hinzu — Workouts, Schlaf, Stress und
Gesundheitswerte fließen in Takt ein und werden mit der Zeiterfassung **verbunden**, statt in
einer separaten App zu leben.

---

## 2. Technischer Stand (Ist)

| Bereich | Stack |
|---|---|
| Frontend | **React 18 + TypeScript + Vite**, kein Router (View-Switch über `useState` in `src/App.tsx`), Inline-Styles + CSS-Variablen (Liquid-Glass-Design), Light/Dark-Theme |
| Backend | **Cloudflare Pages Functions** (`functions/api/*`) — schlanke REST-Endpunkte |
| Datenbank | **Cloudflare D1** (SQLite), DB `takt-web` |
| Deployment | **Cloudflare Pages**, live unter `takt-web.pages.dev`, geschützt durch **Cloudflare Access** (Login-Wall) |
| Repo | GitHub `ericschmittls99-pixel/takt-web`, Branch `main` |

**Wichtige Konventionen**
- Design-Tokens als CSS-Variablen in `src/index.css` (`--accent`, `--ink/--ink2/--ink3`,
  `--screen`, `--glass`, `--hair`, `--border`, `--shadow` …); `[data-theme='dark']` überschreibt.
- Akzentfarbe global konfigurierbar (`--accent`).
- Zeit-Erfassungstabelle heißt **`time_entries`** (nicht `entries`).
- Migrationen liegen in `schema/00xx_*.sql` (idempotent, `INSERT OR IGNORE` / `CREATE TABLE IF NOT EXISTS`).
- Settings sind Key-Value in `app_settings` (JSON-Werte für Listen, z. B. `hotkeys`, `absence_types`).
- Produktions-Writes / Remote-Migrationen erfordern **ausdrückliche Freigabe**.
- **Nur Desktop** optimiert (feste Breiten, `zoom`, keine Media Queries) — Mobile ist offen.

---

## 3. Aktuelle Features (Screens)

Fünf Views, erreichbar per Navigation, **Spotlight-Suche** (⌘/Ctrl+K) und konfigurierbaren
**Hotkeys** (`src/commands.ts`, in Verwalten frei belegbar).

1. **Mein Tag** (`MeinTag.tsx`) — Tages-Ansicht: laufender **Timer**, erfasste Aktivitäten,
   24-Stunden-Uhr, Timeline (Plan & Ist), Konto/Saldo bis Ende des Tages, Donut-Widgets
   pro Bereich (private Bereiche = „% Wochenziel", kein Minus).
2. **To-Dos** (`Todos.tsx`) — Aufgaben mit Bereichsfarben, Fristen, Favoriten, Sortierung;
   Text-Parsing (`+DD.MM.JJJJ`, Bereichszuordnung).
3. **Kalender** (`Calendar.tsx`) — Woche/Monat/Jahr/**Planner**/**Liste**; geplante Blöcke
   (Standardwoche), Overrides, Abwesenheiten, Split-Ansicht Plan|Ist, Filter, Export,
   Doppelklick → „Erfassen"/„Plan".
4. **Auswertung** (`Auswertung.tsx`) — KPIs pro Woche/Monat/Jahr/Gesamt: Saldo (nur
   Arbeitsbereiche), Verteilung nach Bereich/Projekt, Verlaufs-Balken.
5. **Verwalten** (`Verwalten.tsx`) — Bereiche & Projekte, Abwesenheiten, Kürzel/Emojis,
   Allgemein (Akzentfarbe, Startdatum, Bundesland), **Befehle & Kürzel** (Hotkey-Aufnahme
   mit Konflikterkennung).

Geteilte Bausteine: `Spotlight.tsx` (Suche über Befehle + Einträge + geplante Blöcke +
To-Dos), `EntryEditor.tsx`, `TimeField.tsx` (24h-Eingabe), `commands.ts` (Command-Registry
+ Hotkey-Utilities), `colors.ts`, `holidays.ts`, `absence.ts`, `todoParse.ts`.

---

## 4. Datenmodell (D1-Tabellen)

| Tabelle | Zweck |
|---|---|
| `employers` | **Bereiche** — Name, Farbe, Icon, `kind` (`work`/`private`), aktiv, Sortierung |
| `projects` | Projekte je Bereich — Farbe, aktiv, Sortierung |
| `time_entries` | Erfasste Aktivitäten — `employer_id`, `project_id`, `start_ts`, `end_ts`, `duration_min`, `note` |
| `targets` | Wochen-Soll je Bereich (`weekly_soll_min`, `valid_from`) |
| `area_hours` | Pro-Wochentag-Soll je Bereich (Minuten, `weekday` 0–6) |
| `planned_blocks` | Standardwoche/Planner — Blöcke pro Wochentag mit Zeitfenster |
| `planned_overrides` | Ausnahmen von der Standardwoche für konkrete Tage |
| `absences` | Abwesenheiten (Urlaub etc.) — Zeitraum, Typ, ggf. Uhrzeitfenster |
| `todos` | Aufgaben |
| `app_settings` | Key-Value-Einstellungen (Akzent, Startdatum, Bundesland, Abwesenheitstypen, Hotkeys) |

**Kernkonzepte**: Soll vs. Ist → **Saldo** (nur Arbeitsbereiche); private Bereiche haben ein
**Wochenziel in %** statt Minus; **Planblöcke** verschwinden im Kalender, sobald abgelaufen
oder von einer Buchung überlappt (in „Mein Tag" bleiben sie sichtbar); Feiertage je Bundesland.

---

## 5. Vision: Integrierte Life-Tracking-App

Takt soll über reine Zeiterfassung hinauswachsen: **Zeit + Körper + Gesundheit in einem
Kontext**. Erster großer Baustein ist **Garmin**. Leitidee: *eine schönere, benutzer­freundlichere
Oberfläche als Garmin Connect — aber verbunden mit meiner Zeiterfassung.*

### 5.1 Inbox — Benachrichtigungs-Popover (übergreifendes Feature)

Die **Inbox** ist die zentrale **Benachrichtigungs- und Briefing-Zentrale** von Takt.
Garmin-Workouts sind nur *eine* Quelle, die dort einspeist.

**Form (v1): ein Popover, kein eigener Tab und kein Slide-over.**
- Verankert an einem **Icon im Header oben rechts**, mit **Badge** für die Zahl offener Aktionen.
- ~**420px breit**, **max ~70vh** hoch, schließt bei **Außenklick/Esc**.
- Einträge sind **kompakte Zeilen**. **Workout-Zeilen klappen inline auf** — die Zuordnung
  (Bereich + Projekt + Notiz) passiert direkt im Popover. **Andere Typen sind reine Sprungziele**
  (Klick → springt an den passenden Ort in der App).
- Eine Vollansicht **„Alle anzeigen"** ist als **Wachstumspfad** dokumentiert, aber bewusst
  **nicht Teil von v1**.

Sie enthält zwei Arten von Einträgen:
- **Aktionen** (zuordenbar/erledigbar): z. B. „Workout hochgeladen, noch nicht zugeordnet",
  überfällige To-Dos, fehlende Erfassungen.
- **Briefings** (zeitgesteuerte Zusammenfassungen):

**Morgen-Briefing (1× morgens)**
- Kurzzusammenfassung: **was heute ansteht** (Plan/Standardwoche, Termine, fällige To-Dos).
- **Wochen-Saldos** je Bereich + **Gesamt-Saldo**.

**Abend-Briefing (1× ~18:00) — „Das war dein Tag"**
- Kurzzusammenfassung des **heute Erfassten** (Aktivitäten, Zeit je Bereich).
- **Saldos** (Tag/Woche/Gesamt).
- ggf. **Health-Daten & Schlaf** (Body Battery, Stress, Schlaf-Score).
- **Workout-Vorschlag für morgen** (leicht / all-out / Ruhetag …) auf Basis von Erholung,
  jüngster Trainingslast und Schlaf.
- offene Aktionen (z. B. **hochgeladenes, nicht zugeordnetes Workout**).

**Umsetzung — Inbox ohne Zustands-Duplikation (verbindlich)**
- **Aktionen = Live-Query**, kein persistenter Zustand: offene Workouts (`activities.status =
  'inbox'`) und überfällige To-Dos werden bei jedem Öffnen frisch abgefragt.
- Die Tabelle **`inbox_items` speichert NUR Briefings** (nicht die Aktionen).
- Der **Zuordnungsstatus lebt ausschließlich in `activities.status`** — es gibt keine zweite
  Wahrheit über den Bearbeitungsstand.
- **Zeitgesteuerte Generierung** der Briefings über **Cloudflare Cron Triggers** (Worker läuft
  morgens/abends, baut die Briefings aus D1 und legt `inbox_items` an). Briefings sind damit auch
  ohne offene App da. Reihenfolge: Garmin-Sync **vor** dem Abend-Briefing, damit Health/Workout-Daten
  aktuell sind.
- **Benachrichtigung**: v1 = In-App-Inbox mit Badge. **Web Push (PWA) rückt bewusst nach hinten**
  — die In-App-Inbox reicht zunächst.
- **Workout-Vorschlag**: zunächst einfache Heuristik (z. B. hohe Last / niedrige Body Battery →
  „leicht/Ruhe"; gute Erholung + länger kein intensives → „all-out"); später verfeinerbar.

### 5.2 „Puls" — Tab für Körper & Training

Der neue Tab heißt **„Puls"** und ist die freundlichere, mit der Zeiterfassung gekoppelte
Alternative zu Garmin Connect. Er hat **vier Unteransichten per Segment-Toggle**:

- **Heute** — aktuelle Körperwerte (Body Battery, Stress, Schlaf, Schritte, Ruhepuls …).
- **Workouts** — Trainingshistorie. Die Liste = **alle `time_entries` auf Sport-Bereichen**,
  per LEFT JOIN mit `activities` für Metriken (siehe 5.4). Klick → Deep-Dive.
- **Schlaf & Erholung** — Schlafphasen/-score, Body Battery, Stressverlauf.
- **Trends** — Langzeitentwicklung (VO2max, Ruhepuls-Trend, Trainingslast, Gewicht …).

Die **Auswertung** zeigt künftig **nur noch Arbeitsbereiche**; die private/sportliche Auswertung
lebt in **Puls** (siehe 6.3).

### 5.3 Sport als Bereichs-Flag (kein dritter Bereichstyp)

Sport wird **nicht** als eigener Bereichstyp modelliert, sondern als **Flag** auf einem Bereich:
`employers.is_sport`.
- **Nur bei `kind = 'private'` setzbar** (Toggle in Verwalten).
- Sport-Bereiche **verhalten sich weiter wie private Bereiche**: **% Wochenziel, kein Minus**,
  sichtbar auf der 24-Stunden-Uhr in Mein Tag.
- Zusätzlich **speisen sie den Puls-Tab** (nur Sport-Bereiche liefern die Workout-Historie).

### 5.4 Workout-Erfassung, Zuordnung & Verknüpfung — Zielbild

1. **Import (Garmin)**: Ein abgeschlossenes Workout kommt per Sync herein als `activities`-Zeile
   mit `source = 'garmin'`, `status = 'inbox'` → erscheint als **Aktion in der Inbox**.
2. **Zuordnung im Inbox-Popover**: Workout-Zeile klappt inline auf; ich weise **Bereich + Projekt**
   zu — **mit Vorschlag von Takt** (häufigste Kombi für denselben Aktivitätstyp) — und ergänze eine
   **Notiz**. Ergebnis: `status = 'assigned'` und ein **verknüpfter `time_entry`** entsteht
   (taucht in Mein Tag / Kalender / Saldo auf).
3. **Manuelle Erfassung**: Beim Erfassen auf einem **Sport-Bereich** klappt im bestehenden
   **EntryEditor** ein optionaler **Metrik-Abschnitt** auf (Typ, Distanz, Kalorien, Ø/Max-HF) →
   erzeugt eine `activities`-Zeile mit `source = 'manual'`, `status = 'assigned'`. Kein neues Formular.
4. **Deep-Dive-Pop-up**: Aus jeder Workout-Aktivität öffnet ein Pop-up die tiefergehende Auswertung
   (HF-Zonen, Splits, HF-Kurve …). Bei `source = 'manual'` sind die Werte **editierbar**.
5. **Ankerprinzip**: Der **Zeiteintrag ist der Anker** — die bestehende Sport-Historie erscheint in
   Puls **ohne Backfill**, weil die Workout-Liste über `time_entries` (Sport-Bereiche) LEFT JOIN
   `activities` läuft.

### 5.5 Datenkategorien (alle vier gewünscht)
- **Aktivitäten/Workouts**: Typ, Dauer, Distanz, Kalorien, HF, Pace, Zeitpunkt.
- **Schlaf & Erholung**: Phasen, Dauer, Body Battery, Stress, Score.
- **Tageswerte**: Schritte, Herzfrequenz, Kalorien, aktive Minuten.
- **Gesundheit/Fitness**: VO2max, Ruhepuls-Trend, Gewicht.

---

## 6. Vorgeschlagene Architektur (Garmin)

Cloudflare Pages Functions laufen auf der Worker-Runtime und können die Garmin-Anbindung
**nicht** selbst ausführen (kein Python, Login passt nicht in einen Worker). Deshalb drei Schichten:

**Schicht 1 — Lokales Sync-Skript** (`garmin/sync.py`, läuft auf dem Rechner)
- Bibliothek **`garth`** (Garmin-SSO inkl. MFA, Token-Cache ~1 Jahr).
- Login einmalig interaktiv; Token in `garmin/.garth/` (**gitignored**, kein Passwort im Repo).
- Holt Aktivitäten/Tageswerte/Schlaf/Gesundheit für einen Datumsbereich.
- Schreibt **idempotent** in die Remote-D1 via `wrangler d1 execute --remote`. Natürlicher
  Sync-Schlüssel für Workouts ist **`activities.garmin_activity_id`** (UNIQUE), für Tageswerte
  `calendar_date`.
- **Re-Sync-Regel (verbindlich):** Der Sync überschreibt **niemals** `status`, `employer_id`,
  `project_id`, `note`, `entry_id` — **nur Messfelder** (Dauer, Distanz, HF, Kalorien …).
- Grauzone: inoffizieller Zugang zu **eigenen** Daten; kann brechen, wenn Garmin die
  internen Endpunkte ändert.

**Schicht 2 — D1-Tabellen + Read-API** (Migrationen ab `0018`)
- **`activities`** — **quellenneutral** (nicht `garmin_activities`). `id` (PK),
  `source` (`'garmin'`/`'manual'`), **`garmin_activity_id` (UNIQUE, nullable)** als natürlicher
  Sync-Schlüssel, `start_ts`, `type`, `name`, `duration_sec`, `distance_m`, `calories`,
  `avg_hr`, `max_hr`, … plus **Zuordnungs-Felder**: `status` (`inbox`/`assigned`/`ignored`),
  `employer_id`, `project_id`, `note`, `entry_id` (Verknüpfung zur `time_entries`-Zeile).
- **`activity_details`** — `activity_id` (PK), `payload` (JSON: **HF-Zonen, Splits,
  HF-Kurve auf ~200 Punkte downgesampelt**) für das Deep-Dive-Pop-up.
- `garmin_daily` — `calendar_date` (PK), Schritte, Ruhepuls, Kalorien, aktive Minuten,
  Body Battery, Stress.
- `garmin_sleep` — `calendar_date` (PK), gesamt/tief/leicht/REM/wach, Score.
- `garmin_health` — `calendar_date` (PK), VO2max, Ruhepuls-Trend, Gewicht.
- `inbox_items` — **nur Briefings** (Typ `briefing`, `created_at`, `status`, `payload` JSON).
- `employers.is_sport` — neues Flag (siehe 5.3), nur bei `kind='private'`.
- **Leserichtung Puls-Workoutliste:** **alle `time_entries` auf Sport-Bereichen**, LEFT JOIN
  `activities` für Metriken. Der **Zeiteintrag ist der Anker** → bestehende Sport-Historie ist
  ohne Backfill sichtbar; Workouts ohne Garmin-Daten erscheinen trotzdem.
- Endpunkte unter `functions/api/*` nach dem Muster von `entries.ts`
  (GET mit optionalem Datumsfilter; PATCH für Inbox-Zuordnung; GET für Deep-Dive-Details).

**Schicht 3 — UI**
- **Inbox-Popover** (Header oben rechts, siehe 5.1): Workout-Zeilen klappen inline auf,
  „Bereich + Projekt zuweisen" mit **Vorschlag** + Notizfeld; andere Zeilen sind Sprungziele.
- Beim Zuweisen entsteht ein `time_entries`-Eintrag (Saldo/Kalender/Mein Tag) mit Rückverweis
  über `activities.entry_id`.
- **Manuelle Sport-Erfassung im bestehenden `EntryEditor`**: bei Sport-Bereich optionaler
  Metrik-Abschnitt (Typ, Distanz, Kalorien, Ø/Max-HF) → `activities`-Zeile `source='manual'`,
  `status='assigned'`. Kein neues Formular.
- **Deep-Dive-Pop-up** an der Aktivität (HF-Zonen, Splits, HF-Kurve …); bei `source='manual'`
  editierbar.
- **Tab „Puls"** mit Segment-Toggle (Heute / Workouts / Schlaf & Erholung / Trends),
  im Glass-Stil. Integration in Nav + `commands.ts` + Spotlight.

### 6.1 Zuordnungs-/Vorschlagslogik
- Beim Import landet jedes neue Garmin-Workout als `activities`-Zeile mit `status='inbox'`.
- **Vorschlag** = häufigste `(employer_id, project_id)`-Kombination früherer Workouts desselben
  Aktivitätstyps (Fallback: konfigurierbares Typ→Bereich-Mapping).
- Nutzer bestätigt/ändert Bereich+Projekt, ergänzt Notiz → `status='assigned'`, `time_entry`
  wird erzeugt/verknüpft. „Ignorieren" → `status='ignored'` (kein Saldo-Effekt).

### 6.2 Lösch- & Verknüpfungsregeln (verbindlich)
- **Re-Sync** überschreibt **nie** `status`, `employer_id`, `project_id`, `note`, `entry_id`
  (nur Messfelder).
- **Löschen eines `time_entry` mit Garmin-Aktivität** → die Aktivität wird **getrennt, nicht
  gelöscht**: `entry_id = NULL`, `status = 'inbox'` (landet wieder in der Inbox).
- **Löschen eines `time_entry` mit manueller Aktivität** → die `activities`-Zeile wird
  **mitgelöscht** (sie hat keine externe Quelle).

### 6.3 Auswirkungen auf bestehende Screens
- **Auswertung**: zeigt künftig **nur Arbeitsbereiche**; private/Sport-Auswertung wandert in
  **Puls**.
- **Mein Tag**: Donut-Widgets bleiben **unverändert** (Dopplung mit Puls ist gewollt);
  neu: **Puls-Icon** an Garmin-verknüpften Aktivitäten (öffnet Deep-Dive), kompakte
  **„Körper heute"-Karte** (nur wenn Daten vorhanden), **Inbox-Badge** im Header.
- **Design-Hinweis**: Mein Tag und Auswertung werden **nicht** über Claude Design neu gestaltet;
  die neuen Elemente werden im bestehenden Glass-Stil ergänzt.

### 6.4 Feldspezifikation (verifiziert an Garmin-Rohdaten in WP0)

Grundlage: `garmin/explore.py` hat 14 Tage Roh-JSON gezogen (`garmin/samples/`, gitignored).
Konvention: **Zeit lokal** (`startTimeLocal`) speichern, passend zur lokalen Leseweise der App.
Sync-Bibliothek für WP1 auf **`garth==0.6.3`** gepinnt (0.7+ liefert 429 beim Login).
**NULL-Regel:** Alle Garmin-abgeleiteten Kennzahlspalten sind **NULL-fähig** und tragen **keine
bedeutungstragenden Defaults** (fehlender Wert = `NULL`, nicht 0). Ausnahme: `activities.status`
(Default `'inbox'`) und `source`/Schlüssel.

**Prinzip:** `activities`/`*_daily`/`*_sleep` tragen die **abfragbaren Kennzahlen als Spalten**;
granulare Deep-Dive-Daten (Kurven, Splits, Übungssätze) liegen als **JSON-Payload** in
`activity_details` bzw. der `curves`-Spalte von `garmin_sleep`.

**`activities`** (Quelle: `activitylist-service/.../activities`, Zuordnung siehe 6.1)
- `id` (intern, PK) · `source` (`garmin`/`manual`) · `garmin_activity_id` (UNIQUE, nullable ← `activityId`)
- `start_ts` ← `startTimeLocal` · `type` ← `activityType.typeKey` · `name` ← `activityName`
- `duration_sec` ← `duration` · `distance_m` ← `distance` (0/NULL bei Kraft) · `calories` ← `calories`
- `avg_hr` ← `averageHR` · `max_hr` ← `maxHR` · `elevation_gain_m` ← `elevationGain` (Lauf/Rad)
- Trainings-Kennzahlen: `training_load` ← `activityTrainingLoad` · `aerobic_te` ← `aerobicTrainingEffect`
  · `anaerobic_te` ← `anaerobicTrainingEffect` · `moderate_min`/`vigorous_min` ← `*IntensityMinutes`
  · `vo2max` ← `vO2MaxValue` (nur Lauf/Rad; Quelle für Puls-Trend, siehe `garmin_health`)
- Kraft-Summe: `total_reps` ← `totalReps` · `total_sets` ← `totalSets`
- Zuordnung: `status` (`inbox`/`assigned`/`ignored`) · `employer_id` · `project_id` · `note` · `entry_id`

**`activity_details`** (Quelle: `activity-service/activity/{id}/details?maxChartSize=200`)
- `activity_id` (PK → `activities.id`) · `payload` (JSON):
  - `hr_curve`: `[{t, v}]` ~200 Punkte (aus `directHeartRate` + `directTimestamp`; Lauf **und** Kraft)
  - `hr_zones_sec`: `{z1…z5}` ← `hrTimeInZone_1..5`
  - `splits`: ← `splitSummaries` (Lauf/Rad)
  - `exercise_sets`: ← `summarizedExerciseSets` (Kraft): `[{category, subCategory, reps, sets, maxWeight, volume, duration}]`
  - editierbar bei `source='manual'`

**`garmin_daily`** (Quelle: `usersummary-service/usersummary/daily`, PK `calendar_date`)
- `steps` ← `totalSteps` · `step_goal` ← `dailyStepGoal`
- `resting_hr` ← `restingHeartRate` · `resting_hr_7d_avg` ← `lastSevenDaysAvgRestingHeartRate`
  · `min_hr`/`max_hr` ← `minHeartRate`/`maxHeartRate`
- `calories_total`/`calories_active`/`calories_bmr` ← `total`/`active`/`bmrKilocalories`
- `intensity_moderate_min`/`intensity_vigorous_min` ← `*IntensityMinutes`
- `stress_avg` ← `averageStressLevel` · `stress_max` ← `maxStressLevel`
- Body Battery: `bb_high`/`bb_low`/`bb_wake`/`bb_charged`/`bb_drained`
  ← `bodyBatteryHighest`/`Lowest`/`AtWakeTime`/`Charged`/`DrainedValue`
- `spo2_avg` ← `averageSpo2` · `respiration_waking_avg` ← `avgWakingRespirationValue`
  · `floors_ascended` ← `floorsAscended` · `sleeping_sec` ← `sleepingSeconds`

**`garmin_sleep`** (Quelle: `wellness-service/wellness/dailySleepData`, PK `calendar_date`)
- Summary aus `dailySleepDTO`: `total_sec` ← `sleepTimeSeconds` · `deep_sec`/`light_sec`/`rem_sec`/`awake_sec`
  · `score` ← `sleepScores.overall.value` · `score_qualifier` ← `sleepScores.overall.qualifierKey`
  · `avg_stress` ← `avgSleepStress` · `avg_hr` ← `avgHeartRate` · `avg_respiration` ← `averageRespirationValue`
  · `avg_spo2` ← `averageSpO2Value`
- Top-Level: `hrv_overnight_avg` ← `avgOvernightHrv` · `hrv_status` ← `hrvStatus`
  · `body_battery_change` ← `bodyBatteryChange` · `resting_hr` ← `restingHeartRate` · `restless_moments` ← `restlessMomentsCount`
- `curves` (JSON, **15-Min-Raster**, ~5,5 KB/Nacht): `{ hr, stress, body_battery, movement }` je `[{t, v}]`
  (aus `sleepHeartRate`/`sleepStress`/`sleepBodyBattery`/`sleepMovement.activityLevel`) + `levels` (Phasen 1:1 aus `sleepLevels`)
- **Verworfen:** SpO2-Epochen- und Roh-Bewegungs-Arrays (nur deren Summary bleibt) → statt ~172 KB nur ~5,5 KB/Nacht

**`garmin_health`** (PK `calendar_date`) — bewusst schlank (keine Dopplung mit `garmin_daily`)
- `vo2max` ← letzter bekannter `vO2MaxValue` aus `activities` (fortgeschrieben)
- `weight_g` · `bmi` · `body_fat` (nullable, Quelle `weight-service`; aktuell **leer** — Spalten für später)
- Ruhepuls-**Trend** wird aus `garmin_daily.resting_hr` gelesen (nicht dupliziert)

**Offene Nachrüstung (später, nicht WP1):** täglicher VO2max-Endpunkt für lückenlose Werte
(in WP0 fehlgeschlagen; vorerst Aktivitäts-Quelle).

### 6.5 Betriebs-Erkenntnisse & Konventionen (verifiziert)

- **Aufbewahrung: unbegrenzt.** Speicherverbrauch nach 365-Tage-Backfill gemessen: **~3 MB/Jahr**
  (bei 234 Workouts). **~92 %** entfallen auf die beiden JSON-Payload-Tabellen `activity_details`
  (~1,8 MB) und `garmin_sleep.curves` (~1,0 MB); die Summary-Spalten sind vernachlässigbar.
  Hochrechnung: 10 Jahre ≈ 30 MB → für Cloudflare D1 (Free-Tier 5 GB) unkritisch.
  **Sparhebel dokumentiert, aber inaktiv:** HF-Kurve von ~200 auf ~100 Punkte reduzieren oder
  Kurven nur on-demand aus Garmin laden — aktuell kein Handlungsbedarf.
- **Foreign Keys werden lokal erzwungen** (D1/miniflare). Beim Auflösen einer Verknüpfung daher
  **immer erst die Referenz lösen, dann löschen**: `UPDATE activities SET entry_id = NULL` vor
  `DELETE FROM time_entries` (bei manuellen Aktivitäten die `activities`-Zeile vor dem `time_entry`).
  Sonst `FOREIGN KEY constraint failed`. Betrifft unassign/re-assign und den `time_entries`-Delete-Pfad (6.2).
- **Einheiten-Konvention:** Garmin liefert **Basiseinheiten** (Gewicht in **Gramm**, Distanz in
  **Metern**, Dauer in **Sekunden**). **Umrechnung nur an der Grenze:** im Sync z. B. `maxWeight`
  Gramm→kg; Distanz/Dauer bleiben als Basiseinheit in der DB, die **Anzeige** rechnet km/min/Pace.
  Manuelle Eingaben werden auf dieselbe Basis normalisiert.

### 6.6 Historie-Status (WP4a-2)

- `activities.status` kennt zusätzlich **`history`**: Garmin-Aktivitäten **vor dem Stichtag**
  (`app_settings.start_date`) aus dem 365-Tage-Backfill. **Nur Puls, nie Zeitbuchung/Saldo.**
  Einmaliger Aufräumer `garmin/backfill_history.sql` (idempotent) hat `inbox`→`history` gesetzt —
  **kein** dauerhafter Sync-Mechanismus. Re-Sync fasst `history` (wie `assigned`/`ignored`) nicht an.
- **Aggregationsregel (verbindlich):**
  - **Körper-/Trainings-Trends** (Trainingslast, VO2max, Wochenvolumen, HF …) zählen `history` **mit**.
  - **Zeit-Kopplung / Saldo / Mein Tag / Kalender** nutzen **nur** zugeordnete `time_entries` ab
    Stichtag — `history` fließt dort **nie** ein (hat keinen Bereich).
- **Puls-Workouts** liest zwei Quellen (`/api/garmin/workouts`, UNION): `origin='entry'` (Sport-
  `time_entries` LEFT JOIN activities) + `origin='history'` (activities `status='history'`),
  chronologisch gemischt, Historie dezent markiert; Deep-Dive funktioniert für beide.

### 6.7 Kategorie-2-Scores (WP4b)

- Tageszeitreihe **`garmin_scores`** (PK `calendar_date`): Training Readiness (Score/Level/
  Recovery-Time/Acute-Load/ACWR), Training Status (Code + `weeklyLoad` + `ts_load_balance` JSON),
  Endurance Score, Hill Score (+ Strength/Endurance), Fitness Age, Race Predictions (5k/10k/HM/M in s)
  und **VO2max**. Quellen: `trainingreadiness/{d}`, `trainingstatus/aggregated/{d}`, `endurancescore`,
  `hillscore`, `fitnessage/{d}` (je **pro Tag**), `maxmet/daily/{start}/{end}` und
  `racepredictions/daily/{dn}` (je **ein Range-Call → Liste**). Einzelne Score-Ausfälle pro Tag
  killen den Sync nicht (`safe_api`). **Nicht verfügbar** (Stufe 1): Körpertemperatur, Jetlag Adviser.
- **Sleep Need** (Sleep Coach) liegt in `garmin_sleep` (`sleep_need_baseline/actual/feedback`) —
  kein neuer Endpunkt, aus `dailySleepDTO.sleepNeed`.
- **VO2max-Quellen (gelöste 6.4-Altlast):** **maßgeblich** ist `garmin_scores.vo2max` (aus
  `maxmet/daily`, lückenlos je Tag) — Primärquelle für den VO2max-Trend. `garmin_health.vo2max`
  (aus Aktivitäten fortgeschrieben) bleibt bestehen, ist aber nur noch **sekundär** (Fallback/
  Kompatibilität), nicht die Trend-Quelle.

---

## 7. Roadmap (vorgeschlagen, bottom-up & testbar)

1. **Sync-Fundament**: `garth` in lokalem venv, Login-Test, Roh-JSON sichten → Feldauswahl fixieren.
2. **Schema + Sync-Write**: Tabellen `0018+` (`activities` inkl. `garmin_activity_id` UNIQUE,
   `activity_details`, `garmin_daily/sleep/health`, `inbox_items`, `employers.is_sport`),
   Schreiben zuerst gegen **lokale** D1; Re-Sync-Regel (nur Messfelder) umsetzen.
3. **Sport-Flag + manuelle Erfassung**: `is_sport`-Toggle in Verwalten; `EntryEditor` um den
   optionalen Metrik-Abschnitt erweitern (`source='manual'`). Lösch-/Verknüpfungsregeln (6.2).
4. **Read-API + Inbox-Popover**: Endpunkte + Header-Popover mit Live-Aktionen (Inbox-Query) +
   Briefings; inline-Zuordnung mit Vorschlag; `time_entry`-Verknüpfung (`typecheck` grün).
5. **Deep-Dive-Pop-up**: `activity_details`-Payload rendern (HF-Zonen/Splits/HF-Kurve),
   editierbar bei `source='manual'`.
6. **Puls-Tab**: Segment-Toggle (Heute / Workouts / Schlaf & Erholung / Trends),
   Nav/Commands/Spotlight-Integration; Auswertung auf Arbeitsbereiche reduzieren; Mein-Tag-Ergänzungen
   (Puls-Icon, „Körper heute", Inbox-Badge).
7. **Briefings**: Morgen-/Abend-Briefing zunächst on-demand generierbar, dann per
   **Cloudflare Cron Trigger** automatisiert (Sync vor Abend-Briefing).
8. **Produktion** (nur mit ausdrücklicher Freigabe): Remote-Migration + Sync + Deploy.
9. **Später**: „Alle anzeigen"-Vollansicht der Inbox, **Web Push (PWA)** für echte
   Benachrichtigungen, Automatisierung des Syncs (Cron/Launchd), Mobile-Optimierung,
   Design-Feinschliff über den Claude-Design-Master.

---

## 8. Offene Punkte / Entscheidungen
- **Sync-Trigger**: manuell (`python3 garmin/sync.py --days N`) zuerst; Automatisierung später.
- **Garmin-Zugang**: `garth` benötigt ggf. Python ≥ 3.10 (System ist 3.9.6) → venv mit
  neuerem Python via Homebrew.
- **Design**: neue Screens ideal über Claude-Design-Master; erste Version im bestehenden
  Glass-Stil funktional bauen.
- **Mobile**: weiterhin offen (App ist aktuell desktop-fixiert).
