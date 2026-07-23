import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { api, type AppSettings, type Employer, type GarminDaily, type GarminIntraday, type GarminScores, type GarminSleep, type IntradayPoint, type PlannedBlock, type PlannedOverride, type Project, type Workout } from '../api'
import { employerColor } from '../colors'
import { holidayName } from '../holidays'
import InboxPopover from '../components/InboxPopover'
import ActivityDeepDive from '../components/ActivityDeepDive'

const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const TYPE_EMOJI: Record<string, string> = {
  running: '🏃', treadmill_running: '🏃', trail_running: '🏃', track_running: '🏃',
  strength_training: '🏋️', indoor_cardio: '🤸', hiit: '🔥',
  road_biking: '🚴', cycling: '🚴', indoor_cycling: '🚴', mountain_biking: '🚵', gravel_cycling: '🚴',
  lap_swimming: '🏊', open_water_swimming: '🏊', swimming: '🏊',
  yoga: '🧘', pilates: '🧘', walking: '🚶', hiking: '🥾', soccer: '⚽',
}
const TYPE_LABEL: Record<string, string> = {
  running: 'Lauf', strength_training: 'Kraft', road_biking: 'Rad', hiking: 'Wandern',
  soccer: 'Fußball', open_water_swimming: 'Schwimmen', hiit: 'HIIT',
}
const pad = (n: number) => String(n).padStart(2, '0')
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dateFromKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d) }
// Alter IMMER zur Laufzeit aus Geburtsdatum berechnen (nie speichern), YYYY-MM-DD.
const ageFromBirthdate = (birth: string): number | null => {
  if (!birth) return null
  const b = dateFromKey(birth); if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--
  return a >= 0 && a < 130 ? a : null
}
const parseTs = (ts: string) => new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'))
function fmtDur(min: number) { if (min < 60) return `${Math.round(min)} min`; return `${Math.floor(min / 60)}h ${pad(Math.round(min % 60))}` }
function kmStr(m: number | null) { return m ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : '–' }
function relTime(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 90) return 'gerade eben'
  const m = s / 60; if (m < 90) return `vor ${Math.round(m)} Min`
  const h = m / 60; if (h < 36) return `vor ${Math.round(h)} Std`
  return `vor ${Math.round(h / 24)} Tg`
}
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}
function sparkPath(vals: number[], w: number, h: number, p = 3): string {
  if (vals.length < 2) return ''
  const mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1, sx = w / (vals.length - 1)
  return vals.map((v, i) => `${i ? 'L' : 'M'}${(i * sx).toFixed(1)} ${(p + (h - 2 * p) - ((v - mn) / r) * (h - 2 * p)).toFixed(1)}`).join(' ')
}
// ── Chart-Hover (Welle 4-1): Tooltip + Führungslinie + Punkt über beliebigen Kurven ──
type HoverPoint = { v: number | null; label: string }
function HoverOverlay({ pts, format, color, yFracAt, barMode = false }: { pts: HoverPoint[]; format: (v: number) => string; color: string; yFracAt: (i: number) => number | null; barMode?: boolean }) {
  const [hi, setHi] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const n = pts.length
  const nearestValid = (idx: number): number | null => {
    if (n === 0) return null
    for (let d = 0; d < n; d++) {
      const a = idx - d, b = idx + d
      if (a >= 0 && pts[a]?.v != null) return a
      if (b < n && pts[b]?.v != null) return b
    }
    return null
  }
  const onMove = (e: ReactMouseEvent) => {
    const el = ref.current; if (!el) return
    const rect = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const raw = barMode ? Math.min(n - 1, Math.floor(frac * n)) : Math.round(frac * (n - 1))
    setHi(nearestValid(raw))
  }
  const active = hi != null && pts[hi]?.v != null
  const xf = hi == null ? 0 : barMode ? (hi + 0.5) / n : (n > 1 ? hi / (n - 1) : 0.5)
  const yf = hi == null ? null : yFracAt(hi)
  const flip = xf > 0.62
  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 3 }}>
      {active && (<>
        <div style={{ position: 'absolute', left: `${xf * 100}%`, top: 0, bottom: 0, width: 1, background: 'var(--hair)', transform: 'translateX(-0.5px)', pointerEvents: 'none' }} />
        {yf != null && <div style={{ position: 'absolute', left: `${xf * 100}%`, top: `${yf * 100}%`, width: 8, height: 8, borderRadius: '50%', background: color, border: '2px solid var(--card)', transform: 'translate(-50%,-50%)', pointerEvents: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />}
        <div style={{ position: 'absolute', left: `${xf * 100}%`, top: 0, transform: `translate(${flip ? 'calc(-100% - 9px)' : '9px'}, -2px)`, pointerEvents: 'none', background: 'var(--glass-strong, var(--card))', border: '1px solid var(--border)', borderRadius: 9, padding: '5px 9px', boxShadow: '0 8px 22px -12px rgba(0,0,0,0.5)', whiteSpace: 'nowrap', zIndex: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{format(pts[hi as number].v as number)}</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', marginTop: 1 }}>{pts[hi as number].label}</div>
        </div>
      </>)}
    </div>
  )
}
// y-Fraktion (0=oben,1=unten) eines Punktes einer auto-skalierten Linie (wie sparkPath/linePathGapped)
function lineYFrac(vals: (number | null)[], i: number, pFrac: number): number | null {
  const v = vals[i]; if (v == null) return null
  const nn = vals.filter((x): x is number => x != null)
  if (nn.length < 2) return null
  const mn = Math.min(...nn), mx = Math.max(...nn), r = mx - mn || 1
  return pFrac + (1 - (v - mn) / r) * (1 - 2 * pFrac)
}
const fmtDayLabel = (d: Date) => `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}`
const fmtClock = (t: number | null): string => { if (t == null) return ''; const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
// Punkte für tages-basierte Serien (Index i ⇒ Datum today-(len-1)+i), label = Wochentag/Datum
function dayHoverPts(vals: (number | null)[]): HoverPoint[] {
  const len = vals.length
  return vals.map((v, i) => ({ v, label: fmtDayLabel(addDays(new Date(), i - (len - 1))) }))
}
// „nette" Achsen-Ticks (9.6)
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) { const p = Math.abs(min) || 1; min -= p * 0.5; max += p * 0.5 }
  const raw = (max - min) / count
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step * 0.5; v += step) out.push(Number(v.toFixed(6)))
  return out
}

const GLASS: CSSProperties = { background: 'var(--glass)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--hair)' }
const CARD: CSSProperties = { background: 'var(--card)', backdropFilter: 'blur(20px) saturate(180%)', WebkitBackdropFilter: 'blur(20px) saturate(180%)', border: '1px solid var(--border)', boxShadow: 'var(--card-shadow, 0 22px 48px -30px rgba(17,24,39,0.5))' }
const kicker: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }
const iconBtn: CSSProperties = { width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }

type Seg = 'heute' | 'workouts' | 'schlaf' | 'trends'

// Planblöcke eines Tages auflösen (Standardwoche + Overrides), analog Mein Tag.
function resolvePlanned(planned: PlannedBlock[], overrides: PlannedOverride[], date: Date, bundesland: string) {
  const wd = date.getDay()
  const key = dayKey(date)
  const templates = holidayName(key, bundesland) ? [] : planned.filter((b) => b.weekday === wd)
  const dayOv = overrides.filter((o) => o.date === key)
  const out: { employer_id: number; start_min: number; end_min: number }[] = []
  for (const t of templates) {
    const ov = dayOv.find((o) => o.source_block_id === t.id)
    if (ov) { if (ov.deleted) continue; out.push({ employer_id: ov.employer_id ?? t.employer_id, start_min: ov.start_min ?? t.start_min, end_min: ov.end_min ?? t.end_min }) }
    else out.push({ employer_id: t.employer_id, start_min: t.start_min, end_min: t.end_min })
  }
  for (const o of dayOv) if (o.source_block_id == null && !o.deleted && o.employer_id != null && o.start_min != null && o.end_min != null) out.push({ employer_id: o.employer_id, start_min: o.start_min, end_min: o.end_min })
  return out.filter((b) => b.end_min > b.start_min)
}

export default function Puls({ theme, onBack, onOpenTodos, onOpenCalendar, onOpenSpotlight, settings, onOpenDay }: {
  theme: 'light' | 'dark'
  onBack: () => void
  onOpenTodos: () => void
  onOpenCalendar: () => void
  onOpenSpotlight: () => void
  settings: AppSettings
  selectedDay: Date
  onOpenDay: (d: Date) => void
}) {
  const [seg, setSeg] = useState<Seg>('heute')
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [dailyRange, setDailyRange] = useState<GarminDaily[]>([])
  const [sleepRange, setSleepRange] = useState<GarminSleep[]>([])
  const [scoresRange, setScoresRange] = useState<GarminScores[]>([])
  const [intradayRange, setIntradayRange] = useState<GarminIntraday[]>([])
  const [heuteDay, setHeuteDay] = useState<Date | null>(null)
  const [planned, setPlanned] = useState<PlannedBlock[]>([])
  const [overrides, setOverrides] = useState<PlannedOverride[]>([])
  const [deepId, setDeepId] = useState<number | null>(null)
  const [areaFilter, setAreaFilter] = useState<number | 'all' | 'history'>('all')
  const [rangeFilter, setRangeFilter] = useState<'week' | 'month' | 'all'>('all')

  const todayKey = dayKey(new Date())
  function loadAll() {
    api.getEmployers().then(setEmployers).catch(() => {})
    api.getProjects().then(setProjects).catch(() => {})
    api.getGarminWorkouts().then(setWorkouts).catch(() => {})
    api.getPlanned().then(setPlanned).catch(() => {})
    api.getOverrides().then(setOverrides).catch(() => {})
    // Bereiche über 40 Tage; „Heute" wählt daraus den angezeigten Tag (Default: letzter Datentag).
    const from40 = dayKey(addDays(new Date(), -40))
    api.getGarminDaily(from40, todayKey).then(setDailyRange).catch(() => {})
    api.getGarminSleep(from40, todayKey).then(setSleepRange).catch(() => {})
    api.getGarminScores(from40, todayKey).then(setScoresRange).catch(() => {})
    api.getGarminIntraday(from40, todayKey).then(setIntradayRange).catch(() => {})
  }
  useEffect(loadAll, [todayKey])

  const empById = useMemo(() => new Map(employers.map((e) => [e.id, e])), [employers])
  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const sportIds = useMemo(() => new Set(employers.filter((e) => e.is_sport === 1).map((e) => e.id)), [employers])
  const colorOf = (id: number | null) => (id != null ? empById.get(id)?.color ?? employerColor(id) : '#94A3B8')

  // Ein Workout „vermenschlichen". history = ohne Bereich, dezent als Historie markiert.
  function view(w: Workout) {
    const isHistory = w.origin === 'history'
    const emp = w.employer_id != null ? empById.get(w.employer_id) : undefined
    const emoji = (w.type && TYPE_EMOJI[w.type]) || emp?.icon || '🏅'
    const typeName = (w.type && (TYPE_LABEL[w.type] || w.type)) || emp?.name || 'Workout'
    const name = w.name || w.note || typeName
    const project = isHistory ? 'Historie' : w.project_id != null ? projById.get(w.project_id)?.name ?? emp?.name ?? '' : emp?.name ?? ''
    const durMin = w.duration_min ?? (w.end_ts ? (parseTs(w.end_ts).getTime() - parseTs(w.start_ts).getTime()) / 60000 : 0)
    return { emoji, typeName, name, project, durMin, isHistory, color: isHistory ? '#94A3B8' : colorOf(w.employer_id) }
  }

  // ---- aktuelle Woche (Mo–So) für den Workouts-Zeitraumfilter ----
  const monday = useMemo(() => { const t = startOfDay(new Date()); return addDays(t, -((t.getDay() + 6) % 7)) }, [])

  // ---- Heute-Ansicht: angezeigter Tag, navigierbar, gedeckelt auf letzten Datentag ----
  const latestDay = useMemo(() => { const k = dailyRange[0]?.calendar_date ?? sleepRange[0]?.calendar_date; return k ? dateFromKey(k) : startOfDay(new Date()) }, [dailyRange, sleepRange])
  const hDay = heuteDay ?? latestDay
  const hKey = dayKey(hDay)
  const hDaily = useMemo(() => dailyRange.find((d) => d.calendar_date === hKey) ?? null, [dailyRange, hKey])
  const hSleep = useMemo(() => sleepRange.find((s) => s.calendar_date === hKey) ?? null, [sleepRange, hKey])
  const hScores = useMemo(() => scoresRange.find((s) => s.calendar_date === hKey) ?? null, [scoresRange, hKey])
  const hIntraday = useMemo(() => intradayRange.find((r) => r.calendar_date === hKey) ?? null, [intradayRange, hKey])
  const hMonday = useMemo(() => addDays(startOfDay(hDay), -((hDay.getDay() + 6) % 7)), [hKey])
  const hWeekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(hMonday, i)), [hMonday])
  const hWeekWorkouts = useMemo(() => workouts.filter((w) => { const k = dayKey(parseTs(w.start_ts)); return k >= dayKey(hWeekDates[0]) && k <= dayKey(hWeekDates[6]) }), [workouts, hWeekDates])
  const hWeekPlanned = useMemo(() => hWeekDates.flatMap((d) => resolvePlanned(planned, overrides, d, settings.bundesland).filter((b) => sportIds.has(b.employer_id)).map((b) => ({ ...b, date: d }))), [planned, overrides, hWeekDates, settings.bundesland, sportIds])
  const canForward = dayKey(hDay) < dayKey(latestDay)

  // ---- Deep-Dive öffnen (nur bei verknüpfter Aktivität) ----
  const openWorkout = (w: Workout) => { if (w.activity_id != null) setDeepId(w.activity_id); else onOpenDay(startOfDay(parseTs(w.start_ts))) }

  const seg1: CSSProperties = { padding: '9px 18px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 800, letterSpacing: '-0.2px', whiteSpace: 'nowrap', transition: 'background .18s ease, color .18s ease' }
  const segStyle = (on: boolean): CSSProperties => ({ ...seg1, background: on ? 'var(--seg-active, #fff)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink3)', boxShadow: on ? '0 4px 12px -4px rgba(17,24,39,0.28)' : 'none' })

  const viewTitle = { heute: 'Heute', workouts: 'Workouts', schlaf: 'Schlaf & Erholung', trends: 'Trends' }[seg]

  return (
    <div data-theme={theme} style={{ minHeight: '100vh', boxSizing: 'border-box', background: 'var(--screen)', color: 'var(--ink)', padding: '26px 40px 60px', zoom: 0.9, overflowX: 'hidden' }}>
      <div style={{ maxWidth: 1360, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div onClick={onBack} title="Zurück zu Mein Tag" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 16, ...GLASS, cursor: 'pointer', color: 'var(--ink)', fontSize: 14, fontWeight: 800 }}>‹ Mein Tag</div>
          <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 16, ...GLASS }}>
            {(['heute', 'workouts', 'schlaf', 'trends'] as Seg[]).map((s) => (
              <div key={s} onClick={() => setSeg(s)} style={segStyle(seg === s)}>{{ heute: 'Heute', workouts: 'Workouts', schlaf: 'Schlaf', trends: 'Trends' }[s]}</div>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {settings.garmin_last_sync && (
            <div title={`Letzter Garmin-Sync: ${new Date(settings.garmin_last_sync).toLocaleString('de-DE')}${settings.garmin_last_sync_status === 'partial' ? ' — teilweise' : ''}`} style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>
              Garmin-Stand: {relTime(settings.garmin_last_sync)}{settings.garmin_last_sync_status === 'partial' ? ' · teilweise' : ''}
            </div>
          )}
          <div onClick={onOpenSpotlight} title="Suche (Spotlight)" style={iconBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          </div>
          <div onClick={onOpenTodos} title="To-Dos" style={iconBtn}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>
          </div>
          <div onClick={onOpenCalendar} title="Kalender" style={iconBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18" /><path d="M8 2.5v4" /><path d="M16 2.5v4" /></svg>
          </div>
          <InboxPopover onChanged={loadAll} onOpenTodos={onOpenTodos} />
        </div>

        {/* Titel */}
        <div style={{ margin: '30px 0 22px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Puls</div>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-1.4px', lineHeight: 1, marginTop: 6 }}>{viewTitle}</div>
        </div>

        {seg === 'heute' && <Heute daily={hDaily} sleep={hSleep} scores={hScores} intraday={hIntraday} workouts={workouts} employers={employers} weekWorkouts={hWeekWorkouts} weekPlanned={hWeekPlanned} weekDates={hWeekDates} selKey={hKey} realTodayKey={todayKey} hDay={hDay} canForward={canForward} showLatest={dayKey(hDay) < dayKey(latestDay)} onPrev={() => setHeuteDay(addDays(hDay, -1))} onNext={() => { if (canForward) setHeuteDay(addDays(hDay, 1)) }} onLatest={() => setHeuteDay(null)} onOpenDaySel={(d: Date) => { if (dayKey(d) <= dayKey(latestDay)) setHeuteDay(startOfDay(d)) }} view={view} colorOf={colorOf} openWorkout={openWorkout} />}
        {seg === 'workouts' && <Workouts workouts={workouts} employers={employers} projects={projects} view={view} colorOf={colorOf} openWorkout={openWorkout} areaFilter={areaFilter} setAreaFilter={setAreaFilter} rangeFilter={rangeFilter} setRangeFilter={setRangeFilter} monday={monday} />}
        {seg === 'schlaf' && <Schlaf sleepRange={sleepRange} />}
        {seg === 'trends' && <Trends />}
      </div>

      {deepId != null && <ActivityDeepDive activityId={deepId} employers={employers} projects={projects} onClose={() => setDeepId(null)} onChanged={loadAll} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function KpiCard({ kickerText, emoji, tint, val, unit, color, barW, sub }: { kickerText: string; emoji: string; tint: string; val: string; unit: string; color: string; barW: number; sub: string }) {
  return (
    <div style={{ ...CARD, borderRadius: 24, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={kicker}>{kickerText}</div>
        <div style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 17, background: tint }}>{emoji}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 16 }}>
        <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-1.2px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink3)' }}>{unit}</div>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--track)', marginTop: 16, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, barW))}%`, background: color, borderRadius: 99 }} />
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink2)', marginTop: 11 }}>{sub}</div>
    </div>
  )
}

function reco(daily: GarminDaily | null, workouts: Workout[]): { title: string; body: string; readiness: string; dot: string } {
  const bb = daily?.bb_high ?? null
  // Trainingslast der letzten 3 Tage (Load, sonst Dauer als Proxy).
  const now = Date.now()
  const load3 = workouts.filter((w) => now - parseTs(w.start_ts).getTime() < 3 * 864e5).reduce((s, w) => s + (w.training_load ?? (w.duration_min ?? 0)), 0)
  const daysSinceIntense = (() => {
    const hard = workouts.find((w) => (w.training_load ?? 0) >= 80)
    return hard ? Math.floor((now - parseTs(hard.start_ts).getTime()) / 864e5) : 99
  })()
  if ((bb != null && bb < 30) || load3 > 250) return { title: 'Leichte Einheit oder Ruhetag', body: 'Deine Erholung ist angespannt (niedrige Body Battery bzw. hohe Last der letzten Tage). Halte es locker.', readiness: 'Niedrig', dot: '#EF4444' }
  if ((bb == null || bb >= 60) && daysSinceIntense >= 3) return { title: 'All-out möglich', body: 'Gute Erholung und länger keine intensive Einheit — heute darf es hart sein.', readiness: 'Hoch', dot: '#22C55E' }
  return { title: 'Moderate Einheit', body: 'Solide Erholung — eine ausgewogene Einheit passt gut.', readiness: 'Mittel', dot: '#F59E0B' }
}

function fmtRecovery(v: number): string { if (v <= 0) return 'erholt'; if (v < 24) return `${v} Std`; return `${Math.floor(v / 24)} Tg ${v % 24} Std` }

// Intraday-Tagesverlauf (3-Min-Raster), feste 0–domainMax-Skala für vergleichbare Form.
function IntradayChart({ pts, color, domainMax = 100, height = 84 }: { pts: IntradayPoint[]; color: string; domainMax?: number; height?: number }) {
  const W = 620
  const vals = pts.map((p) => p.v)
  const n = vals.length
  const xx = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0)
  const yy = (v: number) => height - 3 - (Math.max(0, Math.min(domainMax, v)) / domainMax) * (height - 6)
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${xx(i).toFixed(1)} ${yy(v).toFixed(1)}`).join(' ')
  const area = `M0 ${height} ${vals.map((v, i) => `L${xx(i).toFixed(1)} ${yy(v).toFixed(1)}`).join(' ')} L${W} ${height} Z`
  const hpts: HoverPoint[] = pts.map((p) => ({ v: p.v, label: fmtClock(p.t) }))
  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        <path d={area} fill={hexA(color, 0.13)} stroke="none" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <HoverOverlay pts={hpts} color={color} format={(v) => `${Math.round(v)}`} yFracAt={(i) => yy(vals[i]) / height} />
    </div>
  )
}

