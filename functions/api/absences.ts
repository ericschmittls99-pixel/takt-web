import { badRequest, json, type Env } from '../_utils'

const TYPES = ['urlaub', 'krank', 'sonstiges']

interface CreateAbsenceBody {
  start_date?: unknown
  end_date?: unknown
  type?: unknown
  employer_id?: unknown
  note?: unknown
  all_day?: unknown
  start_min?: unknown
  end_min?: unknown
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, start_date, end_date, type, employer_id, note, all_day, start_min, end_min, created_at FROM absences ORDER BY start_date ASC',
  ).all()
  return json(results)
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as CreateAbsenceBody
  const re = /^\d{4}-\d{2}-\d{2}$/
  if (typeof body.start_date !== 'string' || !re.test(body.start_date)) return badRequest('start_date (YYYY-MM-DD) ist Pflicht')
  const end = typeof body.end_date === 'string' && re.test(body.end_date) ? body.end_date : body.start_date
  if (end < body.start_date) return badRequest('end_date darf nicht vor start_date liegen')
  if (typeof body.type !== 'string' || !TYPES.includes(body.type)) return badRequest('type ungültig')

  const allDay = body.all_day === false || body.all_day === 0 ? 0 : 1
  let startMin: number | null = null
  let endMin: number | null = null
  if (!allDay) {
    if (typeof body.start_min !== 'number' || typeof body.end_min !== 'number' || body.end_min <= body.start_min) return badRequest('Bei Zeitfenster sind start_min < end_min Pflicht')
    startMin = body.start_min
    endMin = body.end_min
  }

  const employerId = typeof body.employer_id === 'number' ? body.employer_id : null
  const note = typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null

  const created = await env.DB.prepare(
    'INSERT INTO absences (start_date, end_date, type, employer_id, note, all_day, start_min, end_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(body.start_date, end, body.type, employerId, note, allDay, startMin, endMin)
    .first()

  return json(created, { status: 201 })
}
