#!/usr/bin/env python3
"""Garmin -> lokale D1 Sync (WP1).

Liest die vier Kategorien (Aktivitäten inkl. Detail, Tageswerte, Schlaf, Health) für die
letzten N Tage und schreibt sie IDEMPOTENT in die LOKALE D1 (wrangler d1 execute, ohne
--remote). Feld-Mapping exakt nach docs/PROJECT_OVERVIEW.md Abschnitt 6.4.

Idempotenz:
  - Natürliche Schlüssel: activities.garmin_activity_id, *_daily/_sleep/_health.calendar_date.
  - Bei bestehender activities-Zeile werden NUR Messfelder aktualisiert. status, employer_id,
    project_id, note, entry_id werden NIE angefasst (Zuordnung = WP2).

Login: garth==0.6.3, Token-Cache garmin/.garth (aus WP0). Erstlogin braucht ein echtes
Terminal (MFA); danach non-interaktiv via garth.resume().

Fehler => Exit-Code != 0 + klare Logzeile. Am Ende: Zusammenfassung neu/aktualisiert je Tabelle.

Aufruf:  garmin/venv/bin/python garmin/sync.py --days 14
"""

from __future__ import annotations

import argparse
import getpass
import json
import math
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    import garth
except ImportError:
    print("[FEHLER] 'garth' fehlt. venv nutzen: garmin/venv/bin/pip install 'garth==0.6.3'", file=sys.stderr)
    sys.exit(1)

BASE = Path(__file__).resolve().parent
ROOT = BASE.parent
TOKEN_DIR = BASE / ".garth"
DB_NAME = "takt-web"

_failures: list[str] = []


