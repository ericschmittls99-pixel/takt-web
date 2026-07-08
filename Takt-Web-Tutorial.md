# Takt Web — von Claude Design zur Multi-Device-App

Schritt-für-Schritt-Anleitung, um dein fertiges Claude Design in eine echte, von Mac **und** Handy nutzbare Arbeitszeiterfassung zu verwandeln. Komplett im kostenlosen Bereich.

**Stack:** Cloudflare Pages (Hosting) · Pages Functions (Backend) · D1 (SQLite-Datenbank) · Cloudflare Access (Login) · gebaut mit Claude Code.

**Am Ende hast du:** eine URL wie `https://takt-web.pages.dev`, die nur du öffnen kannst, mit automatischem Sync über alle Geräte.

---

## Der Stack auf einen Blick

| Teil | Rolle | Kosten |
|---|---|---|
| Cloudflare Pages | hostet Frontend, vergibt `*.pages.dev` | gratis |
| Pages Functions | kleines Backend (API) im selben Projekt | gratis |
| Cloudflare D1 | speichert die Zeiteinträge (SQLite) | gratis (5 GB) |
| Cloudflare Access | sperrt die App auf deine E-Mail | gratis (bis 50 Nutzer) |

Ein Anbieter, ein Projekt, nichts pausiert bei sporadischer Nutzung.

---

## Voraussetzungen (einmalig)

- **Node.js** installiert (`node -v` sollte etwas ausgeben). Falls nicht: von nodejs.org.
- **Claude Code** installiert und einsatzbereit.
- **Cloudflare-Account** (kostenlos, unter dash.cloudflare.com anlegen).
- Dein **fertiges Claude Design** ist offen.
- Git hast du bereits.

---

## Phase 0 — Vorbereitung

1. Neuen, **leeren** Ordner anlegen — **nicht** ins bestehende SwiftUI-/Xcode-Takt-Projekt. Das ist ein anderer Stack.
   ```bash
   mkdir -p ~/Documents/"4 Freizeit"/"Projekt Takt"/Takt-Web
   cd ~/Documents/"4 Freizeit"/"Projekt Takt"/Takt-Web
   ```
2. Claude Code **in diesem Ordner** starten.

---

## Phase 1 — Design-Handoff nach Claude Code

1. In **Claude Design** oben rechts: **Export → „Handoff to Claude Code"**.
2. Du bekommst einen fertigen Prompt inklusive der URL zum Handoff-Bundle (Design-Dateien, Design-System-Tokens, Komponentenstruktur, Intention je Seite).
3. **Kopiere diesen Prompt** — den fügst du gleich in Phase 2 zusammen mit den Stack-Vorgaben in Claude Code ein.

> Tipp: Wähle das **lokale** Claude Code (nicht Claude Code Web), weil du hier gleich wrangler, die Datenbank und den Deploy mit erledigst.

---

## Phase 2 — Projekt aufsetzen  ▶ Prompt 1

Füge in Claude Code **zuerst den Handoff-Prompt aus Claude Design** ein und hänge direkt darunter das Folgende an:

```
Nutze das oben verlinkte Claude-Design-Handoff-Bundle als UI-Grundlage für meine
Arbeitszeiterfassung „Takt Web". Bitte richte das Projekt so ein:

1. Frontend: Vite + React (TypeScript), responsive für Desktop und Mobile.
2. Ziel-Hosting: Cloudflare Pages. Backend über Cloudflare Pages Functions
   (Ordner /functions), Daten in einer Cloudflare-D1-Datenbank.
3. Lege eine wrangler.toml an mit:
   - name = "takt-web"
   - pages_build_output_dir = "dist"
   - einem D1-Binding namens DB (database_id trage ich später ein)
4. Baue die UI aus dem Bundle nach, aber verdrahte die Daten noch NICHT —
   Schema und API-Funktionen kommen im nächsten Schritt.
5. Initialisiere ein Git-Repo mit sinnvoller .gitignore.

Zeig mir ZUERST die geplante Ordnerstruktur und die wrangler.toml,
bevor du Code schreibst. Warte auf mein OK.
```

Prüf die vorgeschlagene Struktur, gib dann dein OK.

---

## Phase 3 — Cloudflare & Datenbank anlegen

Diese Schritte brauchen deinen Browser/Account. Du kannst die Befehle selbst ausführen **oder** Claude Code ausführen lassen (dann musst du im Browser nur bestätigen).

