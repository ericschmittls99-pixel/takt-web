import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { api, type Employer, type GarminActivity, type GarminSuggestion, type Project, type Todo } from '../api'
import { employerColor } from '../colors'

// Inbox-Popover (WP2). Header-Icon oben rechts + Badge; Aktionen = Live-Query offener
// Workouts (activities status='inbox') + überfällige To-Dos. Workout-Zeilen klappen inline
// auf: Vorschlag vorausgewählt, Sport-Bereichs-/Projekt-Chips, Notiz, Übernehmen/Ignorieren.

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const TYPE_EMOJI: Record<string, string> = {
  running: '🏃', treadmill_running: '🏃', trail_running: '🏃', track_running: '🏃',
  strength_training: '🏋️', indoor_cardio: '🤸', hiit: '🔥',
  road_biking: '🚴', cycling: '🚴', indoor_cycling: '🚴', mountain_biking: '🚵', gravel_cycling: '🚴',
  lap_swimming: '🏊', open_water_swimming: '🏊', swimming: '🏊',
  yoga: '🧘', pilates: '🧘', walking: '🚶', hiking: '🥾',
}
const TYPE_LABEL: Record<string, string> = {
  running: 'Laufen', treadmill_running: 'Laufband', trail_running: 'Trailrun', track_running: 'Bahnlauf',
  strength_training: 'Krafttraining', indoor_cardio: 'Cardio', hiit: 'HIIT',
  road_biking: 'Radfahren', cycling: 'Radfahren', indoor_cycling: 'Indoor-Rad', mountain_biking: 'Mountainbike', gravel_cycling: 'Gravel',
  lap_swimming: 'Schwimmen', open_water_swimming: 'Freiwasser', swimming: 'Schwimmen',
  yoga: 'Yoga', pilates: 'Pilates', walking: 'Gehen', hiking: 'Wandern',
}
const pad = (n: number) => String(n).padStart(2, '0')
const typeEmoji = (t: string | null) => (t && TYPE_EMOJI[t]) || '🏅'
const typeLabel = (a: GarminActivity) => (a.type && TYPE_LABEL[a.type]) || a.name || a.type || 'Workout'

