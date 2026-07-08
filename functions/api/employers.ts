import { json, type Env } from '../_utils'

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, name, bundesland FROM employers ORDER BY name',
  ).all()
  return json(results)
}
