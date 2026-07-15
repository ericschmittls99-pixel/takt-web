import { badRequest, json, type Env } from '../../_utils'

interface PatchProjectBody {
  name?: unknown
  employer_id?: unknown
  active?: unknown
  sort_order?: unknown
}

function parseId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')

  const current = await env.DB.prepare('SELECT id FROM projects WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()
  if (!current) return badRequest('Projekt nicht gefunden', 404)

  const body = (await request.json()) as PatchProjectBody
  const fields: string[] = []
  const values: (string | number)[] = []

  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    fields.push('name = ?')
    values.push(body.name.trim())
  }
  if (typeof body.employer_id === 'number' && Number.isInteger(body.employer_id)) {
    const employer = await env.DB.prepare('SELECT id FROM employers WHERE id = ?')
      .bind(body.employer_id)
      .first<{ id: number }>()
    if (!employer) return badRequest('Arbeitgeber nicht gefunden', 404)
    fields.push('employer_id = ?')
    values.push(body.employer_id)
  }
  if (typeof body.active === 'boolean' || body.active === 0 || body.active === 1) {
    fields.push('active = ?')
    values.push(body.active === true || body.active === 1 ? 1 : 0)
  }
  if (typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)) {
    fields.push('sort_order = ?')
    values.push(Math.round(body.sort_order))
  }

  if (fields.length === 0) return badRequest('Keine Felder zum Aktualisieren')

  values.push(id)
  const updated = await env.DB.prepare(
    `UPDATE projects SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  )
    .bind(...values)
    .first()

  return json(updated)
}

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ env, params }) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')

  const entries = await env.DB.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE project_id = ?')
    .bind(id)
    .first<{ n: number }>()
  if ((entries?.n ?? 0) > 0) return badRequest('Projekt hat erfasste Zeiten – bitte stattdessen deaktivieren', 409)

  await env.DB.batch([
    env.DB.prepare('DELETE FROM planned_blocks WHERE project_id = ?').bind(id),
    env.DB.prepare('UPDATE todos SET project_id = NULL WHERE project_id = ?').bind(id),
  ])
  const result = await env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run()
  if (!result.meta.changes) return badRequest('Projekt nicht gefunden', 404)
  return new Response(null, { status: 204 })
}