function fmtMetrics(a: GarminActivity): string {
  const p: string[] = []
  if (a.duration_sec) p.push(`${Math.round(a.duration_sec / 60)} min`)
  if (a.distance_m) p.push(`${(a.distance_m / 1000).toFixed(1).replace('.', ',')} km`)
  if (a.avg_hr) p.push(`${Math.round(a.avg_hr)} bpm`)
  if (a.calories) p.push(`${Math.round(a.calories)} kcal`)
  return p.join('  ·  ')
}
function fmtTime(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function addDaysKey(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  if (h.length !== 6) return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

type Sel = { area: number | null; project: number | null; note: string; noteOpen: boolean; status: 'idle' | 'saving' | 'error' }
const GLASS_STRONG: CSSProperties = { background: 'var(--glass-strong)', backdropFilter: 'blur(30px) saturate(200%)', WebkitBackdropFilter: 'blur(30px) saturate(200%)' }

export default function InboxPopover({ onChanged, onOpenTodos }: { onChanged: () => void; onOpenTodos: () => void }) {
  const [open, setOpen] = useState(false)
  const [inbox, setInbox] = useState<GarminActivity[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [todoMenu, setTodoMenu] = useState<number | null>(null)
  const [sel, setSel] = useState<Record<number, Sel>>({})
  const [sugg, setSugg] = useState<Record<number, GarminSuggestion>>({})

  const sportAreas = employers.filter((e) => e.is_sport === 1 && (e.active === 1 || true))
  const overdue = todos.filter((t) => t.done === 0 && t.due_date != null && t.due_date < todayKey())
  const colorFor = (id: number | null) => employers.find((e) => e.id === id)?.color ?? (id != null ? employerColor(id) : 'var(--ink3)')

  const loadCounts = useCallback(async () => {
    try {
      const [ib, td] = await Promise.all([api.getGarminInbox(), api.getTodos()])
      setInbox(ib)
      setTodos(td)
    } catch { /* Backend evtl. noch nicht bereit */ }
  }, [])

  useEffect(() => {
    loadCounts()
    api.getEmployers().then(setEmployers).catch(() => {})
    api.getProjects().then(setProjects).catch(() => {})
  }, [loadCounts])

  // Esc schließt.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const openCount = inbox.length + overdue.length
  const rootRef = useRef<HTMLDivElement | null>(null)

  function defaultSel(a: GarminActivity, s?: GarminSuggestion): Sel {
    return { area: s?.employer_id ?? null, project: s?.project_id ?? null, note: a.note ?? '', noteOpen: false, status: 'idle' }
  }
  function eff(a: GarminActivity): Sel {
    return sel[a.id] ?? defaultSel(a, sugg[a.id])
  }
  function patchSel(id: number, obj: Partial<Sel>) {
    setSel((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { area: null, project: null, note: '', noteOpen: false, status: 'idle' }), ...obj } }))
  }

  async function pickRow(a: GarminActivity) {
    const next = expandedId === a.id ? null : a.id
    setExpandedId(next)
    if (next != null && sugg[a.id] === undefined) {
      try {
        const s = await api.getGarminSuggestion(a.id)
        setSugg((prev) => ({ ...prev, [a.id]: s }))
        if (sel[a.id] === undefined) patchSel(a.id, { area: s.employer_id ?? null, project: s.project_id ?? null })
      } catch { /* kein Vorschlag */ }
    }
  }

  async function accept(a: GarminActivity) {
    const s = eff(a)
    if (s.area == null || s.status === 'saving') return
    patchSel(a.id, { status: 'saving' })
    try {
      await api.patchGarminActivity(a.id, { action: 'assign', employer_id: s.area, project_id: s.project, note: s.note.trim() || null })
      setInbox((prev) => prev.filter((x) => x.id !== a.id))
      setExpandedId((cur) => (cur === a.id ? null : cur))
      onChanged()
    } catch {
      patchSel(a.id, { status: 'error' })
    }
  }
  async function ignore(a: GarminActivity) {
    try {
      await api.patchGarminActivity(a.id, { action: 'ignore' })
      setInbox((prev) => prev.filter((x) => x.id !== a.id))
      setExpandedId((cur) => (cur === a.id ? null : cur))
      onChanged()
    } catch { /* ignore */ }
  }
  async function completeTodo(t: Todo) {
    setTodoMenu(null)
    setTodos((prev) => prev.filter((x) => x.id !== t.id)) // optimistisch
    try {
      await api.updateTodo(t.id, { done: true })
      onChanged()
    } catch {
      setTodos((prev) => [...prev, t]) // Rollback bei Fehler
    }
  }
  async function postponeTodo(t: Todo, date: string) {
    if (!date) return
    setTodoMenu(null)
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, due_date: date } : x))) // future -> fällt aus overdue
    try {
      await api.updateTodo(t.id, { due_date: date })
      onChanged()
    } catch {
      setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, due_date: t.due_date } : x)))
    }
  }

  const iconBtn = (active: boolean): CSSProperties => ({
    position: 'relative', width: 40, height: 40, borderRadius: '50%',
    background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--glass)',
    backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)',
    border: `1px solid ${active ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--hair)'}`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    color: active ? 'var(--accent)' : 'var(--ink2)', transition: 'background .18s ease',
  })
  const menuItem: CSSProperties = { padding: '9px 11px', borderRadius: 9, fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', cursor: 'pointer' }
  const chip = (on: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 11px', borderRadius: 11, cursor: 'pointer',
    background: on ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'var(--track)',
    border: `${on ? '1.5px solid var(--accent)' : '1px solid var(--hair)'}`, color: on ? 'var(--ink)' : 'var(--ink2)',
    fontSize: 13, fontWeight: 800, transition: 'background .14s ease',
  })

  return (
    <div ref={rootRef} style={{ position: 'relative', zIndex: 401 }}>
      <div onClick={() => { setOpen((o) => !o); if (!open) loadCounts() }} title="Inbox" style={iconBtn(open)}>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 13l1.6-7.2A2 2 0 0 1 8.5 4h7a2 2 0 0 1 1.9 1.8L19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" /></svg>
        {openCount > 0 && (
          <div style={{ position: 'absolute', top: -4, right: -4, minWidth: 19, height: 19, padding: '0 5px', boxSizing: 'border-box', borderRadius: 10, background: 'var(--accent)', color: '#fff', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--screen)', fontVariantNumeric: 'tabular-nums' }}>{openCount}</div>
        )}
      </div>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 400 }} />
          <div className="no-scrollbar" style={{ position: 'absolute', top: 'calc(100% + 12px)', right: 0, zIndex: 401, width: 420, maxHeight: '70vh', overflowY: 'auto', borderRadius: 20, ...GLASS_STRONG, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', textAlign: 'left', animation: 'popIn .18s ease' }}>
            <div style={{ position: 'absolute', top: -6, right: 16, width: 12, height: 12, ...GLASS_STRONG, borderLeft: '1px solid var(--border)', borderTop: '1px solid var(--border)', transform: 'rotate(45deg)', borderRadius: '3px 0 0 0' }} />

            {/* Header */}
            <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', ...GLASS_STRONG, borderBottom: '1px solid var(--hair)' }}>
              <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.3px', color: 'var(--ink)' }}>Inbox</div>
              {openCount > 0 && <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink3)' }}>{openCount} offen</div>}
              <div style={{ flex: 1 }} />
              <div onClick={() => setOpen(false)} style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--track)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </div>
            </div>

            {openCount === 0 ? (
              <div style={{ padding: '52px 24px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <div style={{ width: 56, height: 56, borderRadius: 17, background: 'var(--track)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)' }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 13l1.6-7.2A2 2 0 0 1 8.5 4h7a2 2 0 0 1 1.9 1.8L19 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" /></svg>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', marginTop: 16 }}>Nichts Offenes</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 6, maxWidth: 280, lineHeight: 1.5 }}>Alles zugeordnet. Wir sagen Bescheid, sobald etwas Neues reinkommt.</div>
              </div>
            ) : (
              <div style={{ padding: '8px 12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 8px 8px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Aktionen</div>
                  <div style={{ minWidth: 18, height: 18, padding: '0 6px', boxSizing: 'border-box', borderRadius: 9, background: 'var(--track)', color: 'var(--ink2)', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{openCount}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {inbox.map((a) => {
                    const s = eff(a)
                    const expanded = expandedId === a.id
                    const suggestion = sugg[a.id]
                    const areaProjects = projects.filter((p) => p.employer_id === s.area && (p.active === 1 || p.id === s.project))
                    const canAccept = s.area != null && s.status !== 'saving'
                    return (
                      <div key={a.id} style={{ borderRadius: 14, background: expanded ? 'var(--card)' : 'transparent', border: `1px solid ${expanded ? 'var(--border)' : 'transparent'}` }}>
                        <div onClick={() => pickRow(a)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer', borderRadius: 14 }}>
                          <div style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: s.area != null ? hexA(String(colorFor(s.area)).startsWith('#') ? String(colorFor(s.area)) : '#888888', 0.16) : 'var(--track)', flex: 'none' }}>{typeEmoji(a.type)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-0.2px', color: 'var(--ink)' }}>{typeLabel(a)}</div>
                              {!expanded && <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink3)' }}>· zuordnen</div>}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginTop: 2 }}>{fmtMetrics(a)}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{fmtTime(a.start_ts)}</div>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink3)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s ease' }}><path d="M6 9l6 6 6-6" /></svg>
                          </div>
                        </div>

                        {expanded && (
                          <div style={{ padding: '2px 14px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 9px' }}>
                              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Bereich</div>
                              {s.area == null && <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink3)' }}>· Bereich wählen</div>}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                              {sportAreas.map((e) => {
                                const on = s.area === e.id
                                return (
                                  <div key={e.id} onClick={() => patchSel(a.id, { area: e.id, project: null, status: 'idle' })} style={chip(on)}>
                                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: e.color || employerColor(e.id) }} />
                                    <span>{e.icon}</span>
                                    <span>{e.name}</span>
                                    {suggestion?.employer_id === e.id && suggestion.source !== 'none' && (
                                      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 6, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}>Vorschlag</span>
                                    )}
                                    {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                                  </div>
                                )
                              })}
                              {sportAreas.length === 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Kein Sport-Bereich vorhanden — in Verwalten einen Bereich als „Sport" markieren.</div>}
                            </div>

                            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', margin: '16px 0 9px' }}>Projekt</div>
                            {s.area != null ? (
                              areaProjects.length > 0 ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                                  {areaProjects.map((p) => {
                                    const on = s.project === p.id
                                    return (
                                      <div key={p.id} onClick={() => patchSel(a.id, { project: on ? null : p.id, status: 'idle' })} style={chip(on)}>
                                        <span>{p.name}</span>
                                        {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Keine Projekte in diesem Bereich (optional).</div>
                              )
                            ) : (
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Zuerst einen Bereich wählen.</div>
                            )}

                            <div style={{ marginTop: 14 }}>
                              {!s.noteOpen ? (
                                <div onClick={() => patchSel(a.id, { noteOpen: true })} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 800, color: 'var(--ink3)', cursor: 'pointer' }}>
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                                  Notiz hinzufügen
                                </div>
                              ) : (
                                <textarea value={s.note} onChange={(e) => patchSel(a.id, { note: e.target.value })} placeholder="Notiz…" rows={1} style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 40, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--hair)', background: 'var(--track)', color: 'var(--ink)', fontSize: 13.5, fontWeight: 600, outline: 'none', fontFamily: 'inherit' }} />
                              )}
                            </div>

                            {s.status === 'error' && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 13, padding: '9px 12px', borderRadius: 11, background: 'var(--track)', border: '1px solid var(--hair)' }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ink2)', flex: 'none' }}><path d="M10.3 4l-7 12A2 2 0 0 0 5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 16.5v.5" /></svg>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink2)' }}>Konnte nicht gespeichert werden. Bitte erneut versuchen.</div>
                              </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 15 }}>
                              <div onClick={() => accept(a)} style={{ padding: '10px 18px', borderRadius: 12, background: 'var(--accent)', color: '#fff', fontSize: 13.5, fontWeight: 800, cursor: canAccept ? 'pointer' : 'default', opacity: canAccept ? 1 : 0.45, pointerEvents: canAccept ? 'auto' : 'none', boxShadow: '0 8px 18px -8px color-mix(in srgb, var(--accent) 70%, transparent)' }}>{s.status === 'saving' ? 'Speichern…' : 'Übernehmen'}</div>
                              <div onClick={() => ignore(a)} style={{ padding: '10px 14px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, color: 'var(--ink3)', cursor: 'pointer' }}>Ignorieren</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {overdue.map((t) => (
                    <div key={`t${t.id}`} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 14 }}>
                      <div onClick={() => completeTodo(t)} title="Erledigen" style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--track)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink3)', flex: 'none', cursor: 'pointer' }}>
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></svg>
                      </div>
                      <div onClick={() => { setOpen(false); onOpenTodos() }} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800, letterSpacing: '-0.2px', color: 'var(--ink)' }}>{t.title}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginTop: 2 }}>Fällig {t.due_date}</div>
                      </div>
                      <div onClick={() => setTodoMenu(todoMenu === t.id ? null : t.id)} title="Erledigen / verschieben" style={{ width: 32, height: 32, borderRadius: 9, background: todoMenu === t.id ? 'var(--glass-strong)' : 'var(--track)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink2)', cursor: 'pointer', flex: 'none' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: todoMenu === t.id ? 'rotate(180deg)' : 'none', transition: 'transform .18s ease' }}><path d="M6 9l6 6 6-6" /></svg>
                      </div>

                      {todoMenu === t.id && (
                        <>
                          <div onClick={() => setTodoMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 4 }} />
                          <div style={{ position: 'absolute', top: 'calc(100% - 2px)', right: 10, zIndex: 5, minWidth: 216, borderRadius: 14, ...GLASS_STRONG, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 6 }}>
                            <div onClick={() => completeTodo(t)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 9, cursor: 'pointer' }}>
                              <div style={{ width: 18, height: 18, borderRadius: 6, border: '1.5px solid var(--ink3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                              </div>
                              <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)' }}>Erledigt</span>
                            </div>
                            <div style={{ height: 1, background: 'var(--hair)', margin: '5px 8px' }} />
                            <div style={{ padding: '6px 11px 4px', fontSize: 10.5, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Verschieben auf</div>
                            {[{ label: 'Morgen', v: addDaysKey(1) }, { label: 'In 3 Tagen', v: addDaysKey(3) }, { label: 'Nächste Woche', v: addDaysKey(7) }].map((o) => (
                              <div key={o.label} onClick={() => postponeTodo(t, o.v)} style={menuItem}>{o.label}</div>
                            ))}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px 4px' }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)' }}>Datum</span>
                              <input type="date" lang="de-DE" min={addDaysKey(1)} onChange={(e) => postponeTodo(t, e.target.value)} style={{ flex: 1, minWidth: 0, borderRadius: 10, border: '1px solid var(--hair)', background: 'var(--track)', padding: '8px 10px', fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Briefings – Platzhalter (WP5) */}
                <div style={{ padding: '16px 8px 8px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Briefings</div>
                </div>
                <div style={{ padding: '0 2px 4px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Kommt in WP5 (Morgen-/Abend-Briefing).</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
