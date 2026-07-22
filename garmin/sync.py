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
import time
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


def write_sync_stamp(status: str) -> None:
    """Sync-Stand (ISO-Zeit + ok|partial) direkt in die lokale D1 schreiben —
    kein HTTP-Endpunkt, weil pages dev beim launchd-Lauf nicht läuft."""
    now = datetime.now().astimezone().replace(microsecond=0).isoformat()
    d1_exec_file(
        f"INSERT INTO app_settings (key, value) VALUES ('garmin_last_sync', {q(now)}) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value;\n"
        f"INSERT INTO app_settings (key, value) VALUES ('garmin_last_sync_status', {q(status)}) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value;")
    log(f"[OK] Sync-Stand: {now} ({status})")


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
               "total_reps", "total_sets",
               "avg_power", "max_power", "norm_power", "max_20min_power",
               "intensity_factor", "training_stress_score", "avg_lr_balance",
               "pedal_strokes", "work_kj", "power_zones"]


def map_activity(a: dict) -> tuple[str, dict]:
    gid = str(a.get("activityId"))
    # Work (kJ) ist KEIN Garmin-Feld -> abgeleitet: Ø-Power × Bewegungsdauer.
    avgp = g(a, "avgPower")
    mdur = g(a, "movingDuration") or g(a, "duration")
    work = round(avgp * mdur / 1000, 1) if (avgp is not None and mdur is not None) else None
    strokes = g(a, "strokes")
    strokes = int(round(strokes)) if strokes is not None else None
    pz = {f"z{i}": a.get(f"powerTimeInZone_{i}") for i in range(1, 8)}
    pz = {k: v for k, v in pz.items() if v is not None}
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
        # Power-Summary (nur Rad-mit-Powermeter füllt sie):
        "avg_power": avgp,
        "max_power": g(a, "maxPower"),
        "norm_power": g(a, "normPower"),
        "max_20min_power": g(a, "max20MinPower"),
        "intensity_factor": g(a, "intensityFactor"),
        "training_stress_score": g(a, "trainingStressScore"),
        "avg_lr_balance": g(a, "avgLeftBalance"),
        "pedal_strokes": strokes,
        "work_kj": work,
        "power_zones": json.dumps(pz, ensure_ascii=False, separators=(",", ":")) if pz else None,
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


SERIES_CAP = 200


def _downsample(rows: list) -> list:
    if len(rows) <= SERIES_CAP:
        return rows
    step = math.ceil(len(rows) / SERIES_CAP)
    return rows[::step]


def sample_series(detail: dict) -> tuple[dict, list | None]:
    """Überlagerbare Serien (hr/cadence/speed/elevation/power) + GPS aus den
    activityDetailMetrics, downgesampelt auf ~200 Punkte. Fehlende/leere Serien
    werden weggelassen (Lauf hat z. B. keine Power)."""
    md = detail.get("metricDescriptors") or []
    idx = {m.get("key"): m.get("metricsIndex") for m in md}
    rows = _downsample(detail.get("activityDetailMetrics") or [])

    def col(key):
        i = idx.get(key)
        if i is None:
            return None
        return [(r.get("metrics") or [None])[i] if i < len(r.get("metrics") or []) else None for r in rows]

    def cadence_col():
        for k in ("directBikeCadence", "directDoubleCadence", "directRunCadence"):
            c = col(k)
            if c and any(v is not None for v in c):
                return c
        return None

    series: dict = {}
    for name, c in (("hr", col("directHeartRate")), ("cadence", cadence_col()),
                    ("speed", col("directSpeed")), ("elevation", col("directElevation")),
                    ("power", col("directPower"))):
        if c and any(v is not None for v in c):
            series[name] = [round(v, 2) if isinstance(v, float) else v for v in c]

    la, lo = col("directLatitude"), col("directLongitude")
    gps = None
    if la and lo:
        pts = [[round(x, 6), round(y, 6)] for x, y in zip(la, lo) if x is not None and y is not None]
        gps = pts if len(pts) > 1 else None
    return series, gps


