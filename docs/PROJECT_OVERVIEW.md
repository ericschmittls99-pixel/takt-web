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

### 5.1 Inbox / Benachrichtigungs-Zentrale (übergreifendes Feature)

Die **Inbox** ist mehr als ein Garmin-Postfach — sie ist die zentrale **Benachrichtigungs- und
Briefing-Zentrale** von Takt. Garmin-Workouts sind nur *eine* Quelle, die dort einspeist.

Sie enthält zwei Arten von Einträgen:
- **Aktionen** (zuordenbar/erledigbar): z. B. „Workout hochgeladen, noch nicht zugeordnet",
  offene To-Dos mit Frist, fehlende Erfassungen.
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

**Umsetzung (Architektur-Implikationen)**
- Neue Tabelle `inbox_items` (Typ `action`/`briefing`, `created_at`, `status`
  `unread`/`read`/`done`/`dismissed`, `payload` als JSON, optionaler Bezug zu
  `garmin_activities`/`todos`/`time_entries`).
- **Zeitgesteuerte Generierung** über **Cloudflare Cron Triggers** (Worker läuft morgens/abends,
  baut die Briefings aus D1 und legt `inbox_items` an). Briefings sind damit auch ohne offene App da.
- Reihenfolge: Der Garmin-Sync sollte **vor** dem Abend-Briefing laufen, damit Health/Workout-Daten
  aktuell sind.
- **Benachrichtigung**: v1 = In-App-Inbox mit Badge; v2 = echte Push-Nachrichten über **Web Push
  (PWA)** — die PWA-Basis (Manifest, Icons, `apple-mobile-web-app`) ist bereits vorhanden.
- **Workout-Vorschlag**: zunächst einfache Heuristik (z. B. hohe Last / niedrige Body Battery →
  „leicht/Ruhe"; gute Erholung + länger kein intensives → „all-out"); später verfeinerbar.

### 5.2 Garmin-Feature — Zielbild

1. **Import**: Garmin-Daten (Workouts, Tageswerte, Schlaf, Stress, Gesundheit) werden nach
   Takt importiert.
2. **Postfach / Inbox**: Ein **abgeschlossenes Workout** erscheint in Takt in einem **Postfach**.
3. **Zuordnung**: Ich ordne das Workout einem **Bereich + Projekt** zu — **mit Vorschlag von
   Takt** (z. B. auf Basis früherer Zuordnungen oder des Aktivitätstyps). Ich ergänze **Notizen** etc.
4. **Verknüpfung mit Zeiterfassung**: Nach der Zuordnung wird das Workout zu einer erfassten
   **Aktivität** (taucht in Mein Tag / Kalender / Auswertung / Saldo auf) — **verbunden** mit
   den Garmin-Rohdaten.
5. **Deep-Dive-Auswertung**: Aus der Aktivität heraus öffnet ein **Pop-up** eine tiefergehende
   Auswertung des Workouts (HF-Zonen, Distanz, Pace, Kalorien, Karte …).
