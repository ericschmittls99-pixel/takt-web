import { badRequest, json, type Env } from '../../../_utils'

// GET /api/garmin/activities/:id — inkl. activity_details.payload (Deep-Dive). Read-only.
export const onRequestGet: PagesFunction<Env, 'id'> = async ({ env, params }) => {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return badRequest('Ungültige id')

  const activity = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first()
  if (!activity) return badRequest('Aktivität nicht gefunden', 404)

  const det = await env.DB
    .prepare('SELECT payload FROM activity_details WHERE activity_id = ?')
    .bind(id)
    .first<{ payload: string | null }>()

  let details: unknown = null
  if (det?.payload) {
    try { details = JSON.parse(det.payload) } catch { details = det.payload }
  }
  return json({ ...activity, details })
}

interface PatchBody {
  action?: unknown
  employer_id?: unknown
  project_id?: unknown
  note?: unknown
  // action='edit' (nur source='manual'): Mess-KPIs auf activities-Spalten.
  duration_sec?: unknown
  distance_m?: unknown
  calories?: unknown
  avg_hr?: unknown
  max_hr?: unknown
  // action='edit-exercises': [{ name, sets, reps, max_weight }]
  exercises?: unknown
  // action='rename': neuer Titel (jede Aktivität)
  name?: unknown
}

const EDIT_COLS = ['duration_sec', 'distance_m', 'calories', 'avg_hr', 'max_hr'] as const
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// Wandelt Garmin-Startzeit (lokale Wall-Clock) + Dauer in time_entries-Felder.
// Wall-Clock wird TZ-neutral behandelt (als UTC interpretiert), damit das Ergebnis
// runtime-unabhängig ist und im Browser lokal wieder korrekt gelesen wird.
function toEntryTimes(startTs: string, durationSec: number | null): { start: string; end: string | null; durMin: number | null } {
  const start = startTs.replace(' ', 'T').slice(0, 19)
  if (durationSec == null || !Number.isFinite(durationSec)) return { start, end: null, durMin: null }
  const startMs = Date.parse(start + 'Z')
  if (!Number.isFinite(startMs)) return { start, end: null, durMin: null }
  const end = new Date(startMs + durationSec * 1000).toISOString().slice(0, 19)
  return { start, end, durMin: Math.round(durationSec / 60) }
}

