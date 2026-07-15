import { badRequest, json, type Env } from '../../_utils'

interface PatchOverrideBody {
  deleted?: unknown
  employer_id?: unknown
  project_id?: unknown
  start_min?: unknown
  end_min?: unknown
}

function parseId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ request, env, params }) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')

  const current = await env.DB.prepare('SELECT id FROM planned_overrides WHERE id = ?').bind(id).first<{ id: number }>()
  if (!current) return badRequest('Override nicht gefunden', 404)

  const body = (await request.json()) as PatchOverrideBody
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (typeof body.deleted === 'boolean' || body.deleted === 0 || body.deleted === 1) {
    fields.push('deleted = ?')
    values.push(body.deleted === true || body.deleted === 1 ? 1 : 0)
  }
  if (body.employer_id === null || typeof body.employer_id === 'number') {
    fields.push('employer_id = ?')
    values.push(body.employer_id as number | null)
  }
  if (body.project_id === null || typeof body.project_id === 'number') {
    fields.push('project_id = ?')
    values.push(body.project_id as number | null)
  }
  if (typeof body.start_min === 'number') {
    fields.push('start_min = ?')
    values.push(body.start_min)
  }
  if (typeof body.end_min === 'number') {
    fields.push('end_min = ?')
    values.push(body.end_min)
  }

  if (fields.length === 0) return badRequest('Keine Felder zum Aktualisieren')

  values.push(id)
  const updated = await env.DB.prepare(`UPDATE planned_overrides SET ${fields.join(', ')} WHERE id = ? RETURNING *`).bind(...values).first()
  return json(updated)
}

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ env, params }) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')
  const result = await env.DB.prepare('DELETE FROM planned_overrides WHERE id = ?').bind(id).run()
  if (!result.meta.changes) return badRequest('Override nicht gefunden', 404)
  return new Response(null, { status: 204 })
}