function IntradayCard({ title, emoji, pts, color, tint, sub }: { title: string; emoji: string; pts: IntradayPoint[]; color: string; tint: string; sub?: string }) {
  const vals = pts.map((p) => p.v)
  const start = vals[0], end = vals[vals.length - 1], lo = Math.min(...vals), hi = Math.max(...vals)
  return (
    <div style={{ ...CARD, borderRadius: 24, padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={kicker}>{title}</div>
        <div style={{ width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 17, background: tint }}>{emoji}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{Math.round(end)}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Start {Math.round(start)} · Tief {Math.round(lo)} · Hoch {Math.round(hi)}</div>
      </div>
      <div style={{ marginTop: 14 }}><IntradayChart pts={pts} color={color} /></div>
      {sub && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink3)', marginTop: 8 }}>{sub}</div>}
    </div>
  )
}
function Heute({ daily, sleep, scores, intraday, workouts, employers, weekWorkouts, weekPlanned, weekDates, selKey, realTodayKey, hDay, canForward, showLatest, onPrev, onNext, onLatest, onOpenDaySel, view, colorOf, openWorkout }: any) {
  const bbCurve: IntradayPoint[] = intraday?.body_battery_curve ?? []
  const stCurve: IntradayPoint[] = intraday?.stress_curve ?? []
  const dLabel = selKey === realTodayKey ? 'Heute' : `${WD[hDay.getDay()]}, ${hDay.getDate()}. ${MONTHS_SHORT[hDay.getMonth()]}`
  const dayNav = (on: boolean): CSSProperties => ({ width: 36, height: 36, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.35, fontSize: 18, fontWeight: 700, color: 'var(--ink2)' })

  // Top-Widgets: HRV · Trainingslast (ACWR) · Stress · Schlaf-Score
  const acwr = scores?.tr_acwr_percent ?? null
  const ai = ACWR_INFO(acwr)
  const hasDay = daily != null || sleep != null || scores != null
  const kpis: ReactNode[] = [
    <KpiCard key="hrv" kickerText="HRV" emoji="💓" tint={hexA('#14B8A6', 0.15)} color="#14B8A6" val={sleep?.hrv_overnight_avg != null ? String(Math.round(sleep.hrv_overnight_avg)) : '–'} unit="ms" barW={sleep?.hrv_overnight_avg != null ? Math.min(100, sleep.hrv_overnight_avg) : 0} sub={sleep?.hrv_status ? `Status ${sleep.hrv_status}` : 'Nächtliche HRV'} />,
    <KpiCard key="load" kickerText="Trainingslast" emoji="📊" tint={hexA(ai.color, 0.15)} color={ai.color} val={scores?.tr_acute_load != null ? String(Math.round(scores.tr_acute_load)) : '–'} unit="" barW={acwr != null ? Math.min(100, acwr) : 0} sub={acwr != null ? `ACWR ${ai.label} · ${Math.round(acwr)} %` : 'Akutlast'} />,
    <KpiCard key="st" kickerText="Stress" emoji="🌀" tint={hexA('#F59E0B', 0.15)} color="#F59E0B" val={daily?.stress_avg != null ? String(daily.stress_avg) : '–'} unit="/ 100" barW={daily?.stress_avg ?? 0} sub={daily?.stress_avg != null ? (daily.stress_avg < 30 ? 'Niedrig' : daily.stress_avg < 60 ? 'Moderat' : 'Erhöht') : '—'} />,
    <KpiCard key="sl" kickerText="Schlaf-Score" emoji="😴" tint={hexA('#7C5CFF', 0.15)} color="#7C5CFF" val={sleep?.score != null ? String(sleep.score) : '–'} unit="/ 100" barW={sleep?.score ?? 0} sub={sleep?.total_sec ? `${fmtDur(sleep.total_sec / 60)} · ${sleep.score_qualifier ?? ''}` : (sleep?.score_qualifier ?? '—')} />,
  ]

  // Letztes Workout relativ zum gewählten Tag, optional nach Bereich gefiltert.
  const sportEmps: Employer[] = (employers as Employer[]).filter((e) => e.is_sport === 1)
  const [woArea, setWoArea] = useState<number | 'all'>('all')
  const last: Workout | undefined = useMemo(() => (workouts as Workout[]).find((w) => dayKey(parseTs(w.start_ts)) <= selKey && (woArea === 'all' || w.employer_id === woArea)), [workouts, selKey, woArea])
  const lv = last ? view(last) : null
  const woDate = last ? parseTs(last.start_ts) : null
  const daysBefore = woDate ? Math.round((dateFromKey(selKey).getTime() - startOfDay(woDate).getTime()) / 864e5) : 0
  const woWhen = daysBefore <= 0 ? 'am gewählten Tag' : daysBefore === 1 ? 'vor 1 Tag' : `vor ${daysBefore} Tagen`
  const r = reco(daily, workouts)
  const areaPill = (on: boolean): CSSProperties => ({ flex: 'none', padding: '3px 8px', borderRadius: 7, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', color: on ? 'var(--ink)' : 'var(--ink3)', background: on ? 'var(--seg-active, #fff)' : 'transparent' })

  return (
    <div>
      {/* Tages-Navigation — wirkt auf alle Heute-Elemente */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div onClick={onPrev} title="Vorheriger Tag" style={dayNav(true)}>‹</div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', minWidth: 128, textAlign: 'center' }}>{dLabel}</div>
        <div onClick={canForward ? onNext : undefined} title={canForward ? 'Nächster Tag' : 'Kein neuerer Datentag'} style={dayNav(canForward)}>›</div>
        {showLatest && <div onClick={onLatest} title="Zum neuesten Tag" style={{ marginLeft: 4, padding: '8px 14px', borderRadius: 12, ...GLASS, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)' }}>Neuester ⏭</div>}
      </div>

      {!hasDay && <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px', color: 'var(--ink3)', fontWeight: 700, marginBottom: 18 }}>Keine Tagesdaten für {dLabel}.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 18 }}>{kpis}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginTop: 18 }}>
        {/* letztes Workout (relativ zum Tag, mit Bereichs-Toggle) */}
        <div style={{ ...CARD, borderRadius: 26, padding: '24px 26px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <div style={kicker}>Letztes Workout</div>
            {sportEmps.length > 0 && (
              <div className="no-scrollbar" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 9, background: 'var(--track)', overflowX: 'auto', maxWidth: '70%' }}>
                <div onClick={() => setWoArea('all')} style={areaPill(woArea === 'all')}>Alle</div>
                {sportEmps.map((e) => <div key={e.id} onClick={() => setWoArea(e.id)} title={e.name} style={areaPill(woArea === e.id)}>{e.icon || e.name}</div>)}
              </div>
            )}
          </div>
          {last && lv ? (
            <div onClick={() => openWorkout(last)} style={{ cursor: 'pointer' }}>
              {/* Datum oben – prominent, mit Bezug zum gewählten Tag */}
              <div style={{ marginTop: 16, fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{WD[woDate!.getDay()]}, {woDate!.getDate()}. {MONTHS_SHORT[woDate!.getMonth()]} {woDate!.getFullYear()} · {woWhen}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
                <div style={{ width: 56, height: 56, borderRadius: 17, display: 'grid', placeItems: 'center', fontSize: 27, background: hexA(lv.color, 0.16) }}>{lv.emoji}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.5px' }}>{lv.name}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink2)', marginTop: 2 }}>{lv.typeName}{lv.project ? ` · ${lv.project}` : ''}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 30, marginTop: 22 }}>
                {[['Dauer', fmtDur(lv.durMin)], ['Distanz', kmStr(last.distance_m)], ['Ø-HF', last.avg_hr ? `${Math.round(last.avg_hr)}` : '–']].map(([k, v]) => (
                  <div key={k}><div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{v}</div><div style={{ ...kicker, fontSize: 11, marginTop: 3 }}>{k}</div></div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 120, color: 'var(--ink3)', fontWeight: 700, fontSize: 13.5, textAlign: 'center' }}>Kein Workout {woArea === 'all' ? '' : 'in diesem Bereich '}bis {dLabel}.</div>
          )}
        </div>

        {/* Empfehlung */}
        <div style={{ ...GLASS, borderRadius: 26, boxShadow: 'var(--card-shadow, 0 22px 48px -30px rgba(17,24,39,0.5))', padding: '24px 26px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.6px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Heute empfohlen</div>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.4px', marginTop: 14, lineHeight: 1.25 }}>{r.title}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)', marginTop: 10, lineHeight: 1.5 }}>{r.body}</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 12, background: 'var(--track)' }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: r.dot }} />
              <div style={{ fontSize: 13, fontWeight: 800 }}>Bereitschaft: {scores?.training_readiness_score != null ? `${scores.training_readiness_score}${scores.tr_level ? ` · ${scores.tr_level}` : ''}` : r.readiness}</div>
            </div>
            {scores?.tr_recovery_time != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 12, background: 'var(--track)' }}>
                <span style={{ fontSize: 13 }}>♻️</span>
                <div style={{ fontSize: 13, fontWeight: 800 }}>Erholung: {fmtRecovery(scores.tr_recovery_time)}</div>
              </div>
            )}
            {sleep?.hrv_status && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>HRV {sleep.hrv_status}{daily?.resting_hr ? ` · Ruhepuls ${daily.resting_hr}` : ''}</div>}
          </div>
        </div>
      </div>

      {/* Wochenleiste */}
      <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px', marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div style={kicker}>Diese Woche</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)' }}>{weekWorkouts.length} erfasst · {weekPlanned.length} geplant</div>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 11, height: 11, borderRadius: 4, background: 'var(--track)', border: '1px solid var(--hair)' }} /><div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink2)' }}>Erfasst</div></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 11, height: 11, borderRadius: 4, background: 'transparent', border: '1.5px dashed var(--ink3)' }} /><div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink2)' }}>Geplant</div></div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 10 }}>
          {weekDates.map((d: Date) => {
            const k = dayKey(d)
            const isSel = k === selKey
            const dayWo = weekWorkouts.filter((w: Workout) => dayKey(parseTs(w.start_ts)) === k)
            const dayPl = weekPlanned.filter((b: any) => dayKey(b.date) === k)
            const rest = dayWo.length === 0 && dayPl.length === 0
            return (
              <div key={k} onClick={() => onOpenDaySel(d)} title="Diesen Tag anzeigen" style={{ borderRadius: 16, cursor: 'pointer', background: isSel ? 'color-mix(in srgb, var(--accent) 9%, var(--track))' : 'var(--track)', border: isSel ? '1.5px solid color-mix(in srgb, var(--accent) 45%, transparent)' : '1px solid var(--hair)', padding: '12px 10px', minHeight: 118, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: isSel ? 'var(--accent)' : 'var(--ink2)' }}>{WD[d.getDay()]}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{d.getDate()}.</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 11 }}>
                  {dayWo.map((w: Workout) => { const v = view(w); return (
                    <div key={`${w.origin}-${w.entry_id ?? w.activity_id}`} onClick={(ev) => { ev.stopPropagation(); openWorkout(w) }} title={`${v.name} – Details`} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 10, cursor: 'pointer', background: hexA(v.color, 0.2), border: `1px solid ${hexA(v.color, 0.35)}` }}>
                      <span style={{ fontSize: 13, lineHeight: 1 }}>{v.emoji}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(v.durMin)}′</span>
                    </div>
                  ) })}
                  {dayPl.map((b: any, i: number) => { const c = colorOf(b.employer_id); return (
                    <div key={`p${i}`} title="Geplant" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 10, background: 'transparent', border: `1.5px dashed ${hexA(c, 0.6)}` }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{Math.round((b.end_min - b.start_min))}′ geplant</span>
                    </div>
                  ) })}
                  {rest && <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink3)', padding: '4px 2px' }}>Ruhetag</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Body Battery + Stress — Tagesverlauf (9.3.2, an den angezeigten Tag gebunden) */}
      {(bbCurve.length > 1 || stCurve.length > 1) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginTop: 18 }}>
          {bbCurve.length > 1 && <IntradayCard title="Body Battery – Verlauf" emoji="🔋" pts={bbCurve} color="#22C55E" tint={hexA('#22C55E', 0.15)} sub={`${bbCurve.length} Messpunkte über den Tag`} />}
          {stCurve.length > 1 && <IntradayCard title="Stress – Verlauf" emoji="🌀" pts={stCurve} color="#F59E0B" tint={hexA('#F59E0B', 0.15)} sub="Skala 0 (ruhig) – 100 (hoch)" />}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function loadColor(v: number) { return v < 45 ? '#22C55E' : v < 72 ? '#F59E0B' : '#EF4444' }

