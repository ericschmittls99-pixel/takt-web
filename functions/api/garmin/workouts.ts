import { json, type Env } from '../../_utils'

// GET /api/garmin/workouts — zwei Quellen, chronologisch gemischt:
//  (a) origin='entry':  time_entries auf Sport-Bereichen (is_sport=1) LEFT JOIN activities
//      = zugeordnete/manuelle Workouts ab Stichtag, mit Bereichszuordnung (Zeit-Kopplung).
//  (b) origin='history': activities mit status='history' (Backfill VOR Stichtag) direkt,
//      ohne time_entry/Bereich — nur Puls, nie Saldo. Siehe PROJECT_OVERVIEW (WP4a-2).
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    "SELECT 'entry' AS origin, te.id AS entry_id, te.start_ts, te.end_ts, te.duration_min, " +
      'te.employer_id, te.project_id, te.note, a.id AS activity_id, ' +
      'a.type, a.name, a.distance_m, a.avg_hr, a.max_hr, a.training_load, a.calories ' +
      'FROM time_entries te ' +
      'JOIN employers e ON e.id = te.employer_id AND e.is_sport = 1 ' +
      'LEFT JOIN activities a ON a.entry_id = te.id ' +
      'UNION ALL ' +
      "SELECT 'history' AS origin, NULL AS entry_id, ah.start_ts, NULL AS end_ts, " +
      'CAST(ROUND(ah.duration_sec / 60.0) AS INTEGER) AS duration_min, ' +
      'NULL AS employer_id, NULL AS project_id, ah.note, ah.id AS activity_id, ' +
      'ah.type, ah.name, ah.distance_m, ah.avg_hr, ah.max_hr, ah.training_load, ah.calories ' +
      'FROM activities ah WHERE ah.status = ' + "'history' " +
      'ORDER BY start_ts DESC',
  ).all()
  return json(results)
}
