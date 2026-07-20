#!/usr/bin/env python3
"""Garmin-Connect Explorations-Skript (WP0 — reine Feld-Sichtung).

Zweck: EINMALIG die Roh-JSON-Strukturen von Garmin Connect sichten, damit Eric
die finale Feldliste fuer WP1 (Schema/Sync) festlegen kann. Es schreibt NICHTS
in eine Datenbank und veraendert keinen App-Code.

Ablauf:
  1. Login via garth (interaktiv, inkl. MFA). Token-Cache in garmin/.garth/.
  2. Laedt fuer die letzten 14 Tage Roh-JSON fuer:
       - Aktivitaeten (Liste + Detail je Lauf und Krafttraining)
       - Tageswerte (usersummary daily)
       - Schlaf (dailySleepData)
       - Health/Fitness (VO2max, Gewicht, Ruhepuls/HR)
  3. Schreibt die Payloads UNVERAENDERT nach garmin/samples/<kategorie>.json.
  4. Gibt am Ende pro Kategorie die Feldnamen aus und stellt einen Lauf einem
     Krafttraining gegenueber.

Fehler werden klar geloggt (kein stilles Schlucken). Endet mit Exit-Code != 0,
wenn Login oder eine ganze Kategorie fehlschlaegt.

Aufruf:  garmin/venv/bin/python garmin/explore.py
"""

from __future__ import annotations

import getpass
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    import garth
except ImportError:
    print(
        "[FEHLER] 'garth' ist nicht installiert. Bitte venv nutzen: "
        "garmin/venv/bin/pip install garth",
        file=sys.stderr,
    )
    sys.exit(1)

BASE = Path(__file__).resolve().parent
TOKEN_DIR = BASE / ".garth"
SAMPLES = BASE / "samples"
DAYS = 14

# Kategorien, die am Ende scheitern und den Exit-Code bestimmen.
_failures: list[str] = []


def log(msg: str) -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(f"[WARN] {msg}", file=sys.stderr, flush=True)


def err(msg: str) -> None:
    print(f"[FEHLER] {msg}", file=sys.stderr, flush=True)


def api(path: str, **kwargs):
    """Roh-Aufruf gegen die Garmin-Connect-API (wirft bei Fehler)."""
    return garth.connectapi(path, **kwargs)


# --------------------------------------------------------------------------- #
# Login
# --------------------------------------------------------------------------- #
def login() -> None:
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    try:
        garth.resume(str(TOKEN_DIR))
        _ = garth.client.username  # validiert die Sitzung
        log(f"[OK] Bestehende Sitzung wiederverwendet (Token: {TOKEN_DIR}).")
        return
    except Exception:
        log("[INFO] Kein gueltiger Token-Cache — Login noetig.")

    # E-Mail/Passwort aus Env oder interaktiv. MFA braucht immer ein echtes Terminal.
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not (email and password) and not sys.stdin.isatty():
        err(
            "Interaktiver Login noetig, aber kein echtes Terminal (kein TTY).\n"
            "        Bitte in Terminal.app ausfuehren:\n"
            "          cd \"$(pwd)\" && garmin/venv/bin/python garmin/explore.py\n"
            "        Oder E-Mail/Passwort per Env setzen (MFA braucht dennoch ein TTY):\n"
            "          GARMIN_EMAIL=… GARMIN_PASSWORD=… garmin/venv/bin/python garmin/explore.py"
        )
        sys.exit(2)
    if not email:
        email = input("Garmin E-Mail: ").strip()
    if not password:
        password = getpass.getpass("Garmin Passwort: ")
    try:
        garth.login(
            email,
            password,
            prompt_mfa=lambda: input("MFA-Code (leer lassen, falls nicht gefragt): ").strip(),
        )
    except Exception as e:  # noqa: BLE001 — Login-Fehler ist fatal
        err(f"Login fehlgeschlagen: {e}")
        sys.exit(2)
    garth.save(str(TOKEN_DIR))
    log(f"[OK] Login erfolgreich. Token gespeichert: {TOKEN_DIR}.")


