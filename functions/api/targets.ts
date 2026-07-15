import { json, type Env } from '../_utils'

// Soll-Vorgaben pro Arbeitgeber (nur Lesezugriff). Mehrere Zeilen je Arbeitgeber
// (unterschiedliche valid_from) sind erlaubt; das Frontend wählt die jeweils
// gültige aus. Ein PATCH/PUT folgt bewusst später.
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const { results } = await env.DB.prepare(
    'SELECT id, employer_id, weekly_soll_min, valid_from FROM targets ORDER BY employer_id, valid_from',
  ).all()
  return json(results)
}
