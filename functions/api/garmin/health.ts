import { json, type Env } from '../../_utils'

// GET /api/garmin/health?from=&to=  (calendar_date, inklusive). Read-only.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const where: string[] = []
  const binds: unknown[] = []
  if (from) { where.push('calendar_date >= ?'); binds.push(from) }
  if (to) { where.push('calendar_date <= ?'); binds.push(to) }

  const sql =
    `SELECT * FROM garmin_health ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY calendar_date DESC`
  const { results } = await env.DB.prepare(sql).bind(...binds).all()
  return json(results)
}