1. **Bei Cloudflare anmelden** (öffnet den Browser, einmal autorisieren):
   ```bash
   npx wrangler login
   ```
2. **D1-Datenbank erstellen:**
   ```bash
   npx wrangler d1 create takt-db
   ```
   Der Befehl gibt am Ende einen Block mit `database_id = "..."` aus.
3. **Diese ID in die `wrangler.toml`** eintragen (beim D1-Binding `DB`). Sag Claude Code einfach:
   ```
   Hier ist die database_id aus `wrangler d1 create`: <ID_EINFÜGEN>
   Trag sie in die wrangler.toml beim Binding DB ein.
   ```

---

## Phase 4 — Datenbank-Schema & Backend  ▶ Prompt 2

Zuerst das Schema. Es ist auf deine Takt-Logik zugeschnitten (Ist/Soll, zwei Arbeitgeber, Projekt-Hierarchie) und bewusst schlank gehalten, damit du es später erweitern kannst.

Sag Claude Code:

```
Lege eine Datei schema.sql im Projektwurzelverzeichnis mit genau diesem Inhalt an:
```

```sql
-- Arbeitgeber
CREATE TABLE employers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  bundesland  TEXT NOT NULL
);

-- Projekte: vierstufige Hierarchie über parent_id (NULL = oberste Ebene)
CREATE TABLE projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id  INTEGER NOT NULL REFERENCES employers(id),
  parent_id    INTEGER REFERENCES projects(id),
  name         TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1
);

-- Zeiteinträge (Ist)
CREATE TABLE time_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id  INTEGER NOT NULL REFERENCES employers(id),
  project_id   INTEGER REFERENCES projects(id),
  start_ts     TEXT NOT NULL,             -- ISO 8601
  end_ts       TEXT,                      -- NULL = läuft gerade
  duration_min INTEGER,                   -- wird beim Stoppen berechnet
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Soll-Vorgaben pro Arbeitgeber
CREATE TABLE targets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  employer_id     INTEGER NOT NULL REFERENCES employers(id),
  weekly_soll_min INTEGER NOT NULL,       -- Soll-Minuten pro Woche
  valid_from      TEXT NOT NULL
);

CREATE INDEX idx_entries_employer ON time_entries(employer_id);
CREATE INDEX idx_entries_start    ON time_entries(start_ts);

-- Startdaten: deine zwei Arbeitgeber
INSERT INTO employers (name, bundesland) VALUES
  ('FMC',  'Rheinland-Pfalz'),
  ('bhyo', 'Baden-Württemberg');
```

> Deine 50%-Uni-Stelle kannst du später als dritten `employers`-Eintrag ergänzen.

Dann die API. Sag Claude Code:

```
Baue jetzt das Backend als Cloudflare Pages Functions unter /functions/api/:
- GET  /api/entries          -> alle Zeiteinträge, neueste zuerst
- POST /api/entries          -> neuen Eintrag anlegen (start_ts, employer_id, project_id, note)
- PATCH /api/entries/:id     -> Eintrag stoppen/bearbeiten (end_ts setzen, duration_min berechnen)
- DELETE /api/entries/:id    -> Eintrag löschen
- GET  /api/employers        -> Arbeitgeber-Liste
- GET  /api/projects         -> Projekt-Liste
Nutze das D1-Binding context.env.DB mit prepared statements.
Verdrahte danach das Frontend aus dem Design mit diesen Endpunkten
(Start/Stopp-Button, Liste der Einträge, Arbeitgeber-/Projektauswahl).
```

---

## Phase 5 — Lokal testen  ▶ Prompt 3

1. **Schema in die lokale Test-Datenbank** einspielen:
   ```bash
   npx wrangler d1 execute takt-db --local --file=./schema.sql
   ```
2. Claude Code den lokalen Dev-Server einrichten lassen (Vite + Functions zusammen ist etwas eigen — lass dir den genauen Befehl geben):
   ```
   Richte den lokalen Entwicklungsmodus ein, sodass Frontend und die Pages
   Functions gegen die lokale D1-Datenbank laufen. Nenn mir den genauen
   Befehl zum Starten und wie ich ihn aufrufe.
   ```
3. Im Browser öffnen, einen Testeintrag anlegen, stoppen, neu laden — bleibt der Eintrag da, passt die lokale DB.

---

## Phase 6 — Deployen