function Workouts({ workouts, employers, projects, view, colorOf, openWorkout, areaFilter, setAreaFilter, rangeFilter, setRangeFilter, monday }: any) {
  const sportEmps: Employer[] = employers.filter((e: Employer) => e.is_sport === 1)
  // Toggle = definierte Sport-Bereiche aus Mein Tag + eigener Tab für unzugeordnete Historie.
  const segs: { val: 'all' | number | 'history'; label: string }[] = [
    { val: 'all', label: 'Alle' },
    ...sportEmps.map((e: Employer) => ({ val: e.id as number, label: e.name })),
    { val: 'history', label: 'Historie (Keine Zuordnung)' },
  ]

  const singleArea = typeof areaFilter === 'number' ? (areaFilter as number) : null
  // Drilldown-Filter (steuern nur die Tabelle oben): Projekt (aus Donut/Legende) + Periode (aus Verlaufs-Balken).
  const [projFilter, setProjFilter] = useState<number | 'none' | null>(null)
  const [periodFilter, setPeriodFilter] = useState<{ from: Date; to: Date; label: string; key: string } | null>(null)
  useEffect(() => { setProjFilter(null) }, [areaFilter]) // Projektfilter beim Bereichswechsel zurücksetzen

  // Kanonische Kategorien mit STABILEN Farben (Legende geteilt von Donut + Verlauf).
  // "Alle" → Bereiche (+ Historie); ein Bereich → Projekte dieses Bereichs (Schattierungen).
  const cats = useMemo<Cat[]>(() => {
    const base = workouts as Workout[]
    if (singleArea != null) {
      const areaWs = base.filter((w) => w.origin === 'entry' && w.employer_id === singleArea)
      const tot = new Map<number | 'none', number>()
      for (const w of areaWs) { const k = w.project_id ?? 'none'; tot.set(k, (tot.get(k) ?? 0) + (w.duration_min ?? 0)) }
      const areaColor = colorOf(singleArea)
      return [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([pid], i) => ({ key: `p${String(pid)}`, name: pid === 'none' ? 'Ohne Projekt' : (projects.find((p: Project) => p.id === pid)?.name ?? 'Projekt'), color: hexA(areaColor, Math.max(0.5, 1 - i * 0.14)), pid, empId: null, match: (w: Workout) => w.origin === 'entry' && w.employer_id === singleArea && (pid === 'none' ? w.project_id == null : w.project_id === pid) }))
    }
    if (areaFilter === 'history') return [{ key: 'hist', name: 'Historie', color: HIST_GREY, pid: null, empId: null, match: (w: Workout) => w.origin === 'history' }]
    const assigned = base.filter((w) => w.origin === 'entry' && w.employer_id != null)
    const tot = new Map<number, number>()
    for (const w of assigned) tot.set(w.employer_id as number, (tot.get(w.employer_id as number) ?? 0) + (w.duration_min ?? 0))
    const list: Cat[] = [...tot.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => ({ key: `a${id}`, name: employers.find((e: Employer) => e.id === id)?.name ?? '—', color: colorOf(id), pid: null, empId: id, match: (w: Workout) => w.origin === 'entry' && w.employer_id === id }))
    if (base.some((w) => w.origin === 'history')) list.push({ key: 'hist', name: 'Historie', color: HIST_GREY, pid: null, empId: null, match: (w: Workout) => w.origin === 'history' })
    return list
  }, [workouts, singleArea, areaFilter, employers, projects, colorOf])
  const catByKey = useMemo(() => new Map(cats.map((c) => [c.key, c])), [cats])
  const activeCatKey = projFilter != null ? `p${String(projFilter)}` : null
  const pickCat = (key: string) => { const c = catByKey.get(key); if (!c) return; if (c.key === 'hist') { setAreaFilter('history'); return } if (singleArea != null) setProjFilter((p) => (p === c.pid ? null : (c.pid as number | 'none'))); else if (c.empId != null) setAreaFilter(c.empId) }
  const pickPeriod = (b: { from: Date; to: Date; label: string; key: string }) => setPeriodFilter((prev) => (prev?.key === b.key ? null : b))

  const rangeCut = (w: Workout): boolean => { if (rangeFilter === 'all') return true; const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30); const cut = rangeFilter === 'week' ? dayKey(monday) : dayKey(monthAgo); return dayKey(parseTs(w.start_ts)) >= cut }

  const filtered = useMemo(() => (workouts as Workout[]).filter((w) => {
    if (areaFilter === 'history') { if (w.origin !== 'history') return false }
    else if (areaFilter !== 'all') { if (w.employer_id !== areaFilter) return false }
    if (singleArea != null && projFilter != null) { if (projFilter === 'none') { if (!(w.origin === 'entry' && w.project_id == null)) return false } else if (w.project_id !== projFilter) return false }
    if (periodFilter) { const t = parseTs(w.start_ts).getTime(); if (t < periodFilter.from.getTime() || t >= periodFilter.to.getTime()) return false }
    else if (!rangeCut(w)) return false
    return true
  }), [workouts, areaFilter, singleArea, projFilter, periodFilter, rangeFilter, monday])

  // Bereich-scoped (ohne Drilldown) für Donut (mit Range) und Verlauf (eigene Periode).
  const areaScoped = useMemo(() => (workouts as Workout[]).filter((w) => (areaFilter === 'history' ? w.origin === 'history' : singleArea != null ? (w.origin === 'entry' && w.employer_id === singleArea) : true)), [workouts, areaFilter, singleArea])
  const donutRows = useMemo(() => cats.map((c) => { const ws = areaScoped.filter((w) => rangeCut(w) && c.match(w)); return { key: c.key, name: c.name, color: c.color, min: ws.reduce((s, w) => s + (w.duration_min ?? 0), 0), count: ws.length } }).filter((r) => r.min > 0 && (r.key !== 'hist' || areaFilter === 'history')), [cats, areaScoped, rangeFilter, monday, areaFilter])
  const donutTitle = singleArea != null ? `Trainingszeit pro Projekt · ${employers.find((e: Employer) => e.id === singleArea)?.name ?? ''}` : areaFilter === 'history' ? 'Trainingszeit · Historie' : 'Trainingszeit pro Bereich'
  // Native <select> darf KEIN display:flex haben (bricht das Rendering) — eigener Stil.
  const selBtn: CSSProperties = { ...GLASS, display: 'inline-block', padding: '9px 30px 9px 14px', borderRadius: 12, fontSize: 13, fontWeight: 800, color: 'var(--ink2)', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', fontFamily: 'inherit', outline: 'none', maxWidth: '100%' }
  const cols = '2.4fr 0.9fr 0.9fr 0.9fr 0.9fr 0.8fr'

  return (
    <div>
      {/* Filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
          {segs.map((s) => { const on = areaFilter === s.val; return (
            <div key={String(s.val)} onClick={() => setAreaFilter(s.val)} style={{ padding: '7px 15px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap', background: on ? 'var(--seg-active, #fff)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink3)', boxShadow: on ? '0 4px 12px -4px rgba(17,24,39,0.28)' : 'none' }}>{s.label}</div>
          )})}
        </div>
        <div style={{ flex: 1 }} />
        <select value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value as 'week' | 'month' | 'all')} style={selBtn}>
          <option value="week">Diese Woche</option>
          <option value="month">Letzte 30 Tage</option>
          <option value="all">Alle</option>
        </select>
      </div>

      {/* aktive Drilldown-Filter (aus Donut/Legende bzw. Verlaufs-Balken) */}
      {(periodFilter || projFilter != null) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {projFilter != null && (() => { const c = catByKey.get(`p${String(projFilter)}`); return (
            <div onClick={() => setProjFilter(null)} title="Projektfilter entfernen" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 10, cursor: 'pointer', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)' }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: c?.color ?? 'var(--accent)', flex: 'none' }} />
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{c?.name ?? 'Projekt'}</div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </div>
          ) })()}
          {periodFilter && (
            <div onClick={() => setPeriodFilter(null)} title="Zeitraumfilter entfernen" style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 10, cursor: 'pointer', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)' }}>
              <span style={{ fontSize: 12 }}>📅</span>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{periodFilter.label}</div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" strokeWidth="2.8" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </div>
          )}
        </div>
      )}

      {/* Tabelle */}
      <div style={{ ...CARD, borderRadius: 24, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--hair)' }}>
          {['Workout', 'Datum', 'Dauer', 'Distanz', 'Ø-HF', 'Load'].map((h, i) => <div key={h} style={{ ...kicker, fontSize: 10.5, textAlign: i === 5 ? 'right' : 'left' }}>{h}</div>)}
        </div>
        {filtered.length === 0 && <div style={{ padding: '28px 24px', color: 'var(--ink3)', fontWeight: 700 }}>Keine Workouts für diese Filter.</div>}
        <div style={{ maxHeight: '52vh', overflowY: 'auto' }} className="no-scrollbar">
          {filtered.map((w: Workout) => { const v = view(w); const load = w.training_load != null ? Math.round(w.training_load) : null; return (
            <div key={`${w.origin}-${w.entry_id ?? w.activity_id}`} onClick={() => openWorkout(w)} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '15px 24px', borderBottom: '1px solid var(--hair)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, display: 'grid', placeItems: 'center', fontSize: 20, background: hexA(v.color, 0.16), flex: 'none' }}>{v.emoji}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: '-0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
                    {v.isHistory && <div style={{ flex: 'none', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 6, background: 'var(--track)', color: 'var(--ink3)', border: '1px dashed var(--hair)' }}>Historie</div>}
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)', marginTop: 1 }}>{v.project}</div>
                </div>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{parseTs(w.start_ts).getDate()}. {MONTHS_SHORT[parseTs(w.start_ts).getMonth()]}</div>
              <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(v.durMin)}</div>
              <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{kmStr(w.distance_m)}</div>
              <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{w.avg_hr ? Math.round(w.avg_hr) : '–'}</div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                {load != null ? <div style={{ minWidth: 38, textAlign: 'center', padding: '5px 10px', borderRadius: 9, fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', background: hexA(loadColor(load), 0.15), color: loadColor(load) }}>{load}</div> : <span style={{ color: 'var(--ink3)', fontWeight: 700 }}>–</span>}
              </div>
            </div>
          ) })}
        </div>
      </div>

      {/* Zeit-Kopplung: Donut (Gesamtzeiten pro Bereich/Projekt, 5-1) links + Workout-Verlauf-Balken rechts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 32%) 1fr', gap: 18, marginTop: 18, alignItems: 'stretch' }}>
        <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px', alignSelf: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={kicker}>{donutTitle}</div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
              {donutRows.map((a) => { const on = activeCatKey === a.key; return (
                <div key={a.key} onClick={() => pickCat(a.key)} title={`Nach ${a.name} filtern`} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', opacity: activeCatKey && !on ? 0.5 : 1 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: a.color, flex: 'none' }} />
                  <div style={{ fontSize: 12, fontWeight: 800, color: on ? 'var(--ink)' : 'var(--ink2)', whiteSpace: 'nowrap' }}>{a.name}</div>
                </div>
              ) })}
            </div>
          </div>
          {donutRows.length === 0 ? (
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)', marginTop: 20 }}>Keine Daten.</div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
              <Donut rows={donutRows} onPick={pickCat} activeKey={activeCatKey} />
            </div>
          )}
        </div>

        {/* Workout-Verlauf: navigierbar, gestapelt (stabile Farben/Legende), Balken-Klick filtert oben nach Periode */}
        <WorkoutHistory workouts={areaScoped} cats={cats} onPickPeriod={pickPeriod} activePeriodKey={periodFilter?.key ?? null} />
      </div>
    </div>
  )
}

// ── Workout-Verlauf-Widget (5-x): Perioden-Navigation + gestapelte Balken + Klick-Liste ──
type HistBucket = { from: Date; to: Date; key: string; xlabel: string }
function histBuckets(pmode: 'week' | 'month' | 'year', anchor: Date): { buckets: HistBucket[]; label: string } {
  if (pmode === 'week') {
    const mon = addDays(startOfDay(anchor), -((anchor.getDay() + 6) % 7))
    const buckets = Array.from({ length: 7 }, (_, i) => { const from = addDays(mon, i); return { from, to: addDays(from, 1), key: dayKey(from), xlabel: WD[from.getDay()] } })
    const d0 = buckets[0].from, d6 = buckets[6].from
    const label = d0.getMonth() === d6.getMonth() ? `${d0.getDate()}.–${d6.getDate()}. ${MONTHS_SHORT[d6.getMonth()]}` : `${d0.getDate()}. ${MONTHS_SHORT[d0.getMonth()]} – ${d6.getDate()}. ${MONTHS_SHORT[d6.getMonth()]}`
    return { buckets, label }
  }
  if (pmode === 'month') {
    const y = anchor.getFullYear(), m = anchor.getMonth(), days = new Date(y, m + 1, 0).getDate()
    const buckets = Array.from({ length: days }, (_, i) => { const from = new Date(y, m, i + 1); return { from, to: new Date(y, m, i + 2), key: dayKey(from), xlabel: String(i + 1) } })
    return { buckets, label: anchor.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) }
  }
  const y = anchor.getFullYear()
  const buckets = Array.from({ length: 12 }, (_, i) => ({ from: new Date(y, i, 1), to: new Date(y, i + 1, 1), key: `${y}-${i}`, xlabel: MONTHS_SHORT[i] }))
  return { buckets, label: String(y) }
}
function histShift(pmode: 'week' | 'month' | 'year', anchor: Date, dir: number): Date {
  if (pmode === 'week') return addDays(anchor, dir * 7)
  if (pmode === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1)
  return new Date(anchor.getFullYear() + dir, anchor.getMonth(), 1)
}
const HIST_GREY = '#94A3B8'
// Kategorie mit stabiler Farbe/Match (aus Workouts durchgereicht an Verlauf + Donut).
type Cat = { key: string; name: string; color: string; pid: number | 'none' | null; empId: number | null; match: (w: Workout) => boolean }

