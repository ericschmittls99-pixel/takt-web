# Garmin-Sync-Automatik (launchd, lokal)

Lässt `garmin/sync.py --days 3` automatisch **4×/Tag** (09:00 / 15:00 / 21:00 / 03:00)
auf diesem Rechner laufen. Kein Cloud-Sync, kein Deploy. Der Sync schreibt seinen
Stand (`garmin_last_sync` + `garmin_last_sync_status`) direkt in die lokale D1; die
App zeigt ihn grau an ("Garmin-Stand: vor 2 Std").

- **Wrapper:** `run-sync.sh` (setzt PATH für `node/npx`, cd ins Repo, loggt je Lauf).
- **Job:** `com.takt.garmin-sync.plist`.
- **Logs:** `garmin/logs/sync.log` (je Lauf ein `Sync-Start`/`Sync-Ende`-Block),
  launchd-Ausgaben in `garmin/logs/launchd.*.log`. Alles gitignored.

> **Wichtig – Repo-Ort:** Dieses Setup erwartet das Repo unter `~/Takt-Web`
> (`/Users/ericschmitt/Takt-Web`). Bewusst **außerhalb** von `~/Documents`, weil macOS
> Documents/Desktop/Downloads per TCC schützt — ein launchd-Job dort bräuchte
> Festplattenvollzugriff (bei Skripten notorisch unzuverlässig). Außerhalb dieser
> Ordner läuft es **ohne jede Sonderfreigabe**.

> `--days 3` frischt nur die jüngsten Tage auf (schnell/schonend). **intraday** läuft
> dabei als volle Kategorie mit — Garmin hält Intraday nur ~144 Tage vor, so geht kein
> Tag verloren. Der große Backfill (`--days 400`) bleibt manuell/einmalig.

## Einrichten (einmalig, von Eric manuell)

```sh
cd ~/Takt-Web

# 1) Wrapper ausführbar machen (falls Git das +x nicht übernommen hat):
chmod +x garmin/launchd/run-sync.sh

# 2) plist an den festen launchd-Ort kopieren:
mkdir -p ~/Library/LaunchAgents
cp garmin/launchd/com.takt.garmin-sync.plist ~/Library/LaunchAgents/

# 3) Laden (aktiviert den Zeitplan):
launchctl load ~/Library/LaunchAgents/com.takt.garmin-sync.plist
```

## Bedienung

```sh
# Status / ist der Job geladen? (mittlere Spalte = letzter Exit-Code, 0 = ok)
launchctl list | grep com.takt.garmin-sync

# Sofort einmal testen (ohne auf die Uhrzeit zu warten):
launchctl kickstart -k gui/$(id -u)/com.takt.garmin-sync
tail -f ~/Takt-Web/garmin/logs/sync.log

# Entladen (Automatik aus):
launchctl unload ~/Library/LaunchAgents/com.takt.garmin-sync.plist
```

## Uhrzeiten ändern

`StartCalendarInterval` in der plist bearbeiten (je `<dict>` ein Zeitpunkt, `Hour`/`Minute`),
dann neu laden:

```sh
launchctl unload ~/Library/LaunchAgents/com.takt.garmin-sync.plist
cp ~/Takt-Web/garmin/launchd/com.takt.garmin-sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.takt.garmin-sync.plist
```

## Hinweise

- **Pfade sind absolut** auf `~/Takt-Web` gesetzt. Zieht das Repo um, die Pfade in
  `run-sync.sh` (`REPO=`) und in der plist anpassen.
- **node/npx** werden unter `/usr/local/bin` erwartet (der Wrapper ergänzt zusätzlich
  `/opt/homebrew/bin`). `which npx` prüfen, falls der D1-Schreibvorgang scheitert.
- Der Rechner muss zur geplanten Zeit **wach** sein; verpasste Läufe holt launchd
  standardmäßig nicht nach — der nächste reguläre Lauf frischt aber ohnehin auf.
- **Garmin-Login:** läuft über den Token-Cache (`garmin/.garth`). Läuft der ab, schlägt
  der Sync fehl (im Log sichtbar) und braucht einen manuellen Login im Terminal.
