import { badRequest, json, type Env } from '../../../_utils'

// GET /api/garmin/activities/:id — inkl. activity_details.payload (Deep-Dive). Read-only.
export const onRequestGet: PagesFunction<Env, 'id'> = async ({ env, params }) => {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return badRequest('Ungültige id')

  const activity = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first()
  if (!activity) return badRequest('Aktivität nicht gefunden', 404)

  const det = await env.DB
    .prepare('SELECT payload FROM activity_details WHERE activity_id = ?')
    .bind(id)
    .first<{ payload: string | null }>()

  let details: unknown = null
  if (det?.payload) {
    try { details = JSON.parse(det.payload) } catch { details = det.payload }
  }
  return json({ ...activity, details })
}
