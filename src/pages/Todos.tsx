import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { api, type Employer, type Project, type Todo, type TodoPatch } from '../api'
import { employerColor } from '../colors'
import type { PageIntent } from '../App'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GLASS: CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--border)',
}

const NEUTRAL = 'var(--accent, #22C55E)'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Fälligkeits-Label relativ zu heute, z. B. "Heute", "Morgen", "Mi 15.7.". */
function dueParts(due: string): { label: string; diffDays: number } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(`${due}T00:00:00`)
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (diffDays === 0) return { label: 'Heute', diffDays }
  if (diffDays === 1) return { label: 'Morgen', diffDays }
  if (diffDays === -1) return { label: 'Gestern', diffDays }
  return { label: d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }), diffDays }
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const WEEKDAYS: Record<string, number> = {
  sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6,
}

/** Ein natürlichsprachiges Datum in ein YYYY-MM-DD auflösen (deutsch). */
function resolvePhrase(p: string): string | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (p === 'heute') return dayKey(today)
  if (p === 'morgen') return dayKey(addDays(today, 1))
  if (p === 'übermorgen' || p === 'uebermorgen') return dayKey(addDays(today, 2))
  let mm = /^in\s+(\d+)\s+(?:tag|tage|tagen)$/.exec(p)
  if (mm) return dayKey(addDays(today, parseInt(mm[1], 10)))
  mm = /^in\s+(\d+)\s+(?:woche|wochen)$/.exec(p)
  if (mm) return dayKey(addDays(today, 7 * parseInt(mm[1], 10)))
  if (/^n[äa]chste\s+woche$/.test(p)) return dayKey(addDays(today, 7))
  if (p in WEEKDAYS) {
    const delta = (WEEKDAYS[p] - today.getDay() + 7) % 7
    return dayKey(addDays(today, delta))
  }
  mm = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(p)
  if (mm) {
    const day = +mm[1]
    const mon = +mm[2] - 1
    const yr = mm[3] ? (mm[3].length === 2 ? 2000 + +mm[3] : +mm[3]) : today.getFullYear()
    let d = new Date(yr, mon, day)
    d.setHours(0, 0, 0, 0)
    if (!mm[3] && d.getTime() < today.getTime()) d = new Date(yr + 1, mon, day)
    if (Number.isNaN(d.getTime()) || d.getMonth() !== mon) return null
    return dayKey(d)
  }
  return null
}

const DATE_RE =
  /(^|\s)(\+?)(heute|morgen|übermorgen|uebermorgen|in\s+\d+\s+(?:tag|tage|tagen|woche|wochen)|n[äa]chste\s+woche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)(?=\s|$)/gi

/** Letztes Datums-Phrase (optional mit +) im Text finden und (Datum, bereinigter Titel, Label) liefern. */
function parseGermanDue(text: string): { date: string; clean: string; label: string } | null {
  DATE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = DATE_RE.exec(text)) !== null) last = m
  if (!last) return null
  const date = resolvePhrase(last[3].toLowerCase())
  if (!date) return null
  const start = last.index + last[1].length
  const end = start + last[2].length + last[3].length
  const clean = (text.slice(0, start) + text.slice(end)).replace(/\s{2,}/g, ' ').trim()
  return { date, clean, label: dueParts(date).label }
}

// ---------------------------------------------------------------------------
// Editor popup
// ---------------------------------------------------------------------------

interface EditorState {
  id: number | null // null = neu
  title: string
  employerId: number | null
  projectId: number | null
  due: string
}

