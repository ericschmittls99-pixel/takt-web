import { json, type Env } from '../../_utils'

// GET /api/garmin/activities?status=&from=&to=
// from/to filtern auf das Datum (YYYY-MM-DD) von start_ts, inklusive. Read-only (Zuordnung = WP2).
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const where: string[] = []
  const binds: unknown[] = []
  if (status) { where.push('status = ?'); binds.push(status) }
  if (from) { where.push('substr(start_ts, 1, 10) >= ?'); binds.push(from) }
  if (to) { where.push('substr(start_ts, 1, 10) <= ?'); binds.push(to) }

  const sql =
    `SELECT * FROM activities ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY start_ts DESC`
  const { results } = await env.DB.prepare(sql).bind(...binds).all()
  return json(results)
}