1. **Schema in die echte (Remote-)Datenbank** einspielen — einmalig:
   ```bash
   npx wrangler d1 execute takt-db --remote --file=./schema.sql
   ```
2. **Frontend bauen und deployen:**
   ```bash
   npm run build
   npx wrangler pages deploy dist
   ```
   Beim ersten Mal fragt wrangler, ob ein neues Pages-Projekt angelegt werden soll → Namen bestätigen (`takt-web`).
3. Du bekommst deine Live-URL: **`https://takt-web.pages.dev`**. Einmal öffnen und testen.

> Falls die App zwar lädt, aber keine Daten speichert: meist ist das D1-Binding im Pages-Projekt noch nicht aktiv. Sag Claude Code: *„Prüf, ob das D1-Binding DB im deployten Pages-Projekt gesetzt ist, und korrigiere wrangler.toml falls nötig."*

---

## Phase 7 — Login davorschalten (Pflicht)

Ohne diesen Schritt kann **jeder** mit der URL deine Arbeitszeitdaten sehen. Cloudflare Access sperrt die App auf deine E-Mail — gratis.

1. Im Cloudflare-Dashboard: **Zero Trust** öffnen (beim ersten Mal wird ein Team-Name abgefragt; Free-Plan wählen).
2. **Access → Applications → Add an application → Self-hosted**.
3. **Application domain:** `takt-web.pages.dev` eintragen.
4. Eine **Policy** hinzufügen:
   - Action: **Allow**
   - Include → **Emails** → deine E-Mail-Adresse
5. Speichern. Ab jetzt landest du beim Öffnen der URL zuerst auf einem Login und kommst nur mit deiner E-Mail rein.

---

## Phase 8 — Aufs Handy bringen

1. Die URL `https://takt-web.pages.dev` am Handy im Browser öffnen, einloggen.
2. **„Zum Home-Bildschirm hinzufügen"** (Safari: Teilen-Menü / Chrome: Drei-Punkte-Menü).
3. Jetzt liegt ein App-Icon auf dem Homescreen; es öffnet die Seite im Vollbild — fühlt sich wie eine native App an, greift aber auf dieselbe D1-Datenbank zu wie der Mac.

> Optional kann Claude Code ein Web-App-Manifest + Icon ergänzen, damit das Icon und der Vollbildstart sauber aussehen. Prompt: *„Füge ein PWA-Manifest und ein App-Icon hinzu, damit die Seite als Homescreen-App gut aussieht."*

---

## Phase 9 — Backup & Weiterentwicklung

**Backup der Daten** (ganze Datenbank als SQL-Datei):
```bash
npx wrangler d1 export takt-db --remote --output=./backup.sql
```
Praktisch als gelegentliches Sicherungsritual — passt gut zu deinem Git-/Obsidian-Stil.

**CSV-Export in der App** (nützlich fürs Auswerten in Excel): sag Claude Code *„Füge einen Button hinzu, der alle Zeiteinträge als CSV herunterlädt."*

**Auto-Deploy per Git (optional):** Repo auf GitHub pushen und im Cloudflare-Pages-Projekt verbinden. Danach deployt jeder `git push` automatisch — kein manuelles `wrangler pages deploy` mehr nötig.

**Nächste Ausbaustufen**, wenn die Basis läuft: Soll/Ist-Auswertung pro Woche, getrennte Überstundenkonten je Bundesland, Projekt-Hierarchie-Baum, Wochen-/Monatsdiagramme.

---

## Kosten-Check

Alles oben liegt dauerhaft im kostenlosen Bereich. Für eine persönliche App mit ein paar Einträgen pro Tag bist du bei D1, Pages und Access **weit** unter jeder Free-Tier-Grenze. Es entstehen nur Kosten, wenn du die App massiv skalierst — was hier nicht passiert.

---

## Wenn was klemmt

- **`wrangler`-Befehl nicht gefunden** → `npx` davorsetzen (`npx wrangler ...`) oder Node prüfen.
- **Login-/Deploy-Fehler** → `npx wrangler login` erneut ausführen.
- **App lädt, speichert aber nicht** → D1-Binding im Pages-Projekt fehlt (siehe Hinweis in Phase 6).
- **Access sperrt dich selbst aus** → in der Policy prüfen, ob genau deine Login-E-Mail unter „Include → Emails" steht.
- **Allgemein** → beschreib Claude Code die Fehlermeldung wörtlich; es kann Config und Code direkt korrigieren.
