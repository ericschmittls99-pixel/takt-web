import { badRequest, json, type Env } from '../_utils'

interface CreateOverrideBody {
  date?: unknown
  source_block_id?: unknown
  deleted?: unknown
  employer_id?: unknown
  project_id?: unknown
  start_min?: unknown
  end_min?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, date, source_block_id, deleted, employer_id, project_id, start_min, end_min, created_at FROM planned_overrides ORDER BY date ASC, start_min ASC',
  ).all()
  return json(results)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as CreateOverrideBody

  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return badRequest('date (YYYY-MM-DD) ist Pflicht')
  const deleted = body.deleted === true || body.deleted === 1 ? 1 : 0
  const sourceId = typeof body.source_block_id === 'number' ? body.source_block_id : null

  if (!deleted) {
    if (typeof body.employer_id !== 'number') return badRequest('employer_id (number) ist Pflicht')
    if (typeof body.start_min !== 'number' || typeof body.end_min !== 'number') return badRequest('start_min/end_min (number) sind Pflicht')
    if (body.end_min <= body.start_min) return badRequest('end_min muss nach start_min liegen')
  }

  const employerId = typeof body.employer_id === 'number' ? body.employer_id : null
  const projectId = typeof body.project_id === 'number' ? body.project_id : null
  const startMin = typeof body.start_min === 'number' ? body.start_min : null
  const endMin = typeof body.end_min === 'number' ? body.end_min : null

  const created = await env.DB.prepare(
    'INSERT INTO planned_overrides (date, source_block_id, deleted, employer_id, project_id, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(body.date, sourceId, deleted, employerId, projectId, startMin, endMin)
    .first()

  return json(created, { status: 201 })
}