def _descr_index(descriptors, want_substr: str):
    for d in (descriptors or []):
        key = idx = None
        for k, v in d.items():
            lk = k.lower()
            if lk.endswith("key"):
                key = str(v).lower()
            elif lk.endswith("index"):
                idx = v
        if key and want_substr in key:
            return idx
    return None


def build_intraday_curve(values, descriptors, level_substr: str, cap: int = 180) -> list | None:
    """[{t,v}] aus einem Garmin-Intraday-Array (3-Min-Raster), downgesampelt auf ~cap Punkte.
    Negative Werte (Stress -1 = keine Messung) werden entfernt."""
    if not values:
        return None
    ti = _descr_index(descriptors, "timestamp")
    vi = _descr_index(descriptors, level_substr)
    if ti is None:
        ti = 0
    if vi is None:
        return None
    pts = []
    for row in values:
        if not isinstance(row, list) or vi >= len(row):
            continue
        v = row[vi]
        if v is None or (isinstance(v, (int, float)) and v < 0):
            continue
        t = row[ti] if ti < len(row) else None
        pts.append({"t": t, "v": v})
    if len(pts) <= 1:
        return None
    if len(pts) > cap:
        step = math.ceil(len(pts) / cap)
        pts = pts[::step]
    return pts


def map_dailystress(data: dict) -> tuple[list | None, list | None]:
    bb_desc = data.get("bodyBatteryValueDescriptorsDTOList") or data.get("bodyBatteryValueDescriptorDTOList")
    st_desc = data.get("stressValueDescriptorsDTOList") or data.get("stressValueDescriptorDTOList")
    bb = build_intraday_curve(data.get("bodyBatteryValuesArray"), bb_desc, "bodybatterylevel")
    st = build_intraday_curve(data.get("stressValuesArray"), st_desc, "stresslevel")
    return bb, st


