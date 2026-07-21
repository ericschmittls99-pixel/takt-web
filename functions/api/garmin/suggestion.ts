import { badRequest, json, type Env } from '../../_utils'

// GET /api/garmin/suggestion?activity_id=  ->  { employer_id, project_id, source }
// source: 'history' (häufigste Kombi gleicher type unter assigned) | 'mapping'
// (Typ->Bereich aus app_settings.garmin_type_map) | 'none'.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const activityId = Number(url.searchParams.get('activity_id'))
  if (!Number.isInteger(activityId) || activityId <= 0) return badRequest('activity_id (number) erforderlich')

  const act = await env.DB.prepare('SELECT type FROM activities WHERE id = ?').bind(activityId).first<{ type: string | null }>()
  if (!act) return badRequest('Aktivität nicht gefunden', 404)

  // 1) Historie: häufigste (employer_id, project_id) früherer assigned-Aktivitäten gleichen Typs.
  if (act.type) {
    const hist = await env.DB
      .prepare(
        "SELECT employer_id, project_id, COUNT(*) AS c FROM activities " +
        "WHERE status = 'assigned' AND type = ? AND employer_id IS NOT NULL " +
        "GROUP BY employer_id, project_id ORDER BY c DESC LIMIT 1",
      )
      .bind(act.type)
      .first<{ employer_id: number; project_id: number | null }>()
    if (hist) return json({ employer_id: hist.employer_id, project_id: hist.project_id ?? null, source: 'history' })
  }

  // 2) Fallback: Typ->Bereich-Mapping aus app_settings (key 'garmin_type_map', JSON).
  if (act.type) {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'garmin_type_map'").first<{ value: string }>()
    if (row?.value) {
      try {
        const map = JSON.parse(row.value) as Record<string, { employer_id?: number; project_id?: number | null }>
        const m = map[act.type]
        if (m && typeof m.employer_id === 'number') {
          return json({ employer_id: m.employer_id, project_id: m.project_id ?? null, source: 'mapping' })
        }
      } catch { /* kaputtes JSON ignorieren */ }
    }
  }

  return json({ employer_id: null, project_id: null, source: 'none' })
}
