import { badRequest, json, type Env } from '../_utils'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, name, color, icon, kind, weekly_goal_min, active, sort_order FROM employers ORDER BY sort_order, name',
  ).all()
  return json(results)
}

interface NewEmployerBody {
  name?: unknown
  color?: unknown
  icon?: unknown
  kind?: unknown
  weekly_goal_min?: unknown
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as NewEmployerBody
  if (typeof body.name !== 'string' || body.name.trim().length === 0) return badRequest('Name fehlt')
  const name = body.name.trim()
  const color = typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#2563EB'
  const icon = typeof body.icon === 'string' && body.icon.trim().length > 0 ? body.icon.trim().slice(0, 8) : '💼'
  const kind = body.kind === 'private' ? 'private' : 'work'
  const goal = typeof body.weekly_goal_min === 'number' && body.weekly_goal_min >= 0 ? Math.round(body.weekly_goal_min) : 0

  const row = await env.DB.prepare(
    'INSERT INTO employers (name, color, icon, kind, weekly_goal_min, active, sort_order) VALUES (?, ?, ?, ?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM employers)) RETURNING *',
  )
    .bind(name, color, icon, kind, goal)
    .first()
  return json(row, { status: 201 })
}
