import { badRequest, json, type Env } from '../_utils'

// Whitelist bearbeitbarer Einstellungen.
const KEYS = new Set(['accent_color', 'start_date', 'bundesland', 'birth_date', 'sex', 'todo_sound', 'absence_types', 'hotkeys', 'puls_trends_layout'])

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>()
  const out: Record<string, string> = {}
  for (const r of results) out[r.key] = r.value
  return json(out)
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json()) as Record<string, unknown>
  const entries = Object.entries(body).filter(([k, v]) => KEYS.has(k) && typeof v === 'string')
  if (entries.length === 0) return badRequest('Keine gültigen Einstellungen')

  for (const [k, v] of entries) {
    await env.DB.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
      .bind(k, v as string)
      .run()
  }

  const { results } = await env.DB.prepare('SELECT key, value FROM app_settings').all<{ key: string; value: string }>()
  const out: Record<string, string> = {}
  for (const r of results) out[r.key] = r.value
  return json(out)
}