def display_name() -> str:
    prof = api("/userprofile-service/socialProfile")
    dn = prof.get("displayName") or prof.get("userName")
    if not dn:
        raise RuntimeError("Kein displayName im socialProfile gefunden")
    return dn


def days_desc() -> list[str]:
    """Letzte DAYS Kalendertage, neueste zuerst (ISO YYYY-MM-DD)."""
    today = date.today()
    return [(today - timedelta(days=i)).isoformat() for i in range(DAYS)]


def write_sample(name: str, payload) -> None:
    SAMPLES.mkdir(parents=True, exist_ok=True)
    path = SAMPLES / f"{name}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"[OK] {name}: geschrieben nach {path}")


# --------------------------------------------------------------------------- #
# Fetch pro Kategorie
# --------------------------------------------------------------------------- #
def fetch_activities() -> dict:
    acts = api(
        "/activitylist-service/activities/search/activities",
        params={"start": 0, "limit": 50},
    )
    cutoff = (date.today() - timedelta(days=DAYS)).isoformat()
    recent = [a for a in acts if str(a.get("startTimeLocal", ""))[:10] >= cutoff]

    def find(keys: tuple[str, ...]):
        for a in acts:
            tk = (a.get("activityType") or {}).get("typeKey", "")
            if any(k in tk for k in keys):
                return a
        return None

    run = find(("running", "treadmill_running", "trail_running", "track_running"))
    strength = find(("strength_training", "strength", "indoor_cardio", "hiit"))

    detail_running = detail_strength = None
    if run:
        try:
            detail_running = api(f"/activity-service/activity/{run['activityId']}")
        except Exception as e:  # noqa: BLE001
            warn(f"Laufdetail (id={run.get('activityId')}) fehlgeschlagen: {e}")
    else:
        warn("Keine Lauf-Aktivitaet in den letzten Eintraegen gefunden.")
    if strength:
        try:
            detail_strength = api(f"/activity-service/activity/{strength['activityId']}")
        except Exception as e:  # noqa: BLE001
            warn(f"Kraftdetail (id={strength.get('activityId')}) fehlgeschlagen: {e}")
    else:
        warn("Keine Krafttraining-Aktivitaet in den letzten Eintraegen gefunden.")

    return {
        "list_recent_14d": recent,
        "list_fetched": acts,
        "detail_running": detail_running,
        "detail_strength": detail_strength,
    }


def fetch_daily(dn: str) -> dict:
    out = {}
    for d in days_desc():
        out[d] = api(
            f"/usersummary-service/usersummary/daily/{dn}",
            params={"calendarDate": d},
        )
    return out


def fetch_sleep(dn: str) -> dict:
    out = {}
    for d in days_desc():
        out[d] = api(
            f"/wellness-service/wellness/dailySleepData/{dn}",
            params={"date": d, "nonSleepBufferMinutes": 60},
        )
    return out


def fetch_health(dn: str) -> dict:
    """Health/Fitness ist quellenabhaengig lueckenhaft — einzelne Metriken sind
    optional (nur [WARN]), die Kategorie selbst scheitert nur bei Totalausfall."""
    today = date.today().isoformat()
    start = (date.today() - timedelta(days=DAYS)).isoformat()
    out: dict = {}

    def opt(key: str, path: str, **kwargs):
        try:
            out[key] = api(path, **kwargs)
        except Exception as e:  # noqa: BLE001
            warn(f"Health-Metrik '{key}' fehlgeschlagen: {e}")

    opt("vo2max_latest", f"/metrics-service/metrics/maxmet/latest/{dn}")
    opt("weight_range", "/weight-service/weight/dateRange",
        params={"startDate": start, "endDate": today})
    opt("heartrate_today", f"/wellness-service/wellness/dailyHeartRate/{dn}",
        params={"date": today})
    opt("resting_hr_range", f"/userstats-service/wellness/daily/{dn}",
        params={"fromDate": start, "untilDate": today,
                "metricId": 60, "grpParentActId": 0})

    if not out:
        raise RuntimeError("Keine einzige Health-Metrik abrufbar")
    return out


