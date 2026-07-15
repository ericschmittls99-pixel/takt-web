import { badRequest, json, type Env } from '../../_utils'

interface PatchTodoBody {
  title?: unknown
  due_date?: unknown
  done?: unknown
  favorite?: unknown
  sort_order?: unknown
  employer_id?: unknown
  project_id?: unknown
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

  const current = await env.DB.prepare('SELECT id FROM todos WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()
  if (!current) return badRequest('Aufgabe nicht gefunden', 404)

  const body = (await request.json()) as PatchTodoBody
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (typeof body.title === 'string' && body.title.trim().length > 0) {
    fields.push('title = ?')
    values.push(body.title.trim())
  }
  if (body.due_date === null || typeof body.due_date === 'string') {
    fields.push('due_date = ?')
    values.push(body.due_date === '' ? null : (body.due_date as string | null))
  }
  if (typeof body.done === 'boolean' || body.done === 0 || body.done === 1) {
    fields.push('done = ?')
    values.push(body.done === true || body.done === 1 ? 1 : 0)
  }
  if (typeof body.favorite === 'boolean' || body.favorite === 0 || body.favorite === 1) {
    fields.push('favorite = ?')
    values.push(body.favorite === true || body.favorite === 1 ? 1 : 0)
  }
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    fields.push('sort_order = ?')
    values.push(body.sort_order)
  }
  if (body.employer_id === null || typeof body.employer_id === 'number') {
    fields.push('employer_id = ?')
    values.push(body.employer_id as number | null)
  }
  if (body.project_id === null || typeof body.project_id === 'number') {
    fields.push('project_id = ?')
    values.push(body.project_id as number | null)
  }

  if (fields.length === 0) return badRequest('Keine Felder zum Aktualisieren')

  values.push(id)
  const updated = await env.DB.prepare(
    `UPDATE todos SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
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

  const result = await env.DB.prepare('DELETE FROM todos WHERE id = ?')
    .bind(id)
    .run()

  if (!result.meta.changes) return badRequest('Aufgabe nicht gefunden', 404)
  return new Response(null, { status: 204 })
}
