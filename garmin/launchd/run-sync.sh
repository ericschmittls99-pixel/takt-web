#!/bin/bash
# launchd-Wrapper für den Garmin-Sync.
# launchd startet mit minimalem PATH -> node/npx (für `npx wrangler d1 execute`)
# müssen explizit ergänzt werden, sonst schlägt der D1-Schreibvorgang fehl.
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO="/Users/ericschmitt/Takt-Web"
LOG="$REPO/garmin/logs/sync.log"

cd "$REPO" || exit 1
echo "" >> "$LOG"
echo "===== $(date '+%Y-%m-%d %H:%M:%S %z') Sync-Start (--days 3) =====" >> "$LOG"
# Automatik: nur jüngste Tage auffrischen (schnell/schonend). intraday läuft
# als volle Kategorie mit (kurze Garmin-Vorhaltung ~144 Tage -> nichts verlieren).
"$REPO/garmin/venv/bin/python" "$REPO/garmin/sync.py" --days 3 >> "$LOG" 2>&1
RC=$?
echo "===== $(date '+%Y-%m-%d %H:%M:%S %z') Sync-Ende (exit $RC) =====" >> "$LOG"
exit $RC
