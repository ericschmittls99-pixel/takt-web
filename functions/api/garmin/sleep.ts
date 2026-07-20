import { json, type Env } from '../../_utils'

// GET /api/garmin/sleep?from=&to=  (calendar_date, inklusive). curves wird als JSON geparst.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const where: string[] = []
  const binds: unknown[] = []
  if (from) { where.push('calendar_date >= ?'); binds.push(from) }
  if (to) { where.push('calendar_date <= ?'); binds.push(to) }

  const sql =
    `SELECT * FROM garmin_sleep ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY calendar_date DESC`
  const { results } = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>()

  const parsed = (results ?? []).map((row) => {
    const curves = row.curves
    if (typeof curves === 'string') {
      try { return { ...row, curves: JSON.parse(curves) } } catch { return row }
    }
    return row
  })
  return json(parsed)
}