6. **Neuer Tab „Health/Fitness"**: Ein komplett **neuer Tab** mit **KPIs** zu Workouts, Stress,
   Schlaf, Gesundheit — die freundlichere Garmin-Connect-Alternative, **gekoppelt an die
   Zeiterfassung** (z. B. „Trainingszeit vs. Erholung", Belastung pro Bereich).

### 5.3 Datenkategorien (alle vier gewünscht)
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
- Schreibt **idempotent** (`INSERT OR REPLACE`, natürliche Schlüssel wie `activity_id`,
  `calendar_date`) in die Remote-D1 via `wrangler d1 execute --remote`.
- Grauzone: inoffizieller Zugang zu **eigenen** Daten; kann brechen, wenn Garmin die
  internen Endpunkte ändert.

**Schicht 2 — D1-Tabellen + Read-API** (Migrationen ab `0018`)
- `garmin_activities` — `activity_id` (PK), `start_ts`, `type`, `name`, `duration_sec`,
  `distance_m`, `calories`, `avg_hr`, `max_hr`, … plus **Zuordnungs-Felder**:
  `status` (`inbox`/`assigned`/`ignored`), `employer_id`, `project_id`, `note`, `entry_id`
  (Verknüpfung zur erzeugten `time_entries`-Zeile).
- `garmin_daily` — `calendar_date` (PK), Schritte, Ruhepuls, Kalorien, aktive Minuten,
  Body Battery, Stress.
- `garmin_sleep` — `calendar_date` (PK), gesamt/tief/leicht/REM/wach, Score.
- `garmin_health` — `calendar_date` (PK), VO2max, Ruhepuls-Trend, Gewicht.
- Endpunkte unter `functions/api/garmin/*` nach dem Muster von `entries.ts`
  (GET mit optionalem Datumsfilter; POST/PATCH für Inbox-Zuordnung).

**Schicht 3 — UI**
- **Postfach/Inbox**: neue Workouts als zuordenbare Karten; „Bereich + Projekt zuweisen"
  mit **Vorschlag** (Heuristik: letzte Zuordnung für denselben Aktivitätstyp) + Notizfeld.
- Beim Zuweisen entsteht ein `time_entries`-Eintrag (Saldo/Kalender/Mein Tag) mit Rückverweis
  auf die Garmin-Aktivität.
- **Deep-Dive-Pop-up** an der Aktivität (HF-Zonen, Distanz, Pace, Kalorien …).
- **Neuer Tab „Health/Fitness"**: KPI-Dashboard (Workouts, Stress, Schlaf, Gesundheit),
  im Glass-Stil, verbunden mit der Zeiterfassung. Integration in Nav + `commands.ts` + Spotlight.

### 6.1 Zuordnungs-/Vorschlagslogik (Kern des „Postfach"-Erlebnisses)
- Beim Import landet jedes neue Workout mit `status='inbox'`.
- **Vorschlag** = häufigste `(employer_id, project_id)`-Kombination früherer Workouts desselben
  Garmin-Typs (Fallback: konfigurierbares Typ→Bereich-Mapping).
- Nutzer bestätigt/ändert Bereich+Projekt, ergänzt Notiz → `status='assigned'`, `time_entry`
  wird erzeugt/verknüpft. „Ignorieren" → `status='ignored'` (kein Saldo-Effekt).

---

## 7. Roadmap (vorgeschlagen, bottom-up & testbar)

1. **Sync-Fundament**: `garth` in lokalem venv, Login-Test, Roh-JSON sichten → Feldauswahl fixieren.
2. **Schema + Sync-Write**: Tabellen `0018+`, Schreiben zuerst gegen **lokale** D1.
3. **Read-API + Inbox-UI**: Endpunkte + Postfach mit Zuordnung/Vorschlag (`typecheck` grün).
4. **Verknüpfung**: Zuordnung erzeugt `time_entry`; Deep-Dive-Pop-up.
5. **Health/Fitness-Tab**: KPI-Dashboard, Nav/Commands/Spotlight-Integration.
6. **Inbox/Briefings**: Tabelle `inbox_items` + In-App-Inbox mit Badge; Morgen-/Abend-Briefing
   zunächst on-demand generierbar, dann per **Cloudflare Cron Trigger** automatisiert.
7. **Produktion** (nur mit ausdrücklicher Freigabe): Remote-Migration + Sync + Deploy.
8. **Später**: Web-Push (PWA) für echte Benachrichtigungen, Automatisierung des Syncs
   (Cron/Launchd), Mobile-Optimierung, Design-Feinschliff über den Claude-Design-Master.

---

## 8. Offene Punkte / Entscheidungen
- **Sync-Trigger**: manuell (`python3 garmin/sync.py --days N`) zuerst; Automatisierung später.
- **Garmin-Zugang**: `garth` benötigt ggf. Python ≥ 3.10 (System ist 3.9.6) → venv mit
  neuerem Python via Homebrew.
- **Design**: neue Screens ideal über Claude-Design-Master; erste Version im bestehenden
  Glass-Stil funktional bauen.
- **Mobile**: weiterhin offen (App ist aktuell desktop-fixiert).
