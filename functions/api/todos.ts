import { badRequest, json, type Env } from '../_utils'

interface CreateTodoBody {
  title?: unknown
  due_date?: unknown
  employer_id?: unknown
  project_id?: unknown
  done?: unknown
  note?: unknown
  steps?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, title, due_date, done, favorite, employer_id, project_id, sort_order, note, steps, created_at FROM todos ORDER BY done ASC, sort_order ASC, created_at ASC',
  ).all()
  return json(results)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as CreateTodoBody

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return badRequest('title ist Pflicht')
  }

  const dueDate =
    typeof body.due_date === 'string' && body.due_date.length > 0
      ? body.due_date
      : null
  const employerId =
    typeof body.employer_id === 'number' ? body.employer_id : null
  const projectId =
    typeof body.project_id === 'number' ? body.project_id : null
  const done = body.done === true || body.done === 1 ? 1 : 0
  const note = typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null
  const steps = typeof body.steps === 'string' && body.steps.length > 0 ? body.steps : null

  // Neue Aufgaben ans Ende der globalen Sortierung hängen.
  const created = await env.DB.prepare(
    'INSERT INTO todos (title, due_date, done, employer_id, project_id, note, steps, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM todos)) RETURNING *',
  )
    .bind(body.title.trim(), dueDate, done, employerId, projectId, note, steps)
    .first()

  return json(created, { status: 201 })
}
