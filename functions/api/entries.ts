import { badRequest, json, type Env } from '../_utils'

interface CreateEntryBody {
  start_ts?: unknown
  employer_id?: unknown
  project_id?: unknown
  note?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, employer_id, project_id, start_ts, end_ts, duration_min, note, created_at FROM time_entries ORDER BY start_ts DESC',
  ).all()
  return json(results)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as CreateEntryBody

  if (typeof body.start_ts !== 'string' || body.start_ts.length === 0) {
    return badRequest('start_ts (ISO 8601) ist Pflicht')
  }
  if (typeof body.employer_id !== 'number') {
    return badRequest('employer_id (number) ist Pflicht')
  }

  const projectId =
    typeof body.project_id === 'number' ? body.project_id : null
  const note =
    typeof body.note === 'string' && body.note.length > 0 ? body.note : null

  const created = await env.DB.prepare(
    'INSERT INTO time_entries (employer_id, project_id, start_ts, note) VALUES (?, ?, ?, ?) RETURNING *',
  )
    .bind(body.employer_id, projectId, body.start_ts, note)
    .first()

  return json(created, { status: 201 })
}
