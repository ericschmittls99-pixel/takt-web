import { badRequest, json, type Env } from '../../_utils'

const TYPES = ['urlaub', 'krank', 'sonstiges']

interface PatchAbsenceBody {
  start_date?: unknown
  end_date?: unknown
  type?: unknown
  employer_id?: unknown
  note?: unknown
  all_day?: unknown
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
  const current = await env.DB.prepare('SELECT id FROM absences WHERE id = ?').bind(id).first<{ id: number }>()
  if (!current) return badRequest('Abwesenheit nicht gefunden', 404)

  const body = (await request.json()) as PatchAbsenceBody
  const re = /^\d{4}-\d{2}-\d{2}$/
  const fields: string[] = []
  const values: (string | number | null)[] = []

  if (typeof body.start_date === 'string' && re.test(body.start_date)) {
    fields.push('start_date = ?')
    values.push(body.start_date)
  }
  if (typeof body.end_date === 'string' && re.test(body.end_date)) {
    fields.push('end_date = ?')
    values.push(body.end_date)
  }
  if (typeof body.type === 'string' && TYPES.includes(body.type)) {
    fields.push('type = ?')
    values.push(body.type)
  }
  if (body.employer_id === null || typeof body.employer_id === 'number') {
    fields.push('employer_id = ?')
    values.push(body.employer_id as number | null)
  }
  if (body.note === null || typeof body.note === 'string') {
    fields.push('note = ?')
    values.push(body.note === '' ? null : (body.note as string | null))
  }
  if (typeof body.all_day === 'boolean' || body.all_day === 0 || body.all_day === 1) {
    const ad = body.all_day === true || body.all_day === 1 ? 1 : 0
    fields.push('all_day = ?', 'start_min = ?', 'end_min = ?')
    if (ad) values.push(1, null, null)
    else {
      if (typeof body.start_min !== 'number' || typeof body.end_min !== 'number' || body.end_min <= body.start_min) return badRequest('Bei Zeitfenster sind start_min < end_min Pflicht')
      values.push(0, body.start_min, body.end_min)
    }
  }

  if (fields.length === 0) return badRequest('Keine Felder zum Aktualisieren')
  values.push(id)
  const updated = await env.DB.prepare(`UPDATE absences SET ${fields.join(', ')} WHERE id = ? RETURNING *`).bind(...values).first()
  return json(updated)
}

export const onRequestDelete: PagesFunction<Env, 'id'> = async ({ env, params }) => {
  const id = parseId(params.id)
  if (id === null) return badRequest('Ungültige id')
  const result = await env.DB.prepare('DELETE FROM absences WHERE id = ?').bind(id).run()
  if (!result.meta.changes) return badRequest('Abwesenheit nicht gefunden', 404)
  return new Response(null, { status: 204 })
}
