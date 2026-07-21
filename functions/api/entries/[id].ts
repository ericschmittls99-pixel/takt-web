import { badRequest, json, type Env } from '../../_utils'

interface PatchEntryBody {
  start_ts?: unknown
  end_ts?: unknown
  employer_id?: unknown
  project_id?: unknown
  note?: unknown
}

function parseId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({
  request,
  env,
  params,
}) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')

  const current = await env.DB.prepare(
    'SELECT id, start_ts FROM time_entries WHERE id = ?',
  )
    .bind(id)
    .first<{ id: number; start_ts: string }>()
  if (!current) return badRequest('Eintrag nicht gefunden', 404)

  const body = (await request.json()) as PatchEntryBody
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (typeof body.start_ts === 'string') {
    fields.push('start_ts = ?')
    values.push(body.start_ts)
  }
  if (typeof body.employer_id === 'number') {
    fields.push('employer_id = ?')
    values.push(body.employer_id)
  }
  if (body.project_id === null || typeof body.project_id === 'number') {
    fields.push('project_id = ?')
    values.push(body.project_id)
  }
  if (body.note === null || typeof body.note === 'string') {
    fields.push('note = ?')
    values.push(body.note)
  }

  if (typeof body.end_ts === 'string') {
    const startTs =
      typeof body.start_ts === 'string' ? body.start_ts : current.start_ts
    const startMs = Date.parse(startTs)
    const endMs = Date.parse(body.end_ts)
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return badRequest('start_ts oder end_ts nicht als ISO 8601 lesbar')
    }
    fields.push('end_ts = ?', 'duration_min = ?')
    values.push(body.end_ts, Math.round((endMs - startMs) / 60000))
  } else if (body.end_ts === null) {
    fields.push('end_ts = ?', 'duration_min = ?')
    values.push(null, null)
  }

  if (fields.length === 0) return badRequest('Keine Felder zum Aktualisieren')

  values.push(id)
  const updated = await env.DB.prepare(
    `UPDATE time_entries SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  )
    .bind(...values)
    .first()

  return json(updated)
}

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({
  env,
  params,
}) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')

  // Konsistenzregeln (PROJECT_OVERVIEW 6.2): verknüpfte Aktivität behandeln.
  const act = await env.DB
    .prepare('SELECT id, source FROM activities WHERE entry_id = ?')
    .bind(id)
    .first<{ id: number; source: string }>()

  const stmts = []
  if (act) {
    if (act.source === 'manual') {
      // Manuelle Aktivität existiert nur über diesen Eintrag -> mitlöschen.
      stmts.push(env.DB.prepare('DELETE FROM activity_details WHERE activity_id = ?').bind(act.id))
      stmts.push(env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(act.id))
    } else {
      // Garmin-Aktivität bleibt erhalten -> trennen, zurück in die Inbox.
      stmts.push(env.DB.prepare("UPDATE activities SET entry_id = NULL, status = 'inbox' WHERE id = ?").bind(act.id))
    }
  }
  stmts.push(env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(id))

  const results = await env.DB.batch(stmts)
  const del = results[results.length - 1]
  if (!del.meta.changes) return badRequest('Eintrag nicht gefunden', 404)
  return new Response(null, { status: 204 })
}
