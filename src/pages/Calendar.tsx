import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { api, type Absence, type AbsenceType, type AppSettings, type AreaHours, type Employer, type Entry, type PlannedBlock, type PlannedOverride, type Project } from '../api'
import { employerColor } from '../colors'
import EntryEditor from '../components/EntryEditor'
import TimeField from '../components/TimeField'
import { holidayName } from '../holidays'
import { distributeAbsenceMinutes } from '../absence'
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

const ZOOM = 0.9
const HOUR_H = 44
const NEUTRAL = 'var(--accent, #22C55E)'
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const ABS_LABEL: Record<AbsenceType, string> = { urlaub: 'Urlaub', krank: 'Krank', sonstiges: 'Sonstiges' }
const ABS_COLOR: Record<AbsenceType, string> = { urlaub: '#F59E0B', krank: '#E5484D', sonstiges: '#5B6577' }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function minToHHMM(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`
}
function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes()
}
function monIndex(d: Date): number {
  return (d.getDay() + 6) % 7
}
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
}
function snap15(m: number): number {
  return Math.round(m / 15) * 15
}
function csvEscape(v: string | number | null): string {
  const s = String(v ?? '')
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function buildCsv(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(';')).join('\r\n')
}
function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface PlanBlock {
  key: string
  employer_id: number
  project_id: number | null
  start_min: number
  end_min: number
  templateId: number | null
  overrideId: number | null
}

interface Draft {
  block: PlanBlock | null
  planner: boolean
  weekday: number
  date: string
  employerId: number | null
  projectId: number | null
  start: string
  end: string
  scope: 'day' | 'plan'
  splitAt: string // HH:MM für "Teilen bei"
  kind?: 'plan' | 'log' // 'log' = Ist-Aktivität erfassen (nur neue Blöcke in der Wochenansicht)
  note?: string
}

function sameBlock(b: PlanBlock, edited: PlanBlock | null): boolean {
  if (!edited) return false
  if (edited.templateId != null && b.templateId === edited.templateId) return true
  if (edited.overrideId != null && b.overrideId === edited.overrideId) return true
  return false
}

function computeShifts(others: PlanBlock[], s: number, e: number): { block: PlanBlock; start: number; end: number }[] {
  const sorted = [...others].sort((a, b) => a.start_min - b.start_min)
  let cursor = e
  const shifts: { block: PlanBlock; start: number; end: number }[] = []
  for (const b of sorted) {
    if (b.end_min <= s) continue
    if (b.start_min >= cursor) {
      cursor = Math.max(cursor, b.end_min)
      continue
    }
    const dur = b.end_min - b.start_min
    shifts.push({ block: b, start: cursor, end: cursor + dur })
    cursor += dur
  }
  return shifts
}

// ---------------------------------------------------------------------------
// Block-Editor
// ---------------------------------------------------------------------------

function BlockEditor({
  draft,
  employers,
  projects,
  onChange,
  onClose,
  onSave,
  onDelete,
  onSplit,
  busy,
  error,
}: {
  draft: Draft
  employers: Employer[]
  projects: Project[]
  onChange: (patch: Partial<Draft>) => void
  onClose: () => void
  onSave: () => void
  onDelete: () => void
  onSplit: () => void
  busy: boolean
  error: string | null
}) {
  const areaProjects = useMemo(() => projects.filter((p) => p.employer_id === draft.employerId && (p.active === 1 || p.id === draft.projectId)), [projects, draft.employerId, draft.projectId])
  const chip = (on: boolean, color: string): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12,
    background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)',
    border: `1.5px solid ${on ? color : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  })
  const kind = draft.kind ?? 'plan'
  const canKind = draft.block === null && !draft.planner // neue Buchung in der Wochenansicht: Plan oder Erfassen

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 65, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 30px 16px' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>{draft.block === null ? (draft.planner ? 'Neuer Plan-Block' : kind === 'log' ? 'Aktivität erfassen' : 'Neuer Block') : 'Block bearbeiten'}</div>
          <div onClick={onClose} style={{ width: 40, height: 40, borderRadius: 13, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 18, fontWeight: 600 }}>✕</div>
        </div>

        <div style={{ padding: '0 30px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {canKind && (
            <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)' }}>
              {(['plan', 'log'] as const).map((k) => (
                <div key={k} onClick={() => onChange({ kind: k })} style={{ flex: 1, textAlign: 'center', padding: '9px 12px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: kind === k ? 'var(--ink)' : 'var(--ink3)', background: kind === k ? 'var(--glass-strong)' : 'transparent', boxShadow: kind === k ? '0 2px 8px var(--hair)' : 'none' }}>
                  {k === 'plan' ? 'Plan' : 'Erfassen'}
                </div>
              ))}
            </div>
          )}
          {!draft.planner && kind === 'plan' && (
            <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)' }}>
              {(['day', 'plan'] as const).map((s) => (
                <div key={s} onClick={() => onChange({ scope: s })} style={{ flex: 1, textAlign: 'center', padding: '9px 12px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: draft.scope === s ? 'var(--ink)' : 'var(--ink3)', background: draft.scope === s ? 'var(--glass-strong)' : 'transparent', boxShadow: draft.scope === s ? '0 2px 8px var(--hair)' : 'none' }}>
                  {s === 'day' ? 'Nur dieser Tag' : 'Im Plan (Planner)'}
                </div>
              ))}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Bereich</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {employers.filter((e) => e.active === 1 || e.id === draft.employerId).map((e) => {
                const on = e.id === draft.employerId
                const color = e.color || employerColor(e.id)
                return (
                  <div key={e.id} onClick={() => onChange({ employerId: e.id, projectId: null })} style={chip(on, color)}>
                    <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                    {e.name}
                  </div>
                )
              })}
            </div>
          </div>

          {draft.employerId !== null && areaProjects.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Projekt <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· optional</span></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {areaProjects.map((p) => {
                  const on = p.id === draft.projectId
                  const color = employers.find((e) => e.id === p.employer_id)?.color || employerColor(p.employer_id)
                  return (
                    <div key={p.id} onClick={() => onChange({ projectId: on ? null : p.id })} style={chip(on, color)}>
                      <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                      {p.name}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Start</div>
              <TimeField value={draft.start} onChange={(v) => onChange({ start: v })} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Ende</div>
              <TimeField value={draft.end} onChange={(v) => onChange({ end: v })} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          </div>

          {kind === 'log' && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Notiz <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· optional</span></div>
              <input value={draft.note ?? ''} onChange={(e) => onChange({ note: e.target.value })} placeholder="Woran hast du gearbeitet?" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          )}

          {draft.block !== null && (
            <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Teilen bei <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· in zwei Blöcke</span></div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <TimeField value={draft.splitAt} onChange={(v) => onChange({ splitAt: v })} style={{ flex: 1, boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                <div onClick={busy ? undefined : onSplit} style={{ padding: '12px 22px', borderRadius: 14, background: '#2563EB', color: '#fff', fontWeight: 800, fontSize: 15, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(37,99,235,0.35)' }}>Teilen</div>
              </div>
            </div>
          )}

          {error && <div style={{ fontSize: 13, fontWeight: 700, color: '#E5484D' }}>{error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
            {draft.block !== null && (
              <div onClick={busy ? undefined : onDelete} style={{ padding: '14px 20px', borderRadius: 14, border: '1px solid var(--hair)', color: '#E5484D', fontWeight: 800, fontSize: 15, cursor: busy ? 'default' : 'pointer' }}>Löschen</div>
            )}
            <div style={{ flex: 1 }} />
            <div onClick={busy || draft.employerId === null ? undefined : onSave} style={{ padding: '14px 30px', borderRadius: 14, background: NEUTRAL, color: '#fff', fontWeight: 800, fontSize: 15, cursor: busy || draft.employerId === null ? 'default' : 'pointer', opacity: busy || draft.employerId === null ? 0.6 : 1, boxShadow: '0 8px 20px rgba(34,197,94,0.4)' }}>{busy ? 'Sichern…' : 'Sichern'}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

interface CalendarProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onBack: () => void
  onOpenTodos: () => void
  onOpenSpotlight: () => void
  settings: AppSettings
  selectedDay: Date
  setSelectedDay: Dispatch<SetStateAction<Date>>
  intent: PageIntent | null
  onIntentDone: () => void
}

export default function Calendar({ theme, onToggleTheme, onBack, onOpenTodos, onOpenSpotlight, settings, selectedDay, setSelectedDay, intent, onIntentDone }: CalendarProps) {
  const [calView, setCalView] = useState<'week' | 'month' | 'year' | 'planner' | 'list'>('week')
  const [splitPlan, setSplitPlan] = useState(false) // Wochenansicht: Ist links, Plan rechts (kompletter Plan)

  // Command-Intents: Periode vor/zurück, Plan (Standardwoche) an/aus.
  const lastIntentNonce = useRef(0)
  useEffect(() => {
    if (!intent || intent.nonce === lastIntentNonce.current) return
    lastIntentNonce.current = intent.nonce
    if (intent.action === 'period-prev') calPrev()
    else if (intent.action === 'period-next') calNext()
    else if (intent.action === 'planner-toggle') setCalView((v) => (v === 'planner' ? 'week' : 'planner'))
    else if (intent.action === 'plan-split') { setCalView('week'); setSplitPlan((s) => !s) }
    else if (intent.action === 'level-up' || intent.action === 'level-down') {
      const dir = intent.action === 'level-up' ? 1 : -1
      const ladder: Array<'week' | 'month' | 'year'> = ['week', 'month', 'year']
      setCalView((v) => {
        const i = ladder.indexOf(v as 'week' | 'month' | 'year')
        return ladder[Math.max(0, Math.min(2, (i < 0 ? 0 : i) + dir))]
      })
    } else if (intent.action === 'new-absence') openAbsSheet()
    else if (intent.action === 'filter-toggle') setFilterOpen((o) => !o)
    else if (intent.action === 'export-open') openExport()
    else if (intent.action === 'list-view') setCalView((v) => (v === 'list' ? 'week' : 'list'))
    onIntentDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [planned, setPlanned] = useState<PlannedBlock[]>([])
  const [overrides, setOverrides] = useState<PlannedOverride[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [areaHours, setAreaHours] = useState<AreaHours[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [absSheet, setAbsSheet] = useState(false)
  const [absDraft, setAbsDraft] = useState<{ id: number | null; start: string; end: string; type: AbsenceType; employerId: number | null; note: string; allDay: boolean; startTime: string; endTime: string }>({ id: null, start: '', end: '', type: 'urlaub', employerId: null, note: '', allDay: true, startTime: '09:00', endTime: '13:00' })
  const [absBusy, setAbsBusy] = useState(false)
  const [absError, setAbsError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exp, setExp] = useState<{ from: string; to: string; kind: 'entries' | 'absences'; employerId: number | 'all' }>({ from: '', to: '', kind: 'entries', employerId: 'all' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hiddenAreas, setHiddenAreas] = useState<Set<number>>(new Set())
  const [hiddenProjects, setHiddenProjects] = useState<Set<number>>(new Set())
  const [filterOpen, setFilterOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [editor, setEditor] = useState<Draft | null>(null)
  const [entryEdit, setEntryEdit] = useState<Entry | null>(null)
  const [entryPopup, setEntryPopup] = useState<Entry | null>(null)
  const [busy, setBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ block: PlanBlock; mode: 'week' | 'planner'; targetKey: string; newStart: number; dur: number } | null>(null)
  const [conflict, setConflict] = useState<{ count: number; apply: (pushBack: boolean) => Promise<void> } | null>(null)
  const [dx, setDx] = useState(0)
  const [animating, setAnimating] = useState(false)
  const pagerRef = useRef<HTMLDivElement | null>(null)
  const panelScroll = useRef<Record<number, HTMLDivElement | null>>({})
  const lastScrollTop = useRef(7 * HOUR_H - 20)
  const swipeLock = useRef(false)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  async function reloadPlan() {
    const [pl, ov] = await Promise.all([api.getPlanned(), api.getOverrides()])
    setPlanned(pl)
    setOverrides(ov)
  }

  async function reloadEntries() {
    setEntries(await api.getEntries())
  }

  useEffect(() => {
    let alive = true
    Promise.all([api.getEmployers(), api.getProjects(), api.getPlanned(), api.getOverrides(), api.getEntries(), api.getAbsences(), api.getAreaHours()])
      .then(([emp, proj, pl, ov, ent, abs, ah]) => {
        if (!alive) return
        setEmployers(emp)
        setProjects(proj)
        setPlanned(pl)
        setOverrides(ov)
        setEntries(ent)
        setAbsences(abs)
        setAreaHours(ah)
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
  const today = startOfDay(now)
  const nowMin = minutesOfDay(now)
  const isPlanner = calView === 'planner'

  const visible = (emp: number, proj: number | null) => !hiddenAreas.has(emp) && !(proj != null && hiddenProjects.has(proj))

  function planLabel(b: PlanBlock): string {
    const proj = b.project_id != null ? projectsById.get(b.project_id) : undefined
    return proj?.name ?? employersById.get(b.employer_id)?.name ?? 'Block'
  }
  function labelEntry(e: Entry): string {
    const proj = e.project_id != null ? projectsById.get(e.project_id) : undefined
    return proj?.name ?? employersById.get(e.employer_id)?.name ?? 'Aktivität'
  }

  function resolveDayPlan(date: Date): PlanBlock[] {
    const wd = date.getDay()
    const key = dayKey(date)
    // An Feiertagen die Standardwoche ignorieren – nur explizit hier geplante Blöcke.
    const templates = holidayName(date, settings.bundesland) ? [] : planned.filter((b) => b.weekday === wd)
    const dayOv = overrides.filter((o) => o.date === key)
    const out: PlanBlock[] = []
    for (const t of templates) {
      const ov = dayOv.find((o) => o.source_block_id === t.id)
      if (ov) {
        if (ov.deleted) continue
        out.push({ key: `o${ov.id}`, employer_id: ov.employer_id ?? t.employer_id, project_id: ov.project_id ?? t.project_id, start_min: ov.start_min ?? t.start_min, end_min: ov.end_min ?? t.end_min, templateId: t.id, overrideId: ov.id })
      } else {
        out.push({ key: `t${t.id}`, employer_id: t.employer_id, project_id: t.project_id, start_min: t.start_min, end_min: t.end_min, templateId: t.id, overrideId: null })
      }
    }
    for (const o of dayOv) {
      if (o.source_block_id == null && !o.deleted && o.employer_id != null && o.start_min != null && o.end_min != null)
        out.push({ key: `o${o.id}`, employer_id: o.employer_id, project_id: o.project_id, start_min: o.start_min, end_min: o.end_min, templateId: null, overrideId: o.id })
    }
    return out.filter((b) => b.end_min > b.start_min && visible(b.employer_id, b.project_id))
  }

  function templateBlocks(wd: number): PlanBlock[] {
    return planned
      .filter((b) => b.weekday === wd && b.end_min > b.start_min && visible(b.employer_id, b.project_id))
      .map((b) => ({ key: `t${b.id}`, employer_id: b.employer_id, project_id: b.project_id, start_min: b.start_min, end_min: b.end_min, templateId: b.id, overrideId: null }))
  }

  function trackedForDay(date: Date) {
    const key = dayKey(date)
    const isTodayDate = key === dayKey(now)
    return entries
      .filter((e) => dayKey(new Date(e.start_ts)) === key && visible(e.employer_id, e.project_id))
      .map((e) => {
        const s = minutesOfDay(new Date(e.start_ts))
        const end = e.end_ts ? minutesOfDay(new Date(e.end_ts)) : isTodayDate ? nowMin : s
        return { id: e.id, s, e: end, color: colorFor(e.employer_id), name: labelEntry(e) }
      })
      .filter((b) => b.e > b.s)
  }

  function dayColors(date: Date): string[] {
    const isFut = startOfDay(date).getTime() > today.getTime()
    const colors = new Set<string>()
    if (isFut) {
      for (const b of resolveDayPlan(date)) colors.add(colorFor(b.employer_id))
    } else {
      const key = dayKey(date)
      for (const e of entries) if (dayKey(new Date(e.start_ts)) === key && visible(e.employer_id, e.project_id)) colors.add(colorFor(e.employer_id))
    }
    return [...colors]
  }

  function absencesForDate(date: Date): Absence[] {
    const key = dayKey(date)
    return absences.filter((a) => a.start_date <= key && key <= a.end_date && (a.employer_id == null || !hiddenAreas.has(a.employer_id)))
  }

  function dailySoll(empId: number, key: string): number {
    const emp = employersById.get(empId)
    if (emp && emp.kind === 'private') return 0
    if (holidayName(key, settings.bundesland)) return 0
    const wd = new Date(`${key}T00:00:00`).getDay()
    for (const r of areaHours) if (r.employer_id === empId && r.weekday === wd) return r.minutes
    return 0
  }

  const colorFor = (empId: number): string => employersById.get(empId)?.color ?? employerColor(empId)
  const absCfg = useMemo(() => {
    const m = new Map<string, { label: string; color: string; icon: string }>()
    try {
      for (const t of JSON.parse(settings.absence_types) as { key: string; label: string; color: string; icon: string }[]) m.set(t.key, t)
    } catch {
      /* ignore */
    }
    return m
  }, [settings.absence_types])
  const absColor = (t: AbsenceType): string => absCfg.get(t)?.color ?? ABS_COLOR[t]
  const absLabel = (t: AbsenceType): string => absCfg.get(t)?.label ?? ABS_LABEL[t]
  const absIcon = (t: AbsenceType): string => absCfg.get(t)?.icon ?? '📌'

  function openAbsSheet() {
    const k = dayKey(selectedDay)
    setAbsError(null)
    setAbsDraft({ id: null, start: k, end: k, type: 'urlaub', employerId: null, note: '', allDay: true, startTime: '09:00', endTime: '13:00' })
    setAbsSheet(true)
  }
  function openAbsEdit(a: Absence) {
    setAbsError(null)
    setAbsDraft({ id: a.id, start: a.start_date, end: a.end_date, type: a.type, employerId: a.employer_id, note: a.note ?? '', allDay: a.all_day === 1, startTime: minToHHMM(a.start_min ?? 540), endTime: minToHHMM(a.end_min ?? 720) })
    setAbsSheet(true)
  }
  async function saveAbsence() {
    if (!absDraft.start) return
    const start = absDraft.start
    const end = absDraft.end && absDraft.end >= start ? absDraft.end : start
    const sMin = hhmmToMin(absDraft.startTime)
    const eMin = hhmmToMin(absDraft.endTime)
    if (!absDraft.allDay && eMin <= sMin) {
      setAbsError('Ende muss nach Start liegen')
      return
    }
    const clash = absences.some((a) => {
      if (a.id === absDraft.id) return false
      if (!(a.start_date <= end && start <= a.end_date)) return false
      if (!(a.employer_id == null || absDraft.employerId == null || a.employer_id === absDraft.employerId)) return false
      if (absDraft.allDay || a.all_day) return true
      return (a.start_min ?? 0) < eMin && sMin < (a.end_min ?? 0)
    })
    if (clash) {
      setAbsError('Überschneidet eine bestehende Abwesenheit')
      return
    }
    setAbsBusy(true)
    setAbsError(null)
    try {
      const payload = { start_date: start, end_date: end, type: absDraft.type, employer_id: absDraft.employerId, note: absDraft.note || null, all_day: absDraft.allDay, start_min: absDraft.allDay ? null : sMin, end_min: absDraft.allDay ? null : eMin }
      if (absDraft.id != null) await api.updateAbsence(absDraft.id, payload)
      else await api.createAbsence(payload)
      setAbsences(await api.getAbsences())
      setAbsDraft((d) => ({ ...d, id: null, note: '' }))
    } catch (e) {
      setAbsError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setAbsBusy(false)
    }
  }
  async function removeAbsence(id: number) {
    setAbsences((prev) => prev.filter((a) => a.id !== id))
    try {
      await api.deleteAbsence(id)
    } catch {
      setAbsences(await api.getAbsences())
    }
  }

  function openExport() {
    let from: Date
    let to: Date
    if (calView === 'month') {
      from = new Date(year, month, 1)
      to = new Date(year, month + 1, 0)
    } else if (calView === 'year') {
      from = new Date(year, 0, 1)
      to = new Date(year, 11, 31)
    } else {
      from = weekStart
      to = addDays(weekStart, 6)
    }
    setExp({ from: dayKey(from), to: dayKey(to), kind: 'entries', employerId: 'all' })
    setExportOpen(true)
  }
  function doExport() {
    const { from, to } = exp
    const empOk = (id: number | null) => exp.employerId === 'all' || id === exp.employerId
    if (exp.kind === 'entries') {
      const rows: (string | number | null)[][] = [['Datum', 'Start', 'Ende', 'Dauer (min)', 'Dauer (h)', 'Bereich', 'Projekt', 'Notiz']]
      entries
        .filter((e) => { const k = dayKey(new Date(e.start_ts)); return k >= from && k <= to && empOk(e.employer_id) })
        .sort((a, b) => a.start_ts.localeCompare(b.start_ts))
        .forEach((e) => {
          const s = new Date(e.start_ts)
          const end = e.end_ts ? new Date(e.end_ts) : null
          const durMin = e.duration_min ?? (end ? Math.round((end.getTime() - s.getTime()) / 60000) : 0)
          rows.push([dayKey(s), minToHHMM(minutesOfDay(s)), end ? minToHHMM(minutesOfDay(end)) : '', durMin, (durMin / 60).toFixed(2).replace('.', ','), employersById.get(e.employer_id)?.name ?? '', e.project_id != null ? projectsById.get(e.project_id)?.name ?? '' : '', e.note ?? ''])
        })
      downloadCsv(`aktivitaeten_${from}_bis_${to}.csv`, buildCsv(rows))
    } else {
      const rows: (string | number | null)[][] = [['Von', 'Bis', 'Art', 'Bereich', 'Ganztägig', 'Start', 'Ende', 'Notiz']]
      absences
        .filter((a) => !(a.end_date < from || a.start_date > to) && empOk(a.employer_id))
        .sort((a, b) => a.start_date.localeCompare(b.start_date))
        .forEach((a) => rows.push([a.start_date, a.end_date, absLabel(a.type), a.employer_id == null ? 'Alle' : employersById.get(a.employer_id)?.name ?? '', a.all_day ? 'ja' : 'nein', a.all_day ? '' : minToHHMM(a.start_min ?? 0), a.all_day ? '' : minToHHMM(a.end_min ?? 0), a.note ?? '']))
      downloadCsv(`abwesenheiten_${from}_bis_${to}.csv`, buildCsv(rows))
    }
    setExportOpen(false)
  }

  const year = selectedDay.getFullYear()
  const month = selectedDay.getMonth()
  const weekStart = useMemo(() => addDays(startOfDay(selectedDay), -monIndex(selectedDay)), [selectedDay])

  function calPrev() {
    if (calView === 'week') setSelectedDay((d) => addDays(d, -7))
    else if (calView === 'month') setSelectedDay(new Date(year, month - 1, 1))
    else if (calView === 'year') setSelectedDay(new Date(year - 1, month, 1))
  }
  function calNext() {
    if (calView === 'week') setSelectedDay((d) => addDays(d, 7))
    else if (calView === 'month') setSelectedDay(new Date(year, month + 1, 1))
    else if (calView === 'year') setSelectedDay(new Date(year + 1, month, 1))
  }

  const periodTitle =
    isPlanner ? 'Planner'
      : calView === 'week' ? `KW ${isoWeek(weekStart)} · ${weekStart.getDate()}.–${addDays(weekStart, 6).getDate()}. ${MONTHS_SHORT[addDays(weekStart, 6).getMonth()]}`
      : calView === 'month' ? `${MONTHS[month]} ${year}`
      : String(year)

  const showToday = calView === 'week' ? dayKey(today) < dayKey(weekStart) || dayKey(today) > dayKey(addDays(weekStart, 6)) : calView === 'month' || calView === 'year'
  const hours = Array.from({ length: 25 }, (_, i) => i)

  // Vertikale Scroll-Position zwischen den Blättern beibehalten; Standardwoche wie die
  // Wochenansicht automatisch auf ~7 Uhr setzen.
  useEffect(() => {
    if (loading) return
    if (calView === 'week') {
      for (const i of [0, 1, 2]) {
        const r = panelScroll.current[i]
        if (r) r.scrollTop = lastScrollTop.current
      }
    } else if (calView === 'planner') {
      const r = panelScroll.current[9]
      if (r) r.scrollTop = lastScrollTop.current
    }
  }, [calView, weekStart, loading])

  // --- Editor / Anlegen ---
  const midOf = (a: number, b: number) => minToHHMM(snap15((a + b) / 2))
  function openBlockEditor(block: PlanBlock, date: string) {
    setEditError(null)
    setEditor({ block, planner: false, weekday: new Date(`${date}T00:00:00`).getDay(), date, employerId: block.employer_id, projectId: block.project_id, start: minToHHMM(block.start_min), end: minToHHMM(block.end_min), scope: 'day', splitAt: midOf(block.start_min, block.end_min) })
  }
  function openNewBlock(date: string, startMin: number) {
    setEditError(null)
    const s = Math.max(0, Math.min(1440 - 60, snap15(startMin)))
    setEditor({ block: null, planner: false, weekday: new Date(`${date}T00:00:00`).getDay(), date, employerId: employers[0]?.id ?? null, projectId: null, start: minToHHMM(s), end: minToHHMM(s + 60), scope: 'day', splitAt: minToHHMM(s + 30) })
  }
  function openTemplateEditor(block: PlanBlock, weekday: number) {
    setEditError(null)
    setEditor({ block, planner: true, weekday, date: '', employerId: block.employer_id, projectId: block.project_id, start: minToHHMM(block.start_min), end: minToHHMM(block.end_min), scope: 'plan', splitAt: midOf(block.start_min, block.end_min) })
  }
  function openNewTemplate(weekday: number, startMin: number) {
    setEditError(null)
    const s = Math.max(0, Math.min(1440 - 60, snap15(startMin)))
    setEditor({ block: null, planner: true, weekday, date: '', employerId: employers[0]?.id ?? null, projectId: null, start: minToHHMM(s), end: minToHHMM(s + 60), scope: 'plan', splitAt: minToHHMM(s + 30) })
  }

  async function applyBlockTimes(block: PlanBlock, scope: 'day' | 'plan', date: string, start: number, end: number) {
    if (scope === 'plan') {
      if (block.templateId != null) await api.updatePlanned(block.templateId, { start_min: start, end_min: end })
    } else if (block.overrideId != null) {
      await api.updateOverride(block.overrideId, { start_min: start, end_min: end })
    } else if (block.templateId != null) {
      await api.createOverride({ date, source_block_id: block.templateId, employer_id: block.employer_id, project_id: block.project_id, start_min: start, end_min: end })
    }
  }

  async function saveBlock() {
    if (!editor || editor.employerId === null) return
    const start_min = hhmmToMin(editor.start)
    const end_min = hhmmToMin(editor.end)
    if (end_min <= start_min) {
      setEditError('Ende muss nach dem Start liegen')
      return
    }
    // "Erfassen": echte Ist-Aktivität für diesen Tag anlegen (statt Planblock).
    if (editor.kind === 'log') {
      setBusy(true)
      setEditError(null)
      try {
        const created = await api.createEntry({ start_ts: `${editor.date}T${editor.start}:00`, employer_id: editor.employerId, project_id: editor.projectId, note: (editor.note ?? '').trim() || null })
        await api.updateEntry(created.id, { end_ts: `${editor.date}T${editor.end}:00` })
        await reloadEntries()
        setEditor(null)
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
      } finally {
        setBusy(false)
      }
      return
    }
    const emp = editor.employerId
    const proj = editor.projectId
    const planScope = editor.planner || editor.scope === 'plan'
    const others = (planScope ? templateBlocks(editor.weekday) : resolveDayPlan(new Date(`${editor.date}T00:00:00`))).filter((b) => !sameBlock(b, editor.block))

    const primary = async () => {
      if (editor.planner) {
        if (editor.block?.templateId != null) await api.updatePlanned(editor.block.templateId, { employer_id: emp, project_id: proj, weekday: editor.weekday, start_min, end_min })
        else await api.createPlanned({ employer_id: emp, project_id: proj, weekday: editor.weekday, start_min, end_min })
      } else if (editor.scope === 'plan') {
        if (editor.block?.templateId != null) {
          await api.updatePlanned(editor.block.templateId, { employer_id: emp, project_id: proj, start_min, end_min })
          if (editor.block.overrideId != null) await api.deleteOverride(editor.block.overrideId)
        } else {
          await api.createPlanned({ employer_id: emp, project_id: proj, weekday: editor.weekday, start_min, end_min })
          if (editor.block?.overrideId != null) await api.deleteOverride(editor.block.overrideId)
        }
      } else {
        if (editor.block?.overrideId != null) await api.updateOverride(editor.block.overrideId, { employer_id: emp, project_id: proj, start_min, end_min, deleted: false })
        else if (editor.block?.templateId != null) await api.createOverride({ date: editor.date, source_block_id: editor.block.templateId, employer_id: emp, project_id: proj, start_min, end_min })
        else await api.createOverride({ date: editor.date, employer_id: emp, project_id: proj, start_min, end_min })
      }
    }

    const clashing = others.filter((b) => b.start_min < end_min && start_min < b.end_min)
    if (clashing.length === 0) {
      setBusy(true)
      setEditError(null)
      try {
        await primary()
        await reloadPlan()
        setEditor(null)
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
      } finally {
        setBusy(false)
      }
      return
    }
    setEditor(null)
    setConflict({
      count: clashing.length,
      apply: async (pushBack: boolean) => {
        await primary()
        if (pushBack) for (const sh of computeShifts(others, start_min, end_min)) await applyBlockTimes(sh.block, planScope ? 'plan' : 'day', editor.date, sh.start, sh.end)
        await reloadPlan()
      },
    })
  }

  async function deleteBlock() {
    if (!editor?.block) return
    const b = editor.block
    setBusy(true)
    try {
      if (editor.planner || editor.scope === 'plan') {
        if (b.templateId != null) await api.deletePlanned(b.templateId)
        else if (b.overrideId != null) await api.deleteOverride(b.overrideId)
      } else {
        if (b.overrideId != null && b.templateId != null) await api.updateOverride(b.overrideId, { deleted: true })
        else if (b.overrideId != null) await api.deleteOverride(b.overrideId)
        else if (b.templateId != null) await api.createOverride({ date: editor.date, source_block_id: b.templateId, deleted: true })
      }
      await reloadPlan()
      setEditor(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  // Block an einem Zeitpunkt in zwei aneinandergrenzende Blöcke teilen.
  async function splitBlock() {
    if (!editor?.block || editor.employerId === null) return
    const start = hhmmToMin(editor.start)
    const end = hhmmToMin(editor.end)
    const at = hhmmToMin(editor.splitAt)
    if (at <= start || at >= end) {
      setEditError('Teilzeitpunkt muss zwischen Start und Ende liegen')
      return
    }
    const b = editor.block
    const emp = editor.employerId
    const proj = editor.projectId
    setBusy(true)
    setEditError(null)
    try {
      if (editor.planner) {
        await api.updatePlanned(b.templateId!, { employer_id: emp, project_id: proj, weekday: editor.weekday, start_min: start, end_min: at })
        await api.createPlanned({ employer_id: emp, project_id: proj, weekday: editor.weekday, start_min: at, end_min: end })
      } else if (editor.scope === 'plan') {
        if (b.templateId != null) {
          await api.updatePlanned(b.templateId, { employer_id: emp, project_id: proj, start_min: start, end_min: at })
          await api.createPlanned({ employer_id: emp, project_id: proj, weekday: editor.weekday, start_min: at, end_min: end })
          if (b.overrideId != null) await api.deleteOverride(b.overrideId)
        } else {
          await api.createPlanned({ employer_id: emp, project_id: proj, weekday: editor.weekday, start_min: start, end_min: at })
          await api.createPlanned({ employer_id: emp, project_id: proj, weekday: editor.weekday, start_min: at, end_min: end })
          if (b.overrideId != null) await api.deleteOverride(b.overrideId)
        }
      } else {
        // nur dieser Tag: Teil 1 als Override [start,at], Teil 2 als Zusatz-Override [at,end]
        if (b.overrideId != null) await api.updateOverride(b.overrideId, { employer_id: emp, project_id: proj, start_min: start, end_min: at })
        else if (b.templateId != null) await api.createOverride({ date: editor.date, source_block_id: b.templateId, employer_id: emp, project_id: proj, start_min: start, end_min: at })
        await api.createOverride({ date: editor.date, employer_id: emp, project_id: proj, start_min: at, end_min: end })
      }
      await reloadPlan()
      setEditor(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Teilen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  // --- Drag (vertikal = Zeit, horizontal = anderer Tag/Wochentag) ---
  function resolveDrop(block: PlanBlock, mode: 'week' | 'planner', sourceKey: string, targetKey: string, newStart: number, dur: number) {
    const newEnd = newStart + dur
    const isPlan = mode === 'planner'
    const others = (isPlan ? templateBlocks(Number(targetKey.slice(2))) : resolveDayPlan(new Date(`${targetKey}T00:00:00`))).filter((b) => !sameBlock(b, block))
    const primary = async () => {
      if (isPlan) {
        if (block.templateId != null) await api.updatePlanned(block.templateId, { weekday: Number(targetKey.slice(2)), start_min: newStart, end_min: newEnd })
      } else if (targetKey === sourceKey) {
        if (block.overrideId != null) await api.updateOverride(block.overrideId, { start_min: newStart, end_min: newEnd })
        else if (block.templateId != null) await api.createOverride({ date: sourceKey, source_block_id: block.templateId, employer_id: block.employer_id, project_id: block.project_id, start_min: newStart, end_min: newEnd })
      } else {
        if (block.templateId != null) {
          if (block.overrideId != null) await api.updateOverride(block.overrideId, { deleted: true })
          else await api.createOverride({ date: sourceKey, source_block_id: block.templateId, deleted: true })
        } else if (block.overrideId != null) {
          await api.deleteOverride(block.overrideId)
        }
        await api.createOverride({ date: targetKey, employer_id: block.employer_id, project_id: block.project_id, start_min: newStart, end_min: newEnd })
      }
    }
    const clashing = others.filter((b) => b.start_min < newEnd && newStart < b.end_min)
    if (clashing.length === 0) {
      void (async () => {
        try {
          await primary()
          await reloadPlan()
        } catch {
          await reloadPlan()
        }
      })()
      return
    }
    setConflict({
      count: clashing.length,
      apply: async (pushBack: boolean) => {
        await primary()
        if (pushBack) for (const sh of computeShifts(others, newStart, newEnd)) await applyBlockTimes(sh.block, isPlan ? 'plan' : 'day', targetKey, sh.start, sh.end)
        await reloadPlan()
      },
    })
  }

  function startBlockDrag(block: PlanBlock, mode: 'week' | 'planner', sourceKey: string, e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const dur = block.end_min - block.start_min
    let moved = false
    let curStart = block.start_min
    let curTarget = sourceKey
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 4 || Math.abs(ev.clientX - e.clientX) > 4) moved = true
      curStart = Math.max(0, Math.min(1440 - dur, snap15(block.start_min + ((ev.clientY - startY) / ZOOM / HOUR_H) * 60)))
      const col = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-daycol]')
      curTarget = col?.getAttribute('data-daycol') ?? sourceKey
      setDrag({ block, mode, targetKey: curTarget, newStart: curStart, dur })
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      setDrag(null)
      if (moved && (curTarget !== sourceKey || curStart !== block.start_min)) resolveDrop(block, mode, sourceKey, curTarget, curStart, dur)
      else if (!moved) {
        if (mode === 'planner') openTemplateEditor(block, Number(sourceKey.slice(2)))
        else openBlockEditor(block, sourceKey)
      }
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  function onColumnDblClick(colKey: string, mode: 'week' | 'planner', e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('[data-block]')) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const min = ((e.clientY - rect.top) / ZOOM / HOUR_H) * 60
    if (mode === 'planner') openNewTemplate(Number(colKey.slice(2)), min)
    else openNewBlock(colKey, min)
  }

  // --- Pager (fließendes Blättern) ---
  function commitSwipe(dir: number, w: number) {
    setAnimating(true)
    setDx(dir > 0 ? -w : w)
    window.setTimeout(() => {
      if (dir > 0) calNext()
      else calPrev()
      setAnimating(false)
      setDx(0)
    }, 320)
  }
  function snapBack() {
    setAnimating(true)
    setDx(0)
    window.setTimeout(() => setAnimating(false), 320)
  }
  function pagerWheel(e: React.WheelEvent) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return
    if (swipeLock.current || animating) return
    swipeLock.current = true
    commitSwipe(e.deltaX > 0 ? 1 : -1, pagerRef.current?.clientWidth ?? 1)
    window.setTimeout(() => (swipeLock.current = false), 360)
  }
  function pagerDown(e: React.PointerEvent) {
    if (animating) return
    const startX = e.clientX
    const startY = e.clientY
    const w = pagerRef.current?.clientWidth ?? 1
    let axis: 'h' | 'v' | null = null
    let engaged = false
    const move = (ev: PointerEvent) => {
      const ddx = ev.clientX - startX
      const ddy = ev.clientY - startY
      if (!axis && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) {
        axis = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v'
        if (axis === 'h') {
          engaged = true
          if (calView === 'week') {
            const st = panelScroll.current[1]?.scrollTop ?? lastScrollTop.current
            lastScrollTop.current = st
            for (const i of [0, 2]) {
              const r = panelScroll.current[i]
              if (r) r.scrollTop = st
            }
          }
        }
      }
      if (axis === 'h') setDx(ddx)
    }
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      if (!engaged) return
      const ddx = ev.clientX - startX
      const th = Math.min(120, w * 0.22)
      if (ddx <= -th) commitSwipe(1, w)
      else if (ddx >= th) commitSwipe(-1, w)
      else snapBack()
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  function planBlockEl(b: PlanBlock, mode: 'week' | 'planner', colKey: string, half: 'full' | 'right' = 'full') {
    const h = Math.max(16, ((b.end_min - b.start_min) / 60) * HOUR_H - 2)
    const color = colorFor(b.employer_id)
    const hx = half === 'right' ? { left: 'calc(50% + 1px)', right: 3 } : { left: 3, right: 3 }
    return (
      <div key={b.key} data-block onPointerDown={(e) => startBlockDrag(b, mode, colKey, e)} title={planLabel(b)} style={{ position: 'absolute', left: hx.left, right: hx.right, top: (b.start_min / 60) * HOUR_H, height: h, borderRadius: 9, background: `color-mix(in srgb, ${color} 14%, transparent)`, border: `1.5px dashed ${color}`, padding: '4px 7px', overflow: 'hidden', boxSizing: 'border-box', cursor: 'grab', touchAction: 'none' }}>
        {h >= 22 && <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{planLabel(b)}</div>}
        {h >= 38 && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{minToHHMM(b.start_min)}–{minToHHMM(b.end_min)}</div>}
      </div>
    )
  }
  function ghostEl(colKey: string) {
    if (!drag || drag.targetKey !== colKey) return null
    return (
      <div style={{ position: 'absolute', left: 3, right: 3, top: (drag.newStart / 60) * HOUR_H, height: Math.max(16, (drag.dur / 60) * HOUR_H - 2), borderRadius: 9, background: 'color-mix(in srgb, var(--accent, #22C55E) 22%, transparent)', border: '2px solid var(--accent, #22C55E)', padding: '4px 7px', boxSizing: 'border-box', zIndex: 6, pointerEvents: 'none' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{minToHHMM(drag.newStart)}–{minToHHMM(drag.newStart + drag.dur)}</div>
      </div>
    )
  }

  // --- Body-Renderer ---
  const dayHeader = (labels: { label: string; date?: number; isTod?: boolean; holiday?: string | null }[]) => (
    <div style={{ position: 'sticky', top: 0, zIndex: 4, background: 'var(--glass)', backdropFilter: 'blur(24px) saturate(180%)', WebkitBackdropFilter: 'blur(24px) saturate(180%)', display: 'flex', paddingLeft: 52, paddingRight: 6, borderBottom: '1px solid var(--hair)', paddingBottom: 8, paddingTop: 2 }}>
      {labels.map((c, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>{c.label}</div>
          {c.date != null && <div style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 16, fontWeight: 800, background: c.isTod ? 'var(--accent, #22C55E)' : 'transparent', color: c.isTod ? '#fff' : 'var(--ink)' }}>{c.date}</div>}
          {c.holiday && (
            <div title={c.holiday} style={{ maxWidth: '96%', fontSize: 9, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', color: '#7C5CFF', background: 'color-mix(in srgb, #7C5CFF 16%, transparent)', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.holiday}</div>
          )}
        </div>
      ))}
    </div>
  )
  const hourGridLines = (
    <>
      {hours.map((h) => (
        <div key={h}>
          <div style={{ position: 'absolute', left: 46, right: 6, top: h * HOUR_H, height: 1, background: 'var(--hair)' }} />
          <div style={{ position: 'absolute', left: 0, top: h * HOUR_H, transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{h < 24 ? `${pad2(h)}:00` : ''}</div>
        </div>
      ))}
    </>
  )

  function weekBody(ws: Date, slot: number) {
    const wdays = Array.from({ length: 7 }, (_, i) => addDays(ws, i))
    return (
      <div
        key={dayKey(ws)}
        ref={(el) => { panelScroll.current[slot] = el }}
        onScroll={(e) => { lastScrollTop.current = e.currentTarget.scrollTop }}
        style={{ width: '33.3333%', height: '100%', flex: 'none', overflowY: 'auto', overflowX: 'hidden' }}
      >
        {dayHeader(wdays.map((d) => ({ label: WD[monIndex(d)], date: d.getDate(), isTod: dayKey(d) === dayKey(today), holiday: holidayName(d, settings.bundesland) })))}
        <div style={{ position: 'relative', height: 24 * HOUR_H, width: '100%' }}>
          {hourGridLines}
          <div style={{ position: 'absolute', left: 52, right: 6, top: 0, bottom: 0, display: 'flex' }}>
            {wdays.map((d) => {
              const isFut = startOfDay(d).getTime() > today.getTime()
              const isTod = dayKey(d) === dayKey(today)
              const colKey = dayKey(d)
              const tracked = !isFut ? trackedForDay(d) : []
              let plannedList: PlanBlock[]
              if (splitPlan) {
                // Split-Ansicht: kompletter Plan (alle Tage, ungefiltert) in eigener Spalte.
                plannedList = resolveDayPlan(d)
              } else {
                plannedList = isFut || isTod ? resolveDayPlan(d) : []
                // Heute: Planblock ausblenden, wenn er zeitlich komplett abgelaufen ist ODER
                // von einer erfassten Aktivität überlappt wird (bereichs-/endzeit-unabhängig).
                if (isTod) plannedList = plannedList.filter((b) => b.end_min > nowMin && !tracked.some((t) => b.start_min < t.e && t.s < b.end_min))
              }
              const abs = absencesForDate(d)
              return (
                <div key={colKey} data-daycol={colKey} onDoubleClick={(e) => onColumnDblClick(colKey, 'week', e)} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--hair)' }}>
                  {abs.map((a) => {
                    const top = a.all_day ? 0 : ((a.start_min ?? 0) / 60) * HOUR_H
                    const height = a.all_day ? 24 * HOUR_H : Math.max(14, (((a.end_min ?? 0) - (a.start_min ?? 0)) / 60) * HOUR_H)
                    return (
                      <div key={a.id} onClick={(e) => { e.stopPropagation(); openAbsEdit(a) }} title={`${absLabel(a.type)} · ${a.employer_id == null ? 'Alle Bereiche' : employersById.get(a.employer_id)?.name ?? ''}`} style={{ position: 'absolute', left: 3, right: 3, top, height, zIndex: 1, cursor: 'pointer', borderRadius: 9, overflow: 'hidden', background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${absColor(a.type)} 16%, transparent) 0 8px, transparent 8px 16px)`, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '4px 7px' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.3px', textTransform: 'uppercase', color: absColor(a.type), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{absLabel(a.type)} · {a.employer_id == null ? 'Alle' : employersById.get(a.employer_id)?.name}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{a.all_day ? 'ganztägig' : `${minToHHMM(a.start_min ?? 0)}–${minToHHMM(a.end_min ?? 0)}`}</div>
                      </div>
                    )
                  })}
                  {plannedList.map((b) => planBlockEl(b, 'week', colKey, splitPlan ? 'right' : 'full'))}
                  {tracked.map((b) => {
                    const h = Math.max(16, ((b.e - b.s) / 60) * HOUR_H - 2)
                    return (
                      <div key={`t${b.id}`} title={`${b.name} – zum Ansehen/Bearbeiten klicken`} onClick={(ev) => { ev.stopPropagation(); const en = entries.find((x) => x.id === b.id); if (en) setEntryPopup(en) }} style={{ position: 'absolute', left: 3, right: splitPlan ? 'calc(50% + 1px)' : 3, top: (b.s / 60) * HOUR_H, height: h, borderRadius: 9, background: b.color, boxShadow: '0 3px 10px var(--hair)', padding: '4px 7px', overflow: 'hidden', boxSizing: 'border-box', zIndex: 2, cursor: 'pointer' }}>
                        {h >= 22 && <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>}
                        {h >= 38 && <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>{minToHHMM(b.s)}–{minToHHMM(b.e)}</div>}
                      </div>
                    )
                  })}
                  {ghostEl(colKey)}
                  {isTod && (
                    <div style={{ position: 'absolute', left: -1, right: 0, top: (nowMin / 60) * HOUR_H, height: 2, background: '#E5484D', zIndex: 5 }}>
                      <div style={{ position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: '50%', background: '#E5484D' }} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  function monthBody(y: number, m: number) {
    const first = new Date(y, m, 1)
    const gridStart = addDays(startOfDay(first), -monIndex(first))
    const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
    return (
      <div key={`${y}-${m}`} style={{ width: '33.3333%', height: '100%', flex: 'none', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', marginBottom: 8 }}>
          {WD.map((h) => (
            <div key={h} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>{h}</div>
          ))}
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 6 }}>
          {cells.map((d) => {
            const inMonth = d.getMonth() === ((m % 12) + 12) % 12
            const isTod = dayKey(d) === dayKey(today)
            const hol = holidayName(d, settings.bundesland)
            const colors = dayColors(d)
            return (
              <div key={dayKey(d)} onClick={() => { setSelectedDay(startOfDay(d)); setCalView('week') }} title={hol ?? undefined} style={{ borderRadius: 12, border: '1px solid var(--hair)', background: 'var(--glass)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', opacity: inMonth ? 1 : 0.4 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, background: isTod ? 'var(--accent, #22C55E)' : hol ? 'color-mix(in srgb, #7C5CFF 22%, transparent)' : 'transparent', color: isTod ? '#fff' : hol ? '#7C5CFF' : 'var(--ink)' }}>{d.getDate()}</div>
                {hol && <div style={{ fontSize: 9, fontWeight: 800, color: '#7C5CFF', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hol}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {colors.slice(0, 6).map((c, i) => (
                    <div key={i} style={{ width: 7, height: 7, borderRadius: 2, background: c }} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function yearBody(y: number) {
    return (
      <div key={y} style={{ width: '33.3333%', height: '100%', flex: 'none', overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
          {Array.from({ length: 12 }, (_, mi) => {
            const first = new Date(y, mi, 1)
            const gridStart = addDays(startOfDay(first), -monIndex(first))
            const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
            return (
              <div key={mi} onClick={() => { setSelectedDay(new Date(y, mi, 1)); setCalView('month') }} style={{ borderRadius: 16, border: '1px solid var(--hair)', background: 'var(--glass)', padding: 14, cursor: 'pointer' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>{MONTHS[mi]}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                  {days.map((d) => {
                    const inMonth = d.getMonth() === mi
                    const isTod = dayKey(d) === dayKey(today)
                    const hol = inMonth ? holidayName(d, settings.bundesland) : null
                    const has = inMonth && dayColors(d).length > 0
                    return (
                      <div key={dayKey(d)} title={hol || undefined} style={{ aspectRatio: '1', display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 600, borderRadius: 4, color: !inMonth ? 'var(--ink3)' : isTod ? '#fff' : hol ? '#7C5CFF' : 'var(--ink2)', background: isTod ? 'var(--accent, #22C55E)' : hol ? 'color-mix(in srgb, #7C5CFF 26%, transparent)' : has ? 'color-mix(in srgb, #2563EB 22%, transparent)' : 'transparent', opacity: inMonth ? 1 : 0.35 }}>{d.getDate()}</div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  function plannerBody() {
    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
        {dayHeader(WD_ORDER.map((_, i) => ({ label: WD[i], date: undefined })))}
        <div ref={(el) => { panelScroll.current[9] = el }} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <div style={{ position: 'relative', height: 24 * HOUR_H, width: '100%' }}>
            {hourGridLines}
            <div style={{ position: 'absolute', left: 52, right: 6, top: 0, bottom: 0, display: 'flex' }}>
              {WD_ORDER.map((wd) => {
                const colKey = `wd${wd}`
                return (
                  <div key={colKey} data-daycol={colKey} onDoubleClick={(e) => onColumnDblClick(colKey, 'planner', e)} style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--hair)' }}>
                    {templateBlocks(wd).map((b) => planBlockEl(b, 'planner', colKey))}
                    {ghostEl(colKey)}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Listenansicht: alle gefilterten Buchungen nach Tag (neueste zuerst); bei aktivem Plan
  // erscheinen die geplanten Aktivitäten mit, klar als „Plan" markiert.
  function listBody() {
    const days = new Map<string, Entry[]>()
    for (const e of entries) {
      if (!visible(e.employer_id, e.project_id)) continue
      const k = dayKey(new Date(e.start_ts))
      const arr = days.get(k) ?? []
      arr.push(e)
      days.set(k, arr)
    }
    const keys = [...days.keys()].sort((a, b) => (a < b ? 1 : -1))
    return (
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {keys.length === 0 && <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink3)', padding: '8px 2px' }}>Keine Buchungen.</div>}
        {keys.map((k) => {
          const d = new Date(`${k}T00:00:00`)
          const isTod = k === dayKey(now)
          type Row = { kind: 'ist' | 'plan'; s: number; e: number; color: string; name: string; note: string | null; entry: Entry | null }
          const ist: Row[] = (days.get(k) ?? []).map((e) => ({ kind: 'ist', s: minutesOfDay(new Date(e.start_ts)), e: e.end_ts ? minutesOfDay(new Date(e.end_ts)) : isTod ? nowMin : minutesOfDay(new Date(e.start_ts)), color: colorFor(e.employer_id), name: labelEntry(e), note: e.note, entry: e }))
          const plan: Row[] = splitPlan ? resolveDayPlan(d).map((b) => ({ kind: 'plan', s: b.start_min, e: b.end_min, color: colorFor(b.employer_id), name: planLabel(b), note: null, entry: null })) : []
          const rows = [...ist, ...plan].sort((a, b) => a.s - b.s)
          return (
            <div key={k} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: isTod ? 'var(--accent, #16A34A)' : 'var(--ink3)', marginBottom: 8 }}>{WD[monIndex(d)]} · {d.getDate()}. {MONTHS[d.getMonth()]} {d.getFullYear()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((it, i) => {
                  const isPlan = it.kind === 'plan'
                  return (
                    <div key={i} onClick={it.entry ? () => setEntryPopup(it.entry) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 14, background: 'var(--glass)', border: isPlan ? `1.5px dashed ${it.color}` : '1px solid var(--border)', cursor: it.entry ? 'pointer' : 'default' }}>
                      <div style={{ width: 88, flex: 'none', fontSize: 13, fontWeight: 800, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{minToHHMM(it.s)}–{minToHHMM(it.e)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                        {it.note && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.note}</div>}
                      </div>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 7, flex: 'none', color: isPlan ? it.color : '#fff', background: isPlan ? `color-mix(in srgb, ${it.color} 16%, transparent)` : it.color, border: isPlan ? `1px solid ${it.color}` : 'none' }}>{isPlan ? 'Plan' : 'Ist'}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div data-theme={theme} style={{ fontFamily: "-apple-system, system-ui, 'Manrope', sans-serif", height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{ zoom: ZOOM, width: 'calc(100vw / 0.9)', height: 'calc(100vh / 0.9)', background: 'var(--screen)', overflow: 'hidden', position: 'relative', padding: '44px 68px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        {/* header — Padding & Zeilenhöhe wie Mein Tag, damit die Rundicons beim Wechsel nicht springen */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, minHeight: 45 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 14, ...GLASS, cursor: 'pointer', fontSize: 14, fontWeight: 800, color: 'var(--ink2)' }}>‹ Tag</div>
            <div onClick={() => setCalView((v) => (v === 'planner' ? 'week' : 'planner'))} title="Planner (Standardwoche)" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', ...(isPlanner ? { background: 'color-mix(in srgb, var(--accent, #22C55E) 16%, transparent)', border: '1.5px solid var(--accent, #22C55E)', color: 'var(--accent, #16A34A)' } : { color: 'var(--ink2)' }) }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.3 5.6 6 .5-4.6 3.9 1.5 5.9L12 17.8 6.8 18.9l1.5-5.9L3.7 9.1l6-.5z" /></svg>
            </div>
            <div onClick={openAbsSheet} title="Abwesenheit anlegen" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></svg>
            </div>
            <div onClick={() => setCalView((v) => (v === 'list' ? 'week' : 'list'))} title="Listenansicht aller Buchungen" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', ...(calView === 'list' ? { background: 'color-mix(in srgb, var(--accent, #22C55E) 16%, transparent)', border: '1.5px solid var(--accent, #22C55E)', color: 'var(--accent, #16A34A)' } : { color: 'var(--ink2)' }) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" /></svg>
            </div>
            {!isPlanner && (calView === 'week' || calView === 'list') && (
              <div onClick={() => setSplitPlan((s) => !s)} title={calView === 'list' ? 'Geplante Aktivitäten in der Liste anzeigen' : 'Ist & Plan getrennt (Ist links, Plan rechts)'} style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', ...(splitPlan ? { background: 'color-mix(in srgb, var(--accent, #22C55E) 16%, transparent)', border: '1.5px solid var(--accent, #22C55E)', color: 'var(--accent, #16A34A)' } : { color: 'var(--ink2)' }) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M12 4.5v15" /></svg>
              </div>
            )}
            <div style={{ position: 'relative' }}>
              <div onClick={() => setFilterOpen((o) => !o)} title="Filtern" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: hiddenAreas.size || hiddenProjects.size ? '#2563EB' : 'var(--ink2)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16" /><path d="M7 12h10" /><path d="M10 19h4" /></svg>
              </div>
              {filterOpen && (
                <>
                  <div onClick={() => setFilterOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 54 }} />
                  <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 55, width: 280, maxHeight: 380, overflowY: 'auto', borderRadius: 20, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, boxSizing: 'border-box' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Bereiche &amp; Projekte</div>
                    {employers.map((e) => {
                      const areaOn = !hiddenAreas.has(e.id)
                      const color = colorFor(e.id)
                      return (
                        <div key={e.id} style={{ marginBottom: 10 }}>
                          <div onClick={() => setHiddenAreas((s) => { const n = new Set(s); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n })} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                            <div style={{ width: 18, height: 18, borderRadius: 6, border: `1.5px solid ${areaOn ? color : 'var(--border)'}`, background: areaOn ? color : 'transparent' }} />
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{e.name}</div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '6px 0 0 28px' }}>
                            {projects.filter((p) => p.employer_id === e.id).map((p) => {
                              const on = !hiddenProjects.has(p.id)
                              return (
                                <div key={p.id} onClick={() => setHiddenProjects((s) => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                                  <div style={{ width: 14, height: 14, borderRadius: 4, border: `1.5px solid ${on ? color : 'var(--border)'}`, background: on ? color : 'transparent' }} />
                                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)' }}>{p.name}</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 'none' }}>
            {!isPlanner && calView !== 'list' && <div onClick={calPrev} style={{ width: 34, height: 34, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 18, fontWeight: 700 }}>‹</div>}
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.4px', minWidth: 230, textAlign: 'center' }}>{calView === 'list' ? 'Alle Buchungen' : periodTitle}</div>
            {!isPlanner && calView !== 'list' && <div onClick={calNext} style={{ width: 34, height: 34, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 18, fontWeight: 700 }}>›</div>}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
            {showToday && !isPlanner && calView !== 'list' && (
              <div onClick={() => setSelectedDay(startOfDay(new Date()))} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 11, background: 'color-mix(in srgb, var(--accent, #22C55E) 14%, transparent)', border: '1.5px solid var(--accent, #22C55E)', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'var(--accent, #16A34A)', whiteSpace: 'nowrap' }}>↩ Heute</div>
            )}
            {!isPlanner && (
              <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
                {(['week', 'month', 'year'] as const).map((v) => (
                  <div key={v} onClick={() => setCalView(v)} style={{ padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: calView === v ? 'var(--ink)' : 'var(--ink3)', background: calView === v ? 'var(--glass-strong)' : 'transparent', boxShadow: calView === v ? '0 2px 8px var(--hair)' : 'none' }}>
                    {v === 'week' ? 'Woche' : v === 'month' ? 'Monat' : 'Jahr'}
                  </div>
                ))}
              </div>
            )}
            <div onClick={openExport} title="Exportieren (CSV)" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 9l5-6 5 6" /><path d="M4 17v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
            </div>
            <div onClick={onOpenSpotlight} title="Suche (Spotlight)" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            </div>
            <div onClick={onOpenTodos} title="To-Dos" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6h11" />
                <path d="M9 12h11" />
                <path d="M9 18h11" />
                <path d="M4 6l1 1 2-2" />
                <path d="M4 12l1 1 2-2" />
                <path d="M4 18l1 1 2-2" />
              </svg>
            </div>
            <div onClick={onToggleTheme} title="Farbschema wechseln" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              {theme === 'light' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--ink3)', fontWeight: 600, padding: 12 }}>Lädt…</div>
        ) : loadError ? (
          <div style={{ color: '#E5484D', fontWeight: 700, padding: 12 }}>{loadError}</div>
        ) : isPlanner ? (
          plannerBody()
        ) : calView === 'list' ? (
          listBody()
        ) : (
          <div ref={pagerRef} onPointerDown={pagerDown} onWheel={pagerWheel} style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' }}>
            <div style={{ display: 'flex', width: '300%', height: '100%', transform: `translateX(calc(-33.3333% + ${dx}px))`, transition: animating ? 'transform .32s cubic-bezier(.22,.61,.36,1)' : 'none' }}>
              {calView === 'week' && [addDays(weekStart, -7), weekStart, addDays(weekStart, 7)].map((ws, i) => weekBody(ws, i))}
              {calView === 'month' && [[year, month - 1], [year, month], [year, month + 1]].map(([yy, mm]) => monthBody(yy, mm))}
              {calView === 'year' && [year - 1, year, year + 1].map((yy) => yearBody(yy))}
            </div>
          </div>
        )}

        {conflict && (
          <div style={{ position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 72, display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px 12px 22px', borderRadius: 18, background: 'var(--screen)', border: '1.5px solid #E5484D', boxShadow: 'var(--shadow)', maxWidth: '90%' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Überschneidet {conflict.count} {conflict.count === 1 ? 'Block' : 'Blöcke'} — parallel nicht erlaubt.</div>
            <div onClick={() => setConflict(null)} style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--hair)', color: 'var(--ink2)', fontWeight: 800, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>Abbrechen</div>
            <div
              onClick={async () => {
                const c = conflict
                setConflict(null)
                setBusy(true)
                try {
                  await c.apply(true)
                } catch (e) {
                  setEditError(e instanceof Error ? e.message : 'Fehlgeschlagen')
                } finally {
                  setBusy(false)
                }
              }}
              style={{ padding: '10px 20px', borderRadius: 12, background: NEUTRAL, color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 6px 16px rgba(34,197,94,0.4)', whiteSpace: 'nowrap' }}
            >
              Andere nach hinten schieben
            </div>
          </div>
        )}

        {editor && (
          <BlockEditor
            draft={editor}
            employers={employers}
            projects={projects}
            onChange={(patch) => setEditor((s) => (s ? { ...s, ...patch } : s))}
            onClose={() => setEditor(null)}
            onSave={saveBlock}
            onDelete={deleteBlock}
            onSplit={splitBlock}
            busy={busy}
            error={editError}
          />
        )}

        {/* Info-Popup wie in der 24-Stunden-Uhr (Mein Tag): Ansehen → Bearbeiten/Löschen */}
        {entryPopup && (() => {
          const e = entryPopup
          const emp = employersById.get(e.employer_id)
          const proj = e.project_id != null ? projectsById.get(e.project_id) : undefined
          const color = colorFor(e.employer_id)
          const s = new Date(e.start_ts)
          const end = e.end_ts ? new Date(e.end_ts) : null
          const durMin = ((end ? end.getTime() : Date.now()) - s.getTime()) / 60000
          const durH = Math.floor(durMin / 60)
          const durM = Math.round(durMin % 60)
          const durLabel = durM === 0 ? `${durH}h` : `${durH}h ${pad2(durM)}`
          const sub = proj ? emp?.name ?? '' : ''
          return (
            <div onClick={() => setEntryPopup(null)} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 34 }}>
              <div onClick={(ev) => ev.stopPropagation()} style={{ width: 360, borderRadius: 24, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .16s ease' }}>
                <div style={{ padding: '22px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 4, background: color }} />
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: end ? 'var(--ink3)' : 'var(--accent, #16A34A)' }}>{end ? 'Erfasst' : 'Läuft'}</div>
                    <div style={{ flex: 1 }} />
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{durLabel}</div>
                  </div>
                  <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginTop: 12 }}>{proj?.name ?? emp?.name ?? 'Aktivität'}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 1 }}>Bereich · {sub || '—'} · {minToHHMM(minutesOfDay(s))}–{end ? minToHHMM(minutesOfDay(end)) : 'jetzt'}</div>
                  {e.note && <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginTop: 8, lineHeight: 1.45 }}>{e.note}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <div onClick={() => { setEntryPopup(null); setEntryEdit(e) }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Bearbeiten</div>
                    <div onClick={() => { setEntryPopup(null); void (async () => { await api.deleteEntry(e.id); await reloadEntries() })() }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, borderRadius: 13, background: '#E5484D', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Löschen</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {entryEdit && <EntryEditor entry={entryEdit} employers={employers} projects={projects} onClose={() => setEntryEdit(null)} onSaved={reloadEntries} />}

        {absSheet && (
          <div onClick={() => setAbsSheet(false)} style={{ position: 'absolute', inset: 0, zIndex: 66, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .18s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 30px 16px' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>Abwesenheit</div>
                <div onClick={() => setAbsSheet(false)} style={{ width: 40, height: 40, borderRadius: 13, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 18, fontWeight: 600 }}>✕</div>
              </div>
              <div style={{ padding: '0 30px 28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Art</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {(['urlaub', 'krank', 'sonstiges'] as const).map((t) => {
                      const on = absDraft.type === t
                      return (
                        <div key={t} onClick={() => setAbsDraft((d) => ({ ...d, type: t }))} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12, background: on ? `color-mix(in srgb, ${absColor(t)} 16%, transparent)` : 'var(--glass)', border: `1.5px solid ${on ? absColor(t) : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                          <div style={{ width: 9, height: 9, borderRadius: 3, background: absColor(t) }} />{absLabel(t)}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Von</div>
                    <input type="date" lang="de-DE" value={absDraft.start} onChange={(e) => setAbsDraft((d) => ({ ...d, start: e.target.value, end: d.end && d.end >= e.target.value ? d.end : e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Bis</div>
                    <input type="date" lang="de-DE" value={absDraft.end} min={absDraft.start} onChange={(e) => setAbsDraft((d) => ({ ...d, end: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)' }}>
                    {([true, false] as const).map((v) => (
                      <div key={String(v)} onClick={() => setAbsDraft((d) => ({ ...d, allDay: v }))} style={{ flex: 1, textAlign: 'center', padding: '9px 12px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: absDraft.allDay === v ? 'var(--ink)' : 'var(--ink3)', background: absDraft.allDay === v ? 'var(--glass-strong)' : 'transparent', boxShadow: absDraft.allDay === v ? '0 2px 8px var(--hair)' : 'none' }}>
                        {v ? 'Ganzer Tag' : 'Zeitfenster'}
                      </div>
                    ))}
                  </div>
                  {!absDraft.allDay && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                      <TimeField value={absDraft.startTime} onChange={(v) => setAbsDraft((d) => ({ ...d, startTime: v }))} style={{ flex: 1, boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                      <TimeField value={absDraft.endTime} onChange={(v) => setAbsDraft((d) => ({ ...d, endTime: v }))} style={{ flex: 1, boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Bereich</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <div onClick={() => setAbsDraft((d) => ({ ...d, employerId: null }))} style={{ padding: '8px 14px', borderRadius: 12, background: absDraft.employerId == null ? 'var(--glass-strong)' : 'var(--glass)', border: `1.5px solid ${absDraft.employerId == null ? 'var(--ink3)' : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Alle</div>
                    {employers.map((e) => {
                      const on = absDraft.employerId === e.id
                      const color = colorFor(e.id)
                      return (
                        <div key={e.id} onClick={() => setAbsDraft((d) => ({ ...d, employerId: e.id }))} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12, background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)', border: `1.5px solid ${on ? color : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                          <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />{e.name}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <input value={absDraft.note} onChange={(e) => setAbsDraft((d) => ({ ...d, note: e.target.value }))} placeholder="Notiz (optional)" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                {(() => {
                  const key = absDraft.start || dayKey(selectedDay)
                  const areas = (absDraft.employerId == null ? employers.map((e) => e.id) : [absDraft.employerId]).map((id) => ({ id, soll: dailySoll(id, key) }))
                  const dist = distributeAbsenceMinutes(areas, absDraft.allDay, hhmmToMin(absDraft.startTime), hhmmToMin(absDraft.endTime))
                  const total = [...dist.values()].reduce((s, v) => s + v, 0)
                  const fmtH = (m: number) => { const h = Math.floor(m / 60); const mm = m % 60; return mm ? `${h}h ${pad2(mm)}` : `${h}h` }
                  const parts = [...dist.entries()].filter(([, v]) => v > 0).map(([id, v]) => `${employersById.get(id)?.name}: ${fmtH(v)}`)
                  return (
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px' }}>
                      {total > 0 ? `Zählt als Ist — ${parts.join(' · ')} (Summe ${fmtH(total)})` : 'Kein Soll an diesem Tag (z. B. Feiertag/Wochenende) — keine Anrechnung.'}
                    </div>
                  )
                })()}
                {absError && <div style={{ fontSize: 13, fontWeight: 700, color: '#E5484D' }}>{absError}</div>}
                <div onClick={absBusy || !absDraft.start ? undefined : () => void saveAbsence()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 14, background: NEUTRAL, color: '#fff', fontWeight: 800, fontSize: 15, cursor: absBusy || !absDraft.start ? 'default' : 'pointer', opacity: absBusy || !absDraft.start ? 0.6 : 1, boxShadow: '0 8px 20px rgba(34,197,94,0.4)' }}>{absBusy ? 'Speichern…' : absDraft.id != null ? 'Änderungen speichern' : 'Abwesenheit hinzufügen'}</div>

                {absences.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 10 }}>Geplant</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {absences.map((a) => (
                        <div key={a.id} onClick={() => openAbsEdit(a)} title="Bearbeiten" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: a.id === absDraft.id ? 'var(--glass-strong)' : 'var(--glass)', border: `1px solid ${a.id === absDraft.id ? absColor(a.type) : 'var(--border)'}`, cursor: 'pointer' }}>
                          <div style={{ width: 22, height: 22, borderRadius: 7, background: `color-mix(in srgb, ${absColor(a.type)} 18%, transparent)`, display: 'grid', placeItems: 'center', fontSize: 13, flex: 'none' }}>{absIcon(a.type)}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{absLabel(a.type)} · {new Date(`${a.start_date}T00:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}{a.end_date !== a.start_date ? `–${new Date(`${a.end_date}T00:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}` : ''}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>{a.employer_id == null ? 'Alle Bereiche' : employersById.get(a.employer_id)?.name}{a.all_day ? '' : ` · ${minToHHMM(a.start_min ?? 0)}–${minToHHMM(a.end_min ?? 0)}`}{a.note ? ` · ${a.note}` : ''}</div>
                          </div>
                          <div onClick={(e) => { e.stopPropagation(); void removeAbsence(a.id) }} style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#E5484D', fontWeight: 800 }}>✕</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {exportOpen && (
          <div onClick={() => setExportOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 66, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 520, borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .18s ease' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '26px 30px 16px' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>Export · CSV</div>
                <div onClick={() => setExportOpen(false)} style={{ width: 40, height: 40, borderRadius: 13, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 18, fontWeight: 600 }}>✕</div>
              </div>
              <div style={{ padding: '0 30px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Inhalt</div>
                  <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)', marginTop: 10 }}>
                    {(['entries', 'absences'] as const).map((k) => (
                      <div key={k} onClick={() => setExp((s) => ({ ...s, kind: k }))} style={{ flex: 1, textAlign: 'center', padding: '9px 12px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: exp.kind === k ? 'var(--ink)' : 'var(--ink3)', background: exp.kind === k ? 'var(--glass-strong)' : 'transparent', boxShadow: exp.kind === k ? '0 2px 8px var(--hair)' : 'none' }}>{k === 'entries' ? 'Erfasste Aktivitäten' : 'Abwesenheiten'}</div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Von</div>
                    <input type="date" lang="de-DE" value={exp.from} onChange={(e) => setExp((s) => ({ ...s, from: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Bis</div>
                    <input type="date" lang="de-DE" value={exp.to} min={exp.from} onChange={(e) => setExp((s) => ({ ...s, to: e.target.value }))} style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Bereich</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    <div onClick={() => setExp((s) => ({ ...s, employerId: 'all' }))} style={{ padding: '8px 14px', borderRadius: 12, background: exp.employerId === 'all' ? 'var(--glass-strong)' : 'var(--glass)', border: `1.5px solid ${exp.employerId === 'all' ? 'var(--ink3)' : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Alle</div>
                    {employers.map((e) => {
                      const on = exp.employerId === e.id
                      const color = colorFor(e.id)
                      return (
                        <div key={e.id} onClick={() => setExp((s) => ({ ...s, employerId: e.id }))} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12, background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)', border: `1.5px solid ${on ? color : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                          <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />{e.name}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div onClick={exp.from && exp.to ? doExport : undefined} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 14, borderRadius: 14, background: NEUTRAL, color: '#fff', fontWeight: 800, fontSize: 15, cursor: exp.from && exp.to ? 'pointer' : 'default', opacity: exp.from && exp.to ? 1 : 0.6, boxShadow: '0 8px 20px rgba(34,197,94,0.4)' }}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12" /><path d="M7 9l5-6 5 6" /><path d="M4 17v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
                  CSV herunterladen
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
