import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { api, type Absence, type AppSettings, type AreaHours, type Employer, type Entry, type Project } from '../api'
import { employerColor } from '../colors'
import { holidayName } from '../holidays'
import { distributeAbsenceMinutes } from '../absence'
import EntryEditor from '../components/EntryEditor'
import type { PageIntent } from '../App'

const GLASS: CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--border)',
}
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
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
function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm === 0 ? `${h}h` : `${h}h ${pad2(mm)}`
}
function fmtSigned(min: number): string {
  const r = Math.round(min)
  return (r < 0 ? '−' : '+') + fmtDur(Math.abs(r))
}
function fmtClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
type Mode = 'week' | 'month' | 'year' | 'gesamt'
interface SubPeriod { label: string; from: Date; to: Date }

interface AuswertungProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onBack: () => void
  onOpenCalendar: () => void
  onOpenTodos: () => void
  onOpenSpotlight: () => void
  settings: AppSettings
  setSelectedDay: Dispatch<SetStateAction<Date>>
  mode: Mode
  onModeChange: (m: Mode) => void
  intent: PageIntent | null
  onIntentDone: () => void
}

export default function Auswertung({ theme, onToggleTheme, onBack, onOpenCalendar, onOpenTodos, onOpenSpotlight, settings, setSelectedDay, mode, onModeChange, intent, onIntentDone }: AuswertungProps) {
  const [ref, setRef] = useState(() => startOfDay(new Date()))
  const [areaFilter, setAreaFilter] = useState<number | 'all'>('all')
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [areaHours, setAreaHours] = useState<AreaHours[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [loading, setLoading] = useState(true)
  const [slot, setSlot] = useState<SubPeriod | null>(null)
  const [areaPop, setAreaPop] = useState<number | null>(null)
  const [drill, setDrill] = useState<{ from: Date; to: Date; employerId: number; projectId: number | null; name: string; color: string } | null>(null)
  const [editEntry, setEditEntry] = useState<Entry | null>(null)
  const [sollMode, setSollMode] = useState<'todate' | 'full'>('todate')
  const [splitByArea, setSplitByArea] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [now] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    Promise.all([api.getEmployers(), api.getEntries(), api.getAreaHours(), api.getAbsences(), api.getProjects()])
      .then(([emp, ent, ah, abs, proj]) => {
        if (!alive) return
        setEmployers(emp)
        setEntries(ent)
        setAreaHours(ah)
        setAbsences(abs)
        setProjects(proj)
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])
  async function reloadEntries() {
    setEntries(await api.getEntries())
  }

  // Perioden-Navigation per Command (period-prev/next).
  const lastIntentNonce = useRef(0)
  useEffect(() => {
    if (!intent || intent.nonce === lastIntentNonce.current) return
    lastIntentNonce.current = intent.nonce
    if (intent.action === 'period-prev') navPeriod(-1)
    else if (intent.action === 'period-next') navPeriod(1)
    onIntentDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  const todayKey = dayKey(startOfDay(now))
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const includedEmp = areaFilter === 'all' ? employers.map((e) => e.id) : [areaFilter]

  const employersById = useMemo(() => new Map(employers.map((e) => [e.id, e])), [employers])
  const colorFor = (empId: number): string => employersById.get(empId)?.color ?? employerColor(empId)
  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  // Ist-Minuten je Tag+Bereich aus Zeiteinträgen.
  const entryMin = useMemo(() => {
    const m = new Map<string, Map<number, number>>()
    for (const e of entries) {
      const k = dayKey(new Date(e.start_ts))
      const dur = e.end_ts === null ? (now.getTime() - Date.parse(e.start_ts)) / 60000 : e.duration_min ?? 0
      let inner = m.get(k)
      if (!inner) { inner = new Map(); m.set(k, inner) }
      inner.set(e.employer_id, (inner.get(e.employer_id) ?? 0) + Math.max(0, dur))
    }
    return m
  }, [entries, now])

  function dailySoll(empId: number, key: string): number {
    if (key < settings.start_date) return 0 // harter Stichtag: davor kein Soll
    const emp = employersById.get(empId)
    if (emp && emp.kind === 'private') return 0
    if (holidayName(key, settings.bundesland)) return 0
    const wd = new Date(`${key}T00:00:00`).getDay()
    for (const r of areaHours) if (r.employer_id === empId && r.weekday === wd) return r.minutes
    return 0
  }
  function absenceIstDay(key: string, empId: number): number {
    let total = 0
    for (const a of absences) {
      if (!(a.start_date <= key && key <= a.end_date)) continue
      if (!(a.employer_id == null || a.employer_id === empId)) continue
      const begun = key < todayKey || (key === todayKey && (a.all_day === 1 || (a.start_min ?? 0) <= nowMin))
      if (!begun) continue
      const areaIds = a.employer_id == null ? employers.map((e) => e.id) : [a.employer_id]
      total += distributeAbsenceMinutes(areaIds.map((id) => ({ id, soll: dailySoll(id, key) })), a.all_day === 1, a.start_min, a.end_min).get(empId) ?? 0
    }
    return total
  }
  function istDayEmp(key: string, empId: number): number {
    if (key < settings.start_date) return 0 // harter Stichtag: davor kein Ist
    return (entryMin.get(key)?.get(empId) ?? 0) + absenceIstDay(key, empId)
  }
  // Soll je Tag – im "bis jetzt"-Modus zählen künftige Tage nicht.
  const sollDayFn = (key: string, id: number) => (sollMode === 'todate' && key > todayKey ? 0 : dailySoll(id, key))
  function sumRange(from: Date, to: Date, empIds: number[], fn: (key: string, id: number) => number): number {
    let total = 0
    for (let d = startOfDay(from); d.getTime() <= startOfDay(to).getTime(); d = addDays(d, 1)) {
      const k = dayKey(d)
      for (const id of empIds) total += fn(k, id)
    }
    return total
  }

  // --- Perioden ---
  const year = ref.getFullYear()
  const month = ref.getMonth()
  const weekStart = useMemo(() => addDays(startOfDay(ref), -monIndex(ref)), [ref])
  const earliestYear = useMemo(() => {
    const startYear = new Date(`${settings.start_date}T00:00:00`).getFullYear()
    let y = now.getFullYear()
    for (const e of entries) y = Math.min(y, new Date(e.start_ts).getFullYear())
    return Math.max(y, startYear) // "Gesamt" beginnt frühestens im Stichtags-Jahr
  }, [entries, now, settings.start_date])

  const { subs, periodFrom, periodTo, kicker, big } = useMemo(() => {
    if (mode === 'week') {
      const subsW: SubPeriod[] = Array.from({ length: 7 }, (_, i) => { const d = addDays(weekStart, i); return { label: WD[i], from: d, to: d } })
      return { subs: subsW, periodFrom: weekStart, periodTo: addDays(weekStart, 6), kicker: `${weekStart.getDate()}.–${addDays(weekStart, 6).getDate()}. ${MONTHS_SHORT[addDays(weekStart, 6).getMonth()]} ${year}`, big: `KW ${isoWeek(weekStart)}` }
    }
    if (mode === 'month') {
      const first = new Date(year, month, 1)
      const last = new Date(year, month + 1, 0)
      const subsM: SubPeriod[] = []
      let cur = addDays(startOfDay(first), -monIndex(first))
      while (cur.getTime() <= last.getTime()) {
        const wkEnd = addDays(cur, 6)
        const from = cur.getTime() < first.getTime() ? first : cur
        const to = wkEnd.getTime() > last.getTime() ? last : wkEnd
        if (to.getTime() >= first.getTime() && from.getTime() <= last.getTime()) subsM.push({ label: `KW${isoWeek(from)}`, from, to })
        cur = addDays(cur, 7)
      }
      return { subs: subsM, periodFrom: first, periodTo: last, kicker: String(year), big: MONTHS[month] }
    }
    if (mode === 'year') {
      const subsY: SubPeriod[] = Array.from({ length: 12 }, (_, mi) => ({ label: MONTHS_SHORT[mi], from: new Date(year, mi, 1), to: new Date(year, mi + 1, 0) }))
      return { subs: subsY, periodFrom: new Date(year, 0, 1), periodTo: new Date(year, 11, 31), kicker: 'Jahr', big: String(year) }
    }
    const subsG: SubPeriod[] = []
    for (let y = earliestYear; y <= now.getFullYear(); y++) subsG.push({ label: String(y), from: new Date(y, 0, 1), to: new Date(y, 11, 31) })
    return { subs: subsG, periodFrom: new Date(earliestYear, 0, 1), periodTo: new Date(now.getFullYear(), 11, 31), kicker: 'Alle Zeit', big: 'Gesamt' }
  }, [mode, weekStart, year, month, earliestYear, now])

  const subData = useMemo(
    () => subs.map((sp) => ({ sp, ist: sumRange(sp.from, sp.to, includedEmp, istDayEmp), soll: sumRange(sp.from, sp.to, includedEmp, sollDayFn) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subs, includedEmp, entryMin, absences, areaHours, sollMode, todayKey, settings.start_date],
  )
  const totalIst = subData.reduce((s, x) => s + x.ist, 0)
  const totalSoll = subData.reduce((s, x) => s + x.soll, 0)
  const scaleMax = Math.max(1, ...subData.map((x) => Math.max(x.ist, x.soll)))

  const accent = areaFilter === 'all' ? 'var(--accent, #22C55E)' : employerColor(areaFilter)

  // Projekte (mit Ist-Minuten) im Zeitraum für die Bereiche.
  function projectAgg(from: Date, to: Date, empIds: number[]) {
    const fk = dayKey(startOfDay(from))
    const tk = dayKey(startOfDay(to))
    const map = new Map<string, { employerId: number; projectId: number | null; name: string; color: string; min: number }>()
    for (const e of entries) {
      const k = dayKey(new Date(e.start_ts))
      if (k < fk || k > tk || !empIds.includes(e.employer_id)) continue
      const dur = e.end_ts === null ? (now.getTime() - Date.parse(e.start_ts)) / 60000 : e.duration_min ?? 0
      const key = `${e.employer_id}:${e.project_id ?? 'x'}`
      let row = map.get(key)
      if (!row) {
        const proj = e.project_id != null ? projectsById.get(e.project_id) : undefined
        row = { employerId: e.employer_id, projectId: e.project_id, name: proj?.name ?? employersById.get(e.employer_id)?.name ?? 'Ohne Projekt', color: colorFor(e.employer_id), min: 0 }
        map.set(key, row)
      }
      row.min += Math.max(0, dur)
    }
    return [...map.values()].sort((a, b) => b.min - a.min)
  }
  function entriesFor(from: Date, to: Date, employerId: number, projectId: number | null): Entry[] {
    const fk = dayKey(startOfDay(from))
    const tk = dayKey(startOfDay(to))
    return entries
      .filter((e) => { const k = dayKey(new Date(e.start_ts)); return k >= fk && k <= tk && e.employer_id === employerId && (e.project_id ?? null) === projectId })
      .sort((a, b) => a.start_ts.localeCompare(b.start_ts))
  }

  function navPeriod(dir: number) {
    if (mode === 'week') setRef((d) => addDays(d, dir * 7))
    else if (mode === 'month') setRef(new Date(year, month + dir, 1))
    else if (mode === 'year') setRef(new Date(year + dir, month, 1))
  }
  const isCurrent = mode === 'gesamt' || (mode === 'week' && todayKey >= dayKey(weekStart) && todayKey <= dayKey(addDays(weekStart, 6))) || (mode === 'month' && year === now.getFullYear() && month === now.getMonth()) || (mode === 'year' && year === now.getFullYear())

  const CHART_H = 210

  return (
    <div data-theme={theme} style={{ fontFamily: "-apple-system, system-ui, 'Manrope', sans-serif", height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{ zoom: 0.9, width: 'calc(100vw / 0.9)', height: 'calc(100vh / 0.9)', background: 'var(--screen)', overflow: 'hidden', position: 'relative', padding: '44px 68px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
              <div onClick={onBack} title="Mein Tag" style={{ padding: '8px 13px', borderRadius: 10, color: 'var(--ink3)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.4V12l3.2 1.9" /></svg>
              </div>
              <div title="Auswertung" style={{ padding: '8px 14px', borderRadius: 10, background: 'var(--glass-strong)', boxShadow: '0 2px 8px var(--hair)', color: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V11" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M21 20H3" /></svg>
              </div>
            </div>
            <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
              {(['week', 'month', 'year', 'gesamt'] as const).map((m) => (
                <div key={m} onClick={() => onModeChange(m)} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: mode === m ? 'var(--ink)' : 'var(--ink3)', background: mode === m ? 'var(--glass-strong)' : 'transparent', boxShadow: mode === m ? '0 2px 8px var(--hair)' : 'none' }}>
                  {m === 'week' ? 'Woche' : m === 'month' ? 'Monat' : m === 'year' ? 'Jahr' : 'Gesamt'}
                </div>
              ))}
            </div>
          </div>
          {mode !== 'gesamt' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 18px', borderRadius: 16, ...GLASS, flex: 'none' }}>
              <div onClick={() => navPeriod(-1)} style={{ color: 'var(--ink3)', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}>‹</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', minWidth: 120, textAlign: 'center' }}>{big} · {mode === 'week' ? MONTHS_SHORT[weekStart.getMonth()] : ''}{mode === 'month' ? year : ''}</div>
              <div onClick={() => navPeriod(1)} style={{ color: 'var(--ink3)', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}>›</div>
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
            {!isCurrent && <div onClick={() => setRef(startOfDay(new Date()))} style={{ padding: '8px 14px', borderRadius: 11, background: 'color-mix(in srgb, var(--accent, #22C55E) 14%, transparent)', border: '1.5px solid var(--accent, #22C55E)', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'var(--accent, #16A34A)', whiteSpace: 'nowrap' }}>↩ Aktuell</div>}
            <div onClick={onOpenSpotlight} title="Suche (Spotlight)" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            </div>
            <div onClick={onOpenTodos} title="To-Dos" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4 6l1 1 2-2" /><path d="M4 12l1 1 2-2" /><path d="M4 18l1 1 2-2" /></svg>
            </div>
            <div onClick={onOpenCalendar} title="Kalender" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18" /><path d="M8 2.5v4" /><path d="M16 2.5v4" /></svg>
            </div>
            <div onClick={onToggleTheme} title="Farbschema" style={{ width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>
              {theme === 'light' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>}
            </div>
          </div>
        </div>

        {/* title + area chips */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 18 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '3px', color: 'var(--ink2)', textTransform: 'uppercase' }}>{kicker}</div>
            <div style={{ fontSize: 52, lineHeight: 0.9, fontWeight: 800, color: 'var(--ink3)', letterSpacing: '-2px', marginTop: 4 }}>{big}</div>
          </div>
          <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
            {[{ id: 'all' as const, name: 'Gesamt' }, ...employers.map((e) => ({ id: e.id, name: e.name }))].map((c) => (
              <div key={String(c.id)} onClick={() => setAreaFilter(c.id)} style={{ padding: '8px 15px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', color: areaFilter === c.id ? 'var(--ink)' : 'var(--ink3)', background: areaFilter === c.id ? 'var(--glass-strong)' : 'transparent', boxShadow: areaFilter === c.id ? '0 2px 8px var(--hair)' : 'none' }}>{c.name}</div>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--ink3)', fontWeight: 600, padding: 12 }}>Lädt…</div>
        ) : (
          <div style={{ marginTop: 18, flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* chart card */}
            <div style={{ flex: 'none', borderRadius: 28, ...GLASS, boxShadow: '0 10px 30px var(--hair)', padding: '22px 26px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Konto{sollMode === 'todate' ? ' · bis jetzt' : ''}</div>
                  <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-1.5px', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{fmtSigned(totalIst - totalSoll)}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', marginTop: 2 }}>Ist {fmtDur(totalIst)} · Soll {fmtDur(totalSoll)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 11, ...GLASS }}>
                    {(['todate', 'full'] as const).map((m) => (
                      <div key={m} onClick={() => setSollMode(m)} style={{ padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer', color: sollMode === m ? 'var(--ink)' : 'var(--ink3)', background: sollMode === m ? 'var(--glass-strong)' : 'transparent', boxShadow: sollMode === m ? '0 2px 8px var(--hair)' : 'none' }}>{m === 'todate' ? 'Bis jetzt' : 'Ganze Periode'}</div>
                    ))}
                  </div>
                  {areaFilter === 'all' && (
                    <div onClick={() => setSplitByArea((v) => !v)} title="Balken nach Bereich aufteilen" style={{ width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer', color: splitByArea ? 'var(--ink)' : 'var(--ink3)', background: splitByArea ? 'var(--glass-strong)' : 'var(--glass)', border: `1px solid ${splitByArea ? 'var(--ink3)' : 'var(--border)'}` }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: subData.length > 12 ? 3 : 8, height: CHART_H, marginTop: 16, position: 'relative' }}>
                {subData.map((x, i) => {
                  const istH = Math.max(2, (x.ist / scaleMax) * CHART_H)
                  const sollH = (x.soll / scaleMax) * CHART_H
                  const hovered = hoveredIdx === i
                  const segs = splitByArea && areaFilter === 'all'
                    ? employers.map((e) => ({ color: colorFor(e.id), ist: sumRange(x.sp.from, x.sp.to, [e.id], istDayEmp) })).filter((s) => s.ist > 0)
                    : [{ color: accent, ist: x.ist }]
                  return (
                    <div key={i} onClick={() => setSlot(x.sp)} onMouseEnter={() => setHoveredIdx(i)} onMouseLeave={() => setHoveredIdx(null)} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', position: 'relative', cursor: 'pointer' }}>
                      <div style={{ width: '68%', minWidth: 6, height: istH, borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', opacity: hoveredIdx == null || hovered ? 1 : 0.5, transition: 'opacity .15s ease' }}>
                        {segs.map((s, si) => (
                          <div key={si} style={{ height: `${x.ist > 0 ? (s.ist / x.ist) * 100 : 0}%`, background: s.color }} />
                        ))}
                      </div>
                      {x.soll > 0 && <div style={{ position: 'absolute', left: '10%', right: '10%', bottom: sollH, height: 0, borderTop: '2px dashed var(--ink3)', opacity: 0.7 }} />}
                      {hovered && (
                        <div style={{ position: 'absolute', bottom: istH + 8, left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none' }}>
                          <div style={{ borderRadius: 12, background: 'var(--glass-strong)', border: '1px solid var(--border)', boxShadow: '0 4px 14px var(--hair)', padding: '6px 12px', whiteSpace: 'nowrap', textAlign: 'center' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)' }}>{x.sp.from.getTime() === x.sp.to.getTime() ? `${WD[monIndex(x.sp.from)]} - ${x.sp.from.getDate()}. ${MONTHS_SHORT[x.sp.from.getMonth()]}` : x.sp.label}</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(x.ist)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', paddingTop: 8, gap: subData.length > 12 ? 3 : 8 }}>
                {subData.map((x, i) => (
                  <div key={i} onClick={() => setSlot(x.sp)} style={{ flex: 1, textAlign: 'center', fontSize: subData.length > 12 ? 10 : 12, fontWeight: hoveredIdx === i ? 800 : 700, color: hoveredIdx === i ? 'var(--ink)' : 'var(--ink2)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden' }}>{x.sp.label}</div>
                ))}
              </div>
            </div>

            {/* area cards */}
            <div style={{ flex: 'none', borderRadius: 24, ...GLASS, boxShadow: '0 10px 30px var(--hair)', padding: '18px 22px' }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 12 }}>Bereiche · {big}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {employers.filter((e) => areaFilter === 'all' || e.id === areaFilter).map((e) => {
                  const color = colorFor(e.id)
                  const segs = subs.map((sp) => {
                    const ist = sumRange(sp.from, sp.to, [e.id], istDayEmp)
                    const soll = sumRange(sp.from, sp.to, [e.id], sollDayFn)
                    return { ist, soll, fill: soll > 0 ? Math.min(1, ist / soll) : ist > 0 ? 1 : 0 }
                  })
                  const istT = segs.reduce((s, x) => s + x.ist, 0)
                  const sollT = segs.reduce((s, x) => s + x.soll, 0)
                  return (
                    <div key={e.id} onClick={() => setAreaPop(e.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer', borderRadius: 12, padding: 4, margin: -4 }}>
                      <div style={{ width: 96, flex: 'none', display: 'flex', alignItems: 'center', gap: 7 }}>
                        <div style={{ width: 9, height: 9, borderRadius: 3, background: color }} />
                        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</div>
                      </div>
                      <div style={{ flex: 1, display: 'flex', gap: 3, height: 16 }}>
                        {segs.map((s, i) => (
                          <div key={i} style={{ flex: 1, borderRadius: 4, background: 'var(--track)', position: 'relative', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${s.fill * 100}%`, background: color, borderRadius: 4 }} />
                          </div>
                        ))}
                      </div>
                      <div style={{ width: 130, flex: 'none', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(istT)} / {fmtDur(sollT)}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* slot popup */}
        {slot && (
          <div onClick={() => setSlot(null)} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(20,22,30,0.22)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 380, maxHeight: '84%', overflowY: 'auto', borderRadius: 26, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: '24px 26px' }}>
              {(() => {
                const ist = sumRange(slot.from, slot.to, includedEmp, istDayEmp)
                const soll = sumRange(slot.from, slot.to, includedEmp, sollDayFn)
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--ink3)' }}>{slot.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px', marginTop: 2 }}>{fmtSigned(ist - soll)}</div>
                      </div>
                      <div onClick={() => setSlot(null)} style={{ width: 34, height: 34, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 16, fontWeight: 600 }}>✕</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                      <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Ist</div><div style={{ fontSize: 22, fontWeight: 800, color: accent, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(ist)}</div></div>
                      <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Soll</div><div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(soll)}</div></div>
                    </div>
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 9 }}>
                      {employers.filter((e) => areaFilter === 'all' || e.id === areaFilter).map((e) => (
                        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 9, height: 9, borderRadius: 3, background: colorFor(e.id) }} />
                          <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{e.name}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(sumRange(slot.from, slot.to, [e.id], istDayEmp))}</div>
                        </div>
                      ))}
                    </div>
                    {(() => {
                      const rows = projectAgg(slot.from, slot.to, includedEmp)
                      if (rows.length === 0) return null
                      return (
                        <div style={{ marginTop: 16, borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Projekte · tippen zum Bearbeiten</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {rows.map((r) => (
                              <div key={`${r.employerId}:${r.projectId}`} onClick={() => setDrill({ from: slot.from, to: slot.to, employerId: r.employerId, projectId: r.projectId, name: r.name, color: r.color })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 11, background: 'var(--glass)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                                <div style={{ width: 9, height: 9, borderRadius: 3, background: r.color, flex: 'none' }} />
                                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(r.min)}</div>
                                <div style={{ color: 'var(--ink3)', fontSize: 14 }}>›</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* area popup */}
        {areaPop != null && (
          <div onClick={() => setAreaPop(null)} style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(20,22,30,0.22)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxHeight: '80%', display: 'flex', flexDirection: 'column', borderRadius: 26, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              {(() => {
                const e = employersById.get(areaPop)!
                const color = colorFor(areaPop)
                const ist = sumRange(periodFrom, periodTo, [areaPop], istDayEmp)
                const soll = sumRange(periodFrom, periodTo, [areaPop], sollDayFn)
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 26px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 14, height: 14, borderRadius: 5, background: color }} />
                        <div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>{e.name}</div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>{big}</div></div>
                      </div>
                      <div onClick={() => setAreaPop(null)} style={{ width: 34, height: 34, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 16, fontWeight: 600 }}>✕</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, padding: '0 26px' }}>
                      <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Erfasst</div><div style={{ fontSize: 20, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(ist)}</div></div>
                      <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Soll</div><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(soll)}</div></div>
                      <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Saldo</div><div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(ist - soll)}</div></div>
                    </div>
                    <div style={{ padding: '18px 26px 24px', overflowY: 'auto' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>Pro Zeitraum</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {subs.map((sp, i) => {
                          const si = sumRange(sp.from, sp.to, [areaPop], istDayEmp)
                          const ss = sumRange(sp.from, sp.to, [areaPop], sollDayFn)
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 54, fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{sp.label}</div>
                              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--track)', position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${ss > 0 ? Math.min(100, (si / ss) * 100) : si > 0 ? 100 : 0}%`, background: color, borderRadius: 4 }} /></div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtDur(si)} / {fmtDur(ss)}</div>
                            </div>
                          )
                        })}
                      </div>
                      {(() => {
                        const rows = projectAgg(periodFrom, periodTo, [areaPop])
                        if (rows.length === 0) return null
                        return (
                          <>
                            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', margin: '18px 0 8px' }}>Projekte · tippen zum Bearbeiten</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {rows.map((r) => (
                                <div key={`${r.employerId}:${r.projectId}`} onClick={() => setDrill({ from: periodFrom, to: periodTo, employerId: r.employerId, projectId: r.projectId, name: r.name, color: r.color })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 11, background: 'var(--glass)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                                  <div style={{ width: 9, height: 9, borderRadius: 3, background: r.color, flex: 'none' }} />
                                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(r.min)}</div>
                                  <div style={{ color: 'var(--ink3)', fontSize: 14 }}>›</div>
                                </div>
                              ))}
                            </div>
                          </>
                        )
                      })()}
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* drill: Einträge eines Projekts im Zeitraum */}
        {drill && (
          <div onClick={() => setDrill(null)} style={{ position: 'absolute', inset: 0, zIndex: 64, background: 'rgba(20,22,30,0.22)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxHeight: '82%', display: 'flex', flexDirection: 'column', borderRadius: 26, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 4, background: drill.color, flex: 'none' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drill.name}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>{drill.from.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}{dayKey(drill.from) !== dayKey(drill.to) ? `–${drill.to.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}` : ''}</div>
                  </div>
                </div>
                <div onClick={() => setDrill(null)} style={{ width: 34, height: 34, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 16, fontWeight: 600, flex: 'none' }}>✕</div>
              </div>
              <div style={{ padding: '0 24px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {entriesFor(drill.from, drill.to, drill.employerId, drill.projectId).map((e) => {
                  const s = new Date(e.start_ts)
                  const end = e.end_ts ? new Date(e.end_ts) : null
                  const dur = ((end ? end.getTime() : now.getTime()) - s.getTime()) / 60000
                  return (
                    <div key={e.id} onClick={() => setEditEntry(e)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 12, background: 'var(--cell)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                      <div style={{ width: 58, flex: 'none', fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{s.toLocaleDateString('de-DE', { weekday: 'short' })} {s.getDate()}.</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(s)}–{end ? fmtClock(end) : 'jetzt'}</div>
                        {e.note && <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.note}</div>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(dur)}</div>
                      <div style={{ color: 'var(--ink3)', fontSize: 14 }}>›</div>
                    </div>
                  )
                })}
              </div>
              <div style={{ padding: '0 24px 22px', flex: 'none' }}>
                <div onClick={() => { setSelectedDay(startOfDay(drill.from)); onOpenCalendar() }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 13, borderRadius: 14, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18" /><path d="M8 2.5v4" /><path d="M16 2.5v4" /></svg>
                  Im Kalender bearbeiten →
                </div>
              </div>
            </div>
          </div>
        )}

        {editEntry && <EntryEditor entry={editEntry} employers={employers} projects={projects} onClose={() => setEditEntry(null)} onSaved={reloadEntries} />}
      </div>
    </div>
  )
}
