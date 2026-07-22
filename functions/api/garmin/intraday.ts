import { json, type Env } from '../../_utils'

// GET /api/garmin/intraday?from=&to=  (calendar_date, inklusive). Kurven als JSON geparst.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const where: string[] = []
  const binds: unknown[] = []
  if (from) { where.push('calendar_date >= ?'); binds.push(from) }
  if (to) { where.push('calendar_date <= ?'); binds.push(to) }

  const sql =
    `SELECT * FROM garmin_intraday ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY calendar_date DESC`
  const { results } = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>()

  const parse = (v: unknown) => {
    if (typeof v === 'string') { try { return JSON.parse(v) } catch { return null } }
    return v ?? null
  }
  const parsed = (results ?? []).map((row) => ({
    calendar_date: row.calendar_date,
    body_battery_curve: parse(row.body_battery_curve),
    stress_curve: parse(row.stress_curve),
  }))
  return json(parsed)
}
