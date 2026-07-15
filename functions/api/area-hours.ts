import { json, type Env } from '../_utils'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT employer_id, weekday, minutes FROM area_hours ORDER BY employer_id, weekday',
  ).all()
  return json(results)
}
