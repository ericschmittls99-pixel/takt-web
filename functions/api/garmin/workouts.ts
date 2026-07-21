import { json, type Env } from '../../_utils'

// GET /api/garmin/workouts — Leserichtung lt. PROJECT_OVERVIEW 6.x:
// alle time_entries auf Sport-Bereichen (employers.is_sport=1) LEFT JOIN activities für Metriken.
// Damit erscheint auch die bestehende Sport-Historie ohne verknüpfte Garmin-Aktivität.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT te.id AS entry_id, te.start_ts, te.end_ts, te.duration_min, te.employer_id, te.project_id, te.note, ' +
      'a.id AS activity_id, a.type, a.name, a.distance_m, a.avg_hr, a.max_hr, a.training_load, a.calories ' +
      'FROM time_entries te ' +
      'JOIN employers e ON e.id = te.employer_id AND e.is_sport = 1 ' +
      'LEFT JOIN activities a ON a.entry_id = te.id ' +
      'ORDER BY te.start_ts DESC',
  ).all()
  return json(results)
}
