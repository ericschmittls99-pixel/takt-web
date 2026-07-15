import { badRequest, json, type Env } from '../_utils'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, employer_id, parent_id, name, level, active, sort_order FROM projects ORDER BY employer_id, sort_order, name',
  ).all()
  return json(results)
}

interface NewProjectBody {
  name?: unknown
  employer_id?: unknown
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as NewProjectBody
  if (typeof body.name !== 'string' || body.name.trim().length === 0) return badRequest('Name fehlt')
  if (typeof body.employer_id !== 'number' || !Number.isInteger(body.employer_id)) return badRequest('employer_id fehlt')

  const employer = await env.DB.prepare('SELECT id FROM employers WHERE id = ?')
    .bind(body.employer_id)
    .first<{ id: number }>()
  if (!employer) return badRequest('Arbeitgeber nicht gefunden', 404)

  const row = await env.DB.prepare(
    'INSERT INTO projects (employer_id, parent_id, name, level, active, sort_order) VALUES (?, NULL, ?, 1, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM projects WHERE employer_id = ?)) RETURNING *',
  )
    .bind(body.employer_id, body.name.trim(), body.employer_id)
    .first()
  return json(row, { status: 201 })
}
