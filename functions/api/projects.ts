import { json, type Env } from '../_utils'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, employer_id, parent_id, name, level FROM projects ORDER BY name',
  ).all()
  return json(results)
}