// PATCH /api/garmin/activities/:id — Zuordnung (assign | ignore | unassign).
export const onRequestPatch: PagesFunction<Env, 'id'> = async ({ env, request, params }) => {
  const raw = Array.isArray(params.id) ? params.id[0] : params.id
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) return badRequest('Ungültige id')

  const act = await env.DB
    .prepare('SELECT id, start_ts, duration_sec, source, entry_id FROM activities WHERE id = ?')
    .bind(id)
    .first<{ id: number; start_ts: string | null; duration_sec: number | null; source: string; entry_id: number | null }>()
  if (!act) return badRequest('Aktivität nicht gefunden', 404)

  const body = (await request.json()) as PatchBody
  const action = body.action
  if (action !== 'assign' && action !== 'ignore' && action !== 'unassign' && action !== 'edit' && action !== 'edit-exercises' && action !== 'rename') {
    return badRequest("action muss 'assign', 'ignore', 'unassign', 'edit', 'edit-exercises' oder 'rename' sein")
  }

  if (action === 'rename') {
    // Titel/Name jeder Aktivität änderbar (kosmetisch). Sync überschreibt name nicht mehr (aus ACT_MEASURE entfernt).
    const name = typeof (body as Record<string, unknown>).name === 'string' ? ((body as Record<string, unknown>).name as string).trim() : ''
    if (!name) return badRequest('Name darf nicht leer sein')
    await env.DB.prepare('UPDATE activities SET name = ? WHERE id = ?').bind(name.slice(0, 200), id).run()
    return json(await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first())
  }

  if (action === 'edit-exercises') {
    // Übungssätze im activity_details-Payload ersetzen und als bearbeitet markieren
    // (Sync überschreibt edited=1 nicht — gilt auch für Garmin-Workouts).
    if (!Array.isArray(body.exercises)) return badRequest('exercises (array) erforderlich')
    const clean = []
    for (const e of body.exercises) {
      if (typeof e !== 'object' || e === null) continue
      const rec = e as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      if (!name) continue
      clean.push({ name, sets: numOrNull(rec.sets), reps: numOrNull(rec.reps), maxWeight: numOrNull(rec.max_weight) })
    }
    const cur = await env.DB.prepare('SELECT payload FROM activity_details WHERE activity_id = ?').bind(id).first<{ payload: string | null }>()
    let payload: Record<string, unknown> = {}
    if (cur?.payload) { try { payload = JSON.parse(cur.payload) as Record<string, unknown> } catch { payload = {} } }
    payload.exercise_sets = clean
    await env.DB.prepare(
      'INSERT INTO activity_details (activity_id, payload, edited) VALUES (?, ?, 1) ' +
      'ON CONFLICT(activity_id) DO UPDATE SET payload = excluded.payload, edited = 1',
    ).bind(id, JSON.stringify(payload)).run()
    return json(await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first())
  }

  if (action === 'edit') {
    // Nur manuelle Aktivitäten sind editierbar (Garmin-Rohdaten bleiben Sync-Wahrheit).
    if (act.source !== 'manual') return badRequest('Nur manuelle Aktivitäten sind editierbar')
    const fields: string[] = []
    const values: (number | null)[] = []
    for (const c of EDIT_COLS) {
      if (!(c in body)) continue
      const v = (body as Record<string, unknown>)[c]
      if (v === null) { fields.push(`${c} = ?`); values.push(null) }
      else if (typeof v === 'number' && Number.isFinite(v)) { fields.push(`${c} = ?`); values.push(v) }
      else return badRequest(`${c} muss number oder null sein`)
    }
    if (fields.length === 0) return badRequest('Keine editierbaren Felder übergeben')
    values.push(id)
    await env.DB.prepare(`UPDATE activities SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
    return json(await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first())
  }

  if (action === 'ignore') {
    await env.DB.prepare("UPDATE activities SET status = 'ignored' WHERE id = ?").bind(id).run()
    return json(await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first())
  }

  if (action === 'unassign') {
    // Vollständiger Reset: erst Referenz lösen (FK!), dann time_entry löschen. Zurück in die Inbox.
    // Garmin-Rohdaten (Metriken, activity_details) bleiben erhalten.
    const stmts = []
    stmts.push(env.DB.prepare(
      "UPDATE activities SET status = 'inbox', employer_id = NULL, project_id = NULL, note = NULL, entry_id = NULL WHERE id = ?",
    ).bind(id))
    if (act.entry_id != null) stmts.push(env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(act.entry_id))
    await env.DB.batch(stmts)
    return json(await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first())
  }

  // action === 'assign'
  const employerId = body.employer_id
  if (typeof employerId !== 'number') return badRequest('employer_id (number) ist für assign Pflicht')
  let projectId: number | null = null
  if (body.project_id != null) {
    if (typeof body.project_id !== 'number') return badRequest('project_id muss number oder null sein')
    projectId = body.project_id
  }
  let note: string | null = null
  if (body.note != null) {
    if (typeof body.note !== 'string') return badRequest('note muss string oder null sein')
    note = body.note.trim() || null
  }

  const emp = await env.DB.prepare('SELECT id, is_sport FROM employers WHERE id = ?').bind(employerId).first<{ id: number; is_sport: number }>()
  if (!emp) return badRequest('Bereich nicht gefunden', 404)
  if (emp.is_sport !== 1) return badRequest('Zuweisen nur auf Sport-Bereiche erlaubt')
  if (!act.start_ts) return badRequest('Aktivität hat keine Startzeit')

  const { start, end, durMin } = toEntryTimes(act.start_ts, act.duration_sec)

  // Transaktional: (alten entry ggf. weg — erst Referenz lösen wegen FK) -> neuen time_entry
  // -> entry_id via last_insert_rowid().
  const stmts = []
  if (act.entry_id != null) {
    stmts.push(env.DB.prepare('UPDATE activities SET entry_id = NULL WHERE id = ?').bind(id))
    stmts.push(env.DB.prepare('DELETE FROM time_entries WHERE id = ?').bind(act.entry_id))
  }
  stmts.push(env.DB.prepare(
    'INSERT INTO time_entries (employer_id, project_id, start_ts, end_ts, duration_min, note) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(employerId, projectId, start, end, durMin, note))
  stmts.push(env.DB.prepare(
    "UPDATE activities SET status = 'assigned', employer_id = ?, project_id = ?, note = ?, entry_id = last_insert_rowid() WHERE id = ?",
  ).bind(employerId, projectId, note, id))
  await env.DB.batch(stmts)

  return json(await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first())
}
