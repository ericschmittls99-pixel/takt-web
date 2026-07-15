import { badRequest, json, type Env } from '../../_utils'

interface PatchEmployerBody {
  name?: unknown
  color?: unknown
  icon?: unknown
  kind?: unknown
  weekly_goal_min?: unknown
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

  const current = await env.DB.prepare('SELECT id FROM employers WHERE id = ?')
    .bind(id)
    .first<{ id: number }>()
  if (!current) return badRequest('Arbeitgeber nicht gefunden', 404)

  const body = (await request.json()) as PatchEmployerBody
  const fields: string[] = []
  const values: (string | number)[] = []

  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    fields.push('name = ?')
    values.push(body.name.trim())
  }
  if (typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) {
    fields.push('color = ?')
    values.push(body.color)
  }
  if (typeof body.icon === 'string' && body.icon.trim().length > 0) {
    fields.push('icon = ?')
    values.push(body.icon.trim().slice(0, 8))
  }
  if (body.kind === 'work' || body.kind === 'private') {
    fields.push('kind = ?')
    values.push(body.kind)
  }
  if (typeof body.weekly_goal_min === 'number' && Number.isFinite(body.weekly_goal_min) && body.weekly_goal_min >= 0) {
    fields.push('weekly_goal_min = ?')
    values.push(Math.round(body.weekly_goal_min))
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
    `UPDATE employers SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
  )
    .bind(...values)
    .first()

  return json(updated)
}

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ env, params }) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')

  const entries = await env.DB.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE employer_id = ?')
    .bind(id)
    .first<{ n: number }>()
  if ((entries?.n ?? 0) > 0) return badRequest('Bereich hat erfasste Zeiten – bitte stattdessen deaktivieren', 409)

  const projs = await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE employer_id = ?')
    .bind(id)
    .first<{ n: number }>()
  if ((projs?.n ?? 0) > 0) return badRequest('Bereich hat noch Projekte – bitte zuerst entfernen oder deaktivieren', 409)

  // Verwaiste Nebendaten mitentfernen (Planung, Abwesenheiten, Soll, To-Do-Zuordnung).
  await env.DB.batch([
    env.DB.prepare('DELETE FROM area_hours WHERE employer_id = ?').bind(id),
    env.DB.prepare('DELETE FROM targets WHERE employer_id = ?').bind(id),
    env.DB.prepare('DELETE FROM planned_blocks WHERE employer_id = ?').bind(id),
    env.DB.prepare('DELETE FROM absences WHERE employer_id = ?').bind(id),
    env.DB.prepare('UPDATE todos SET employer_id = NULL, project_id = NULL WHERE employer_id = ?').bind(id),
  ])
  const result = await env.DB.prepare('DELETE FROM employers WHERE id = ?').bind(id).run()
  if (!result.meta.changes) return badRequest('Bereich nicht gefunden', 404)
  return new Response(null, { status: 204 })
}