# --------------------------------------------------------------------------- #
# Feld-Ausgabe (Schritt 4)
# --------------------------------------------------------------------------- #
def short(v) -> str:
    if isinstance(v, (dict,)):
        return f"<dict:{len(v)}>"
    if isinstance(v, (list,)):
        return f"<list:{len(v)}>"
    s = str(v)
    return s if len(s) <= 22 else s[:19] + "..."


def list_fields(name: str, sample) -> None:
    log(f"\n=== {name}: Feldnamen ===")
    if isinstance(sample, dict) and sample:
        for k in sorted(sample):
            log(f"  {k}: {short(sample[k])}")
    elif isinstance(sample, list) and sample:
        log(f"  (Liste mit {len(sample)} Eintraegen — Felder des ersten Eintrags:)")
        first = sample[0]
        if isinstance(first, dict):
            for k in sorted(first):
                log(f"  {k}: {short(first[k])}")
    else:
        log("  (leer / keine Daten)")


def contrast_run_strength(run: dict | None, strength: dict | None) -> None:
    log("\n=== Aktivitaeten: LAUF vs KRAFTTRAINING (Detail-Payload) ===")
    if not run and not strength:
        log("  (weder Lauf noch Kraft verfuegbar)")
        return

    def flat(d):
        keys: dict = {}
        if isinstance(d, dict):
            for k, v in d.items():
                keys[k] = v
                # summaryDTO traegt die eigentlichen Messwerte — eine Ebene aufklappen.
                if k == "summaryDTO" and isinstance(v, dict):
                    for kk, vv in v.items():
                        keys[f"summaryDTO.{kk}"] = vv
        return keys

    r, s = flat(run), flat(strength)
    allk = sorted(set(r) | set(s))
    log(f"  {'Feld':44} {'Lauf':>14} {'Kraft':>14}")
    log(f"  {'-'*44} {'-'*14} {'-'*14}")
    for k in allk:
        rv = short(r[k]) if k in r else "–"
        sv = short(s[k]) if k in s else "–"
        log(f"  {k:44} {rv:>14} {sv:>14}")


# --------------------------------------------------------------------------- #
def category(name: str, fn) -> None:
    try:
        payload = fn()
        write_sample(name, payload)
    except Exception as e:  # noqa: BLE001
        err(f"Kategorie '{name}' fehlgeschlagen: {e}")
        _failures.append(name)


def main() -> int:
    log(f"Garmin-Explore — letzte {DAYS} Tage — Samples nach {SAMPLES}\n")
    login()

    try:
        dn = display_name()
        log(f"[OK] displayName: {dn}")
    except Exception as e:  # noqa: BLE001
        err(f"Profil (displayName) nicht abrufbar: {e}")
        return 3

    category("activities", fetch_activities)
    category("daily", lambda: fetch_daily(dn))
    category("sleep", lambda: fetch_sleep(dn))
    category("health", lambda: fetch_health(dn))

    # --- Feld-Ausgabe ---
    def load(name):
        p = SAMPLES / f"{name}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    acts = load("activities") or {}
    list_fields("Aktivitaeten (Listen-Eintrag)", acts.get("list_recent_14d") or acts.get("list_fetched"))
    contrast_run_strength(acts.get("detail_running"), acts.get("detail_strength"))

    daily = load("daily") or {}
    list_fields("Tageswerte (ein Tag)", next(iter(daily.values()), None))

    sleep = load("sleep") or {}
    list_fields("Schlaf (ein Tag)", next(iter(sleep.values()), None))

    health = load("health") or {}
    for key, val in (health.items() if isinstance(health, dict) else []):
        list_fields(f"Health/{key}", val)

    if _failures:
        err(f"Abgeschlossen mit Fehlern in: {', '.join(_failures)}")
        return 1
    log("\n[OK] Alle Kategorien erfolgreich. Samples liegen in garmin/samples/.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
