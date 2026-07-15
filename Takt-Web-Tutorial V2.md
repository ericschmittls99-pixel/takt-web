# Takt Web — Tutorial v2 (aktualisiert)

Überarbeitete Fassung, basierend auf dem tatsächlichen Weg, den wir gegangen sind — inklusive aller Korrekturen unterwegs. **Reihenfolge bewusst geändert:** komplette App lokal fertig bauen, dann erst deployen.

**Stand:** Setup, Backend-Grundgerüst und der Mein-Tag-Screen sind fertig. To-Dos ist in Arbeit. Dieses Dokument begleitet dich durch den Rest.

---

## Was schon erledigt ist (Phasen 0–3, zur Referenz)

Diese Schritte sind bereits durchlaufen — hier nur zum Nachschlagen, falls du sie für ein neues Gerät oder Projekt wiederholen musst.

### Projekt-Setup
```bash
mkdir -p ~/Documents/"4 Freizeit"/"Projekt Takt"/Takt-Web
cd ~/Documents/"4 Freizeit"/"Projekt Takt"/Takt-Web
claude
```
Claude Code hat darin das Vite+React-Grundgerüst, `wrangler.toml`, Git-Init und `npm install` erledigt.

### Cloudflare-Account & D1 (lokal)
```bash
npx wrangler login
npx wrangler d1 create takt-web
```
Ergebnis in `wrangler.toml` eingetragen:
```toml
name = "takt-web"
compatibility_date = "2026-07-08"

[[d1_databases]]
binding = "DB"
database_name = "takt-web"
database_id = "4f275415-6b4a-4030-b748-9733ed3cb280"
```
> **Wichtig:** `pages_build_output_dir` bewusst **nicht** in der Datei — kollidiert mit dem kombinierten Dev-Befehl unten. Wird erst beim Deploy als CLI-Argument übergeben.

### Kombinierter Dev-Server (ein Terminal für Frontend + API)
In `package.json`:
```json
"pages:dev": "wrangler pages dev -- npm run dev"
```
Start:
```bash
npm run pages:dev
```
→ läuft unter `http://localhost:8788`, Vite intern auf 5173, `/api/*` geht automatisch an die Cloudflare Pages Functions.

### Datenbank-Struktur: Migrations-Ordner
Schema liegt **nicht** als einzelne `schema.sql`, sondern versioniert unter `schema/`:
```
schema/0001_init.sql            -- Grundtabellen: employers, projects, time_entries, targets
schema/0002_seed_projects.sql   -- Testprojekte FMC/bhyo
schema/0003_seed_targets.sql    -- Soll-Zahlen (aktuell 20h/Woche je Arbeitgeber)
schema/0004_todos.sql           -- To-Dos-Tabelle (in Arbeit)
```
Jede neue Tabelle/Änderung bekommt eine neue, nummerierte Datei — nie eine bestehende überschreiben.

Lokal einspielen (bei jeder neuen Migration wiederholen):
```bash
npx wrangler d1 execute takt-web --local --file=./schema/000X_name.sql
```

### Design-Anbindung (Claude Design ↔ Claude Code)

Einmalig, im Terminal:
```bash
claude mcp add --scope user --transport http claude-design https://api.anthropic.com/v1/design/mcp
```
Danach Claude-Code-Session **neu starten**.

In der Session:
```
/design-login
```
Browser öffnet sich → autorisieren. Prüfen mit `/mcp` — sollte `claude-design · ✔ connected` zeigen.

> **Versionshinweis:** Falls `/design-login` fehlt oder `/mcp` „failed" zeigt: `claude doctor` prüfen. Bei Homebrew-Installation reicht `brew upgrade claude-code`, danach Terminal **komplett neu starten** (nicht nur neuer Tab).

Der eigentliche Import läuft über **Claude Design**, nicht über einen Befehl in Claude Code:
1. Design öffnen → **Export → „Send to Claude Code"**.
2. Den dort generierten Prompt kopieren (enthält die Bundle-URL).
3. In Claude Code einfügen, mit dem Verdrahtungs-Zusatz für die jeweilige Ansicht (siehe Phase 4 unten).

---

## Phase 4 — Alle Screens lokal fertig bauen

Hier bist du gerade. Ziel: **die komplette App aus dem Bundle nachbauen und ans Backend anschließen, bevor irgendetwas deployed wird.**

Empfohlene Reihenfolge (jede baut auf der vorherigen auf oder ist unabhängig testbar):

### 4.1 Mein Tag — ✅ fertig
24-Stunden-Ring (Ist-Ring wired, Soll-Ring folgt mit `planned_blocks` in 4.3), Live-Tracking, Start/Stopp/Erfassen, Aktivitätenliste.

