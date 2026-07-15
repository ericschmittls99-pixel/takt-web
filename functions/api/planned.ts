import { badRequest, json, type Env } from '../_utils'

interface CreatePlannedBody {
  employer_id?: unknown
  project_id?: unknown
  weekday?: unknown
  start_min?: unknown
  end_min?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url)
  const date = url.searchParams.get('date')

  if (date) {
    // Wochentag (0=So..6=Sa) aus dem Datum ableiten und die Blöcke dafür liefern.
    const d = new Date(`${date}T00:00:00`)
    if (Number.isNaN(d.getTime())) return badRequest('date muss YYYY-MM-DD sein')
    const weekday = d.getDay()
    const { results } = await env.DB.prepare(
      'SELECT id, employer_id, project_id, weekday, start_min, end_min, created_at FROM planned_blocks WHERE weekday = ? ORDER BY start_min ASC',
    )
      .bind(weekday)
      .all()
    return json(results)
  }

  const { results } = await env.DB.prepare(
    'SELECT id, employer_id, project_id, weekday, start_min, end_min, created_at FROM planned_blocks ORDER BY weekday ASC, start_min ASC',
  ).all()
  return json(results)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as CreatePlannedBody

  if (typeof body.employer_id !== 'number') return badRequest('employer_id (number) ist Pflicht')
  if (typeof body.weekday !== 'number' || body.weekday < 0 || body.weekday > 6) return badRequest('weekday (0..6) ist Pflicht')
  if (typeof body.start_min !== 'number' || typeof body.end_min !== 'number') return badRequest('start_min/end_min (number) sind Pflicht')
  if (body.end_min <= body.start_min) return badRequest('end_min muss nach start_min liegen')

  const projectId = typeof body.project_id === 'number' ? body.project_id : null

  const created = await env.DB.prepare(
    'INSERT INTO planned_blocks (employer_id, project_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(body.employer_id, projectId, body.weekday, body.start_min, body.end_min)
    .first()

  return json(created, { status: 201 })
}
