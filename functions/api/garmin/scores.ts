import { json, type Env } from '../../_utils'

// GET /api/garmin/scores?from=&to=  (calendar_date, inklusive). ts_load_balance wird geparst.
export const onRequestGet: PagesFunction<Env> = async ({ env, request }) => {
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  const where: string[] = []
  const binds: unknown[] = []
  if (from) { where.push('calendar_date >= ?'); binds.push(from) }
  if (to) { where.push('calendar_date <= ?'); binds.push(to) }

  const sql =
    `SELECT * FROM garmin_scores ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY calendar_date DESC`
  const { results } = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>()

  const parsed = (results ?? []).map((row) => {
    const lb = row.ts_load_balance
    if (typeof lb === 'string') {
      try { return { ...row, ts_load_balance: JSON.parse(lb) } } catch { return row }
    }
    return row
  })
  return json(parsed)
}
