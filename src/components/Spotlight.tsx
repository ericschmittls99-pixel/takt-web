import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type Employer, type Entry, type Project, type Todo } from '../api'
import { COMMANDS, formatHotkey, type CommandId } from '../commands'

interface SpotlightProps {
  open: boolean
  theme: 'light' | 'dark'
  hotkeys: Record<string, string>
  onClose: () => void
  onRunCommand: (id: CommandId) => void
  onOpenDay: (day: Date) => void
  onOpenTodos: () => void
}

type Row =
  | { kind: 'command'; key: string; id: CommandId; label: string; icon: string; hotkey: string }
  | { kind: 'entry'; key: string; title: string; sub: string; day: Date }
  | { kind: 'todo'; key: string; title: string; sub: string }

function fmtDay(d: Date): string {
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Spotlight({ open, theme, hotkeys, onClose, onRunCommand, onOpenDay, onOpenTodos }: SpotlightProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [entries, setEntries] = useState<Entry[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Bei jedem Öffnen zurücksetzen und Daten (neu) laden.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = setTimeout(() => inputRef.current?.focus(), 20)
    Promise.all([api.getEntries(), api.getTodos(), api.getEmployers(), api.getProjects()])
      .then(([e, td, emp, proj]) => {
        setEntries(e)
        setTodos(td)
        setEmployers(emp)
        setProjects(proj)
      })
      .catch(() => {})
    return () => clearTimeout(t)
  }, [open])

  const empName = useMemo(() => new Map(employers.map((e) => [e.id, e.name])), [employers])
  const projName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    const out: Row[] = []

    // Funktionen: bei leerer Suche alle, sonst nach Label gefiltert.
    for (const c of COMMANDS) {
      if (q && !c.label.toLowerCase().includes(q)) continue
      out.push({ kind: 'command', key: `c-${c.id}`, id: c.id, label: c.label, icon: c.icon, hotkey: hotkeys[c.id] || '' })
    }

    // Einträge & To-Dos nur bei aktiver Suche.
    if (q) {
      let n = 0
      for (const e of entries) {
        const emp = e.employer_id != null ? empName.get(e.employer_id) ?? '' : ''
        const proj = e.project_id != null ? projName.get(e.project_id) ?? '' : ''
        const hay = `${e.note ?? ''} ${emp} ${proj}`.toLowerCase()
        if (!hay.includes(q)) continue
        const day = new Date(e.start_ts)
        const parts = [emp, proj].filter(Boolean).join(' · ')
        out.push({
          kind: 'entry',
          key: `e-${e.id}`,
          title: e.note?.trim() || parts || 'Eintrag',
          sub: `${fmtDay(day)}${parts && e.note?.trim() ? ` · ${parts}` : ''}`,
          day,
        })
        if (++n >= 8) break
      }
      let m = 0
      for (const t of todos) {
        if (!t.title.toLowerCase().includes(q)) continue
        out.push({
          kind: 'todo',
          key: `t-${t.id}`,
          title: t.title,
          sub: t.done ? 'To-Do · erledigt' : t.due_date ? `To-Do · fällig ${t.due_date}` : 'To-Do',
        })
        if (++m >= 8) break
      }
    }
    return out
  }, [query, entries, todos, empName, projName, hotkeys])

  // Aktiven Index in gültigem Bereich halten.
  useEffect(() => {
    setActive((a) => (rows.length === 0 ? 0 : Math.min(a, rows.length - 1)))
  }, [rows.length])

  if (!open) return null

  function execute(row: Row) {
    if (row.kind === 'command') {
      onRunCommand(row.id)
    } else if (row.kind === 'entry') {
      onOpenDay(row.day)
      onClose()
    } else {
      onOpenTodos()
      onClose()
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (rows.length === 0 ? 0 : (a + 1) % rows.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (rows.length === 0 ? 0 : (a - 1 + rows.length) % rows.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[active]
      if (row) execute(row)
    }
  }

  // Sektions-Überschrift vor dem ersten Eintrag/To-Do einer Art einblenden.
  let lastKind: Row['kind'] | null = null

  return (
    <div
      data-theme={theme}
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(6, 8, 16, 0.42)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '12vh 20px 20px',
        fontFamily: "-apple-system, system-ui, 'Manrope', sans-serif",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: 'min(640px, 100%)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--glass-strong)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          boxShadow: 'var(--shadow)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          overflow: 'hidden',
          animation: 'popIn 0.14s ease',
        }}
      >
        {/* Suchfeld */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--hair)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Funktionen, Einträge oder To-Dos suchen …"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          />
          <kbd style={badge}>Esc</kbd>
        </div>

        {/* Ergebnisliste */}
        <div className="no-scrollbar" style={{ overflowY: 'auto', padding: 8 }}>
          {rows.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 14, fontWeight: 700, color: 'var(--ink3)' }}>
              Keine Treffer
            </div>
          ) : (
            rows.map((row, i) => {
              const showHeader = row.kind !== lastKind
              lastKind = row.kind
              const isActive = i === active
              const header =
                row.kind === 'command' ? 'Funktionen' : row.kind === 'entry' ? 'Einträge' : 'To-Dos'
              return (
                <div key={row.key}>
                  {showHeader && (
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', padding: '10px 12px 6px' }}>
                      {header}
                    </div>
                  )}
                  <div
                    onMouseEnter={() => setActive(i)}
                    onClick={() => execute(row)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      background: isActive ? 'color-mix(in srgb, var(--accent, #22C55E) 16%, transparent)' : 'transparent',
                    }}
                  >
                    <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 16, background: 'var(--glass)', border: '1px solid var(--hair)', flex: 'none' }}>
                      {row.kind === 'command' ? row.icon : row.kind === 'entry' ? '🗓️' : '📝'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.kind === 'command' ? row.label : row.title}
                      </div>
                      {row.kind !== 'command' && (
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                          {row.sub}
                        </div>
                      )}
                    </div>
                    {row.kind === 'command' && row.hotkey && <kbd style={badge}>{formatHotkey(row.hotkey)}</kbd>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

const badge: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 800,
  color: 'var(--ink2)',
  background: 'var(--glass)',
  border: '1px solid var(--hair)',
  borderRadius: 7,
  padding: '3px 7px',
  whiteSpace: 'nowrap',
}
