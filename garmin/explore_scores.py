#!/usr/bin/env python3
"""Garmin-Score-Exploration (WP4b Stufe 1). Reine Sichtung, kein DB-Write.

Probiert für neun „Kategorie-2"-Werte die bekannten Connect-Endpunkte durch, speichert
Roh-JSON nach garmin/samples/scores_<name>.json und meldet je Wert: verfügbar JA/NEIN,
Felder, Beispiel, Granularität (Tageswert / pro Aktivität / Snapshot / Zeitreihe).

Fehler/404 werden pro Endpunkt abgefangen und protokolliert — kein Abbruch.
Manche Werte (Jetlag Adviser, Sleep Coach, Körpertemperatur) existieren evtl. NICHT als
API-Endpunkt — das ist ein erwartetes Ergebnis.

Aufruf:  garmin/venv/bin/python garmin/explore_scores.py
"""
from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

try:
    import garth
except ImportError:
    print("[FEHLER] garth fehlt (venv nutzen).", file=sys.stderr)
    sys.exit(1)

BASE = Path(__file__).resolve().parent
TOKEN_DIR = BASE / ".garth"
SAMPLES = BASE / "samples"
SAMPLES.mkdir(parents=True, exist_ok=True)

today = date.today()
d0 = today.isoformat()
d7 = (today - timedelta(days=7)).isoformat()
d30 = (today - timedelta(days=30)).isoformat()


def log(m): print(m, flush=True)


def login():
    garth.resume(str(TOKEN_DIR))
    _ = garth.client.username
    log(f"[OK] Sitzung wiederverwendet.")


def api(path, **kw):
    return garth.connectapi(path, **kw)


def display_name():
    p = api("/userprofile-service/socialProfile")
    return p.get("displayName") or p.get("userName")


def save(name, data):
    (SAMPLES / f"scores_{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def short(v):
    if isinstance(v, dict): return f"<dict:{len(v)}>"
    if isinstance(v, list): return f"<list:{len(v)}>"
    s = str(v)
    return s if len(s) <= 40 else s[:37] + "..."


def nonempty(data) -> bool:
    if data is None: return False
    if isinstance(data, (list, dict)) and len(data) == 0: return False
    return True


# Ergebnis-Sammlung: name -> {ok, path, note}
results = {}


def probe(name, attempts, note=""):
    """attempts = Liste von (label, path, params). Erster Treffer gewinnt."""
    for label, path, params in attempts:
        try:
            data = api(path, params=params) if params else api(path)
            if nonempty(data):
                save(name, {"_endpoint": path, "_params": params, "data": data})
                results[name] = {"ok": True, "path": path, "note": note, "sample": data}
                log(f"[OK]   {name:22} via {path}")
                return
            else:
                log(f"[leer] {name:22} {path} (leere Antwort)")
        except Exception as e:  # noqa: BLE001
            msg = str(e).split("\n")[0]
            log(f"[--]   {name:22} {path} → {msg[:70]}")
    results[name] = {"ok": False, "path": None, "note": note, "sample": None}


def main():
    login()
    dn = display_name()
    log(f"[OK] displayName: {dn}\n")

    # 1) Training Readiness — Tageswert
    probe("training_readiness", [
        ("date", f"/metrics-service/metrics/trainingreadiness/{d0}", None),
    ], "pro Tag (fetch je Datum)")

    # 2) Training Status — Tageswert (enthält oft VO2, Load-Balance, ACWR, recoveryTime)
    probe("training_status", [
        ("aggregated", f"/metrics-service/metrics/trainingstatus/aggregated/{d0}", None),
    ], "pro Tag (aggregiert)")

    # 3) Recovery / Erholungszeit — meist Teil von trainingstatus bzw. letzter Aktivität
    probe("recovery", [
        ("wellness", f"/wellness-service/wellness/recoveryTime/{d0}", None),
        ("trainingstatus", f"/metrics-service/metrics/trainingstatus/aggregated/{d0}", None),
    ], "vermutlich in trainingstatus/Aktivität (recoveryTime)")

    # 4) Endurance Score — Zeitreihe über Range
    probe("endurance_score", [
        ("range", "/metrics-service/metrics/endurancescore", {"startDate": d30, "endDate": d0, "aggregation": "weekly"}),
        ("daily", "/metrics-service/metrics/endurancescore", {"calendarDate": d0}),
    ], "Zeitreihe (startDate/endDate)")

    # 5) Hill Score — Zeitreihe über Range
    probe("hill_score", [
        ("range", "/metrics-service/metrics/hillscore", {"startDate": d30, "endDate": d0, "aggregation": "daily"}),
        ("daily", "/metrics-service/metrics/hillscore", {"calendarDate": d0}),
    ], "Zeitreihe (startDate/endDate)")

    # 6) Performance / Race Predictions — Snapshot (latest) + evtl. Reihe
    probe("race_predictions", [
        ("latest", f"/metrics-service/metrics/racepredictions/latest/{dn}", None),
        ("range", f"/metrics-service/metrics/racepredictions/{dn}", {"fromCalendarDate": d30, "toCalendarDate": d0}),
    ], "Snapshot (5k/10k/HM/M) bzw. Reihe")

    # 7) Körpertemperatur / Hauttemperatur — oft nur App
    probe("body_temperature", [
        ("dailyBodyTemp", f"/wellness-service/wellness/dailyBodyTemperature/{d0}", None),
        ("skinTemp", "/biometric-service/stats/skinTemp/daily", {"startDate": d7, "endDate": d0}),
    ], "wahrscheinlich nur App / nicht in API")

    # 8) Jetlag Adviser — praktisch nur App
    probe("jetlag_adviser", [
        ("jetlag", f"/jetlag-service/jetlag/{d0}", None),
    ], "erwartet: nicht verfügbar (App-only)")

    # 9) Sleep Coach / Sleep Need — teils im Schlaf-DTO (sleepNeed/nextSleepNeed)
    probe("sleep_coach", [
        ("sleepNeed", f"/wellness-service/wellness/dailySleepData/{dn}", {"date": d0, "nonSleepBufferMinutes": 60}),
    ], "Sleep Need ist Teil von dailySleepData")

    # Zusatz: Fitness Age & VO2 (maxmet) — nur mitgenommen, gehören zur selben Familie
    probe("fitness_age", [
        ("fitnessage", f"/fitnessage-service/fitnessage/{d0}", None),
    ], "pro Tag / Snapshot")
    probe("maxmet_vo2", [
        ("latest", f"/metrics-service/metrics/maxmet/latest/{dn}", None),
        ("daily", f"/metrics-service/metrics/maxmet/daily/{d30}/{d0}", None),
    ], "VO2max/Fitness")

    # ── Zusammenfassung ──
    log("\n" + "=" * 66)
    log("ZUSAMMENFASSUNG (verfügbar? · Top-Level-Felder · Notiz)")
    log("=" * 66)
    for name, r in results.items():
        if not r["ok"]:
            log(f"\n■ {name}: NEIN — {r['note']}")
            continue
        data = r["sample"]
        log(f"\n■ {name}: JA  ({r['path']})")
        log(f"    Notiz: {r['note']}")
        top = data[0] if isinstance(data, list) and data else data
        if isinstance(top, dict):
            for k in sorted(top)[:24]:
                log(f"    {k}: {short(top[k])}")
        elif isinstance(data, list):
            log(f"    (Liste mit {len(data)} Einträgen)")


if __name__ == "__main__":
    main()