// Donut der Gesamtzeiten (pro Bereich bzw. pro Projekt). Mitte = Summe; Segment-Hover zeigt Anzahl + Zeit; Klick filtert.
type DonutRow = { key: string; name: string; color: string; min: number; count?: number }
function Donut({ rows, onPick, activeKey }: { rows: DonutRow[]; onPick?: (k: string) => void; activeKey?: string | null }) {
  const [hi, setHi] = useState<string | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const total = rows.reduce((s, r) => s + r.min, 0)
  const size = 176, sw = 30, R = size / 2, r = R - sw / 2, circ = 2 * Math.PI * r
  if (total <= 0) return <div style={{ height: size, display: 'grid', placeItems: 'center', color: 'var(--ink3)', fontWeight: 700, fontSize: 13 }}>Keine Daten.</div>
  const hiRow = rows.find((x) => x.key === hi) || null
  const onMove = (e: { clientX: number; clientY: number }) => { const el = wrapRef.current; if (!el) return; const b = el.getBoundingClientRect(); setPos({ x: e.clientX - b.left, y: e.clientY - b.top }) }
  let acc = 0
  return (
    <div ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={R} cy={R} r={r} fill="none" stroke="var(--track)" strokeWidth={sw} />
        <g transform={`rotate(-90 ${R} ${R})`}>
          {rows.map((seg) => { const dash = (seg.min / total) * circ; const dim = (!!activeKey && activeKey !== seg.key) || (!!hi && hi !== seg.key); const el = <circle key={seg.key} onMouseEnter={() => setHi(seg.key)} onClick={onPick ? () => onPick(seg.key) : undefined} cx={R} cy={R} r={r} fill="none" stroke={seg.color} strokeWidth={sw} strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-acc} opacity={dim ? 0.4 : 1} style={{ cursor: onPick ? 'pointer' : 'default' }} />; acc += dash; return el })}
        </g>
        <text x={R} y={R - 2} textAnchor="middle" fill="var(--ink)" style={{ fontSize: 21, fontWeight: 800 }}>{fmtDur(total)}</text>
        <text x={R} y={R + 16} textAnchor="middle" fill="var(--ink3)" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1.4px' }}>GESAMT</text>
      </svg>
      {hiRow && (
        <div style={{ position: 'absolute', left: pos.x, top: pos.y, transform: 'translate(-50%, calc(-100% - 8px))', pointerEvents: 'none', zIndex: 6, background: 'var(--glass-strong, var(--card))', border: '1px solid var(--border)', borderRadius: 9, padding: '5px 9px', boxShadow: '0 8px 22px -12px rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{hiRow.name}</div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', marginTop: 1 }}>{hiRow.count ?? 0} {hiRow.count === 1 ? 'Workout' : 'Workouts'} · {fmtDur(hiRow.min)}</div>
        </div>
      )}
    </div>
  )
}

