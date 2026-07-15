import { badRequest, json, type Env } from '../../_utils'

interface PutBody {
  minutes?: unknown // Array mit 7 Werten, Index = weekday (0=So … 6=Sa)
}

function parseId(raw: string | string[]): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

// Setzt die Wochentags-Minuten eines Bereichs komplett neu.
export const onRequestPut: PagesFunction<Env, 'employer_id'> = async ({ request, env, params }) => {
  const employerId = parseId(params.employer_id)
  if (employerId === null) return badRequest('Ungültige employer_id')

  const employer = await env.DB.prepare('SELECT id FROM employers WHERE id = ?')
    .bind(employerId)
    .first<{ id: number }>()
  if (!employer) return badRequest('Arbeitgeber nicht gefunden', 404)

  const body = (await request.json()) as PutBody
  if (!Array.isArray(body.minutes) || body.minutes.length !== 7) {
    return badRequest('minutes muss ein Array mit 7 Werten sein')
  }
  const mins = body.minutes.map((m) => (typeof m === 'number' && Number.isFinite(m) && m >= 0 ? Math.round(m) : 0))

  for (let wd = 0; wd < 7; wd++) {
    await env.DB.prepare(
      'INSERT INTO area_hours (employer_id, weekday, minutes) VALUES (?, ?, ?) ON CONFLICT(employer_id, weekday) DO UPDATE SET minutes = excluded.minutes',
    )
      .bind(employerId, wd, mins[wd])
      .run()
  }

  const { results } = await env.DB.prepare(
    'SELECT employer_id, weekday, minutes FROM area_hours WHERE employer_id = ? ORDER BY weekday',
  )
    .bind(employerId)
    .all()
  return json(results)
}