### 4.2 To-Dos — in Arbeit
```
Baue die To-Dos-Ansicht aus dem Design-Bundle vollständig (nicht als
Platzhalter):

1. Migration schema/0004_todos.sql: Tabelle todos (id, title, due_date,
   done, employer_id nullable, created_at).
2. CRUD-Routen unter /functions/api/todos/:
   GET /api/todos, POST /api/todos, PATCH /api/todos/:id (done toggeln,
   bearbeiten), DELETE /api/todos/:id.
3. Die TO-DOS-Kachel oben rechts (aus Mein Tag.dc.html) an echte Daten
   anbinden: Anzahl offen, Anzahl überfällig (due_date < heute && !done).
4. Navigation: einfachen Zustand-basierten View-Switch in App.tsx einbauen
   (kein React Router, useState reicht) — 'mein-tag' und 'todos' als
   Ansichten. Die Nav-Icons aus dem Bundle (oben links, clock/bar-chart)
   entsprechend verdrahten.
5. Die eigentliche To-Dos-Seite/Liste aus dem Bundle nachbauen und über den
   View-Switch aus Punkt 4 erreichbar machen.

Bitte danach typecheck und build laufen lassen.
```

### 4.3 Planned Blocks + Timeline
Das größte Stück — liefert die Datengrundlage für den inneren Soll-Ring, die Timeline-Ansicht und später die Wochenauswertung.
```
Baue das Planungsdaten-Modell und die Timeline-Ansicht:

1. Migration schema/0005_planned_blocks.sql: Tabelle planned_blocks
   (id, employer_id, project_id nullable, weekday 0-6 ODER date,
   start_min, end_min, created_at). Entscheide dich für wiederkehrend
   (weekday) oder datumsgenau (date) — für den Anfang reicht weekday.
2. CRUD-Routen unter /functions/api/planned/:
   GET /api/planned?date=YYYY-MM-DD (löst weekday zu Segmenten für den
   angefragten Tag auf), POST, PATCH, DELETE.
3. Den inneren Ring in MeinTag.tsx (Ring24, planned-Prop) mit echten
   Segmenten aus /api/planned befüllen statt dem leeren Track.
4. Die Timeline-Ansicht aus dem Bundle nachbauen (Soll-Blöcke vs.
   Ist-Buchungen im Tagesverlauf) und über den View-Switch erreichbar
   machen.

Bitte danach typecheck und build laufen lassen.
```

### 4.4 Auswertung (Woche / Monat / Jahr / Gesamt)
Baut auf 4.3 (`planned_blocks`) und den bestehenden `targets` auf. **Wichtig:** Das Bundle hat hier laut Design nicht nur eine Wochenansicht, sondern mehrere umschaltbare Zeiträume — der Endpunkt muss das von Anfang an flexibel abbilden, sonst müsst ihr ihn für jede Ansicht einzeln nachbauen.
```
Baue die Auswertungs-Ansicht aus dem Design-Bundle vollständig, inklusive
aller im Bundle vorgesehenen Zeitraum-Umschalter (Woche/Monat/Jahr/Gesamt
— bitte im Bundle prüfen, welche genauen Zeiträume und Toggle-Optionen
dort vorgesehen sind, und danach richten):

1. Route GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=day|week|month
   — aggregiert Ist-Minuten aus time_entries und Soll-Minuten aus
   targets/planned_blocks pro Arbeitgeber für den angefragten Zeitraum,
   gruppiert nach dem angegebenen Intervall. "Gesamt" = kein from/sehr
   frühes Datum bis heute.
2. Frontend-seitig die vier Zeitraum-Modi (Woche/Monat/Jahr/Gesamt) als
   Toggle wie im Bundle, der jeweils passende from/to/groupBy-Werte an
   die Route übergibt.
3. Die Auswertungs-Ansicht(en) aus dem Bundle nachbauen (Balken/Chart pro
   Tag/Woche/Monat, je nach gewähltem Zeitraum, wie im Design), über den
   View-Switch erreichbar.

Bitte danach typecheck und build laufen lassen.
```

### 4.5 Konto / Einstellungen
Hier kommt der bisher zurückgestellte Schreibzugriff auf die Sollzahlen.
```
Baue die Konto-/Einstellungsansicht aus dem Design-Bundle:

1. Route PATCH /api/targets/:employer_id — weekly_soll_min aktualisierbar.
2. Einstellungsseite aus dem Bundle nachbauen: Sollzahlen pro Arbeitgeber
   editierbar, über den View-Switch erreichbar.
3. Optional, falls im Bundle vorgesehen: Arbeitgeber-Stammdaten
   (Name, Bundesland) ebenfalls editierbar machen.

Bitte danach typecheck und build laufen lassen.
```

### 4.6 Kalender & Spotlight/Suche
Diese beiden brauchen voraussichtlich kein neues Datenmodell — nur Frontend-Arbeit über die bestehenden Endpunkte.
```
Baue Kalender- und Spotlight/Such-Ansicht aus dem Design-Bundle:

1. Kalender: Monatsübersicht über GET /api/entries mit Datumsfilter,
   Klick auf einen Tag wechselt zur Mein-Tag-Ansicht für dieses Datum.
2. Spotlight/Suche: Volltextsuche über Notizen/Projekte/Arbeitgeber in
   den bestehenden Daten (client- oder serverseitig, je nach Datenmenge
   sinnvoll — für eine private App reicht clientseitig).
3. Beide über den View-Switch bzw. die Icons oben rechts erreichbar
   machen, wie im Bundle.

Bitte danach typecheck und build laufen lassen.
```