function TodoEditor({
  state,
  employers,
  projects,
  onChange,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  state: EditorState
  employers: Employer[]
  projects: Project[]
  onChange: (patch: Partial<EditorState>) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  busy: boolean
}) {
  const areaProjects = useMemo(
    () => projects.filter((p) => p.employer_id === state.employerId && (p.active === 1 || p.id === state.projectId)),
    [projects, state.employerId, state.projectId],
  )

  const chip = (on: boolean, color: string): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '8px 14px',
    borderRadius: 12,
    background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)',
    border: `1.5px solid ${on ? color : 'var(--border)'}`,
    color: 'var(--ink)',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  })

  return (
    <div
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 65, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560, maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .18s ease' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 30px 18px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>
            {state.id === null ? 'Neue Aufgabe' : 'Aufgabe bearbeiten'}
          </div>
          <div onClick={onClose} style={{ width: 40, height: 40, borderRadius: 13, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 18, fontWeight: 600 }}>✕</div>
        </div>

        <div style={{ padding: '4px 30px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Titel</div>
            <input
              value={state.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="Aufgabe benennen…"
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '14px 16px', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 17, fontWeight: 600, fontFamily: 'inherit', outline: 'none' }}
            />
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Bereich</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {employers.filter((emp) => emp.active === 1 || emp.id === state.employerId).map((emp) => {
                const on = emp.id === state.employerId
                const color = employerColor(emp.id)
                return (
                  <div key={emp.id} onClick={() => onChange({ employerId: on ? null : emp.id, projectId: null })} style={chip(on, color)}>
                    <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                    {emp.name}
                  </div>
                )
              })}
            </div>
          </div>

          {state.employerId !== null && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Projekt <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· optional</span></div>
              {areaProjects.length === 0 ? (
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink3)', marginTop: 10 }}>Keine Projekte für diesen Bereich.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  {areaProjects.map((p) => {
                    const on = p.id === state.projectId
                    const color = employerColor(p.employer_id)
                    return (
                      <div key={p.id} onClick={() => onChange({ projectId: on ? null : p.id })} style={chip(on, color)}>
                        <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                        {p.name}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Fällig am <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· optional</span></div>
            <input
              type="date" lang="de-DE"
              value={state.due}
              onChange={(e) => onChange({ due: e.target.value })}
              style={{ marginTop: 8, padding: '13px 16px', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', color: 'var(--ink)', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            {state.id !== null && (
              <div onClick={busy ? undefined : onDelete} style={{ padding: '14px 20px', borderRadius: 14, border: '1px solid var(--hair)', color: '#E5484D', fontWeight: 800, fontSize: 15, cursor: busy ? 'default' : 'pointer' }}>Löschen</div>
            )}
            <div style={{ flex: 1 }} />
            <div
              onClick={busy || state.title.trim().length === 0 ? undefined : onSave}
              style={{ padding: '14px 30px', borderRadius: 14, background: NEUTRAL, color: '#fff', fontWeight: 800, fontSize: 15, cursor: busy || state.title.trim().length === 0 ? 'default' : 'pointer', opacity: busy || state.title.trim().length === 0 ? 0.6 : 1, boxShadow: '0 8px 20px rgba(34,197,94,0.4)' }}
            >
              {busy ? 'Sichern…' : 'Sichern'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline-Composer (Apple-Erinnerungen-Stil: Titel + smarte Zuordnung)
// ---------------------------------------------------------------------------

interface QuickPayload {
  title: string
  employer_id: number | null
  project_id: number | null
  due_date: string | null
}

/** Tippbare @Bereich- / #Projekt-Tokens im Titel auflösen und entfernen. */
function resolveTokens(
  text: string,
  employers: Employer[],
  projects: Project[],
  emp: number | null,
  proj: number | null,
): { text: string; emp: number | null; proj: number | null } {
  const re = /([@#])([^\s@#]+)/g
  const strip: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const q = m[2].toLowerCase()
    if (m[1] === '@') {
      const hit = employers.find((e) => e.name.toLowerCase() === q) ?? employers.find((e) => e.name.toLowerCase().startsWith(q))
      if (hit) { emp = hit.id; strip.push([m.index, m.index + m[0].length]) }
    } else {
      const pool = emp != null ? projects.filter((p) => p.employer_id === emp) : projects
      const hit = pool.find((p) => p.name.toLowerCase() === q) ?? pool.find((p) => p.name.toLowerCase().startsWith(q))
      if (hit) { proj = hit.id; emp = hit.employer_id; strip.push([m.index, m.index + m[0].length]) }
    }
  }
  let out = text
  for (let i = strip.length - 1; i >= 0; i--) out = out.slice(0, strip[i][0]) + out.slice(strip[i][1])
  return { text: out.replace(/\s{2,}/g, ' ').trim(), emp, proj }
}

function InlineComposer({
  employers,
  projects,
  onAdd,
}: {
  employers: Employer[]
  projects: Project[]
  onAdd: (payload: QuickPayload) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [employerId, setEmployerId] = useState<number | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [due, setDue] = useState('')
  const [dueManual, setDueManual] = useState(false)
  const [menu, setMenu] = useState<'area' | 'proj' | 'due' | null>(null)
  const [adding, setAdding] = useState(false)
  const [activeSug, setActiveSug] = useState(0)
  const [sugClosed, setSugClosed] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const employersById = useMemo(() => new Map(employers.map((e) => [e.id, e])), [employers])
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // @Bereich / #Projekt / +Frist als Token am Wort-Ende → Vorschläge
  const token = /(^|\s)([@#+])([^\s@#+]*)$/.exec(title)
  const tokenChar = token?.[2] as '@' | '#' | '+' | undefined
  const tokenQuery = token?.[3] ?? ''
  const titleBase = token ? title.slice(0, token.index + token[1].length) : title

  interface Suggestion { key: string; dot?: string; prefix: string; label: string; pick: () => void }

  const suggestions: Suggestion[] = useMemo(() => {
    if (!token) return []
    const q = tokenQuery.toLowerCase()
    if (tokenChar === '@') {
      return employers
        .filter((e) => e.name.toLowerCase().includes(q))
        .slice(0, 6)
        .map((e) => ({ key: `@${e.id}`, dot: employerColor(e.id), prefix: '@', label: e.name, pick: () => { setTitle(titleBase); setEmployerId(e.id); setProjectId(null); inputRef.current?.focus() } }))
    }
    if (tokenChar === '#') {
      const pool = employerId != null ? projects.filter((p) => p.employer_id === employerId) : projects
      return pool
        .filter((p) => p.name.toLowerCase().includes(q))
        .slice(0, 7)
        .map((p) => ({ key: `#${p.id}`, dot: employerColor(p.employer_id), prefix: '#', label: p.name, pick: () => { setTitle(titleBase); setProjectId(p.id); setEmployerId(p.employer_id); inputRef.current?.focus() } }))
    }
    // '+': Frist
    const opts = [
      { label: 'Heute', date: dayKey(new Date()) },
      { label: 'Morgen', date: dayKey(addDays(new Date(), 1)) },
      { label: 'Übermorgen', date: dayKey(addDays(new Date(), 2)) },
      { label: 'Nächste Woche', date: dayKey(addDays(new Date(), 7)) },
    ]
    const list = opts.filter((o) => o.label.toLowerCase().includes(q))
    const parsed = q ? resolvePhrase(q) : null
    if (parsed && !list.some((o) => o.date === parsed)) list.unshift({ label: dueParts(parsed).label, date: parsed })
    return list.map((o) => ({ key: `+${o.date}`, prefix: '+', label: o.label, pick: () => { setTitle(titleBase); setDue(o.date); setDueManual(true); inputRef.current?.focus() } }))
  }, [token, tokenChar, tokenQuery, titleBase, employers, projects, employerId])

  const liveDue = !dueManual ? parseGermanDue(title) : null
  const effectiveDue = dueManual ? (due || null) : (liveDue?.date ?? null)
  const dueLabel = effectiveDue ? dueParts(effectiveDue).label : null

  // Beim Tippen eines neuen Tokens: Auswahl zurücksetzen und Dropdown wieder öffnen.
  useEffect(() => {
    setActiveSug(0)
    setSugClosed(false)
  }, [tokenChar, tokenQuery])

  const sugOpen = suggestions.length > 0 && !sugClosed

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (sugOpen) { setSugClosed(true); e.preventDefault() }
      else if (menu) { setMenu(null); e.preventDefault() }
      return
    }
    if (sugOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setActiveSug((i) => (e.key === 'ArrowDown' ? (i + 1) % suggestions.length : (i - 1 + suggestions.length) % suggestions.length))
      return
    }
    if (e.key === 'Enter') {
      // Offenes Dropdown → Auswahl bestätigen statt Aufgabe anlegen.
      if (sugOpen) { e.preventDefault(); suggestions[Math.min(activeSug, suggestions.length - 1)]?.pick(); return }
      if (menu) { e.preventDefault(); setMenu(null); return }
      void submit()
    }
  }

  async function submit() {
    if (adding) return
    const resolved = resolveTokens(title, employers, projects, employerId, projectId)
    let finalTitle = resolved.text
    let dueDate: string | null
    if (dueManual) {
      dueDate = due || null
    } else {
      const p = parseGermanDue(finalTitle)
      dueDate = p?.date ?? null
      if (p) finalTitle = p.clean
    }
    finalTitle = finalTitle.trim()
    if (finalTitle.length === 0) return
    setAdding(true)
    try {
      await onAdd({ title: finalTitle, employer_id: resolved.emp, project_id: resolved.proj, due_date: dueDate })
      setTitle('')
      setEmployerId(null)
      setProjectId(null)
      setDue('')
      setDueManual(false)
      setMenu(null)
      inputRef.current?.focus()
    } finally {
      setAdding(false)
    }
  }

  const pill = (active: boolean, color?: string): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 11px',
    borderRadius: 11,
    background: active && color ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)',
    border: `1.5px solid ${active && color ? color : 'var(--border)'}`,
    color: active ? 'var(--ink)' : 'var(--ink2)',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  })

  const menuBox: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    zIndex: 30,
    minWidth: 200,
    maxHeight: 260,
    overflowY: 'auto',
    borderRadius: 14,
    background: 'var(--screen)',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow)',
    padding: 6,
  }
  const menuItem: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }

  const areaProjects = employerId != null ? projects.filter((p) => p.employer_id === employerId) : projects
  const selEmp = employerId != null ? employersById.get(employerId) : undefined
  const selProj = projectId != null ? projectsById.get(projectId) : undefined

  return (
    <div style={{ position: 'relative', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', borderRadius: 14, background: 'var(--cell)', border: '1px solid var(--border)' }}>
        <div style={{ width: 24, height: 24, borderRadius: 8, border: `2px dashed ${selEmp ? employerColor(selEmp.id) : 'var(--ink3)'}`, flex: 'none' }} />
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKey}
          placeholder={'Neue Aufgabe …   @Bereich  #Projekt  +Frist'}
          style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit' }}
        />
        {title.trim().length > 0 && (
          <div onClick={() => void submit()} title="Hinzufügen (Enter)" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 9, background: NEUTRAL, color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>↵</div>
        )}
      </div>

      {/* Token-Vorschläge (@Bereich / #Projekt / +Frist) */}
      {sugOpen && (
        <div style={{ ...menuBox, left: 44 }}>
          {suggestions.map((s, i) => {
            const active = i === Math.min(activeSug, suggestions.length - 1)
            return (
              <div key={s.key} onClick={s.pick} onMouseEnter={() => setActiveSug(i)} style={{ ...menuItem, background: active ? 'var(--glass-strong)' : 'transparent' }}>
                {s.dot ? <div style={{ width: 10, height: 10, borderRadius: 3, background: s.dot }} /> : <span style={{ color: '#2563EB', fontWeight: 800 }}>{s.prefix}</span>}
                {s.dot && <span style={{ color: 'var(--ink3)', fontWeight: 800 }}>{s.prefix}</span>}
                {s.label}
              </div>
            )
          })}
        </div>
      )}

      {/* Quick-Attribut-Leiste */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 2, position: 'relative' }}>
        {/* Bereich */}
        <div style={{ position: 'relative' }}>
          <div onClick={() => setMenu(menu === 'area' ? null : 'area')} style={pill(selEmp != null, selEmp ? employerColor(selEmp.id) : undefined)}>
            {selEmp && <div style={{ width: 8, height: 8, borderRadius: 3, background: employerColor(selEmp.id) }} />}
            {selEmp ? selEmp.name : '＋ Bereich'}
          </div>
          {menu === 'area' && (
            <div style={menuBox}>
              <div onClick={() => { setEmployerId(null); setProjectId(null); setMenu(null) }} style={{ ...menuItem, color: 'var(--ink3)' }}>Kein Bereich</div>
              {employers.map((e) => (
                <div key={e.id} onClick={() => { setEmployerId(e.id); setProjectId(null); setMenu(null) }} style={menuItem}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: employerColor(e.id) }} />
                  {e.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Projekt */}
        <div style={{ position: 'relative' }}>
          <div onClick={() => setMenu(menu === 'proj' ? null : 'proj')} style={pill(selProj != null, selProj ? employerColor(selProj.employer_id) : undefined)}>
            {selProj && <div style={{ width: 8, height: 8, borderRadius: 3, background: employerColor(selProj.employer_id) }} />}
            {selProj ? selProj.name : '＋ Projekt'}
          </div>
          {menu === 'proj' && (
            <div style={menuBox}>
              {areaProjects.length === 0 ? (
                <div style={{ ...menuItem, color: 'var(--ink3)', cursor: 'default' }}>Keine Projekte</div>
              ) : (
                <>
                  <div onClick={() => { setProjectId(null); setMenu(null) }} style={{ ...menuItem, color: 'var(--ink3)' }}>Kein Projekt</div>
                  {areaProjects.map((p) => (
                    <div key={p.id} onClick={() => { setProjectId(p.id); setEmployerId(p.employer_id); setMenu(null) }} style={menuItem}>
                      <div style={{ width: 10, height: 10, borderRadius: 3, background: employerColor(p.employer_id) }} />
                      {p.name}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Frist */}
        <div style={{ position: 'relative' }}>
          <div onClick={() => setMenu(menu === 'due' ? null : 'due')} style={pill(effectiveDue != null, effectiveDue ? '#2563EB' : undefined)}>
            {dueLabel ?? '＋ Frist'}
          </div>
          {menu === 'due' && (
            <div style={{ ...menuBox, minWidth: 220 }}>
              {[
                { label: 'Heute', v: dayKey(new Date()) },
                { label: 'Morgen', v: dayKey(addDays(new Date(), 1)) },
                { label: 'Nächste Woche', v: dayKey(addDays(new Date(), 7)) },
              ].map((o) => (
                <div key={o.label} onClick={() => { setDue(o.v); setDueManual(true); setMenu(null) }} style={menuItem}>{o.label}</div>
              ))}
              <div style={{ padding: '8px 11px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)' }}>Datum</span>
                <input
                  type="date" lang="de-DE"
                  value={dueManual ? due : (liveDue?.date ?? '')}
                  onChange={(e) => { setDue(e.target.value); setDueManual(true) }}
                  style={{ flex: 1, borderRadius: 10, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '8px 10px', fontSize: 14, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
                />
              </div>
              {effectiveDue && (
                <div onClick={() => { setDue(''); setDueManual(true); setMenu(null) }} style={{ ...menuItem, color: '#E5484D' }}>Entfernen</div>
              )}
            </div>
          )}
        </div>

        {liveDue && !dueManual && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>· aus Text erkannt</span>
        )}
      </div>

      {menu && <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Aufgaben-Zeile mit Wisch-Gesten (rechts = Favorit, links = löschen)
// ---------------------------------------------------------------------------

function TodoRow({
  t,
  color,
  subName,
  onGripDown,
  onToggleDone,
  onOpen,
  onFavorite,
  onDelete,
}: {
  t: Todo
  color: string
  subName: string
  onGripDown: (e: React.PointerEvent) => void
  onToggleDone: () => void
  onOpen: () => void
  onFavorite: () => void
  onDelete: () => void
}) {
  const [dx, setDx] = useState(0)
  const suppress = useRef(false)
  const done = t.done === 1
  const fav = t.favorite === 1
  const due = t.due_date ? dueParts(t.due_date) : null
  const dueColor = done ? 'var(--ink3)' : due && due.diffDays < 0 ? '#E5484D' : due && due.diffDays === 0 ? 'var(--accent, #16A34A)' : 'var(--ink2)'
  const TH = 84

  function onPointerDown(e: React.PointerEvent) {
    const startX = e.clientX
    const move = (ev: PointerEvent) => setDx(ev.clientX - startX)
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      const d = ev.clientX - startX
      setDx(0)
      if (Math.abs(d) > 6) {
        suppress.current = true
        setTimeout(() => (suppress.current = false), 60)
      }
      if (d >= TH) onFavorite()
      else if (d <= -TH) onDelete()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const revealRight = dx > 0
  const pass = Math.abs(dx) >= TH

  return (
    <div data-todo-id={t.id} data-flip-key={String(t.id)} style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', marginBottom: 8, touchAction: 'pan-y' }}>
      {/* Aktions-Hintergrund */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: revealRight ? 'flex-start' : 'flex-end', padding: '0 22px', color: '#fff', fontWeight: 800, fontSize: 15, background: revealRight ? '#F59E0B' : '#E5484D', opacity: dx === 0 ? 0 : 1 }}>
        {revealRight ? (
          <span>{fav ? '★ Fokus lösen' : '★ Fokus'}</span>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
            <path d="M6 6l1 14a1.5 1.5 0 0 0 1.5 1.4h7A1.5 1.5 0 0 0 17 20L18 6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        )}
      </div>
      {/* Vordergrund (ziehbar) */}
      <div
        onPointerDown={onPointerDown}
        onClick={() => { if (suppress.current) return; onOpen() }}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', background: 'var(--cell)', border: `1px solid ${fav ? '#F59E0B' : 'var(--border)'}`, borderRadius: 14, cursor: 'pointer', transform: `translateX(${dx}px)`, transition: dx === 0 ? 'transform .22s cubic-bezier(.22,.61,.36,1)' : 'none', boxShadow: pass ? '0 6px 18px var(--hair)' : 'none', userSelect: 'none' }}
      >
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleDone() }}
          style={{ width: 24, height: 24, borderRadius: 8, border: `2px solid ${done ? color : 'var(--ink3)'}`, background: done ? color : 'transparent', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14, fontWeight: 800, flex: 'none' }}
        >
          {done ? '✓' : ''}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {fav && <span style={{ color: '#F59E0B', fontSize: 14, flex: 'none' }}>★</span>}
            <div style={{ fontSize: 16, fontWeight: 700, color: done ? 'var(--ink3)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--ink2)' }}>
              <div style={{ width: 8, height: 8, borderRadius: 3, background: color }} />
              {subName}
            </div>
            {due && <div style={{ fontSize: 12, fontWeight: 700, color: dueColor, fontVariantNumeric: 'tabular-nums' }}>{due.label}</div>}
          </div>
        </div>
        {/* Greifpunkt zum Sortieren */}
        <div
          onPointerDown={(e) => { e.stopPropagation(); onGripDown(e) }}
          onClick={(e) => e.stopPropagation()}
          title="Ziehen zum Sortieren / Verschieben"
          style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 30, marginRight: -2, color: 'var(--ink3)', cursor: 'grab', touchAction: 'none' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="5" r="1.7" /><circle cx="15" cy="5" r="1.7" />
            <circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" />
            <circle cx="9" cy="19" r="1.7" /><circle cx="15" cy="19" r="1.7" />
          </svg>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mitschwebender Klon des gezogenen To-dos (folgt dem Cursor)
// ---------------------------------------------------------------------------

function DragClone({
  todo,
  meta,
  init,
  theme,
  color,
  subName,
}: {
  todo: Todo
  meta: { rowH: number; grabDX: number; grabDY: number; width: number }
  init: { x: number; y: number }
  theme: 'light' | 'dark'
  color: string
  subName: string
}) {
  const [pos, setPos] = useState(init)
  useEffect(() => {
    const move = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])
  const done = todo.done === 1
  const fav = todo.favorite === 1
  const due = todo.due_date ? dueParts(todo.due_date) : null
  return createPortal(
    <div data-theme={theme} style={{ position: 'fixed', zoom: 0.9, left: (pos.x - meta.grabDX) / 0.9, top: (pos.y - meta.grabDY) / 0.9, width: meta.width / 0.9, zIndex: 9999, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', background: 'var(--cell)', border: `1px solid ${fav ? '#F59E0B' : 'var(--border)'}`, borderRadius: 14, boxShadow: '0 22px 44px rgba(0,0,0,0.30)', transform: 'scale(1.03)' }}>
        <div style={{ width: 24, height: 24, borderRadius: 8, border: `2px solid ${done ? color : 'var(--ink3)'}`, background: done ? color : 'transparent', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14, fontWeight: 800, flex: 'none' }}>{done ? '✓' : ''}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {fav && <span style={{ color: '#F59E0B', fontSize: 14 }}>★</span>}
            <div style={{ fontSize: 16, fontWeight: 700, color: done ? 'var(--ink3)' : 'var(--ink)', textDecoration: done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{todo.title}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: 'var(--ink2)' }}>
              <div style={{ width: 8, height: 8, borderRadius: 3, background: color }} />
              {subName}
            </div>
            {due && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{due.label}</div>}
          </div>
        </div>
        <div style={{ width: 30, display: 'grid', placeItems: 'center', color: 'var(--ink3)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.7" /><circle cx="15" cy="5" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="19" r="1.7" /><circle cx="15" cy="19" r="1.7" /></svg>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface TodosProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onBack: () => void
  onOpenCalendar: () => void
  onOpenSpotlight: () => void
  intent: PageIntent | null
  onIntentDone: () => void
}

export default function Todos({ theme, onToggleTheme, onBack, onOpenCalendar, onOpenSpotlight, intent, onIntentDone }: TodosProps) {
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [busy, setBusy] = useState(false)
  const [filterArea, setFilterArea] = useState<number | 'all'>('all')
  const [filterDue, setFilterDue] = useState<'all' | 'overdue' | 'today' | 'week' | 'dated' | 'undated'>('all')
  const [filterFocus, setFilterFocus] = useState(false)
  const [groupBy, setGroupBy] = useState<'frist' | 'bereich'>('frist')
  const [filterMenu, setFilterMenu] = useState<'area' | 'due' | null>(null)
  const [dragTodo, setDragTodo] = useState<Todo | null>(null)
  const [dragInit, setDragInit] = useState<{ x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ groupKey: string; index: number } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 'new-todo' aus Hotkey/Spotlight: Eingabefeld des Composers fokussieren.
  const lastIntentNonce = useRef(0)
  useEffect(() => {
    if (!intent || intent.nonce === lastIntentNonce.current) return
    lastIntentNonce.current = intent.nonce
    if (intent.action === 'new-todo') {
      setTimeout(() => {
        const el = document.querySelector<HTMLInputElement>('input[placeholder^="Neue Aufgabe"]')
        el?.focus()
      }, 30)
    }
    onIntentDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  const dropRef = useRef<{ groupKey: string; index: number } | null>(null)
  const dragMetaRef = useRef<{ rowH: number; grabDX: number; grabDY: number; width: number } | null>(null)
  const snapRef = useRef<{ groups: { key: string; top: number; bottom: number }[]; items: { id: number; groupKey: string; mid: number }[] } | null>(null)
  const flipRef = useRef<Map<string, DOMRect>>(new Map())

  async function loadTodos() {
    setTodos(await api.getTodos())
  }

  useEffect(() => {
    let alive = true
    Promise.all([api.getEmployers(), api.getProjects(), api.getTodos()])
      .then(([emp, proj, tds]) => {
        if (!alive) return
        setEmployers(emp)
        setProjects(proj)
        setTodos(tds)
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const employersById = useMemo(() => new Map(employers.map((e) => [e.id, e])), [employers])
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  const today = dayKey(new Date())

  const filteredTodos = useMemo(() => {
    const weekEnd = dayKey(addDays(new Date(), 7))
    return todos.filter((t) => {
      if (filterArea !== 'all' && t.employer_id !== filterArea) return false
      if (filterFocus && t.favorite !== 1) return false
      const d = t.due_date
      if (filterDue === 'overdue' && !(d != null && d < today)) return false
      if (filterDue === 'today' && d !== today) return false
      if (filterDue === 'week' && !(d != null && d >= today && d <= weekEnd)) return false
      if (filterDue === 'dated' && d == null) return false
      if (filterDue === 'undated' && d != null) return false
      return true
    })
  }, [todos, today, filterArea, filterDue, filterFocus])

  const anyFilter = filterArea !== 'all' || filterDue !== 'all' || filterFocus

  // Gruppierung: standardmäßig nach Tagen (Frist), alternativ nach Bereich.
  const groups = useMemo(() => {
    const open = filteredTodos.filter((t) => t.done === 0)
    const done = filteredTodos.filter((t) => t.done === 1)
    const bySort = (arr: Todo[]) => [...arr].sort((a, b) => a.sort_order - b.sort_order) // manuelle Reihenfolge
    const out: { key: string; label: string; accent: string; items: Todo[] }[] = []

    if (groupBy === 'bereich') {
      for (const e of employers) {
        const items = bySort(open.filter((t) => t.employer_id === e.id))
        if (items.length) out.push({ key: `emp-${e.id}`, label: e.name, accent: employerColor(e.id), items })
      }
      const none = bySort(open.filter((t) => t.employer_id == null))
      if (none.length) out.push({ key: 'emp-none', label: 'Ohne Bereich', accent: 'var(--ink3)', items: none })
    } else {
      const overdue = bySort(open.filter((t) => t.due_date != null && t.due_date < today))
      if (overdue.length) out.push({ key: 'overdue', label: 'Überfällig', accent: '#E5484D', items: overdue })
      const byDate = new Map<string, Todo[]>()
      for (const t of open) {
        if (t.due_date == null || t.due_date < today) continue
        const arr = byDate.get(t.due_date) ?? []
        arr.push(t)
        byDate.set(t.due_date, arr)
      }
      for (const k of [...byDate.keys()].sort()) {
        out.push({ key: `day-${k}`, label: dueParts(k).label, accent: 'var(--ink3)', items: bySort(byDate.get(k)!) })
      }
      const undated = bySort(open.filter((t) => t.due_date == null))
      if (undated.length) out.push({ key: 'undated', label: 'Ohne Termin', accent: 'var(--ink3)', items: undated })
    }

    if (done.length) out.push({ key: 'done', label: 'Erledigt', accent: 'var(--ink3)', items: bySort(done) })
    return out
  }, [filteredTodos, today, groupBy, employers])

  function todoColor(t: Todo): string {
    return t.employer_id != null ? employerColor(t.employer_id) : NEUTRAL
  }

  function todoSubName(t: Todo): string {
    if (t.project_id != null) return projectsById.get(t.project_id)?.name ?? 'Projekt'
    if (t.employer_id != null) return employersById.get(t.employer_id)?.name ?? 'Bereich'
    return 'Ohne Bereich'
  }

  async function toggleDone(t: Todo) {
    // optimistisch umschalten
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: x.done === 1 ? 0 : 1 } : x)))
    try {
      await api.updateTodo(t.id, { done: t.done !== 1 })
    } catch {
      await loadTodos()
    }
  }

  // Rechts-Wisch: Favorit umschalten (optimistisch).
  async function toggleFavorite(t: Todo) {
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, favorite: x.favorite === 1 ? 0 : 1 } : x)))
    try {
      await api.updateTodo(t.id, { favorite: t.favorite !== 1 })
    } catch {
      await loadTodos()
    }
  }

  // Links-Wisch: löschen (optimistisch, mit Rückrollen bei Fehler).
  async function removeTodo(t: Todo) {
    const prev = todos
    setTodos((p) => p.filter((x) => x.id !== t.id))
    try {
      await api.deleteTodo(t.id)
    } catch {
      setTodos(prev)
    }
  }

  // --- Drag & Drop (Greifpunkt, mitschwebender Klon + FLIP-Animation) -----
  function computeDropTarget(clientY: number, dragId: number) {
    const snap = snapRef.current
    if (!snap || snap.groups.length === 0) return
    let gk = snap.groups.find((g) => clientY >= g.top && clientY <= g.bottom)?.key
    if (!gk) gk = clientY < snap.groups[0].top ? snap.groups[0].key : snap.groups[snap.groups.length - 1].key
    const its = snap.items.filter((i) => i.groupKey === gk && i.id !== dragId)
    let index = its.length
    for (let i = 0; i < its.length; i++) {
      if (clientY < its[i].mid) { index = i; break }
    }
    const cur = dropRef.current
    if (!cur || cur.groupKey !== gk || cur.index !== index) {
      dropRef.current = { groupKey: gk!, index }
      setDropTarget({ groupKey: gk!, index })
    }
  }

  function startDrag(t: Todo, e: React.PointerEvent) {
    e.preventDefault()
    const root = listRef.current
    const rowEl = (e.target as HTMLElement).closest<HTMLElement>('[data-todo-id]')
    if (!root || !rowEl) return
    const rect = rowEl.getBoundingClientRect()
    dragMetaRef.current = { rowH: rect.height + 8, grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top, width: rect.width }

    // Geometrie-Schnappschuss (natürliche Positionen) für stabiles Hit-Testing.
    const gEls = Array.from(root.querySelectorAll<HTMLElement>('[data-group-key]'))
    const groupsSnap = gEls.map((g) => { const r = g.getBoundingClientRect(); return { key: g.getAttribute('data-group-key') ?? '', top: r.top, bottom: r.bottom } })
    const itemEls = Array.from(root.querySelectorAll<HTMLElement>('[data-todo-id]'))
    const itemsSnap = itemEls.map((el) => { const r = el.getBoundingClientRect(); return { id: Number(el.dataset.todoId), groupKey: el.closest<HTMLElement>('[data-group-key]')?.getAttribute('data-group-key') ?? '', mid: r.top + r.height / 2 } })
    snapRef.current = { groups: groupsSnap, items: itemsSnap }

    // Startposition = aktueller Slot (kein Sprung beim Aufnehmen).
    const self = itemsSnap.find((i) => i.id === t.id)
    const gk = self?.groupKey ?? ''
    let startIndex = 0
    for (const i of itemsSnap) if (i.groupKey === gk && i.id !== t.id && self && i.mid < self.mid) startIndex++
    dropRef.current = { groupKey: gk, index: startIndex }
    setDropTarget({ groupKey: gk, index: startIndex })

    flipRef.current.clear()
    setDragTodo(t)
    setDragInit({ x: e.clientX, y: e.clientY })

    const move = (ev: PointerEvent) => computeDropTarget(ev.clientY, t.id)
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      finishDrag(t.id)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  function finishDrag(id: number) {
    const dt = dropRef.current
    setDragTodo(null)
    setDragInit(null)
    setDropTarget(null)
    dropRef.current = null
    snapRef.current = null
    flipRef.current.clear()
    if (!dt) return
    const g = groups.find((x) => x.key === dt.groupKey)
    const t = todos.find((x) => x.id === id)
    if (!g || !t) return

    // dt.index ist im „ohne gezogenes Element"-Raum → direkt Nachbarn bestimmen.
    const list = g.items.filter((x) => x.id !== id)
    const idx = Math.max(0, Math.min(dt.index, list.length))
    const before = idx > 0 ? list[idx - 1] : null
    const after = idx < list.length ? list[idx] : null
    const newSort = before && after ? (before.sort_order + after.sort_order) / 2 : before ? before.sort_order + 1 : after ? after.sort_order - 1 : 1

    const patch: TodoPatch = { sort_order: newSort }
    if (g.key === 'done') patch.done = true
    else if (t.done === 1) patch.done = false

    if (groupBy === 'frist') {
      if (g.key.startsWith('day-')) patch.due_date = g.key.slice(4)
      else if (g.key === 'undated') patch.due_date = null
      // 'overdue': Frist bleibt unverändert
    } else if (g.key === 'emp-none') {
      patch.employer_id = null
      patch.project_id = null
    } else if (g.key.startsWith('emp-')) {
      const empId = Number(g.key.slice(4))
      patch.employer_id = empId
      if (t.project_id != null && projectsById.get(t.project_id)?.employer_id !== empId) patch.project_id = null
    }

    // optimistisch anwenden
    setTodos((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x
        const nx: Todo = { ...x, sort_order: newSort }
        if ('due_date' in patch) nx.due_date = patch.due_date ?? null
        if ('employer_id' in patch) nx.employer_id = patch.employer_id ?? null
        if ('project_id' in patch) nx.project_id = patch.project_id ?? null
        if ('done' in patch) nx.done = (patch.done ? 1 : 0) as 0 | 1
        return nx
      }),
    )
    api.updateTodo(id, patch).catch(() => loadTodos())
  }

  // FLIP: nach jedem Umsortieren die betroffenen Zeilen weich an ihre neue Position gleiten lassen.
  useLayoutEffect(() => {
    const root = listRef.current
    if (dragTodo == null || !root) {
      flipRef.current.clear()
      return
    }
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-flip-key]'))
    const next = new Map<string, DOMRect>()
    for (const el of els) next.set(el.getAttribute('data-flip-key') ?? '', el.getBoundingClientRect())
    const prev = flipRef.current
    for (const el of els) {
      const key = el.getAttribute('data-flip-key') ?? ''
      const pr = prev.get(key)
      const nr = next.get(key)!
      if (pr) {
        const dy = pr.top - nr.top
        if (Math.abs(dy) > 0.5) {
          // Liste sitzt in einem zoom:0.9-Container → gemessenes dy entsprechend umrechnen.
          el.style.transition = 'none'
          el.style.transform = `translateY(${dy / 0.9}px)`
          requestAnimationFrame(() => {
            el.style.transition = 'transform .2s cubic-bezier(.2,.7,.3,1)'
            el.style.transform = ''
          })
        }
      }
    }
    flipRef.current = next
  })

  // Anzeige-Gruppen: gezogenes Element entfernen, Platzhalter am Ziel einsetzen.
  const displayGroups = useMemo(() => {
    type Row = { type: 'todo'; t: Todo } | { type: 'placeholder' }
    const base = groups.map((g) => ({
      key: g.key,
      label: g.label,
      accent: g.accent,
      rows: g.items.filter((t) => t.id !== dragTodo?.id).map((t): Row => ({ type: 'todo', t })),
    }))
    if (dragTodo && dropTarget) {
      const tg = base.find((g) => g.key === dropTarget.groupKey)
      if (tg) tg.rows.splice(Math.max(0, Math.min(dropTarget.index, tg.rows.length)), 0, { type: 'placeholder' as const })
    }
    return base
  }, [groups, dragTodo, dropTarget])

  // Schnell-Anlegen aus der Inline-Zeile (Bereich/Projekt/Frist optional).
  async function addQuick(payload: QuickPayload) {
    await api.createTodo(payload)
    await loadTodos()
  }

  function openNew() {
    setEditor({ id: null, title: '', employerId: employers[0]?.id ?? null, projectId: null, due: '' })
  }

  function openEdit(t: Todo) {
    setEditor({ id: t.id, title: t.title, employerId: t.employer_id, projectId: t.project_id, due: t.due_date ?? '' })
  }

  async function saveEditor() {
    if (!editor || editor.title.trim().length === 0) return
    setBusy(true)
    try {
      const payload = {
        title: editor.title.trim(),
        due_date: editor.due ? editor.due : null,
        employer_id: editor.employerId,
        project_id: editor.projectId,
      }
      if (editor.id === null) await api.createTodo(payload)
      else await api.updateTodo(editor.id, payload)
      await loadTodos()
      setEditor(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function deleteEditor() {
    if (!editor || editor.id === null) return
    setBusy(true)
    try {
      await api.deleteTodo(editor.id)
      await loadTodos()
      setEditor(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const openCount = todos.filter((t) => t.done === 0).length
  const selFilterEmp = filterArea !== 'all' ? employersById.get(filterArea) : undefined
  const dueFilterLabels: Record<typeof filterDue, string> = {
    all: 'Frist: Alle', overdue: 'Überfällig', today: 'Heute', week: 'Diese Woche', dated: 'Mit Termin', undated: 'Ohne Termin',
  }
  const fpill = (active: boolean, color?: string): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 12,
    background: active && color ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)',
    border: `1.5px solid ${active ? (color ?? 'var(--ink3)') : 'var(--border)'}`,
    color: 'var(--ink)', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none',
  })
  const fmenu: CSSProperties = {
    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, minWidth: 190, maxHeight: 300, overflowY: 'auto',
    borderRadius: 14, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 6,
  }
  const fitem: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700, color: 'var(--ink)' }

  return (
    <div data-theme={theme} style={{ fontFamily: "-apple-system, system-ui, 'Manrope', sans-serif", height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div
        style={{
          zoom: 0.9,
          width: 'calc(100vw / 0.9)',
          height: 'calc(100vh / 0.9)',
          background: 'var(--screen)',
          overflow: 'hidden',
          position: 'relative',
          padding: '44px 68px',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        {/* top bar — Höhe & Icon-Cluster identisch zu Mein Tag, damit die Rundicons beim Wechsel nicht springen */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 45 }}>
          <div
            onClick={onBack}
            title="Zurück zu Mein Tag"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 16, ...GLASS, cursor: 'pointer', color: 'var(--ink)', fontSize: 14, fontWeight: 800 }}
          >
            ‹ Mein Tag
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              onClick={onOpenSpotlight}
              title="Suche (Spotlight)"
              style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </div>
            <div
              onClick={onOpenCalendar}
              title="Kalender"
              style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
                <path d="M3 9.5h18" />
                <path d="M8 2.5v4" />
                <path d="M16 2.5v4" />
              </svg>
            </div>
            <div
              onClick={onToggleTheme}
              title="Farbschema wechseln"
              style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}
            >
              {theme === 'light' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4.5" />
                  <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                </svg>
              )}
            </div>
          </div>
        </div>

        {/* hero */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 22 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '3px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Aufgaben</div>
            <div style={{ fontSize: 60, lineHeight: 0.9, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-2px', marginTop: 6 }}>To-Dos</div>
          </div>
          <div
            onClick={openNew}
            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 20px', borderRadius: 16, background: NEUTRAL, color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 10px 24px rgba(34,197,94,0.4)' }}
          >
            <span style={{ fontSize: 19, lineHeight: 1 }}>+</span> Aufgabe
          </div>
        </div>

        {/* Gruppierung + Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap', position: 'relative', zIndex: 5 }}>
          {/* Gruppierungs-Toggle */}
          <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, ...GLASS }}>
            {(['frist', 'bereich'] as const).map((g) => (
              <div key={g} onClick={() => setGroupBy(g)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: groupBy === g ? 'var(--ink)' : 'var(--ink3)', background: groupBy === g ? 'var(--glass-strong)' : 'transparent', boxShadow: groupBy === g ? '0 2px 8px var(--hair)' : 'none' }}>
                {g === 'frist' ? 'Nach Frist' : 'Nach Bereich'}
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Bereich-Filter */}
          <div style={{ position: 'relative' }}>
            <div onClick={() => setFilterMenu(filterMenu === 'area' ? null : 'area')} style={fpill(filterArea !== 'all', selFilterEmp ? employerColor(selFilterEmp.id) : undefined)}>
              {selFilterEmp && <div style={{ width: 9, height: 9, borderRadius: 3, background: employerColor(selFilterEmp.id) }} />}
              {selFilterEmp ? selFilterEmp.name : 'Bereich: Alle'}
            </div>
            {filterMenu === 'area' && (
              <div style={fmenu}>
                <div onClick={() => { setFilterArea('all'); setFilterMenu(null) }} style={{ ...fitem, color: filterArea === 'all' ? 'var(--ink)' : 'var(--ink2)' }}>Alle Bereiche</div>
                {employers.map((e) => (
                  <div key={e.id} onClick={() => { setFilterArea(e.id); setFilterMenu(null) }} style={fitem}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: employerColor(e.id) }} />
                    {e.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Frist-Filter */}
          <div style={{ position: 'relative' }}>
            <div onClick={() => setFilterMenu(filterMenu === 'due' ? null : 'due')} style={fpill(filterDue !== 'all', '#2563EB')}>
              {dueFilterLabels[filterDue]}
            </div>
            {filterMenu === 'due' && (
              <div style={fmenu}>
                {(['all', 'overdue', 'today', 'week', 'dated', 'undated'] as const).map((d) => (
                  <div key={d} onClick={() => { setFilterDue(d); setFilterMenu(null) }} style={{ ...fitem, color: d === 'overdue' ? '#E5484D' : 'var(--ink)' }}>
                    {d === 'all' ? 'Alle' : dueFilterLabels[d]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Fokus-Filter (rundes Icon, an/aus) */}
          <div
            onClick={() => setFilterFocus((f) => !f)}
            title="Nur Fokus-Aufgaben"
            style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 16, border: `1.5px solid ${filterFocus ? '#F59E0B' : 'var(--border)'}`, background: filterFocus ? 'color-mix(in srgb, #F59E0B 18%, transparent)' : 'var(--glass)', color: filterFocus ? '#F59E0B' : 'var(--ink3)' }}
          >
            ★
          </div>

          {filterMenu && <div onClick={() => setFilterMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />}
        </div>

        {/* list */}
        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: 22, paddingRight: 6 }}>
          {loading ? (
            <div style={{ color: 'var(--ink3)', fontWeight: 600, padding: '8px 2px' }}>Lädt…</div>
          ) : loadError ? (
            <div style={{ color: '#E5484D', fontWeight: 700, padding: '8px 2px' }}>{loadError}</div>
          ) : (
            <div style={{ maxWidth: 720 }}>
              <InlineComposer employers={employers} projects={projects} onAdd={addQuick} />

              {todos.length === 0 ? (
                <div style={{ color: 'var(--ink3)', fontWeight: 600, padding: '4px 2px' }}>Noch keine Aufgaben — tippe oben eine ein oder nutze „+ Aufgabe" für Details.</div>
              ) : groups.length === 0 && (
                <div style={{ color: 'var(--ink3)', fontWeight: 600, padding: '4px 2px' }}>{anyFilter ? 'Keine Aufgaben für diese Filter.' : 'Alles erledigt 🎉'}</div>
              )}

              {displayGroups.map((sec) => (
                <div key={sec.key} data-group-key={sec.key} style={{ marginBottom: 22 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: sec.accent, margin: '2px 0 10px 2px' }}>{sec.label}</div>
                  {sec.rows.map((row) =>
                    row.type === 'placeholder' ? (
                      <div key="__ph" data-flip-key="__ph" style={{ height: (dragMetaRef.current?.rowH ?? 68) - 8, marginBottom: 8, borderRadius: 14, background: 'var(--track)' }} />
                    ) : (
                      <TodoRow
                        key={row.t.id}
                        t={row.t}
                        color={todoColor(row.t)}
                        subName={todoSubName(row.t)}
                        onGripDown={(e) => startDrag(row.t, e)}
                        onToggleDone={() => void toggleDone(row.t)}
                        onOpen={() => openEdit(row.t)}
                        onFavorite={() => void toggleFavorite(row.t)}
                        onDelete={() => void removeTodo(row.t)}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && !loadError && (
          <div style={{ flex: 'none', paddingTop: 8, fontSize: 13, fontWeight: 700, color: 'var(--ink3)' }}>
            {openCount} offen · {todos.length - openCount} erledigt
          </div>
        )}

        {editor && (
          <TodoEditor
            state={editor}
            employers={employers}
            projects={projects}
            onChange={(patch) => setEditor((s) => (s ? { ...s, ...patch } : s))}
            onClose={() => setEditor(null)}
            onSave={saveEditor}
            onDelete={deleteEditor}
            busy={busy}
          />
        )}
      </div>

      {dragTodo && dragInit && dragMetaRef.current && (
        <DragClone todo={dragTodo} meta={dragMetaRef.current} init={dragInit} theme={theme} color={todoColor(dragTodo)} subName={todoSubName(dragTodo)} />
      )}
    </div>
  )
}