def log(m: str) -> None: print(m, flush=True)
def warn(m: str) -> None: print(f"[WARN] {m}", file=sys.stderr, flush=True)
def err(m: str) -> None: print(f"[FEHLER] {m}", file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# garth Login (wie WP0)
# --------------------------------------------------------------------------- #
def login() -> None:
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    try:
        garth.resume(str(TOKEN_DIR))
        _ = garth.client.username
        log(f"[OK] Garmin-Sitzung wiederverwendet (Token: {TOKEN_DIR}).")
        return
    except Exception:
        log("[INFO] Kein gueltiger Token-Cache — Login noetig.")
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not (email and password) and not sys.stdin.isatty():
        err("Login noetig, aber kein TTY. Bitte einmalig in Terminal.app: "
            "garmin/venv/bin/python garmin/sync.py")
        sys.exit(2)
    if not email:
        email = input("Garmin E-Mail: ").strip()
    if not password:
        password = getpass.getpass("Garmin Passwort: ")
    try:
        garth.login(email, password, prompt_mfa=lambda: input("MFA-Code: ").strip())
    except Exception as e:  # noqa: BLE001
        err(f"Login fehlgeschlagen: {e}")
        sys.exit(2)
    garth.save(str(TOKEN_DIR))
    log("[OK] Login erfolgreich, Token gespeichert.")


def api(path: str, **kwargs):
    return garth.connectapi(path, **kwargs)


def display_name() -> str:
    prof = api("/userprofile-service/socialProfile")
    dn = prof.get("displayName") or prof.get("userName")
    if not dn:
        raise RuntimeError("Kein displayName im socialProfile")
    return dn


def dates_desc(days: int) -> list[str]:
    today = date.today()
    return [(today - timedelta(days=i)).isoformat() for i in range(days)]


def list_limit(days: int) -> int:
    """Aktivitätsliste-Limit passend zum Zeitraum (die API liefert most-recent-first)."""
    return min(1000, max(100, days * 2))


# --------------------------------------------------------------------------- #
# SQL-Helfer
# --------------------------------------------------------------------------- #
def q(v) -> str:
    """SQL-Literal: None->NULL, Zahl->Zahl (NaN/Inf->NULL), sonst gequotet."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            return "NULL"
        return repr(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def qj(obj) -> str:
    return q(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def upsert(table: str, cols: list[str], vals: list, conflict: str, update_cols: list[str]) -> str:
    placeholders = ", ".join(q(v) for v in vals)
    sets = ", ".join(f"{c}=excluded.{c}" for c in update_cols)
    return (f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT({conflict}) DO UPDATE SET {sets};")


def run_wrangler(args: list[str]) -> str:
    p = subprocess.run(["npx", "wrangler", "d1", "execute", DB_NAME, "--local", *args],
                       cwd=str(ROOT), capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"wrangler d1 execute fehlgeschlagen:\n{p.stderr.strip()}")
    return p.stdout


def d1_query(sql: str) -> list[dict]:
    out = run_wrangler(["--json", "--command", sql])
    data = json.loads(out)
    return data[0].get("results", []) if data else []


def d1_exec_file(sql_text: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, dir=str(BASE)) as f:
        f.write(sql_text)
        path = f.name
    try:
        run_wrangler(["--file", path])
    finally:
        os.unlink(path)


def existing_keys(table: str, col: str) -> set:
    rows = d1_query(f"SELECT {col} AS k FROM {table} WHERE {col} IS NOT NULL")
    return {r["k"] for r in rows}


# --------------------------------------------------------------------------- #
# Feld-Mapping (6.4)
# --------------------------------------------------------------------------- #
def g(d: dict, *keys):
    for k in keys:
        if isinstance(d, dict) and k in d and d[k] is not None:
            return d[k]
    return None


ACT_MEASURE = ["start_ts", "type", "name", "duration_sec", "distance_m", "calories",
               "avg_hr", "max_hr", "elevation_gain_m", "training_load", "aerobic_te",
               "anaerobic_te", "moderate_min", "vigorous_min", "vo2max",
               "total_reps", "total_sets"]


def map_activity(a: dict) -> tuple[str, dict]:
    gid = str(a.get("activityId"))
    row = {
        "start_ts": g(a, "startTimeLocal"),
        "type": (a.get("activityType") or {}).get("typeKey"),
        "name": g(a, "activityName"),
        "duration_sec": g(a, "duration"),
        "distance_m": g(a, "distance"),
        "calories": g(a, "calories"),
        "avg_hr": g(a, "averageHR"),
        "max_hr": g(a, "maxHR"),
        "elevation_gain_m": g(a, "elevationGain"),
        "training_load": g(a, "activityTrainingLoad"),
        "aerobic_te": g(a, "aerobicTrainingEffect"),
        "anaerobic_te": g(a, "anaerobicTrainingEffect"),
        "moderate_min": g(a, "moderateIntensityMinutes"),
        "vigorous_min": g(a, "vigorousIntensityMinutes"),
        "vo2max": g(a, "vO2MaxValue"),
        "total_reps": g(a, "totalReps"),
        "total_sets": g(a, "totalSets"),
    }
    return gid, row


def build_hr_curve(detail: dict) -> list[dict]:
    md = detail.get("metricDescriptors") or []
    idx = {m.get("key"): m.get("metricsIndex") for m in md}
    hi, ti = idx.get("directHeartRate"), idx.get("directTimestamp")
    di = idx.get("sumDuration") if ti is None else None
    pts = []
    for p in (detail.get("activityDetailMetrics") or []):
        vals = p.get("metrics") or []
        hr = vals[hi] if hi is not None and hi < len(vals) else None
        if hr is None:
            continue
        t = None
        if ti is not None and ti < len(vals):
            t = vals[ti]
        elif di is not None and di < len(vals):
            t = vals[di]
        pts.append({"t": t, "v": hr})
    return pts


def convert_exercise_sets(sets):
    """Garmin liefert maxWeight in Gramm -> in kg umrechnen (konsistent mit manueller Eingabe)."""
    if not isinstance(sets, list):
        return sets
    out = []
    for s in sets:
        if isinstance(s, dict):
            s = dict(s)
            mw = s.get("maxWeight")
            if isinstance(mw, (int, float)) and mw:
                s["maxWeight"] = round(mw / 1000, 2)
        out.append(s)
    return out


def build_activity_detail_payload(a: dict, detail: dict | None) -> dict:
    hz = {f"z{i}": a.get(f"hrTimeInZone_{i}") for i in range(1, 6)}
    payload = {
        "hr_curve": build_hr_curve(detail) if detail else [],
        "hr_zones_sec": {k: v for k, v in hz.items() if v is not None},
        "splits": a.get("splitSummaries"),
        "exercise_sets": convert_exercise_sets(a.get("summarizedExerciseSets")),
    }
    return payload


def map_daily(d: dict) -> dict:
    return {
        "steps": g(d, "totalSteps"),
        "step_goal": g(d, "dailyStepGoal"),
        "resting_hr": g(d, "restingHeartRate"),
        "resting_hr_7d_avg": g(d, "lastSevenDaysAvgRestingHeartRate"),
        "min_hr": g(d, "minHeartRate"),
        "max_hr": g(d, "maxHeartRate"),
        "calories_total": g(d, "totalKilocalories"),
        "calories_active": g(d, "activeKilocalories"),
        "calories_bmr": g(d, "bmrKilocalories"),
        "intensity_moderate_min": g(d, "moderateIntensityMinutes"),
        "intensity_vigorous_min": g(d, "vigorousIntensityMinutes"),
        "stress_avg": g(d, "averageStressLevel"),
        "stress_max": g(d, "maxStressLevel"),
        "bb_high": g(d, "bodyBatteryHighestValue"),
        "bb_low": g(d, "bodyBatteryLowestValue"),
        "bb_wake": g(d, "bodyBatteryAtWakeTime"),
        "bb_charged": g(d, "bodyBatteryChargedValue"),
        "bb_drained": g(d, "bodyBatteryDrainedValue"),
        "spo2_avg": g(d, "averageSpo2"),
        "respiration_waking_avg": g(d, "avgWakingRespirationValue"),
        "floors_ascended": g(d, "floorsAscended"),
        "sleeping_sec": g(d, "sleepingSeconds"),
    }


def _epoch_ms(t) -> int | None:
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return int(t)
    try:
        return int(datetime.strptime(str(t)[:19], "%Y-%m-%dT%H:%M:%S").timestamp() * 1000)
    except Exception:
        return None


def downsample(arr, tkey, vkey, minutes=15) -> list[dict]:
    b = defaultdict(list)
    for e in (arr or []):
        t = _epoch_ms(e.get(tkey))
        v = e.get(vkey)
        if t is None or v is None:
            continue
        b[t // (minutes * 60000)].append(v)
    return [{"t": k * minutes * 60000, "v": round(sum(x) / len(x), 2)} for k, x in sorted(b.items())]


def map_sleep(sd: dict) -> tuple[str, dict, dict] | None:
    dto = sd.get("dailySleepDTO") if isinstance(sd, dict) else None
    if not isinstance(dto, dict) or dto.get("calendarDate") is None:
        return None
    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall") or {}
    row = {
        "total_sec": g(dto, "sleepTimeSeconds"),
        "deep_sec": g(dto, "deepSleepSeconds"),
        "light_sec": g(dto, "lightSleepSeconds"),
        "rem_sec": g(dto, "remSleepSeconds"),
        "awake_sec": g(dto, "awakeSleepSeconds"),
        "score": overall.get("value"),
        "score_qualifier": overall.get("qualifierKey"),
        "avg_stress": g(dto, "avgSleepStress"),
        "avg_hr": g(dto, "avgHeartRate"),
        "avg_respiration": g(dto, "averageRespirationValue"),
        "avg_spo2": g(dto, "averageSpO2Value"),
        "hrv_overnight_avg": g(sd, "avgOvernightHrv"),
        "hrv_status": g(sd, "hrvStatus"),
        "body_battery_change": g(sd, "bodyBatteryChange"),
        "resting_hr": g(sd, "restingHeartRate"),
        "restless_moments": g(sd, "restlessMomentsCount"),
    }
    curves = {
        "hr": downsample(sd.get("sleepHeartRate"), "startGMT", "value"),
        "stress": downsample(sd.get("sleepStress"), "startGMT", "value"),
        "body_battery": downsample(sd.get("sleepBodyBattery"), "startGMT", "value"),
        "movement": downsample(sd.get("sleepMovement"), "startGMT", "activityLevel"),
        "levels": sd.get("sleepLevels") or [],
    }
    return dto["calendarDate"], row, curves


# --------------------------------------------------------------------------- #
# Sync-Kategorien
# --------------------------------------------------------------------------- #
def sync_activities(days: int, stmts: list[str], summary: dict) -> None:
    acts = api("/activitylist-service/activities/search/activities", params={"start": 0, "limit": list_limit(days)})
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    recent = [a for a in acts if str(a.get("startTimeLocal", ""))[:10] >= cutoff]
    have = existing_keys("activities", "garmin_activity_id")
    new = upd = 0
    for a in recent:
        gid, row = map_activity(a)
        cols = ["source", "garmin_activity_id"] + list(row.keys())
        vals = ["garmin", gid] + list(row.values())
        stmts.append(upsert("activities", cols, vals, "garmin_activity_id", ACT_MEASURE))
        # Detail-Payload (HF-Kurve etc.) – Fehler pro Aktivität nur warnen.
        detail = None
        try:
            detail = api(f"/activity-service/activity/{a['activityId']}/details",
                         params={"maxChartSize": 200, "maxPolylineSize": 0})
        except Exception as e:  # noqa: BLE001
            warn(f"Detail für Aktivität {gid} fehlgeschlagen: {e}")
        payload = build_activity_detail_payload(a, detail)
        stmts.append(
            f"INSERT INTO activity_details (activity_id, payload) "
            f"SELECT id, {qj(payload)} FROM activities WHERE garmin_activity_id={q(gid)} "
            f"ON CONFLICT(activity_id) DO UPDATE SET payload=excluded.payload "
            f"WHERE activity_details.edited = 0;")
        if gid in have:
            upd += 1
        else:
            new += 1
    summary["activities"] = (new, upd)


def sync_daily(dn: str, days: int, stmts: list[str], summary: dict) -> None:
    have = existing_keys("garmin_daily", "calendar_date")
    new = upd = 0
    for d in dates_desc(days):
        data = api(f"/usersummary-service/usersummary/daily/{dn}", params={"calendarDate": d})
        row = map_daily(data)
        cols = ["calendar_date"] + list(row.keys())
        vals = [d] + list(row.values())
        stmts.append(upsert("garmin_daily", cols, vals, "calendar_date", list(row.keys())))
        if d in have: upd += 1
        else: new += 1
    summary["garmin_daily"] = (new, upd)


def sync_sleep(dn: str, days: int, stmts: list[str], summary: dict) -> None:
    have = existing_keys("garmin_sleep", "calendar_date")
    new = upd = 0
    for d in dates_desc(days):
        data = api(f"/wellness-service/wellness/dailySleepData/{dn}",
                   params={"date": d, "nonSleepBufferMinutes": 60})
        mapped = map_sleep(data)
        if mapped is None:
            continue
        cal, row, curves = mapped
        row["curves"] = json.dumps(curves, ensure_ascii=False, separators=(",", ":"))
        cols = ["calendar_date"] + list(row.keys())
        vals = [cal] + list(row.values())
        stmts.append(upsert("garmin_sleep", cols, vals, "calendar_date", list(row.keys())))
        if cal in have: upd += 1
        else: new += 1
    summary["garmin_sleep"] = (new, upd)


def sync_health(dn: str, days: int, activities: list[dict], stmts: list[str], summary: dict) -> None:
    # VO2max aus Aktivitäten fortschreiben; Gewicht aus weight-service (aktuell leer).
    vo2_by_date = {}
    for a in activities:
        v = a.get("vO2MaxValue")
        d = str(a.get("startTimeLocal", ""))[:10]
        if v is not None and d:
            vo2_by_date[d] = v
    start = (date.today() - timedelta(days=days)).isoformat()
    today = date.today().isoformat()
    weight_map = {}
    try:
        w = api("/weight-service/weight/dateRange", params={"startDate": start, "endDate": today})
        for e in (w.get("dateWeightList") or []):
            wd = str(g(e, "calendarDate", "date") or "")[:10]
            if wd:
                weight_map[wd] = {"weight_g": g(e, "weight"), "bmi": g(e, "bmi"), "body_fat": g(e, "bodyFat")}
    except Exception as e:  # noqa: BLE001
        warn(f"Gewichtsdaten nicht abrufbar (ok, oft leer): {e}")

    have = existing_keys("garmin_health", "calendar_date")
    new = upd = 0
    last_vo2 = None
    for d in reversed(dates_desc(days)):  # chronologisch für Fortschreibung
        if d in vo2_by_date:
            last_vo2 = vo2_by_date[d]
        wm = weight_map.get(d, {})
        row = {"vo2max": last_vo2, "weight_g": wm.get("weight_g"),
               "bmi": wm.get("bmi"), "body_fat": wm.get("body_fat")}
        cols = ["calendar_date"] + list(row.keys())
        vals = [d] + list(row.values())
        stmts.append(upsert("garmin_health", cols, vals, "calendar_date", list(row.keys())))
        if d in have: upd += 1
        else: new += 1
    summary["garmin_health"] = (new, upd)


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    args = ap.parse_args()

    log(f"Garmin -> lokale D1 · letzte {args.days} Tage")
    login()
    try:
        dn = display_name()
        log(f"[OK] displayName: {dn}")
    except Exception as e:  # noqa: BLE001
        err(f"Profil nicht abrufbar: {e}")
        return 3

    # Aktivitäten einmal laden (für activities + health-VO2max).
    try:
        acts_all = api("/activitylist-service/activities/search/activities",
                       params={"start": 0, "limit": list_limit(args.days)})
        cutoff = (date.today() - timedelta(days=args.days)).isoformat()
        acts_recent = [a for a in acts_all if str(a.get("startTimeLocal", ""))[:10] >= cutoff]
    except Exception as e:  # noqa: BLE001
        err(f"Aktivitätsliste nicht abrufbar: {e}")
        return 3

    stmts: list[str] = []
    summary: dict = {}

    def cat(name: str, fn):
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            err(f"Kategorie '{name}' fehlgeschlagen: {e}")
            _failures.append(name)

    cat("activities", lambda: sync_activities(args.days, stmts, summary))
    cat("daily", lambda: sync_daily(dn, args.days, stmts, summary))
    cat("sleep", lambda: sync_sleep(dn, args.days, stmts, summary))
    cat("health", lambda: sync_health(dn, args.days, acts_recent, stmts, summary))

    if stmts:
        try:
            d1_exec_file("\n".join(stmts))
        except Exception as e:  # noqa: BLE001
            err(f"Schreiben in lokale D1 fehlgeschlagen: {e}")
            return 1

    log("\n== Zusammenfassung (neu / aktualisiert) ==")
    for t in ["activities", "garmin_daily", "garmin_sleep", "garmin_health"]:
        n, u = summary.get(t, (0, 0))
        log(f"  {t:14} {n} neu / {u} aktualisiert")

    if _failures:
        err(f"Abgeschlossen mit Fehlern in: {', '.join(_failures)}")
        return 1
    log("\n[OK] Sync erfolgreich.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
