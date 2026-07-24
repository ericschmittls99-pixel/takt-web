import { json, type Env } from '../_utils'

// GET /api/map — liefert die Karten-Konfiguration (MapTiler-Key) zur Laufzeit.
// Der Key kommt aus der Env (nie hartkodiert, nie im Bundle/Repo). Fehlt er,
// bleibt `key` leer und der Client kann einen Hinweis statt einer Karte zeigen.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return json({ key: env.MAPTILER_KEY ?? '' })
}