function WorkoutHistory({ workouts, cats, onPickPeriod, activePeriodKey }: any) {
  const [pmode, setPmode] = useState<'week' | 'month' | 'year'>('week')
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()))
  const [hover, setHover] = useState<number | null>(null)
  const cs: Cat[] = cats

  const { buckets, label } = useMemo(() => histBuckets(pmode, anchor), [pmode, anchor])
  const data = useMemo(() => buckets.map((b) => {
    const ws = (workouts as Workout[]).filter((w) => { const t = parseTs(w.start_ts).getTime(); return t >= b.from.getTime() && t < b.to.getTime() })
    const totalMin = ws.reduce((s, w) => s + (w.duration_min ?? 0), 0)
    const segs = cs.map((c) => ({ key: c.key, name: c.name, color: c.color, min: ws.filter(c.match).reduce((s, w) => s + (w.duration_min ?? 0), 0) })).filter((s) => s.min > 0)
    const plabel = pmode === 'year' ? `${MONTHS_SHORT[b.from.getMonth()]} ${b.from.getFullYear()}` : `${WD[b.from.getDay()]}, ${b.from.getDate()}. ${MONTHS_SHORT[b.from.getMonth()]}`
    return { ...b, totalMin, count: ws.length, segs, plabel }
  }), [buckets, workouts, cs, pmode])

  const maxMin = Math.max(1, ...data.map((d) => d.totalMin))
  const grandTotal = data.reduce((s, d) => s + d.totalMin, 0)
  const canNext = buckets[buckets.length - 1].to.getTime() <= Date.now()
  const go = (dir: number) => { if (dir > 0 && !canNext) return; setAnchor((a) => histShift(pmode, a, dir)) }
  // Wisch-/Drag-Navigation über dem Balkenbereich (rechts = zurück, links = weiter).
  const drag = useRef<{ x0: number; swiped: boolean }>({ x0: 0, swiped: false })
  const onDown = (e: { clientX: number }) => { drag.current = { x0: e.clientX, swiped: false } }
  const onUp = (e: { clientX: number }) => { const dx = e.clientX - drag.current.x0; if (Math.abs(dx) > 40) { drag.current.swiped = true; go(dx > 0 ? -1 : 1) } }
  const nav = (on: boolean): CSSProperties => ({ width: 32, height: 32, borderRadius: 10, background: 'var(--track)', display: 'grid', placeItems: 'center', cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.35, fontSize: 17, fontWeight: 700, color: 'var(--ink2)' })

  return (
    <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={kicker}>Workout-Verlauf</div>
        <div style={{ flex: 1 }} />
        <div onClick={() => go(-1)} title="Zurück" style={nav(true)}>‹</div>
        <div style={{ fontSize: 13.5, fontWeight: 800, minWidth: 118, textAlign: 'center' }}>{label}</div>
        <div onClick={() => go(1)} title={canNext ? 'Weiter' : 'Kein späterer Zeitraum'} style={nav(canNext)}>›</div>
        <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, background: 'var(--track)', marginLeft: 4 }}>
          {(['week', 'month', 'year'] as const).map((p) => <div key={p} onClick={() => setPmode(p)} style={{ padding: '6px 12px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', color: pmode === p ? 'var(--ink)' : 'var(--ink3)', background: pmode === p ? 'var(--seg-active, #fff)' : 'transparent' }}>{{ week: 'Woche', month: 'Monat', year: 'Jahr' }[p]}</div>)}
        </div>
      </div>

      <div onPointerDown={onDown} onPointerUp={onUp} style={{ touchAction: 'pan-y', userSelect: 'none', cursor: 'grab' }}>
      {grandTotal === 0 ? (
        <div style={{ height: 150, display: 'grid', placeItems: 'center', color: 'var(--ink3)', fontWeight: 700, fontSize: 13.5 }}>Keine Workouts in diesem Zeitraum.</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: pmode === 'month' ? 3 : 8, height: 150 }}>
          {data.map((d, i) => {
            const hBar = (d.totalMin / maxMin) * 100
            const showLbl = pmode === 'month' ? i % 5 === 0 : true
            const active = activePeriodKey === d.key
            return (
              <div key={d.key} onClick={() => { if (drag.current.swiped) { drag.current.swiped = false; return } if (d.count > 0) onPickPeriod({ from: d.from, to: d.to, label: d.plabel, key: d.key }) }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end', cursor: d.count > 0 ? 'pointer' : 'default', position: 'relative' }}>
                {hover === i && d.count > 0 && (
                  <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 5, pointerEvents: 'none', background: 'var(--glass-strong, var(--card))', border: '1px solid var(--border)', borderRadius: 9, padding: '5px 9px', boxShadow: '0 8px 22px -12px rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)' }}>{d.count} {d.count === 1 ? 'Workout' : 'Workouts'}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', marginTop: 1 }}>{fmtDur(d.totalMin)}</div>
                  </div>
                )}
                <div style={{ width: '100%', maxWidth: 42, height: `${hBar}%`, minHeight: d.totalMin > 0 ? 4 : 0, borderRadius: '8px 8px 3px 3px', overflow: 'hidden', display: 'flex', flexDirection: 'column-reverse', background: 'var(--track)', outline: active ? `2px solid ${d.segs[0]?.color ?? 'var(--accent)'}` : 'none', outlineOffset: 1 }}>
                  {d.segs.map((s) => <div key={s.key} title={`${s.name}: ${fmtDur(s.min)}`} style={{ height: `${(s.min / d.totalMin) * 100}%`, background: s.color }} />)}
                </div>
                <div style={{ fontSize: pmode === 'month' ? 9 : 11, fontWeight: 800, color: 'var(--ink3)', height: 12 }}>{showLbl ? d.xlabel : ''}</div>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Schlaf & Erholung (WP4c-1)
function fmtDurSec(sec: number) { const m = Math.round(sec / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad(m % 60)}` }
const PHASES = [
  { lvl: 0, name: 'Tief', color: '#2563EB', sec: 'deep_sec' as const },
  { lvl: 1, name: 'Leicht', color: '#7C5CFF', sec: 'light_sec' as const },
  { lvl: 2, name: 'REM', color: '#14B8A6', sec: 'rem_sec' as const },
  { lvl: 3, name: 'Wach', color: '#F59E0B', sec: 'awake_sec' as const },
]
const phaseColor = (lvl: number) => PHASES.find((p) => p.lvl === Math.round(lvl))?.color ?? '#94A3B8'
const segSec = (s: { startGMT: string; endGMT: string }) => Math.max(0, (new Date(s.endGMT.slice(0, 19)).getTime() - new Date(s.startGMT.slice(0, 19)).getTime()) / 1000)
const NEED_FB: Record<string, string> = { INCREASED: 'erhöht', DECREASED: 'verringert', NO_CHANGE_NO_ADJUSTMENTS: 'unverändert', NO_CHANGE: 'unverändert' }
// Schlaf-Score-Qualität (8.2): Farbe + Kurzlabel.
const sleepQ = (s: number | null): { c: string; label: string } => s == null ? { c: 'var(--ink3)', label: '—' } : s >= 80 ? { c: '#22C55E', label: 'gut' } : s >= 60 ? { c: '#F59E0B', label: 'mittel' } : { c: '#EF4444', label: 'schlecht' }
// Phasen-Einordnung (8.3): kuratierte, formelfreie Richtwerte — grobe Orientierung, keine Diagnose.
function phaseEval(key: string, pct: number): { t: string; c: string } {
  if (key === 'deep_sec') return pct < 13 ? { t: 'unter dem Richtwert (13–23 %)', c: '#F59E0B' } : pct <= 23 ? { t: 'im Richtbereich (13–23 %)', c: '#22C55E' } : { t: 'über dem Richtwert (13–23 %)', c: 'var(--ink2)' }
  if (key === 'rem_sec') return pct < 20 ? { t: 'unter dem Richtwert (20–25 %)', c: '#F59E0B' } : pct <= 25 ? { t: 'im Richtbereich (20–25 %)', c: '#22C55E' } : { t: 'über dem Richtwert (20–25 %)', c: 'var(--ink2)' }
  if (key === 'awake_sec') return pct < 10 ? { t: 'gering — gut', c: '#22C55E' } : pct <= 20 ? { t: 'etwas erhöht', c: '#F59E0B' } : { t: 'hoch (unruhige Nacht)', c: '#EF4444' }
  return { t: 'Grundgerüst des Schlafs — kein fester Zielwert', c: 'var(--ink3)' }
}

function Schlaf({ sleepRange }: { sleepRange: GarminSleep[] }) {
  const nights = useMemo(() => sleepRange.filter((s) => s.total_sec != null || s.score != null), [sleepRange]) // Lücken raus
  const [selDate, setSelDate] = useState<string | null>(null)
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [phaseOpen, setPhaseOpen] = useState(false)
  // Nächte-Leiste (8.1): älteste links, neueste rechts → beim Laden ans rechte Ende scrollen.
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = stripRef.current; if (el) el.scrollLeft = el.scrollWidth }, [nights.length])
  if (nights.length === 0) return <div style={{ ...CARD, borderRadius: 24, padding: '48px 26px', textAlign: 'center', color: 'var(--ink3)', fontWeight: 700 }}>Noch keine Schlafdaten.</div>

  const strip = [...nights].slice(0, 30).reverse() // 30 jüngste, chronologisch aufsteigend (alt → neu)

  const sel = nights.find((n) => n.calendar_date === selDate) ?? nights[0]
  const curves = sel.curves && typeof sel.curves === 'object' ? sel.curves : null
  const levels = curves?.levels ?? []
  const totalLevels = levels.reduce((a, s) => a + segSec(s), 0) || 1
  const phaseTot = PHASES.reduce((a, p) => a + (sel[p.sec] ?? 0), 0) || 1 // Nenner für Phasen-Prozente (8.3)
  const selD = new Date(`${sel.calendar_date}T00:00:00`)

  const kpis: [string, string, string][] = []
  if (sel.total_sec != null) kpis.push(['Dauer', fmtDurSec(sel.total_sec), ''])
  if (sel.score != null) kpis.push(['Score', String(sel.score), sel.score_qualifier ?? ''])
  if (sel.hrv_overnight_avg != null) kpis.push(['HRV', String(Math.round(sel.hrv_overnight_avg)), sel.hrv_status ?? ''])
  if (sel.body_battery_change != null) kpis.push(['Body Battery', `+${sel.body_battery_change}`, 'über Nacht'])
  if (sel.avg_stress != null) kpis.push(['Ø Stress', String(sel.avg_stress), ''])
  if (sel.resting_hr != null) kpis.push(['Ruhepuls', `${sel.resting_hr}`, 'bpm'])
  if (sel.avg_hr != null) kpis.push(['Ø Herzfrequenz', `${Math.round(sel.avg_hr)}`, 'bpm'])
  if (sel.avg_spo2 != null) kpis.push(['Ø SpO₂', `${sel.avg_spo2}`, '%'])
  if (sel.avg_respiration != null) kpis.push(['Ø Atemfrequenz', `${sel.avg_respiration}`, '/min'])
  if (sel.restless_moments != null) kpis.push(['Unruhe', String(sel.restless_moments), 'Momente'])

  const periodNights = period === 'week' ? nights.slice(0, 7) : nights.slice(0, 30)
  const chrono = [...periodNights].reverse()
  const trendDefs = [
    { label: 'Schlaf-Score', unit: '', color: '#7C5CFF', up: 'good', get: (n: GarminSleep) => n.score },
    { label: 'HRV', unit: 'ms', color: '#14B8A6', up: 'good', get: (n: GarminSleep) => n.hrv_overnight_avg },
    { label: 'Body Battery', unit: '', color: '#22C55E', up: 'good', get: (n: GarminSleep) => n.body_battery_change },
    { label: 'Ø Stress', unit: '', color: '#F59E0B', up: 'bad', get: (n: GarminSleep) => n.avg_stress },
  ] as const

  const miniCurves = curves ? ([['HF', curves.hr, '#EF4444'], ['Stress', curves.stress, '#F59E0B'], ['Body Battery', curves.body_battery, '#22C55E']] as const).filter(([, arr]) => Array.isArray(arr) && arr.length > 1) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Nächte-Leiste (8.1/8.2): alt links → neu rechts, Score nach Qualität gefärbt + Trend vs. Vornacht */}
      <div ref={stripRef} className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {strip.map((n, i) => {
          const on = n.calendar_date === sel.calendar_date
          const d = new Date(`${n.calendar_date}T00:00:00`)
          const q = sleepQ(n.score)
          const prev = strip[i - 1]?.score
          const trend = n.score != null && prev != null ? (n.score > prev ? 'up' : n.score < prev ? 'down' : 'flat') : null
          return (
            <div key={n.calendar_date} onClick={() => setSelDate(n.calendar_date)} title={`${d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}${n.score != null ? ` · Score ${n.score} (${q.label})` : ''}`} style={{ flex: 'none', minWidth: 72, textAlign: 'center', padding: '10px 12px', borderRadius: 14, cursor: 'pointer', background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--track))' : 'var(--track)', border: on ? '1.5px solid color-mix(in srgb, var(--accent) 45%, transparent)' : '1px solid var(--hair)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: on ? 'var(--accent)' : 'var(--ink2)' }}>{WD[d.getDay()]} {d.getDate()}.</div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 3, marginTop: 3 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: q.c, fontVariantNumeric: 'tabular-nums' }}>{n.score ?? (n.total_sec != null ? fmtDurSec(n.total_sec) : '–')}</div>
                {trend && <span style={{ fontSize: 9.5, fontWeight: 900, color: trend === 'up' ? '#22C55E' : trend === 'down' ? '#EF4444' : 'var(--ink3)' }}>{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▬'}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Gewählte Nacht */}
      <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.4px' }}>{selD.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          {sel.total_sec != null && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink2)' }}>{fmtDurSec(sel.total_sec)} geschlafen</div>}
        </div>

        {/* Phasen-Balken */}
        {levels.length > 0 && (
          <div>
            <div style={{ display: 'flex', height: 22, borderRadius: 8, overflow: 'hidden', background: 'var(--track)' }}>
              {levels.map((s, i) => <div key={i} title={`${PHASES.find((p) => p.lvl === Math.round(s.activityLevel))?.name ?? ''}`} style={{ width: `${(segSec(s) / totalLevels) * 100}%`, background: phaseColor(s.activityLevel) }} />)}
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
              {PHASES.map((p) => { const v = sel[p.sec]; return (
                <div key={p.lvl} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 3, background: p.color }} />
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)' }}>{p.name}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{v != null ? fmtDurSec(v) : '–'}</div>
                </div>
              ) })}
            </div>

            {/* Phasen-Bewertung (8.3): Akkordeon mit Richtwert-Einordnung */}
            <div style={{ marginTop: 14 }}>
              <div onClick={() => setPhaseOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 800, color: 'var(--ink2)', background: 'var(--track)' }}>
                Phasen-Bewertung
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: phaseOpen ? 'rotate(180deg)' : 'none', transition: 'transform .18s ease' }}><path d="M6 9l6 6 6-6" /></svg>
              </div>
              {phaseOpen && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {PHASES.map((p) => { const v = sel[p.sec]; if (v == null) return null; const pct = (v / phaseTot) * 100; const ev = phaseEval(p.sec, pct); return (
                    <div key={p.lvl} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: 'none' }} />
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)', minWidth: 46 }}>{p.name}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums', minWidth: 94 }}>{fmtDurSec(v)} · {Math.round(pct)} %</div>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: ev.c }}>{ev.t}</div>
                    </div>
                  ) })}
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ink3)', marginTop: 2, lineHeight: 1.4 }}>Grobe Orientierung, keine medizinische Diagnose. Prozente bezogen auf die gesamte erfasste Nacht.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Kern-KPIs */}
        {kpis.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginTop: 18 }}>
            {kpis.map(([k, v, sub]) => (
              <div key={k} style={{ background: 'var(--track)', borderRadius: 14, padding: '13px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <div style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                  {sub && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)' }}>{sub}</div>}
                </div>
                <div style={{ ...kicker, fontSize: 10.5, marginTop: 5 }}>{k}</div>
              </div>
            ))}
          </div>
        )}

        {/* Sleep Need */}
        {sel.sleep_need_actual != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18, padding: '12px 16px', borderRadius: 14, background: 'var(--track)' }}>
            <div style={{ ...kicker, fontSize: 10.5 }}>Schlafbedarf</div>
            <div style={{ fontSize: 15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtDurSec(sel.sleep_need_actual * 60)}</div>
            {sel.sleep_need_baseline != null && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Basis {fmtDurSec(sel.sleep_need_baseline * 60)}</div>}
            <div style={{ flex: 1 }} />
            {sel.sleep_need_feedback && <div style={{ fontSize: 11.5, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>{NEED_FB[sel.sleep_need_feedback] ?? sel.sleep_need_feedback}</div>}
          </div>
        )}

        {/* Mini-Kurven der Nacht */}
        {miniCurves.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${miniCurves.length}, 1fr)`, gap: 12, marginTop: 18 }}>
            {miniCurves.map(([label, arr, color]) => {
              const cp = arr as { t: number; v: number }[]
              const vals = cp.map((p) => p.v)
              const hpts: HoverPoint[] = cp.map((p) => ({ v: p.v, label: fmtClock(p.t) }))
              return (
                <div key={label} style={{ background: 'var(--track)', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ ...kicker, fontSize: 10.5, marginBottom: 8 }}>{label} · Nacht</div>
                  <div style={{ position: 'relative' }}>
                    <svg width="100%" height="40" viewBox="0 0 200 40" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                      <path d={sparkPath(vals, 200, 40, 4)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <HoverOverlay pts={hpts} color={color} format={(v) => `${Math.round(v)}`} yFracAt={(i) => lineYFrac(vals, i, 4 / 40)} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Trends */}
      <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={kicker}>Verlauf · {period === 'week' ? 'Woche' : 'Monat'}</div>
          <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, background: 'var(--track)' }}>
            {(['week', 'month'] as const).map((p) => (
              <div key={p} onClick={() => setPeriod(p)} style={{ padding: '6px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', color: period === p ? 'var(--ink)' : 'var(--ink3)', background: period === p ? 'var(--seg-active, #fff)' : 'transparent' }}>{p === 'week' ? 'Woche' : 'Monat'}</div>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
          {trendDefs.map((t) => {
            const nn = chrono.map((n) => ({ date: n.calendar_date, v: t.get(n) })).filter((p): p is { date: string; v: number } => p.v != null)
            const series = nn.map((p) => p.v)
            if (series.length === 0) return <div key={t.label} style={{ background: 'var(--track)', borderRadius: 18, padding: '16px 18px', color: 'var(--ink3)', fontWeight: 700, fontSize: 12.5 }}>{t.label} · keine Daten</div>
            const avg = Math.round(series.reduce((a, b) => a + b, 0) / series.length)
            const delta = Math.round(series[series.length - 1] - series[0])
            const good = t.up === 'good' ? delta >= 0 : delta <= 0
            const hpts: HoverPoint[] = nn.map((p) => ({ v: p.v, label: fmtDayLabel(dateFromKey(p.date)) }))
            return (
              <div key={t.label} style={{ background: 'var(--track)', borderRadius: 18, padding: '16px 18px' }}>
                <div style={{ ...kicker, fontSize: 10.5 }}>{t.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 10 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{avg}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{t.unit || 'Ø'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                  <div style={{ position: 'relative', width: 120, height: 30 }}>
                    <svg width="120" height="30" viewBox="0 0 120 30" preserveAspectRatio="none" style={{ overflow: 'visible', display: 'block' }}>
                      <path d={sparkPath(series, 120, 30, 3)} fill="none" stroke={t.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <HoverOverlay pts={hpts} color={t.color} format={(v) => `${Math.round(v)}${t.unit ? ' ' + t.unit : ''}`} yFracAt={(i) => lineYFrac(series, i, 3 / 30)} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: delta === 0 ? 'var(--ink3)' : good ? '#22C55E' : '#EF4444' }}>{delta > 0 ? '+' : ''}{delta}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Trends-Widget-Dashboard (WP4d-2: echte Datenbindung + Zoom-Modal)
type WType = 'sparkline' | 'tagesverlauf' | 'score-gauge' | 'kennzahl-ziel'
type Src = 'daily' | 'sleep' | 'scores' | 'health'
interface WidgetDef {
  id: string; name: string; icon: string; type: WType; group: 'A' | 'B'; defaultVisible: boolean
  src: Src
  get: (r: Record<string, unknown>) => number | null
  unit?: string; decimals?: number; goodDir?: 'up' | 'down'
  gaugeMax?: number
  target?: (r: Record<string, unknown>) => number | null
  fmt?: (v: number) => string
  special?: 'vo2max' | 'load' | 'race' | 'status' | 'weight'
  intradayKey?: 'body_battery_curve' | 'stress_curve'  // Zoom-Modal zeigt zusätzlich den 3-Min-Tagesverlauf
}
const numN = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// Race-Predictions (9.8): wählbare Distanz je Widget
type RaceDist = '5k' | '10k' | 'hm' | 'm'
const RACE_DISTS: RaceDist[] = ['5k', '10k', 'hm', 'm']
const RACE_COL: Record<RaceDist, string> = { '5k': 'race_5k_sec', '10k': 'race_10k_sec', 'hm': 'race_hm_sec', 'm': 'race_m_sec' }
const RACE_LABEL: Record<RaceDist, string> = { '5k': '5 km', '10k': '10 km', 'hm': 'Halbmarathon', 'm': 'Marathon' }
const RACE_SHORT: Record<RaceDist, string> = { '5k': '5k', '10k': '10k', 'hm': 'HM', 'm': 'M' }
function fmtRaceTime(sec: number): string { const s = Math.round(sec); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}` }
function RaceControl({ dist, onDist, small }: { dist: RaceDist; onDist: (d: RaceDist) => void; small?: boolean }) {
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', padding: 2, gap: 2, borderRadius: 10, background: 'var(--track)' }}>
      {RACE_DISTS.map((d) => <div key={d} onClick={() => onDist(d)} style={{ padding: small ? '3px 9px' : '6px 12px', borderRadius: 7, fontSize: small ? 11 : 12.5, fontWeight: 800, cursor: 'pointer', color: d === dist ? 'var(--ink)' : 'var(--ink3)', background: d === dist ? 'var(--seg-active, #fff)' : 'transparent' }}>{RACE_SHORT[d]}</div>)}
    </div>
  )
}

// Widget-Farbwahl (9.7): 4 Standard + freie Palette; Default = --accent
const WIDGET_STD_COLORS = ['#7C5CFF', '#22C55E', '#F59E0B', '#EF4444']
const WIDGET_PALETTE = ['#7C5CFF', '#5B8DEF', '#0EA5E9', '#14B8A6', '#22C55E', '#84CC16', '#EAB308', '#F59E0B', '#F97316', '#EF4444', '#EC4899', '#A855F7']

const WIDGETS: WidgetDef[] = [
  // Gruppe A — garmin_daily / garmin_sleep
  { id: 'resting_hr', name: 'Ruhepuls', icon: '❤️', type: 'sparkline', group: 'A', defaultVisible: true, src: 'daily', get: (r) => numN(r.resting_hr), unit: 'bpm', goodDir: 'down' },
  { id: 'hrv', name: 'HRV', icon: '💓', type: 'sparkline', group: 'A', defaultVisible: true, src: 'sleep', get: (r) => numN(r.hrv_overnight_avg), unit: 'ms', goodDir: 'up' },
  { id: 'stress', name: 'Stress', icon: '🌀', type: 'tagesverlauf', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.stress_avg), goodDir: 'down', intradayKey: 'stress_curve' },
  { id: 'body_battery', name: 'Body Battery', icon: '🔋', type: 'tagesverlauf', group: 'A', defaultVisible: true, src: 'daily', get: (r) => numN(r.bb_high), goodDir: 'up', intradayKey: 'body_battery_curve' },
  { id: 'steps', name: 'Schritte', icon: '👣', type: 'kennzahl-ziel', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.steps), target: (r) => numN(r.step_goal), goodDir: 'up' },
  { id: 'sleep_score', name: 'Schlaf-Score', icon: '😴', type: 'sparkline', group: 'A', defaultVisible: true, src: 'sleep', get: (r) => numN(r.score), goodDir: 'up' },
  { id: 'spo2', name: 'SpO₂', icon: '🫁', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.spo2_avg), unit: '%', goodDir: 'up' },
  { id: 'respiration', name: 'Atmung', icon: '🌬️', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.respiration_waking_avg), unit: '/min', goodDir: 'down' },
  { id: 'intensity', name: 'Intensitätsminuten', icon: '⚡', type: 'kennzahl-ziel', group: 'A', defaultVisible: false, src: 'daily', get: (r) => (numN(r.intensity_moderate_min) ?? 0) + (numN(r.intensity_vigorous_min) ?? 0), target: () => 150, goodDir: 'up' },
  { id: 'calories', name: 'Aktive Kalorien', icon: '🔥', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.calories_active), unit: 'kcal', goodDir: 'up' },
  { id: 'floors', name: 'Etagen', icon: '🪜', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.floors_ascended), goodDir: 'up' },
  { id: 'weight', name: 'Gewicht', icon: '⚖️', type: 'sparkline', group: 'A', defaultVisible: false, src: 'health', get: (r) => { const g = numN(r.weight_g); return g != null ? g / 1000 : null }, unit: 'kg', decimals: 1, goodDir: 'down', special: 'weight' },
  // Gruppe B — garmin_scores
  { id: 'readiness', name: 'Training Readiness', icon: '✅', type: 'score-gauge', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.training_readiness_score), gaugeMax: 100, goodDir: 'up' },
  { id: 'vo2max', name: 'VO2max', icon: '📈', type: 'sparkline', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.vo2max), goodDir: 'up', special: 'vo2max' },
  { id: 'endurance', name: 'Endurance Score', icon: '🏅', type: 'sparkline', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.endurance_score), goodDir: 'up' },
  { id: 'hill', name: 'Hill Score', icon: '⛰️', type: 'sparkline', group: 'B', defaultVisible: false, src: 'scores', get: (r) => numN(r.hill_score), goodDir: 'up' },
  { id: 'fitness_age', name: 'Fitness Age', icon: '🎂', type: 'kennzahl-ziel', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.fitness_age), target: (r) => numN(r.fitness_age_chronological), goodDir: 'down', fmt: (v) => v.toFixed(1).replace('.', ',') },
  { id: 'race', name: 'Race Predictions', icon: '🏁', type: 'sparkline', group: 'B', defaultVisible: false, src: 'scores', get: (r) => numN(r.race_5k_sec), goodDir: 'down', fmt: fmtRaceTime, special: 'race' },
  { id: 'training_status', name: 'Training Status', icon: '🧭', type: 'kennzahl-ziel', group: 'B', defaultVisible: false, src: 'scores', get: (r) => numN(r.training_status_code), special: 'status' },
  { id: 'load', name: 'Trainingslast (ACWR)', icon: '📊', type: 'sparkline', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.tr_acute_load), goodDir: 'up', special: 'load' },
]
const WMAP = new Map(WIDGETS.map((w) => [w.id, w]))
const STATUS_LABEL: Record<number, string> = { 0: 'Kein Status', 1: 'Formverlust', 2: 'Unproduktiv', 3: 'Formerhalt', 4: 'Produktiv', 5: 'Höchstform', 6: 'Überlastung', 7: 'Erholung', 8: 'Angespannt' }
const ACWR_INFO = (p: number | null) => {
  if (p == null) return { label: '—', color: 'var(--ink3)' }
  const r = p / 100
  if (r < 0.8) return { label: 'wenig', color: '#F59E0B' }
  if (r <= 1.3) return { label: 'optimal', color: '#22C55E' }
  if (r <= 1.5) return { label: 'erhöht', color: '#F59E0B' }
  return { label: 'hoch', color: '#EF4444' }
}

type WidgetOpts = { dist?: RaceDist }
type Layout = { visible: string[]; hidden: string[]; colors: Record<string, string>; opts: Record<string, WidgetOpts> }
function defaultLayout(): Layout { return { visible: WIDGETS.filter((w) => w.defaultVisible).map((w) => w.id), hidden: WIDGETS.filter((w) => !w.defaultVisible).map((w) => w.id), colors: {}, opts: {} } }
function reconcile(l: Layout): Layout {
  const known = new Set(WIDGETS.map((w) => w.id))
  const visible = (l.visible || []).filter((id) => known.has(id))
  const hidden = (l.hidden || []).filter((id) => known.has(id) && !visible.includes(id))
  const placed = new Set([...visible, ...hidden])
  for (const w of WIDGETS) if (!placed.has(w.id)) (w.defaultVisible ? visible : hidden).push(w.id)
  const colors: Record<string, string> = {}
  for (const [id, c] of Object.entries(l.colors || {})) if (known.has(id) && typeof c === 'string') colors[id] = c
  const opts: Record<string, WidgetOpts> = {}
  for (const [id, o] of Object.entries(l.opts || {})) if (known.has(id) && o) opts[id] = o
  return { visible, hidden, colors, opts }
}

type Maps = Record<Src, Map<string, Record<string, unknown>>>
function buildSeries(w: WidgetDef, maps: Maps, days: number, getFn?: (r: Record<string, unknown>) => number | null): (number | null)[] {
  const g = getFn ?? w.get
  const out: (number | null)[] = []
  for (let i = days - 1; i >= 0; i--) {
    const r = maps[w.src].get(dayKey(addDays(new Date(), -i)))
    out.push(r ? g(r) : null)
  }
  return out
}
function statsOf(vals: (number | null)[]) {
  const nn = vals.filter((v): v is number => v != null)
  if (nn.length === 0) return null
  return { min: Math.min(...nn), max: Math.max(...nn), avg: nn.reduce((a, b) => a + b, 0) / nn.length, last: nn[nn.length - 1], n: nn.length }
}
function linePathGapped(vals: (number | null)[], w: number, h: number, p = 3): string {
  const nn = vals.filter((v): v is number => v != null)
  if (nn.length < 2) return ''
  const mn = Math.min(...nn), mx = Math.max(...nn), r = mx - mn || 1, sx = w / (vals.length - 1)
  let d = '', pen = false
  vals.forEach((v, i) => { if (v == null) { pen = false; return } const x = i * sx, y = p + (h - 2 * p) - ((v - mn) / r) * (h - 2 * p); d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `; pen = true })
  return d.trim()
}
// Messpunkte (Wertwechsel) für VO2max-Fortschreibungs-Kennzeichnung.
function changeDots(vals: (number | null)[], w: number, h: number, p = 3): { x: number; y: number }[] {
  const nn = vals.filter((v): v is number => v != null)
  if (nn.length < 2) return []
  const mn = Math.min(...nn), mx = Math.max(...nn), r = mx - mn || 1, sx = w / (vals.length - 1)
  const dots: { x: number; y: number }[] = []
  let prev: number | null = null
  vals.forEach((v, i) => { if (v == null) return; if (prev == null || v !== prev) dots.push({ x: i * sx, y: p + (h - 2 * p) - ((v - mn) / r) * (h - 2 * p) }); prev = v })
  return dots
}
function fmtVal(w: WidgetDef, v: number): string { return w.fmt ? w.fmt(v) : `${w.decimals != null ? v.toFixed(w.decimals) : Math.round(v)}${w.unit ? ' ' + w.unit : ''}` }

function WidgetBody({ w, maps, color, dist, onDist }: { w: WidgetDef; maps: Maps; color: string; dist: RaceDist; onDist: (d: RaceDist) => void }) {
  const accent = color
  const getFn = w.special === 'race' ? (r: Record<string, unknown>) => numN(r[RACE_COL[dist]]) : undefined
  const vals = buildSeries(w, maps, 90, getFn)
  const st = statsOf(vals)
  if (!st && w.special === 'weight') return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)' }}>Noch keine Gewichtsdaten</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', marginTop: 5, lineHeight: 1.45 }}>Sobald du dein Gewicht in Garmin Connect pflegst, füllt sich der Verlauf hier automatisch.</div>
    </div>
  )
  if (!st) return <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Keine Daten im Zeitraum.</div>

  if (w.special === 'status') {
    const label = STATUS_LABEL[Math.round(st.last)] ?? `Status ${st.last}`
    return <div style={{ marginTop: 8 }}><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>{label}</div><div style={{ ...kicker, fontSize: 10, marginTop: 6 }}>aktueller Status</div></div>
  }

  if (w.type === 'score-gauge') {
    const frac = Math.max(0, Math.min(1, st.last / (w.gaugeMax ?? 100)))
    const len = 141
    return (
      <div style={{ position: 'relative', display: 'grid', placeItems: 'center', marginTop: 4 }}>
        <svg width="130" height="72" viewBox="0 0 100 56"><path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--track)" strokeWidth="9" strokeLinecap="round" /><path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke={accent} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(frac * len).toFixed(1)} ${len}`} /></svg>
        <div style={{ position: 'absolute', top: 30, fontSize: 26, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{Math.round(st.last)}</div>
      </div>
    )
  }

  if (w.type === 'kennzahl-ziel') {
    const lastRow = maps[w.src].get(dayKey(new Date())) ?? [...maps[w.src].values()][0]
    const target = w.target && lastRow ? w.target(lastRow) : null
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(w, st.last)}</div>
          {target != null && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{w.id === 'fitness_age' ? `vs. ${target} J.` : `/ ${Math.round(target)}`}</div>}
        </div>
        {target != null && target > 0 && <div style={{ height: 8, borderRadius: 99, background: 'var(--track)', marginTop: 12, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, (st.last / target) * 100)}%`, background: accent, borderRadius: 99 }} /></div>}
      </div>
    )
  }

  if (w.type === 'tagesverlauf') {
    const last = vals.slice(-30)
    const mx = Math.max(1, ...last.filter((v): v is number => v != null))
    return (
      <div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(w, st.last)}</div>
        <div style={{ position: 'relative', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 46 }}>
            {last.map((v, i) => <div key={i} style={{ flex: 1, height: v != null ? `${(v / mx) * 100}%` : 0, background: accent, borderRadius: '3px 3px 1px 1px', opacity: 0.85 }} />)}
          </div>
          <HoverOverlay pts={dayHoverPts(last)} color={accent} format={(v) => fmtVal(w, v)} yFracAt={(i) => (last[i] == null ? null : 1 - (last[i] as number) / mx)} barMode />
        </div>
      </div>
    )
  }

  // sparkline (+ vo2max Messpunkte)
  const dots = w.special === 'vo2max' ? changeDots(vals, 200, 46, 4) : []
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.9px', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(w, st.last)}</div>
        {w.special === 'load' && (() => { const p = numN((maps.scores.get(dayKey(new Date())) ?? [...maps.scores.values()][0] ?? {}).tr_acwr_percent); const a = ACWR_INFO(p); return <div style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 7, background: `color-mix(in srgb, ${a.color} 16%, transparent)`, color: a.color }}>ACWR {a.label}</div> })()}
      </div>
      {w.special === 'race' && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink3)', marginTop: 3 }}>Geschätzte Bestzeit über {RACE_LABEL[dist]}</div>}
      <div style={{ position: 'relative', marginTop: 8 }}>
        <svg width="100%" height="46" viewBox="0 0 200 46" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
          <path d={linePathGapped(vals, 200, 46, 4)} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          {dots.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.6" fill={accent} />)}
        </svg>
        <HoverOverlay pts={dayHoverPts(vals)} color={accent} format={(v) => fmtVal(w, v)} yFracAt={(i) => lineYFrac(vals, i, 4 / 46)} />
      </div>
      {w.special === 'vo2max' && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)', marginTop: 4 }}>Punkte = gemessen · Linie fortgeschrieben</div>}
      {w.special === 'race' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <RaceControl dist={dist} onDist={onDist} small />
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)' }}>Formprognose · kein Event</div>
        </div>
      )}
    </div>
  )
}

type ZoomPeriod = 'week' | 'month' | 'year' | 'all'
// Großer Graph im Zoom-Modal mit lesbaren X/Y-Achsen (9.6) + Hover (9.1)
function ZoomChart({ vals, period, bars, color, fmtValue, fmtTick, showDots }: { vals: (number | null)[]; period: ZoomPeriod; bars: boolean; color: string; fmtValue: (v: number) => string; fmtTick: (v: number) => string; showDots?: boolean }) {
  const H = 260, W = 900
  const nn = vals.filter((v): v is number => v != null)
  const dataMin = Math.min(...nn), dataMax = Math.max(...nn)
  const ticks = niceTicks(bars ? 0 : dataMin, dataMax, 4)
  const lo = bars ? 0 : ticks[0], hi = ticks[ticks.length - 1]
  const span = hi - lo || 1
  const yf = (v: number) => 1 - (v - lo) / span
  const n = vals.length, sx = W / (n - 1 || 1)
  let dLine = '', pen = false
  vals.forEach((v, i) => { if (v == null) { pen = false; return } dLine += `${pen ? 'L' : 'M'}${(i * sx).toFixed(1)} ${(yf(v) * H).toFixed(1)} `; pen = true })
  const dots: { x: number; y: number }[] = []
  if (showDots) { let prev: number | null = null; vals.forEach((v, i) => { if (v == null) return; if (prev == null || v !== prev) dots.push({ x: i * sx, y: yf(v) * H }); prev = v }) }
  const step = Math.max(1, Math.round(n / 6))
  const xIdx: number[] = []
  for (let i = 0; i < n; i += step) xIdx.push(i)
  if (xIdx[xIdx.length - 1] !== n - 1) xIdx.push(n - 1)
  let lastTxt = ''
  const xLabels = xIdx.map((i) => {
    const d = addDays(new Date(), i - (n - 1))
    const txt = period === 'week' ? `${WD[d.getDay()]} ${d.getDate()}.` : period === 'month' ? `${d.getDate()}.${d.getMonth() + 1}.` : MONTHS_SHORT[d.getMonth()]
    const dup = txt === lastTxt; lastTxt = txt
    return { xf: bars ? (i + 0.5) / n : (n > 1 ? i / (n - 1) : 0.5), txt: dup ? '' : txt }
  })
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <div style={{ width: 46, position: 'relative', height: H, flex: 'none' }}>
        {ticks.map((t) => <div key={t} style={{ position: 'absolute', right: 4, top: `${yf(t) * 100}%`, transform: 'translateY(-50%)', fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtTick(t)}</div>)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ position: 'relative', height: H }}>
          {ticks.map((t) => <div key={t} style={{ position: 'absolute', left: 0, right: 0, top: `${yf(t) * 100}%`, height: 1, background: 'var(--hair)', opacity: 0.55 }} />)}
          {bars ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 1 }}>{vals.map((v, i) => <div key={i} style={{ flex: 1, height: v != null ? `${((v - lo) / span) * 100}%` : 0, background: color, opacity: 0.85, borderRadius: '2px 2px 0 0' }} />)}</div>
          ) : (
            <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
              <path d={dLine.trim()} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              {dots.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.4" fill={color} />)}
            </svg>
          )}
          <HoverOverlay pts={dayHoverPts(vals)} color={color} format={fmtValue} yFracAt={(i) => (vals[i] == null ? null : yf(vals[i] as number))} barMode={bars} />
        </div>
        <div style={{ position: 'relative', height: 15, marginTop: 7 }}>
          {xLabels.map((l, i) => l.txt ? <div key={i} style={{ position: 'absolute', left: `${l.xf * 100}%`, transform: 'translateX(-50%)', fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{l.txt}</div> : null)}
        </div>
      </div>
    </div>
  )
}

// ── KPI-Erklärungen (Welle 4-2): kuratierte Texte, KEINE aus Daten berechneten Formeln. ──
// Garmins/Firstbeats Algorithmen sind proprietär — hier nur Einordnung, keine exakte Formel.
type Sex = 'm' | 'w'
type ClsCtx = { cur: number | null; row: Record<string, unknown> | null; avg30: number | null; age: number | null; sex: Sex | null }
interface Explain { bubble: string; accordion: string; classify?: (c: ClsCtx) => { text: string; color: string } | null; staticNote?: string }
const C_GREEN = '#22C55E', C_AMBER = '#F59E0B', C_RED = '#EF4444', C_NEUTRAL = 'var(--ink2)'

// ── Altersnormierte Norm-Tabellen (Welle 4-2c) — statische Richtwerte, KEINE berechneten Formeln. ──
// Alter wird zur Laufzeit aus Geburtsdatum berechnet; je Altersgruppe (Dekade) + Geschlecht eine Zeile.
// Jede Zeile = 5 aufsteigende Schwellen → 6 Kategorien.
const NORM_GROUP = (age: number): number => Math.min(70, Math.max(20, Math.floor(age / 10) * 10))
const NORM_GROUP_LABEL = (gk: number): string => (gk >= 70 ? '70+' : `${gk}–${gk + 9}`)
// Index 0..5 anhand aufsteigender Schwellen (v >= Schwelle ⇒ nächste Kategorie).
const NORM_BIN = (v: number, thr: number[]): number => { let i = 0; while (i < thr.length && v >= thr[i]) i++; return i }
// Bei fehlendem Geschlecht: geschlechtsneutrale Norm = Mittel aus m/w.
function normRow(table: Record<Sex, Record<number, number[]>>, sex: Sex | null, gk: number): number[] {
  if (sex) return table[sex][gk]
  const m = table.m[gk], w = table.w[gk]
  return m.map((x, i) => Math.round((x + w[i]) / 2))
}
// VO2max (ml/kg/min), Kategorien niedrig→hoch (höher = besser). Angelehnt an Cooper/ACSM-Perzentile.
const VO2MAX_NORM: Record<Sex, Record<number, number[]>> = {
  m: { 20: [32, 38, 44, 51, 57], 30: [31, 36, 42, 48, 54], 40: [29, 34, 40, 45, 52], 50: [27, 32, 36, 43, 49], 60: [25, 29, 34, 41, 47], 70: [23, 27, 32, 38, 44] },
  w: { 20: [28, 34, 39, 45, 51], 30: [27, 32, 37, 43, 48], 40: [25, 29, 34, 40, 46], 50: [22, 26, 31, 36, 42], 60: [20, 24, 28, 34, 40], 70: [18, 22, 26, 32, 38] },
}
const VO2MAX_LABELS = ['schwach', 'unterdurchschnittlich', 'durchschnittlich', 'gut', 'exzellent', 'überragend']
const VO2MAX_COLORS = [C_RED, C_AMBER, C_NEUTRAL, C_GREEN, C_GREEN, C_GREEN]
// Ruhepuls (bpm), Kategorien niedrig→hoch (niedriger Puls = besser). Altersabhängige Richtwerte.
const RHR_NORM: Record<Sex, Record<number, number[]>> = {
  m: { 20: [56, 62, 66, 74, 82], 30: [56, 62, 66, 75, 83], 40: [57, 63, 67, 76, 84], 50: [58, 64, 68, 77, 84], 60: [57, 62, 67, 76, 84], 70: [56, 62, 66, 74, 82] },
  w: { 20: [61, 66, 70, 79, 85], 30: [61, 66, 70, 78, 84], 40: [61, 66, 70, 79, 85], 50: [62, 67, 71, 80, 85], 60: [61, 66, 70, 78, 84], 70: [61, 66, 70, 77, 84] },
}
const RHR_LABELS = ['Athlet', 'exzellent', 'gut', 'durchschnittlich', 'unterdurchschnittlich', 'schwach']
const RHR_COLORS = [C_GREEN, C_GREEN, C_GREEN, C_NEUTRAL, C_AMBER, C_RED]
const EXPLAIN: Record<string, Explain> = {
  hrv: {
    bubble: 'Herzratenvariabilität — die Schwankung zwischen deinen Herzschlägen in der Nacht. Höher ist meist besser; sie spiegelt Erholung und Belastbarkeit wider.',
    accordion: 'HRV misst, wie variabel die Abstände zwischen Herzschlägen sind. Ein gut erholtes, ausgeglichenes Nervensystem erzeugt höhere Variabilität, Stress und Ermüdung senken sie. HRV ist stark individuell — der absolute Wert sagt weniger als dein persönlicher Trend. Achte auf Abweichungen von deinem eigenen Normalbereich, nicht auf Vergleiche mit anderen.',
    classify: ({ cur, avg30 }) => {
      if (cur == null || avg30 == null) return null
      if (cur < avg30 * 0.95) return { text: `Dein aktueller Wert (${Math.round(cur)} ms) liegt unter deinem 30-Tage-Schnitt (${avg30} ms) — mögliche Belastung oder Ermüdung.`, color: C_AMBER }
      if (cur > avg30 * 1.05) return { text: `Dein aktueller Wert (${Math.round(cur)} ms) liegt über deinem 30-Tage-Schnitt (${avg30} ms) — gut erholt.`, color: C_GREEN }
      return { text: `Dein aktueller Wert (${Math.round(cur)} ms) liegt im Bereich deines 30-Tage-Schnitts (${avg30} ms) — normal.`, color: C_GREEN }
    },
  },
  load: {
    bubble: 'Akute Trainingslast im Verhältnis zur chronischen (ACWR) — zeigt, ob dein aktuelles Training zu deiner jüngsten Gewöhnung passt.',
    accordion: 'ACWR (Acute:Chronic Workload Ratio) setzt deine Last der letzten ~7 Tage ins Verhältnis zu den letzten ~28. Es ist ein etablierter Indikator dafür, ob du dich in einem tragfähigen Belastungsbereich bewegst oder zu schnell steigerst. Als Orientierung (keine medizinische Aussage): unter 0,8 = geringe Last / Detraining möglich; 0,8–1,3 = optimaler Bereich; 1,3–1,5 = erhöht; über 1,5 = hoch, steigendes Überlastungsrisiko.',
    classify: ({ row }) => {
      const p = numN(row?.tr_acwr_percent); if (p == null) return null
      const info = ACWR_INFO(p)
      const label = ({ wenig: 'geringe Last / Detraining möglich', optimal: 'optimaler Bereich', erhöht: 'erhöht', hoch: 'hoch — steigendes Überlastungsrisiko' } as Record<string, string>)[info.label] ?? info.label
      return { text: `Dein aktueller ACWR liegt bei ${(p / 100).toFixed(2).replace('.', ',')} — ${label}.`, color: info.color }
    },
  },
  stress: {
    bubble: 'Garmins Stress-Wert aus der Herzratenvariabilität — je höher, desto mehr Belastung; niedrige Werte bedeuten Erholung/Ruhe.',
    accordion: 'Der Stress-Wert leitet sich aus der HRV über den Tag ab. Er unterscheidet nicht zwischen körperlicher und mentaler Belastung — auch Training, Kaffee oder wenig Schlaf treiben ihn hoch. Bereiche: 0–25 = Ruhe; 26–50 = niedrig; 51–75 = mittel; 76–100 = hoch. Dauerhaft hohe Werte über den Tag deuten auf fehlende Erholungsphasen hin.',
    classify: ({ cur }) => {
      if (cur == null) return null
      const v = Math.round(cur)
      const [b, c] = v <= 25 ? ['Ruhe', C_GREEN] : v <= 50 ? ['niedrig', C_GREEN] : v <= 75 ? ['mittel', C_AMBER] : ['hoch', C_RED]
      return { text: `Dein Tagesschnitt (${v}) liegt im Bereich „${b}".`, color: c }
    },
  },
  sleep_score: {
    bubble: 'Gesamtbewertung deiner Nacht aus Dauer, Tiefschlaf/REM, Erholung und Unruhe. Höher ist besser.',
    accordion: 'Der Score fasst Schlafdauer, Anteil von Tief- und REM-Schlaf, nächtliche HRV/Erholung und Unruhe zu einem Wert zusammen. Bereiche: 90–100 = ausgezeichnet; 80–89 = gut; 60–79 = mittelmäßig; unter 60 = schlecht. Ein einzelner niedriger Wert ist normal — der Wochentrend zählt.',
    classify: ({ cur }) => {
      if (cur == null) return null
      const v = Math.round(cur)
      const [b, c] = v >= 90 ? ['ausgezeichnet', C_GREEN] : v >= 80 ? ['gut', C_GREEN] : v >= 60 ? ['mittelmäßig', C_AMBER] : ['schlecht', C_RED]
      return { text: `Dein Score (${v}) liegt im Bereich „${b}".`, color: c }
    },
  },
  body_battery: {
    bubble: 'Deine Energiereserve — lädt bei Erholung und Schlaf, entleert sich bei Stress und Aktivität. Ein Tank für den Tag.',
    accordion: 'Body Battery kombiniert HRV, Stress, Schlaf und Aktivität zu einem Energiewert. Er steigt bei Ruhe und gutem Schlaf, fällt bei Belastung. Im Tagesverlauf startest du morgens meist hoch (über Nacht geladen) und baust über den Tag ab. Bereiche: 75–100 = hoch; 50–74 = mittel; 25–49 = niedrig; unter 25 = erschöpft. Wie hoch du morgens startest, ist ein guter Erholungsindikator.',
    classify: ({ cur }) => {
      if (cur == null) return null
      const v = Math.round(cur)
      const [b, c] = v >= 75 ? ['hoch', C_GREEN] : v >= 50 ? ['mittel', C_GREEN] : v >= 25 ? ['niedrig', C_AMBER] : ['erschöpft', C_RED]
      return { text: `Dein Tageshöchstwert (${v}) liegt im Bereich „${b}". Wie hoch du morgens startest, ist ein guter Erholungsindikator.`, color: c }
    },
  },
  vo2max: {
    bubble: 'Schätzung deiner maximalen Sauerstoffaufnahme — der wichtigste Einzelwert für aerobe Fitness. Höher = ausdauernder.',
    accordion: 'VO2max schätzt, wie viel Sauerstoff dein Körper unter maximaler Belastung verwerten kann, aus Herzfrequenz und Tempo beim Laufen/Radfahren. Er verbessert sich langsam über Wochen gezielten Trainings. Absolutwerte hängen stark von Alter und Geschlecht ab — dein Trend über Monate ist aussagekräftiger als der Einzelwert. Zwischen Messtagen wird der letzte Wert fortgeschrieben (siehe Kennzeichnung im Graph).',
    staticNote: 'Für die altersnormierte Einordnung Geburtsdatum in den Einstellungen hinterlegen. Ansonsten zählt vor allem dein eigener Trend über Monate.',
    classify: ({ cur, age, sex }) => {
      if (cur == null || age == null) return null
      const gk = NORM_GROUP(age)
      const idx = NORM_BIN(cur, normRow(VO2MAX_NORM, sex, gk))
      const sn = sex ? '' : ' · geschlechtsneutral'
      return { text: `VO2max ${Math.round(cur)} — für dein Alter (Gruppe ${NORM_GROUP_LABEL(gk)}${sn}): ${VO2MAX_LABELS[idx]}.`, color: VO2MAX_COLORS[idx] }
    },
  },
  resting_hr: {
    bubble: 'Deine Herzfrequenz in völliger Ruhe (meist nachts/morgens gemessen). Ein niedrigerer Ruhepuls spricht meist für ein gut trainiertes Herz-Kreislauf-System.',
    accordion: 'Der Ruhepuls ist die Zahl deiner Herzschläge pro Minute in Ruhe. Ausdauertraining senkt ihn tendenziell über die Zeit; Stress, Krankheit, Koffein, Alkohol oder wenig Schlaf heben ihn kurzfristig. Er ist alters- und geschlechtsabhängig sowie individuell — beobachte vor allem deinen eigenen Trend. Die Einordnung unten ist ein altersnormierter Richtwert (keine medizinische Aussage).',
    staticNote: 'Für die altersnormierte Einordnung Geburtsdatum in den Einstellungen hinterlegen.',
    classify: ({ cur, age, sex }) => {
      if (cur == null || age == null) return null
      const gk = NORM_GROUP(age)
      const idx = NORM_BIN(cur, normRow(RHR_NORM, sex, gk))
      const sn = sex ? '' : ' · geschlechtsneutral'
      return { text: `Ruhepuls ${Math.round(cur)} bpm — für dein Alter (Gruppe ${NORM_GROUP_LABEL(gk)}${sn}): ${RHR_LABELS[idx]}.`, color: RHR_COLORS[idx] }
    },
  },
  fitness_age: {
    bubble: 'Dein Fitnessalter im Vergleich zum kalendarischen — niedriger als dein echtes Alter ist gut.',
    accordion: 'Fitness Age übersetzt Werte wie VO2max, Ruhepuls, Aktivität und Körperzusammensetzung in ein "biologisches" Fitnessalter. Liegt es unter deinem echten Alter, bist du fitter als der Durchschnitt deiner Altersgruppe. Es reagiert träge — nachhaltige Verbesserungen zeigen sich über Monate. Der Vergleich zum kalendarischen Alter ist der Kern der Aussage.',
    classify: ({ cur, row }) => {
      if (cur == null) return null
      const chrono = numN(row?.fitness_age_chronological); if (chrono == null) return null
      const val = cur.toFixed(1).replace('.', ',')
      const diff = cur - chrono
      if (diff < -0.5) return { text: `Dein Fitnessalter (${val}) liegt unter deinem kalendarischen Alter (${chrono}) — fitter als der Durchschnitt deiner Altersgruppe.`, color: C_GREEN }
      if (diff > 0.5) return { text: `Dein Fitnessalter (${val}) liegt über deinem kalendarischen Alter (${chrono}).`, color: C_AMBER }
      return { text: `Dein Fitnessalter (${val}) entspricht etwa deinem kalendarischen Alter (${chrono}).`, color: C_NEUTRAL }
    },
  },
  endurance: {
    bubble: 'Bewertung deiner Ausdauerfähigkeit über alle Distanzen — steigt mit konstantem Ausdauertraining.',
    accordion: 'Der Endurance Score bewertet, wie gut dein Körper länger andauernde Belastungen bewältigt, basierend auf VO2max und dem Volumen/der Intensität deiner Einheiten über die Zeit. Höher = bessere Ausdauerbasis. Er wächst durch regelmäßiges, auch längeres Training und ist ein Langzeit-Indikator, kein Tageswert.',
    staticNote: 'Kein fester Schwellwert — Fokus auf deinen eigenen Trend.',
  },
  hill: {
    bubble: 'Deine Fähigkeit, bergauf Leistung zu bringen — kombiniert Kraft und Ausdauer am Anstieg.',
    accordion: 'Der Hill Score bewertet deine Bergauf-Leistungsfähigkeit aus der Leistung, die du an Anstiegen erbringst, und setzt Kraft- und Ausdauerkomponente zusammen. Höher = besser am Berg. Relevant vor allem für Läufer/Radfahrer mit Höhenmetern; ohne Anstiege im Training bleibt er flach.',
    staticNote: 'Kein fester Schwellwert — Fokus auf deinen eigenen Trend.',
  },
  readiness: {
    bubble: 'Wie bereit dein Körper heute für intensives Training ist — aus Schlaf, Erholung, HRV und jüngster Last.',
    accordion: 'Training Readiness bündelt Schlafqualität, Erholungszeit, HRV, akute Last und Stress zu einer Tagesempfehlung. Hoch = guter Tag für Intensität; niedrig = eher Erholung/leichtes Training. Bereiche: 80–100 = hoch (bereit); 50–79 = mittel; unter 50 = niedrig (Erholung ratsam). Es ist eine Momentaufnahme am Morgen, kein Verbot — dein Gefühl zählt mit.',
    classify: ({ cur, row }) => {
      if (cur == null) return null
      const v = Math.round(cur)
      const lvl = typeof row?.tr_level === 'string' && row.tr_level ? ` (${row.tr_level})` : ''
      const [b, c] = v >= 80 ? ['hoch – bereit', C_GREEN] : v >= 50 ? ['mittel', C_AMBER] : ['niedrig – Erholung ratsam', C_RED]
      return { text: `Dein Score (${v})${lvl} liegt im Bereich „${b}".`, color: c }
    },
  },
  race: {
    bubble: 'Geschätzte Bestzeit über die gewählte Distanz, wenn du heute in Form antreten würdest — eine Formprognose, kein geplantes Rennen.',
    accordion: 'Die Prognose leitet aus deiner aktuellen Fitness (v.a. VO2max und Trainingslast) ab, welche Zeit über 5 km / 10 km / Halbmarathon / Marathon realistisch wäre. Sie verbessert sich, wenn deine Form steigt. Es ist eine Schätzung unter Idealbedingungen — Strecke, Wetter und Tagesform beeinflussen die echte Zeit.',
    staticNote: 'Kein fester Schwellwert — beobachte deinen eigenen Prognose-Trend.',
  },
}

function KpiExplain({ w, maps, dist, age, sex }: { w: WidgetDef; maps: Maps; dist: RaceDist; age: number | null; sex: Sex | null }) {
  const [open, setOpen] = useState(false)
  const ex = EXPLAIN[w.id]
  const getFn = w.special === 'race' ? (r: Record<string, unknown>) => numN(r[RACE_COL[dist]]) : w.get
  const { cur, row } = useMemo(() => {
    const entries = [...maps[w.src].entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
    for (const [, r] of entries) { const v = getFn(r); if (v != null) return { cur: v, row: r } }
    return { cur: null as number | null, row: entries[0]?.[1] ?? null }
  }, [maps, w, dist])
  const avg30 = useMemo(() => {
    const nn = buildSeries(w, maps, 30, w.special === 'race' ? getFn : undefined).filter((v): v is number => v != null)
    return nn.length ? Math.round(nn.reduce((a, b) => a + b, 0) / nn.length) : null
  }, [maps, w, dist])
  if (!ex) return null
  const cls = ex.classify ? ex.classify({ cur, row, avg30, age, sex }) : null
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', gap: 11, padding: '14px 16px', borderRadius: 16, background: 'color-mix(in srgb, var(--accent) 8%, var(--track))', border: '1px solid var(--hair)' }}>
        <div style={{ fontSize: 17, lineHeight: 1.3, flex: 'none' }}>💡</div>
        <div style={{ fontSize: 13.5, fontWeight: 650, color: 'var(--ink)', lineHeight: 1.5 }}>{ex.bubble}</div>
      </div>
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '7px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)', background: 'var(--track)' }}>
        Mehr erfahren
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s ease' }}><path d="M6 9l6 6 6-6" /></svg>
      </div>
      {open && (
        <div style={{ marginTop: 10, padding: '15px 17px', borderRadius: 16, border: '1px solid var(--hair)', background: 'var(--card)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', lineHeight: 1.65 }}>{ex.accordion}</div>
          {cls && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 13, padding: '11px 13px', borderRadius: 12, background: `color-mix(in srgb, ${cls.color} 12%, transparent)` }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: cls.color, marginTop: 5, flex: 'none' }} />
              <div style={{ fontSize: 12.5, fontWeight: 750, color: 'var(--ink)', lineHeight: 1.5 }}><span style={{ color: cls.color }}>Deine Einordnung:</span> {cls.text}</div>
            </div>
          )}
          {!cls && ex.staticNote && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)', marginTop: 12, lineHeight: 1.5 }}>Einordnung: {ex.staticNote}</div>}
        </div>
      )}
    </div>
  )
}

