import { useState, type CSSProperties } from 'react'
import { api, type Employer, type Entry, type Project } from '../api'
import { employerColor } from '../colors'
import TimeField from './TimeField'

const GLASS: CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--border)',
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function fmtClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
function isoFromDayTime(day: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = startOfDay(day)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toISOString()
}

const label: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }
const timeField: CSSProperties = { width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }

/**
 * Gemeinsamer Editor für eine erfasste Aktivität — genutzt von Mein Tag (24-Stunden-Uhr),
 * Kalender und Auswertung. Reihenfolge: Bereich, Projekt, Notiz, Start/Ende.
 */
export default function EntryEditor({
  entry,
  employers,
  projects,
  onClose,
  onSaved,
}: {
  entry: Entry
  employers: Employer[]
  projects: Project[]
  onClose: () => void
  onSaved: () => void
}) {
  const day = startOfDay(new Date(entry.start_ts))
  const [employerId, setEmployerId] = useState<number>(entry.employer_id)
  const [projectId, setProjectId] = useState<number | null>(entry.project_id)
  const [start, setStart] = useState(fmtClock(new Date(entry.start_ts)))
  const [end, setEnd] = useState(entry.end_ts ? fmtClock(new Date(entry.end_ts)) : fmtClock(new Date()))
  const [note, setNote] = useState(entry.note ?? '')
  const [busy, setBusy] = useState(false)

  const colorFor = (id: number) => employers.find((e) => e.id === id)?.color ?? employerColor(id)
  const areaList = employers.filter((e) => e.active === 1 || e.id === employerId)
  const areaProjects = projects.filter((p) => p.employer_id === employerId && (p.active === 1 || p.id === projectId))

  async function save() {
    setBusy(true)
    try {
      await api.updateEntry(entry.id, {
        employer_id: employerId,
        project_id: projectId,
        note: note.trim() ? note.trim() : null,
        start_ts: isoFromDayTime(day, start),
        end_ts: isoFromDayTime(day, end),
      })
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  async function del() {
    setBusy(true)
    try {
      await api.deleteEntry(entry.id)
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const chip = (on: boolean, color: string): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12, background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)', border: `1.5px solid ${on ? color : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' })

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxHeight: '88%', overflowY: 'auto', borderRadius: 28, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: '24px 26px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>Aktivität bearbeiten</div>
          <div onClick={onClose} style={{ width: 36, height: 36, borderRadius: 12, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 16, fontWeight: 600 }}>✕</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 2 }}>{day.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>

        {/* Bereich */}
        <div style={{ marginTop: 16 }}>
          <div style={label}>Bereich</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {areaList.map((e) => {
              const on = e.id === employerId
              const color = e.color || employerColor(e.id)
              return (
                <div key={e.id} onClick={() => { setEmployerId(e.id); if (e.id !== employerId) setProjectId(null) }} style={chip(on, color)}>
                  <div style={{ fontSize: 15 }}>{e.icon}</div>
                  {e.name}
                </div>
              )
            })}
          </div>
        </div>

        {/* Projekt */}
        {areaProjects.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={label}>Projekt</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {areaProjects.map((p) => {
                const on = p.id === projectId
                const color = colorFor(p.employer_id)
                return (
                  <div key={p.id} onClick={() => setProjectId(on ? null : p.id)} style={chip(on, color)}>
                    <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                    {p.name}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Notiz */}
        <div style={{ marginTop: 16 }}>
          <div style={label}>Notiz</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notiz" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
        </div>

        {/* Start / Ende */}
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <div style={{ flex: 1 }}><div style={label}>Start</div><TimeField value={start} onChange={setStart} style={timeField} /></div>
          <div style={{ flex: 1 }}><div style={label}>Ende</div><TimeField value={end} onChange={setEnd} style={timeField} /></div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
          <div onClick={busy ? undefined : del} style={{ padding: '13px 20px', borderRadius: 14, border: '1px solid var(--hair)', color: '#E5484D', fontWeight: 800, fontSize: 15, cursor: busy ? 'default' : 'pointer' }}>Löschen</div>
          <div style={{ flex: 1 }} />
          <div onClick={busy ? undefined : save} style={{ padding: '13px 30px', borderRadius: 14, background: 'var(--accent, #22C55E)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, boxShadow: '0 8px 20px rgba(34,197,94,0.4)' }}>{busy ? 'Sichern…' : 'Sichern'}</div>
        </div>
      </div>
    </div>
  )
}