> **Login-Screen aus dem Bundle:** bewusst ausgelassen — Cloudflare Access (Phase 7) übernimmt die Absicherung, ein zusätzlicher In-App-Login wäre doppelt.

---

## Phase 5 — Komplette lokale Testrunde

Erst wenn **alle** Screens aus Phase 4 stehen, hier durchgehen:

```bash
npm run pages:dev
```

Checkliste:
- [ ] Mein Tag: Start/Stopp/Erfassen, Ring (Ist **und** Soll), Saldo, Aktivitätenkacheln
- [ ] To-Dos: anlegen, abhaken, löschen, Kachel-Zahlen korrekt
- [ ] Timeline: Soll-Blöcke sichtbar, korrekt gegen Ist gestellt
- [ ] Auswertung: alle Zeitraum-Modi (Woche/Monat/Jahr/Gesamt) testen, Zahlen plausibel
- [ ] Konto/Einstellungen: Soll-Zahl ändern, wirkt sich auf Mein Tag aus
- [ ] Kalender: Tage anklickbar, richtige Einträge geladen
- [ ] Spotlight: Suche liefert erwartete Treffer
- [ ] Theme-Toggle (hell/dunkel) auf allen Screens
- [ ] Navigation zwischen allen Ansichten sauber

Erst wenn hier alles grün ist, geht's weiter zu Phase 6.

---

## Phase 6 — Deploy (jetzt erst)

### 6.1 Alle Migrationen remote einspielen
Reihenfolge exakt einhalten, alle bisherigen Dateien:
```bash
npx wrangler d1 execute takt-web --remote --file=./schema/0001_init.sql
npx wrangler d1 execute takt-web --remote --file=./schema/0002_seed_projects.sql
npx wrangler d1 execute takt-web --remote --file=./schema/0003_seed_targets.sql
npx wrangler d1 execute takt-web --remote --file=./schema/0004_todos.sql
npx wrangler d1 execute takt-web --remote --file=./schema/0005_planned_blocks.sql
# ... jede weitere Migration, die bis dahin entstanden ist
```

### 6.2 Bauen und deployen
```bash
npm run build
npx wrangler pages deploy dist
```
Beim ersten Mal: Projektnamen bestätigen (`takt-web`) → URL entsteht automatisch: `https://takt-web.pages.dev`.

### 6.3 D1-Binding im Dashboard prüfen
Bekannter Stolperstein: Lädt die App, speichert aber nicht → im Cloudflare-Dashboard prüfen, ob das D1-Binding `DB` im deployten Pages-Projekt aktiv ist (Pages-Projekt → Settings → Functions → D1 database bindings).

---

## Phase 7 — Cloudflare Access (Pflicht)

1. Cloudflare-Dashboard → **Zero Trust** → beim ersten Mal Team-Namen vergeben, Free-Plan.
2. **Access → Applications → Add an application → Self-hosted**.
3. Domain: `takt-web.pages.dev`.
4. Policy: Action **Allow**, Include → **Emails** → deine E-Mail-Adresse.
5. Speichern.

Ab jetzt: Login-Wand vor der eigentlichen App, nur du kommst rein.

---

## Phase 8 — Aufs Handy

1. `https://takt-web.pages.dev` am Handy öffnen, einloggen.
2. „Zum Home-Bildschirm hinzufügen" (Safari: Teilen-Menü / Chrome: Drei-Punkte-Menü).
3. Optional, für sauberes Icon: Claude Code bitten, ein PWA-Manifest + App-Icon zu ergänzen.

---

## Phase 9 — Backup & laufender Betrieb

**Backup:**
```bash
npx wrangler d1 export takt-web --remote --output=./backup.sql
```

**Weitere Änderungen nach dem ersten Deploy:** neue Migration anlegen → lokal testen → remote einspielen → `npm run build` → `npx wrangler pages deploy dist`. Kein erneutes Access-Setup nötig, das bleibt bestehen.

**Auto-Deploy (optional, später):** Repo auf GitHub pushen, im Cloudflare-Pages-Projekt verbinden — danach deployt jeder `git push` automatisch.

---

## Troubleshooting-Notizen (aus der Praxis)

- **`claude mcp login` / `/design-login` fehlt oder MCP zeigt „failed"** → `claude doctor` prüfen, Homebrew-Update (`brew upgrade claude-code`), danach Terminal komplett neu starten.
- **Wrangler-Fehler „database already exists"** → harmlos, meist Doppelausführung; Datenbank ist schon da.
- **`wrangler d1 execute`: Datei nicht gefunden** → Pfad prüfen, insbesondere `schema/000X_*.sql` statt `schema.sql` im Root.
- **`pages_build_output_dir` + `-- <command>`-Proxy gleichzeitig** → Wrangler 4 verbietet das; `pages_build_output_dir` aus `wrangler.toml` raushalten, stattdessen beim Deploy als CLI-Argument (`wrangler pages deploy dist`).
- **App lädt, speichert aber nicht (nach Deploy)** → D1-Binding im Pages-Dashboard fehlt, siehe Phase 6.3.