def build_activity_detail_payload(a: dict, detail: dict | None) -> dict:
    hz = {f"z{i}": a.get(f"hrTimeInZone_{i}") for i in range(1, 6)}
    series, gps = sample_series(detail) if detail else ({}, None)
    payload = {
        "hr_curve": build_hr_curve(detail) if detail else [],
        "hr_zones_sec": {k: v for k, v in hz.items() if v is not None},
        "splits": a.get("splitSummaries"),
        "exercise_sets": convert_exercise_sets(a.get("summarizedExerciseSets")),
        "series": series,
        "gps": gps,
    }
    tmin, tmax = a.get("minTemperature"), a.get("maxTemperature")
    if tmin is not None or tmax is not None:
        payload["temp"] = {"min": tmin, "max": tmax}
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
        # Sleep Need (Sleep Coach) — im selben DTO.
        "sleep_need_baseline": (dto.get("sleepNeed") or {}).get("baseline"),
        "sleep_need_actual": (dto.get("sleepNeed") or {}).get("actual"),
        "sleep_need_feedback": (dto.get("sleepNeed") or {}).get("feedback"),
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
            # Gedrosselt + 429-tolerant (wie 365-Backfill); Serien/Power/GPS stecken hier.
            detail = api_retry(f"/activity-service/activity/{a['activityId']}/details",
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


def sync_intraday(days: int, stmts: list[str], summary: dict) -> None:
    """Body-Battery- + Stress-Tagesverlauf aus dailyStress/{date} (EIN Abruf/Tag, beide Arrays).
    Garmin hält Intraday nicht unbegrenzt vor -> leere/ältere Tage werden gezählt, nicht als Fehler."""
    have = existing_keys("garmin_intraday", "calendar_date")
    new = upd = empty = 0
    for d in dates_desc(days):
        try:
            data = api_retry(f"/wellness-service/wellness/dailyStress/{d}")
        except Exception:  # noqa: BLE001
            empty += 1
            continue
        bb, st = map_dailystress(data) if isinstance(data, dict) else (None, None)
        if not bb and not st:
            empty += 1
            continue
        row = {
            "body_battery_curve": qj(bb) if bb else "NULL",
            "stress_curve": qj(st) if st else "NULL",
        }
        # qj liefert bereits ein SQL-Literal -> direkt einsetzen statt über q().
        cols = ["calendar_date", "body_battery_curve", "stress_curve"]
        sets = "body_battery_curve=excluded.body_battery_curve, stress_curve=excluded.stress_curve"
        stmts.append(
            f"INSERT INTO garmin_intraday ({', '.join(cols)}) "
            f"VALUES ({q(d)}, {row['body_battery_curve']}, {row['stress_curve']}) "
            f"ON CONFLICT(calendar_date) DO UPDATE SET {sets};")
        if d in have:
            upd += 1
        else:
            new += 1
    summary["garmin_intraday"] = (new, upd)
    summary["_intraday_empty"] = empty
    if empty:
        warn(f"Intraday: {empty} Tage ohne Kurvendaten (Garmin hält Intraday nicht unbegrenzt vor).")


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


_score_fails: dict = {}
SCORE_THROTTLE = 0.15  # kurze Pause vor jedem Score-Call (schont den Server)
SCORE_FIELDS = [
    "training_readiness_score", "tr_level", "tr_recovery_time", "tr_acute_load", "tr_acwr_percent",
    "training_status_code", "ts_weekly_load", "ts_load_balance",
    "endurance_score", "hill_score", "hill_strength", "hill_endurance",
    "vo2max", "fitness_age", "fitness_age_chronological",
    "race_5k_sec", "race_10k_sec", "race_hm_sec", "race_m_sec",
]


def api_retry(path: str, **kw):
    """Gedrosselter, 429-toleranter Call: bei Rate-Limit warten und weiter (nicht abbrechen).
    Andere Fehler werden geworfen (vom Aufrufer behandelt)."""
    for attempt in range(6):
        try:
            time.sleep(SCORE_THROTTLE)
            return api(path, **kw)
        except Exception as e:  # noqa: BLE001
            if ("429" in str(e) or "Too Many Requests" in str(e)) and attempt < 5:
                wait = 20 * (attempt + 1)
                warn(f"429 (Rate-Limit) — warte {wait}s und weiter (Versuch {attempt + 1}/5)")
                time.sleep(wait)
                continue
            raise


def safe_api(label: str, path: str, **kw):
    """Wie api_retry(), faengt aber Nicht-429-Fehler ab (zaehlt sie) und gibt None zurueck —
    fuer Score-Endpunkte, die an einzelnen Tagen fehlen duerfen."""
    try:
        return api_retry(path, **kw)
    except Exception:  # noqa: BLE001
        _score_fails[label] = _score_fails.get(label, 0) + 1
        return None


def _first_val(m):
    if isinstance(m, dict):
        for v in m.values():
            return v
    return None


def sync_scores(dn: str, days: int, stmts: list[str], summary: dict) -> None:
    dates = dates_desc(days)
    start, end = dates[-1], dates[0]

    # Range-Quellen (je ein Call, liefern Listen).
    # VO2max: maxmet liefert nur Messtage -> letzten Wert fortschreiben (lückenlos, auch an
    # Nicht-Trainingstagen). Wider-Range als Seed, damit auch Tage vor der ersten Messung im
    # Fenster einen Wert bekommen.
    vo2_measured: list = []
    start_wide = (date.today() - timedelta(days=days + 120)).isoformat()
    try:
        for e in (api_retry(f"/metrics-service/metrics/maxmet/daily/{start_wide}/{end}") or []):
            gen = (e or {}).get("generic") or {}
            if gen.get("calendarDate") and gen.get("vo2MaxValue") is not None:
                vo2_measured.append((str(gen["calendarDate"])[:10], gen.get("vo2MaxValue")))
    except Exception as e:  # noqa: BLE001
        warn(f"VO2max (maxmet/daily) nicht abrufbar: {e}")
    vo2_measured.sort()

    def vo2_for(day: str):
        last = None
        for cd, v in vo2_measured:
            if cd <= day:
                last = v
            else:
                break
        return last
    race_map: dict = {}
    try:
        for e in (api_retry(f"/metrics-service/metrics/racepredictions/daily/{dn}", params={"fromCalendarDate": start, "toCalendarDate": end}) or []):
            if (e or {}).get("calendarDate"):
                race_map[str(e["calendarDate"])[:10]] = e
    except Exception as e:  # noqa: BLE001
        warn(f"Race Predictions (Range) nicht abrufbar: {e}")

    have = existing_keys("garmin_scores", "calendar_date")
    new = upd = 0
    for d in dates:
        tr = safe_api("trainingreadiness", f"/metrics-service/metrics/trainingreadiness/{d}")
        tr = (tr[0] if isinstance(tr, list) and tr else tr) or {}
        ts = safe_api("trainingstatus", f"/metrics-service/metrics/trainingstatus/aggregated/{d}") or {}
        mrts = _first_val((ts.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData")) or {}
        lb = _first_val((ts.get("mostRecentTrainingLoadBalance") or {}).get("metricsTrainingLoadBalanceDTOMap"))
        es = safe_api("endurancescore", "/metrics-service/metrics/endurancescore", params={"calendarDate": d}) or {}
        hs = safe_api("hillscore", "/metrics-service/metrics/hillscore", params={"calendarDate": d}) or {}
        fa = safe_api("fitnessage", f"/fitnessage-service/fitnessage/{d}") or {}
        race = race_map.get(d, {})
        row = {
            "training_readiness_score": tr.get("score"),
            "tr_level": tr.get("level"),
            "tr_recovery_time": tr.get("recoveryTime"),
            "tr_acute_load": tr.get("acuteLoad"),
            "tr_acwr_percent": tr.get("acwrFactorPercent"),
            "training_status_code": mrts.get("trainingStatus"),
            "ts_weekly_load": mrts.get("weeklyTrainingLoad"),
            "ts_load_balance": json.dumps(lb, ensure_ascii=False, separators=(",", ":")) if lb else None,
            "endurance_score": es.get("overallScore"),
            "hill_score": hs.get("overallScore"),
            "hill_strength": hs.get("strengthScore"),
            "hill_endurance": hs.get("enduranceScore"),
            "vo2max": vo2_for(d),
            "fitness_age": fa.get("fitnessAge"),
            "fitness_age_chronological": fa.get("chronologicalAge"),
            "race_5k_sec": race.get("time5K"),
            "race_10k_sec": race.get("time10K"),
            "race_hm_sec": race.get("timeHalfMarathon"),
            "race_m_sec": race.get("timeMarathon"),
        }
        if all(v is None for v in row.values()):
            continue
        cols = ["calendar_date"] + list(row.keys())
        vals = [d] + list(row.values())
        stmts.append(upsert("garmin_scores", cols, vals, "calendar_date", list(row.keys())))
        if d in have:
            upd += 1
        else:
            new += 1
    summary["garmin_scores"] = (new, upd)
    if _score_fails:
        warn("Score-Endpunkt-Ausfälle (einzelne Tage ok): " + ", ".join(f"{k}={v}" for k, v in _score_fails.items()))


# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--only", default="", help="Kommagetrennt nur diese Kategorien (activities,daily,sleep,health,scores)")
    args = ap.parse_args()
    only = {x.strip() for x in args.only.split(",") if x.strip()}
    want = lambda n: (not only) or (n in only)  # noqa: E731

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

    if want("activities"): cat("activities", lambda: sync_activities(args.days, stmts, summary))
    if want("daily"): cat("daily", lambda: sync_daily(dn, args.days, stmts, summary))
    if want("sleep"): cat("sleep", lambda: sync_sleep(dn, args.days, stmts, summary))
    if want("intraday"): cat("intraday", lambda: sync_intraday(args.days, stmts, summary))
    if want("health"): cat("health", lambda: sync_health(dn, args.days, acts_recent, stmts, summary))
    if want("scores"): cat("scores", lambda: sync_scores(dn, args.days, stmts, summary))

    if stmts:
        try:
            d1_exec_file("\n".join(stmts))
        except Exception as e:  # noqa: BLE001
            err(f"Schreiben in lokale D1 fehlgeschlagen: {e}")
            return 1

    log("\n== Zusammenfassung (neu / aktualisiert) ==")
    for t in ["activities", "garmin_daily", "garmin_sleep", "garmin_intraday", "garmin_health", "garmin_scores"]:
        n, u = summary.get(t, (0, 0))
        log(f"  {t:16} {n} neu / {u} aktualisiert")

    # Coverage: wie viele Tage haben tatsächlich Daten je Score-Feld (gesamte Tabelle).
    try:
        sel = "SELECT COUNT(*) AS zeilen, " + ", ".join(f"COUNT({c}) AS {c}" for c in SCORE_FIELDS) + " FROM garmin_scores"
        cov = d1_query(sel)
        if cov:
            row = cov[0]
            log(f"\n== garmin_scores Coverage (Tage mit Daten je Feld · gesamt {row.get('zeilen')}) ==")
            for c in SCORE_FIELDS:
                log(f"  {c:28} {row.get(c)}")
    except Exception as e:  # noqa: BLE001
        warn(f"Coverage-Report nicht möglich: {e}")

    # Coverage Aktivitäts-Detailausbau (Serien / Power / GPS).
    if want("activities"):
        try:
            cov = d1_query(
                "SELECT "
                "(SELECT COUNT(*) FROM activities) AS total, "
                "(SELECT COUNT(*) FROM activities WHERE avg_power IS NOT NULL) AS mit_power, "
                "(SELECT COUNT(*) FROM activity_details WHERE json_extract(payload,'$.gps') IS NOT NULL) AS mit_gps, "
                "(SELECT COUNT(*) FROM activity_details WHERE json_extract(payload,'$.series.cadence') IS NOT NULL) AS mit_cadence, "
                "(SELECT COUNT(*) FROM activity_details WHERE json_extract(payload,'$.series.speed') IS NOT NULL) AS mit_pace, "
                "(SELECT COUNT(*) FROM activity_details WHERE json_extract(payload,'$.series.elevation') IS NOT NULL) AS mit_elevation")
            if cov:
                r = cov[0]
                log(f"\n== Aktivitäts-Detail-Coverage (gesamt {r.get('total')}) ==")
                for k in ["mit_power", "mit_gps", "mit_cadence", "mit_pace", "mit_elevation"]:
                    log(f"  {k:14} {r.get(k)}")
        except Exception as e:  # noqa: BLE001
            warn(f"Aktivitäts-Coverage nicht möglich: {e}")

    # Coverage Intraday (Body Battery + Stress Tagesverlauf).
    if want("intraday"):
        try:
            cov = d1_query(
                "SELECT COUNT(*) AS total, "
                "SUM(CASE WHEN body_battery_curve IS NOT NULL THEN 1 ELSE 0 END) AS mit_bb, "
                "SUM(CASE WHEN stress_curve IS NOT NULL THEN 1 ELSE 0 END) AS mit_stress "
                "FROM garmin_intraday")
            if cov:
                r = cov[0]
                leer = summary.get("_intraday_empty", 0)
                log(f"\n== Intraday-Coverage (Tage gesamt {r.get('total')}) ==")
                log(f"  mit BB-Kurve      {r.get('mit_bb')}")
                log(f"  mit Stress-Kurve  {r.get('mit_stress')}")
                log(f"  ohne Kurvendaten  {leer}  (ältere/ohne Intraday bei Garmin)")
        except Exception as e:  # noqa: BLE001
            warn(f"Intraday-Coverage nicht möglich: {e}")

    # Sync-Stand setzen — auch bei Teilfehlern (Status partial), damit die App den Stand zeigt.
    try:
        write_sync_stamp("partial" if _failures else "ok")
    except Exception as e:  # noqa: BLE001
        warn(f"Sync-Stand konnte nicht geschrieben werden: {e}")

    if _failures:
        err(f"Abgeschlossen mit Fehlern in: {', '.join(_failures)}")
        return 1
    log("\n[OK] Sync erfolgreich.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