function ZoomModal({ w, maps, intraday, color, dist, onDist, age, sex, onClose }: { w: WidgetDef; maps: Maps; intraday?: Map<string, GarminIntraday>; color: string; dist: RaceDist; onDist: (d: RaceDist) => void; age: number | null; sex: Sex | null; onClose: () => void }) {
  const [period, setPeriod] = useState<ZoomPeriod>('month')
  const [iDay, setIDay] = useState<string | null>(null)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 365
  const getFn = w.special === 'race' ? (r: Record<string, unknown>) => numN(r[RACE_COL[dist]]) : undefined
  const vals = buildSeries(w, maps, days, getFn)
  const st = statsOf(vals)
  const bars = w.type === 'tagesverlauf'
  const fmtTick = (v: number) => (w.fmt ? w.fmt(v) : w.decimals != null ? v.toFixed(w.decimals) : String(Math.round(v)))

  // Intraday-Tagesverlauf (nur BB/Stress, nur Tage mit Kurvendaten).
  const iKey = w.intradayKey
  const intraDays = useMemo(() => {
    if (!iKey || !intraday) return [] as string[]
    return [...intraday.values()].filter((r) => Array.isArray(r[iKey]) && (r[iKey] as IntradayPoint[]).length > 1).map((r) => r.calendar_date).sort().reverse()
  }, [iKey, intraday])
  const selDay = iDay && intraDays.includes(iDay) ? iDay : intraDays[0] ?? null
  const iPts: IntradayPoint[] = selDay && intraday && iKey ? ((intraday.get(selDay)?.[iKey] as IntradayPoint[]) ?? []) : []
  const iColor = iKey === 'stress_curve' ? '#F59E0B' : '#22C55E'
  const iVals = iPts.map((p) => p.v)
  const iNav = (on: boolean): CSSProperties => ({ width: 32, height: 32, borderRadius: 10, background: 'var(--track)', display: 'grid', placeItems: 'center', cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.35, fontSize: 17, fontWeight: 700, color: 'var(--ink2)' })
  const iLabel = selDay ? (() => { const d = dateFromKey(selDay); return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS_SHORT[d.getMonth()]}` })() : ''
  const iIdx = selDay ? intraDays.indexOf(selDay) : -1
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 2, width: 960, maxWidth: '100%', borderRadius: 28, background: 'var(--glass-strong)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: '24px 28px', animation: 'popIn .2s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 20, background: 'var(--track)' }}>{w.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>{w.name}</div>
            {w.special === 'race' && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginTop: 2 }}>Geschätzte Bestzeit über {RACE_LABEL[dist]} · aktuelle Formprognose, kein geplantes Event</div>}
          </div>
          {w.special === 'race' && <RaceControl dist={dist} onDist={onDist} />}
          <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, background: 'var(--track)' }}>
            {(['week', 'month', 'year', 'all'] as const).map((p) => <div key={p} onClick={() => setPeriod(p)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', color: period === p ? 'var(--ink)' : 'var(--ink3)', background: period === p ? 'var(--seg-active, #fff)' : 'transparent' }}>{{ week: 'Woche', month: 'Monat', year: 'Jahr', all: 'Alles' }[p]}</div>)}
          </div>
          <div onClick={onClose} style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--track)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></div>
        </div>

        <KpiExplain w={w} maps={maps} dist={dist} age={age} sex={sex} />

        <div style={{ background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 18, padding: '18px 16px', marginTop: 20 }}>
          {st ? (
            <ZoomChart vals={vals} period={period} bars={bars} color={color} fmtValue={(v) => fmtVal(w, v)} fmtTick={fmtTick} showDots={w.special === 'vo2max'} />
          ) : <div style={{ height: 260, display: 'grid', placeItems: 'center', color: 'var(--ink3)', fontWeight: 700 }}>Keine Daten im Zeitraum.</div>}
        </div>

        {st && (
          <div style={{ display: 'flex', gap: 30, marginTop: 18 }}>
            {([['Min', st.min], ['Schnitt', st.avg], ['Max', st.max]] as const).map(([k, v]) => (
              <div key={k}><div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{fmtVal(w, v)}</div><div style={{ ...kicker, fontSize: 10.5, marginTop: 3 }}>{k}</div></div>
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{st.n} Tage mit Daten</div>
          </div>
        )}

        {/* Intraday-Tagesverlauf (3-Min) — zusätzlich zum Mehrtage-Trend, nur Tage mit Kurve */}
        {iKey && intraDays.length > 0 && (
          <div style={{ marginTop: 22, borderTop: '1px solid var(--hair)', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={kicker}>Tagesverlauf · 3-Min</div>
              <div style={{ flex: 1 }} />
              <div onClick={iIdx < intraDays.length - 1 ? () => setIDay(intraDays[iIdx + 1]) : undefined} title="Älterer Tag" style={iNav(iIdx < intraDays.length - 1)}>‹</div>
              <div style={{ fontSize: 13, fontWeight: 800, minWidth: 118, textAlign: 'center' }}>{iLabel}</div>
              <div onClick={iIdx > 0 ? () => setIDay(intraDays[iIdx - 1]) : undefined} title="Neuerer Tag" style={iNav(iIdx > 0)}>›</div>
            </div>
            <div style={{ background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 18, padding: '14px 12px' }}>
              <IntradayChart pts={iPts} color={iColor} height={180} />
            </div>
            {iVals.length > 0 && (
              <div style={{ display: 'flex', gap: 30, marginTop: 14 }}>
                {([['Start', iVals[0]], ['Tief', Math.min(...iVals)], ['Hoch', Math.max(...iVals)], ['Zuletzt', iVals[iVals.length - 1]]] as const).map(([k, v]) => (
                  <div key={k}><div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{Math.round(v)}</div><div style={{ ...kicker, fontSize: 10.5, marginTop: 3 }}>{k}</div></div>
                ))}
                <div style={{ flex: 1 }} />
                <div style={{ alignSelf: 'flex-end', fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{iVals.length} Punkte</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Trends() {
  const [layout, setLayout] = useState<Layout | null>(null)
  const [editing, setEditing] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [colorPop, setColorPop] = useState<string | null>(null)
  const [daily, setDaily] = useState<Record<string, unknown>[]>([])
  const [sleepR, setSleepR] = useState<Record<string, unknown>[]>([])
  const [scores, setScores] = useState<Record<string, unknown>[]>([])
  const [health, setHealth] = useState<Record<string, unknown>[]>([])
  const [intraday, setIntraday] = useState<GarminIntraday[]>([])
  const [birthDate, setBirthDate] = useState<string>('')
  const [sex, setSex] = useState<Sex | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => {
      setBirthDate(s.birth_date || '')
      setSex(s.sex === 'm' || s.sex === 'w' ? s.sex : null)
      try { const p = JSON.parse(s.puls_trends_layout || 'null'); if (p && Array.isArray(p.visible)) { setLayout(reconcile(p)); return } } catch { /* Default */ }
      const def = defaultLayout(); setLayout(def); void api.updateSettings({ puls_trends_layout: JSON.stringify(def) })
    }).catch(() => setLayout(defaultLayout()))
    const from = dayKey(addDays(new Date(), -365)), to = dayKey(new Date())
    api.getGarminDaily(from, to).then((r) => setDaily(r as unknown as Record<string, unknown>[])).catch(() => {})
    api.getGarminSleep(from, to).then((r) => setSleepR(r as unknown as Record<string, unknown>[])).catch(() => {})
    api.getGarminScores(from, to).then((r) => setScores(r as unknown as Record<string, unknown>[])).catch(() => {})
    api.getGarminHealth(from, to).then((r) => setHealth(r as unknown as Record<string, unknown>[])).catch(() => {})
    api.getGarminIntraday(from, to).then(setIntraday).catch(() => {})
  }, [])
  const intradayMap = useMemo(() => new Map(intraday.map((r) => [r.calendar_date, r])), [intraday])
  const age = useMemo(() => ageFromBirthdate(birthDate), [birthDate])

  const maps = useMemo<Maps>(() => ({
    daily: new Map(daily.map((r) => [String(r.calendar_date), r])),
    sleep: new Map(sleepR.map((r) => [String(r.calendar_date), r])),
    scores: new Map(scores.map((r) => [String(r.calendar_date), r])),
    health: new Map(health.map((r) => [String(r.calendar_date), r])),
  }), [daily, sleepR, scores, health])

  function persist(next: Layout) { setLayout(next); void api.updateSettings({ puls_trends_layout: JSON.stringify(next) }) }
  function remove(id: string) { if (!layout) return; persist({ ...layout, visible: layout.visible.filter((x) => x !== id), hidden: [id, ...layout.hidden.filter((x) => x !== id)] }) }
  function add(id: string) { if (!layout) return; persist({ ...layout, visible: [...layout.visible.filter((x) => x !== id), id], hidden: layout.hidden.filter((x) => x !== id) }) }
  function reorder(from: number, to: number) { if (!layout || from === to) return; const v = [...layout.visible]; const [m] = v.splice(from, 1); v.splice(to, 0, m); setLayout({ ...layout, visible: v }) }
  function setColor(id: string, hex: string | null) { if (!layout) return; const colors = { ...layout.colors }; if (hex) colors[id] = hex; else delete colors[id]; persist({ ...layout, colors }) }
  function setDist(id: string, dist: RaceDist) { if (!layout) return; persist({ ...layout, opts: { ...layout.opts, [id]: { ...layout.opts[id], dist } } }) }
  const colorOf = (id: string) => layout?.colors[id] ?? 'var(--accent)'
  const distOf = (id: string): RaceDist => layout?.opts[id]?.dist ?? '5k'

  if (!layout) return <div style={{ ...CARD, borderRadius: 24, padding: '48px 26px', textAlign: 'center', color: 'var(--ink3)', fontWeight: 700 }}>Lädt…</div>
  const editBtn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: 'pointer' }
  const zoomW = zoom ? WMAP.get(zoom) : undefined

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)' }}>{layout.visible.length} Widgets</div>
        <div style={{ flex: 1 }} />
        {editing && <div onClick={() => setCatalogOpen(true)} style={{ ...editBtn, background: 'color-mix(in srgb, var(--accent) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)', color: 'var(--accent)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Widget hinzufügen</div>}
        <div onClick={() => setEditing((e) => !e)} style={{ ...editBtn, ...GLASS, color: editing ? 'var(--accent)' : 'var(--ink2)', borderColor: editing ? 'color-mix(in srgb, var(--accent) 40%, transparent)' : 'var(--hair)' }}>{editing ? 'Fertig' : 'Bearbeiten'}</div>
      </div>

      {layout.visible.length === 0 ? (
        <div style={{ ...CARD, borderRadius: 24, padding: '56px 26px', textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Keine Widgets</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 6 }}>Füge Widgets hinzu, um deine Trends zu sehen.</div>
          <div onClick={() => { setEditing(true); setCatalogOpen(true) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 18, padding: '10px 18px', borderRadius: 12, background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>+ Widget hinzufügen</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
          {layout.visible.map((id, i) => { const w = WMAP.get(id); if (!w) return null; return (
            <div key={id} draggable={editing} onDragStart={() => setDragIdx(i)} onDragOver={(e) => { if (!editing || dragIdx === null) return; e.preventDefault(); if (dragIdx !== i) { reorder(dragIdx, i); setDragIdx(i) } }} onDragEnd={() => { setDragIdx(null); setLayout((cur) => { if (cur) void api.updateSettings({ puls_trends_layout: JSON.stringify(cur) }); return cur }) }} onClick={() => { if (!editing) setZoom(id) }} style={{ ...CARD, position: 'relative', borderRadius: 22, padding: '18px 20px', opacity: dragIdx === i ? 0.5 : 1, cursor: editing ? 'grab' : 'pointer', outline: editing ? '1.5px dashed var(--hair)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 15, background: 'var(--track)' }}>{w.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</div>
                {editing ? (<>
                  <div onClick={(e) => { e.stopPropagation(); setColorPop(colorPop === id ? null : id) }} title="Farbe" style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--track)', flex: 'none' }}><div style={{ width: 13, height: 13, borderRadius: '50%', background: colorOf(id), border: '1.5px solid var(--card)', boxShadow: '0 0 0 1px var(--hair)' }} /></div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--ink3)', flex: 'none' }}><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                  <div onClick={(e) => { e.stopPropagation(); remove(id) }} title="Entfernen" style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#E5484D', background: 'var(--track)', flex: 'none' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></div>
                </>) : <div style={{ ...kicker, fontSize: 9.5, color: 'var(--ink3)' }}>{w.type}</div>}
              </div>
              <WidgetBody w={w} maps={maps} color={colorOf(id)} dist={distOf(id)} onDist={(d) => setDist(id, d)} />
              {editing && colorPop === id && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', zIndex: 20, top: 52, right: 14, width: 194, borderRadius: 16, background: 'var(--glass-strong)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, animation: 'popIn .15s ease' }}>
                  <div style={{ ...kicker, fontSize: 10, marginBottom: 8 }}>Farbe</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <div onClick={() => { setColor(id, null); setColorPop(null) }} title="Standard (Akzent)" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', cursor: 'pointer', display: 'grid', placeItems: 'center', boxShadow: layout.colors[id] == null ? '0 0 0 2px var(--card), 0 0 0 4px var(--accent)' : 'none' }}>{layout.colors[id] == null && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>✓</span>}</div>
                    {WIDGET_STD_COLORS.map((c) => <div key={c} onClick={() => { setColor(id, c); setColorPop(null) }} style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer', boxShadow: layout.colors[id] === c ? '0 0 0 2px var(--card), 0 0 0 4px ' + c : 'none' }} />)}
                  </div>
                  <div style={{ ...kicker, fontSize: 10, marginBottom: 8 }}>Palette</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                    {WIDGET_PALETTE.map((c) => <div key={c} onClick={() => { setColor(id, c); setColorPop(null) }} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', boxShadow: layout.colors[id] === c ? '0 0 0 2px var(--card), 0 0 0 3px ' + c : 'none' }} />)}
                  </div>
                </div>
              )}
            </div>
          ) })}
        </div>
      )}

      {catalogOpen && (
        <div onClick={() => setCatalogOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div onClick={(e) => e.stopPropagation()} className="no-scrollbar" style={{ width: 560, maxWidth: '100%', maxHeight: '84vh', overflowY: 'auto', borderRadius: 26, background: 'var(--glass-strong)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', animation: 'popIn .2s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 24px 14px', borderBottom: '1px solid var(--hair)' }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>Widget-Katalog</div>
              <div onClick={() => setCatalogOpen(false)} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--track)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></div>
            </div>
            <div style={{ padding: '10px 16px 20px' }}>
              {(['A', 'B'] as const).map((grp) => (
                <div key={grp} style={{ marginTop: 8 }}>
                  <div style={{ ...kicker, fontSize: 10.5, padding: '10px 8px 8px' }}>Gruppe {grp === 'A' ? 'A · Körperdaten' : 'B · Scores'}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {WIDGETS.filter((w) => w.group === grp).map((w) => { const active = layout.visible.includes(w.id); return (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 12px', borderRadius: 12, background: 'var(--track)' }}>
                        <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 15, background: 'var(--card)' }}>{w.icon}</div>
                        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)' }}>{w.name}</div><div style={{ ...kicker, fontSize: 9.5, marginTop: 1 }}>{w.type}</div></div>
                        <div onClick={() => (active ? remove(w.id) : add(w.id))} style={{ padding: '7px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', background: active ? 'var(--track)' : 'color-mix(in srgb, var(--accent) 14%, transparent)', color: active ? 'var(--ink3)' : 'var(--accent)', border: active ? '1px solid var(--hair)' : '1px solid color-mix(in srgb, var(--accent) 32%, transparent)' }}>{active ? '✓ Aktiv' : '+ Aktivieren'}</div>
                      </div>
                    ) })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {zoomW && <ZoomModal w={zoomW} maps={maps} intraday={intradayMap} color={colorOf(zoomW.id)} dist={distOf(zoomW.id)} onDist={(d) => setDist(zoomW.id, d)} age={age} sex={sex} onClose={() => setZoom(null)} />}
    </div>
  )
}
