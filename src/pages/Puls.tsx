import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { api, type AppSettings, type Employer, type GarminDaily, type GarminScores, type GarminSleep, type PlannedBlock, type PlannedOverride, type Project, type Workout } from '../api'
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
const parseTs = (ts: string) => new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'))
function fmtDur(min: number) { if (min < 60) return `${Math.round(min)} min`; return `${Math.floor(min / 60)}h ${pad(Math.round(min % 60))}` }
function kmStr(m: number | null) { return m ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : '–' }
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
  const hMonday = useMemo(() => addDays(startOfDay(hDay), -((hDay.getDay() + 6) % 7)), [hKey])
  const hWeekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(hMonday, i)), [hMonday])
  const hWeekWorkouts = useMemo(() => workouts.filter((w) => { const k = dayKey(parseTs(w.start_ts)); return k >= dayKey(hWeekDates[0]) && k <= dayKey(hWeekDates[6]) }), [workouts, hWeekDates])
  const hWeekPlanned = useMemo(() => hWeekDates.flatMap((d) => resolvePlanned(planned, overrides, d, settings.bundesland).filter((b) => sportIds.has(b.employer_id)).map((b) => ({ ...b, date: d }))), [planned, overrides, hWeekDates, settings.bundesland, sportIds])
  const hLastWorkout = useMemo(() => (workouts as Workout[]).find((w) => dayKey(parseTs(w.start_ts)) <= hKey), [workouts, hKey])
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

        {seg === 'heute' && <Heute daily={hDaily} sleep={hSleep} scores={hScores} lastWorkout={hLastWorkout} workouts={workouts} weekWorkouts={hWeekWorkouts} weekPlanned={hWeekPlanned} weekDates={hWeekDates} selKey={hKey} realTodayKey={todayKey} hDay={hDay} canForward={canForward} showLatest={dayKey(hDay) < dayKey(latestDay)} onPrev={() => setHeuteDay(addDays(hDay, -1))} onNext={() => { if (canForward) setHeuteDay(addDays(hDay, 1)) }} onLatest={() => setHeuteDay(null)} onOpenDaySel={(d: Date) => { if (dayKey(d) <= dayKey(latestDay)) setHeuteDay(startOfDay(d)) }} view={view} colorOf={colorOf} openWorkout={openWorkout} />}
        {seg === 'workouts' && <Workouts workouts={workouts} employers={employers} view={view} colorOf={colorOf} openWorkout={openWorkout} areaFilter={areaFilter} setAreaFilter={setAreaFilter} rangeFilter={rangeFilter} setRangeFilter={setRangeFilter} monday={monday} />}
        {seg === 'schlaf' && <Schlaf sleepRange={sleepRange} scoresRange={scoresRange} />}
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
function Heute({ daily, sleep, scores, lastWorkout, workouts, weekWorkouts, weekPlanned, weekDates, selKey, realTodayKey, hDay, canForward, showLatest, onPrev, onNext, onLatest, onOpenDaySel, view, colorOf, openWorkout }: any) {
  const dLabel = selKey === realTodayKey ? 'Heute' : `${WD[hDay.getDay()]}, ${hDay.getDate()}. ${MONTHS_SHORT[hDay.getMonth()]}`
  const dayNav = (on: boolean): CSSProperties => ({ width: 36, height: 36, borderRadius: 11, ...GLASS, display: 'grid', placeItems: 'center', cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.35, fontSize: 18, fontWeight: 700, color: 'var(--ink2)' })
  const kpis: ReactNode[] = []
  if (daily?.bb_high != null) kpis.push(<KpiCard key="bb" kickerText="Body Battery" emoji="🔋" tint={hexA('#22C55E', 0.15)} val={String(daily.bb_high)} unit="/ 100" color="#22C55E" barW={daily.bb_high} sub={daily.bb_low != null ? `Tief ${daily.bb_low} · Hoch ${daily.bb_high}` : 'Ladezustand'} />)
  if (daily?.stress_avg != null) kpis.push(<KpiCard key="st" kickerText="Stress" emoji="🌀" tint={hexA('#F59E0B', 0.15)} val={String(daily.stress_avg)} unit="/ 100" color="#F59E0B" barW={daily.stress_avg} sub={daily.stress_avg < 30 ? 'Niedrig' : daily.stress_avg < 60 ? 'Moderat' : 'Erhöht'} />)
  if (sleep?.score != null) kpis.push(<KpiCard key="sl" kickerText="Schlaf-Score" emoji="😴" tint={hexA('#7C5CFF', 0.15)} val={String(sleep.score)} unit="/ 100" color="#7C5CFF" barW={sleep.score} sub={sleep.total_sec ? `${fmtDur(sleep.total_sec / 60)} · ${sleep.score_qualifier ?? ''}` : (sleep.score_qualifier ?? '')} />)
  if (daily?.steps != null) { const goal = daily.step_goal || 10000; kpis.push(<KpiCard key="sp" kickerText="Schritte" emoji="👣" tint={hexA('#2563EB', 0.15)} val={daily.steps.toLocaleString('de-DE')} unit="" color="#2563EB" barW={(daily.steps / goal) * 100} sub={`Ziel ${goal.toLocaleString('de-DE')} · ${Math.round((daily.steps / goal) * 100)} %`} />) }

  const last: Workout | undefined = lastWorkout
  const lv = last ? view(last) : null
  const r = reco(daily, workouts)

  return (
    <div>
      {/* Tages-Navigation — wirkt auf alle Heute-Elemente */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <div onClick={onPrev} title="Vorheriger Tag" style={dayNav(true)}>‹</div>
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.3px', minWidth: 128, textAlign: 'center' }}>{dLabel}</div>
        <div onClick={canForward ? onNext : undefined} title={canForward ? 'Nächster Tag' : 'Kein neuerer Datentag'} style={dayNav(canForward)}>›</div>
        {showLatest && <div onClick={onLatest} title="Zum neuesten Tag" style={{ marginLeft: 4, padding: '8px 14px', borderRadius: 12, ...GLASS, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, color: 'var(--ink2)' }}>Neuester ⏭</div>}
      </div>

      {kpis.length === 0 && <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px', color: 'var(--ink3)', fontWeight: 700 }}>Keine Tagesdaten für {dLabel}.</div>}
      {kpis.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 18 }}>{kpis}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginTop: kpis.length > 0 ? 18 : 0 }}>
        {/* letztes Workout */}
        {last && lv && (
          <div onClick={() => openWorkout(last)} style={{ ...CARD, borderRadius: 26, padding: '24px 26px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={kicker}>Letztes Workout</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 5 }}>Deep-Dive
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 }}>
              <div style={{ width: 56, height: 56, borderRadius: 17, display: 'grid', placeItems: 'center', fontSize: 27, background: hexA(lv.color, 0.16) }}>{lv.emoji}</div>
              <div>
                <div style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.5px' }}>{lv.name}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink2)', marginTop: 2 }}>{parseTs(last.start_ts).getDate()}. {MONTHS_SHORT[parseTs(last.start_ts).getMonth()]} · {lv.project}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 30, marginTop: 22 }}>
              {[['Dauer', fmtDur(lv.durMin)], ['Distanz', kmStr(last.distance_m)], ['Ø-HF', last.avg_hr ? `${Math.round(last.avg_hr)}` : '–']].map(([k, v]) => (
                <div key={k}><div style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>{v}</div><div style={{ ...kicker, fontSize: 11, marginTop: 3 }}>{k}</div></div>
              ))}
            </div>
          </div>
        )}

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
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
function loadColor(v: number) { return v < 45 ? '#22C55E' : v < 72 ? '#F59E0B' : '#EF4444' }

function Workouts({ workouts, employers, view, colorOf, openWorkout, areaFilter, setAreaFilter, rangeFilter, setRangeFilter, monday }: any) {
  const sportEmps: Employer[] = employers.filter((e: Employer) => e.is_sport === 1)
  // Toggle = definierte Sport-Bereiche aus Mein Tag + eigener Tab für unzugeordnete Historie.
  const segs: { val: 'all' | number | 'history'; label: string }[] = [
    { val: 'all', label: 'Alle' },
    ...sportEmps.map((e: Employer) => ({ val: e.id as number, label: e.name })),
    { val: 'history', label: 'Historie (Keine Zuordnung)' },
  ]

  const filtered = useMemo(() => (workouts as Workout[]).filter((w) => {
    if (areaFilter === 'history') { if (w.origin !== 'history') return false }
    else if (areaFilter !== 'all') { if (w.employer_id !== areaFilter) return false }
    if (rangeFilter !== 'all') { const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30); const cut = rangeFilter === 'week' ? dayKey(monday) : dayKey(monthAgo); if (dayKey(parseTs(w.start_ts)) < cut) return false }
    return true
  }), [workouts, areaFilter, rangeFilter, monday])

  // Zeit-Kopplung: NUR zugeordnete time_entries (origin='entry'). Historie zählt hier NIE mit.
  const areaTime = useMemo(() => {
    const m = new Map<number, number>()
    for (const w of filtered) { if (w.origin !== 'entry' || w.employer_id == null) continue; m.set(w.employer_id, (m.get(w.employer_id) ?? 0) + (w.duration_min ?? 0)) }
    const max = Math.max(1, ...m.values())
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, name: employers.find((e: Employer) => e.id === id)?.name ?? '—', color: colorOf(id), min, w: `${(min / max) * 100}%` }))
  }, [filtered, employers, colorOf])
  const loadWeek = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    const per = days.map((d) => filtered.filter((w) => dayKey(parseTs(w.start_ts)) === dayKey(d)).reduce((s, w) => s + (w.training_load ?? (w.duration_min ?? 0)), 0))
    const max = Math.max(1, ...per)
    return days.map((d, i) => ({ wd: WD[d.getDay()], v: per[i], h: `${Math.max(4, (per[i] / max) * 100)}%`, color: per[i] > 0 ? colorOf(filtered.find((w) => dayKey(parseTs(w.start_ts)) === dayKey(d))?.employer_id ?? 0) : 'var(--track)' }))
  }, [filtered, monday, colorOf])

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

      {/* Zeit-Kopplung */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18, marginTop: 18 }}>
        <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px' }}>
          <div style={kicker}>Trainingszeit pro Bereich</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
            {areaTime.length === 0 && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink3)' }}>Keine Daten.</div>}
            {areaTime.map((a: any) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 72, display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 9, height: 9, borderRadius: '50%', background: a.color }} /><div style={{ fontSize: 13, fontWeight: 800 }}>{a.name}</div></div>
                <div style={{ flex: 1, height: 12, borderRadius: 99, background: 'var(--track)', overflow: 'hidden' }}><div style={{ height: '100%', width: a.w, background: a.color, borderRadius: 99 }} /></div>
                <div style={{ width: 56, textAlign: 'right', fontSize: 13.5, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(a.min)}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ ...CARD, borderRadius: 24, padding: '22px 24px' }}>
          <div style={kicker}>Wochenlast-Verlauf</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 130, marginTop: 18 }}>
            {loadWeek.map((d: any, i: number) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', maxWidth: 42, height: d.h, background: d.color, borderRadius: '9px 9px 5px 5px' }} />
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink2)' }}>{d.wd}</div>
              </div>
            ))}
          </div>
        </div>
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

function Schlaf({ sleepRange, scoresRange }: { sleepRange: GarminSleep[]; scoresRange: GarminScores[] }) {
  const nights = useMemo(() => sleepRange.filter((s) => s.total_sec != null || s.score != null), [sleepRange]) // Lücken raus
  const [selDate, setSelDate] = useState<string | null>(null)
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const scoresByDate = useMemo(() => new Map(scoresRange.map((s) => [s.calendar_date, s])), [scoresRange])
  if (nights.length === 0) return <div style={{ ...CARD, borderRadius: 24, padding: '48px 26px', textAlign: 'center', color: 'var(--ink3)', fontWeight: 700 }}>Noch keine Schlafdaten.</div>

  const sel = nights.find((n) => n.calendar_date === selDate) ?? nights[0]
  const curves = sel.curves && typeof sel.curves === 'object' ? sel.curves : null
  const levels = curves?.levels ?? []
  const totalLevels = levels.reduce((a, s) => a + segSec(s), 0) || 1
  const readiness = scoresByDate.get(sel.calendar_date)
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
  if (readiness?.training_readiness_score != null) kpis.push(['Readiness', String(readiness.training_readiness_score), readiness.tr_level ?? ''])

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
      {/* Nacht-Auswahl */}
      <div className="no-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        {nights.slice(0, 14).map((n) => {
          const on = n.calendar_date === sel.calendar_date
          const d = new Date(`${n.calendar_date}T00:00:00`)
          return (
            <div key={n.calendar_date} onClick={() => setSelDate(n.calendar_date)} style={{ flex: 'none', minWidth: 70, textAlign: 'center', padding: '10px 12px', borderRadius: 14, cursor: 'pointer', background: on ? 'color-mix(in srgb, var(--accent) 12%, var(--track))' : 'var(--track)', border: on ? '1.5px solid color-mix(in srgb, var(--accent) 45%, transparent)' : '1px solid var(--hair)' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: on ? 'var(--accent)' : 'var(--ink2)' }}>{WD[d.getDay()]} {d.getDate()}.</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{n.score ?? '–'}</div>
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
              const vals = (arr as { t: number; v: number }[]).map((p) => p.v)
              return (
                <div key={label} style={{ background: 'var(--track)', borderRadius: 14, padding: '12px 14px' }}>
                  <div style={{ ...kicker, fontSize: 10.5, marginBottom: 8 }}>{label} · Nacht</div>
                  <svg width="100%" height="40" viewBox="0 0 200 40" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                    <path d={sparkPath(vals, 200, 40, 4)} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
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
            const series = chrono.map(t.get).filter((v): v is number => v != null)
            if (series.length === 0) return <div key={t.label} style={{ background: 'var(--track)', borderRadius: 18, padding: '16px 18px', color: 'var(--ink3)', fontWeight: 700, fontSize: 12.5 }}>{t.label} · keine Daten</div>
            const avg = Math.round(series.reduce((a, b) => a + b, 0) / series.length)
            const delta = Math.round(series[series.length - 1] - series[0])
            const good = t.up === 'good' ? delta >= 0 : delta <= 0
            return (
              <div key={t.label} style={{ background: 'var(--track)', borderRadius: 18, padding: '16px 18px' }}>
                <div style={{ ...kicker, fontSize: 10.5 }}>{t.label}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 10 }}>
                  <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{avg}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{t.unit || 'Ø'}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
                  <svg width="120" height="30" viewBox="0 0 120 30" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                    <path d={sparkPath(series, 120, 30, 3)} fill="none" stroke={t.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
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
type Src = 'daily' | 'sleep' | 'scores'
interface WidgetDef {
  id: string; name: string; icon: string; type: WType; group: 'A' | 'B'; defaultVisible: boolean
  src: Src
  get: (r: Record<string, unknown>) => number | null
  unit?: string; decimals?: number; goodDir?: 'up' | 'down'
  gaugeMax?: number
  target?: (r: Record<string, unknown>) => number | null
  fmt?: (v: number) => string
  special?: 'vo2max' | 'load' | 'race' | 'status'
}
const numN = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const fmtMMSS = (sec: number) => `${Math.floor(sec / 60)}:${pad(Math.round(sec % 60))}`

const WIDGETS: WidgetDef[] = [
  // Gruppe A — garmin_daily / garmin_sleep
  { id: 'resting_hr', name: 'Ruhepuls', icon: '❤️', type: 'sparkline', group: 'A', defaultVisible: true, src: 'daily', get: (r) => numN(r.resting_hr), unit: 'bpm', goodDir: 'down' },
  { id: 'hrv', name: 'HRV', icon: '💓', type: 'sparkline', group: 'A', defaultVisible: true, src: 'sleep', get: (r) => numN(r.hrv_overnight_avg), unit: 'ms', goodDir: 'up' },
  { id: 'stress', name: 'Stress', icon: '🌀', type: 'tagesverlauf', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.stress_avg), goodDir: 'down' },
  { id: 'body_battery', name: 'Body Battery', icon: '🔋', type: 'tagesverlauf', group: 'A', defaultVisible: true, src: 'daily', get: (r) => numN(r.bb_high), goodDir: 'up' },
  { id: 'steps', name: 'Schritte', icon: '👣', type: 'kennzahl-ziel', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.steps), target: (r) => numN(r.step_goal), goodDir: 'up' },
  { id: 'sleep_score', name: 'Schlaf-Score', icon: '😴', type: 'sparkline', group: 'A', defaultVisible: true, src: 'sleep', get: (r) => numN(r.score), goodDir: 'up' },
  { id: 'spo2', name: 'SpO₂', icon: '🫁', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.spo2_avg), unit: '%', goodDir: 'up' },
  { id: 'respiration', name: 'Atmung', icon: '🌬️', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.respiration_waking_avg), unit: '/min', goodDir: 'down' },
  { id: 'intensity', name: 'Intensitätsminuten', icon: '⚡', type: 'kennzahl-ziel', group: 'A', defaultVisible: false, src: 'daily', get: (r) => (numN(r.intensity_moderate_min) ?? 0) + (numN(r.intensity_vigorous_min) ?? 0), target: () => 150, goodDir: 'up' },
  { id: 'calories', name: 'Aktive Kalorien', icon: '🔥', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.calories_active), unit: 'kcal', goodDir: 'up' },
  { id: 'floors', name: 'Etagen', icon: '🪜', type: 'sparkline', group: 'A', defaultVisible: false, src: 'daily', get: (r) => numN(r.floors_ascended), goodDir: 'up' },
  // Gruppe B — garmin_scores
  { id: 'readiness', name: 'Training Readiness', icon: '✅', type: 'score-gauge', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.training_readiness_score), gaugeMax: 100, goodDir: 'up' },
  { id: 'vo2max', name: 'VO2max', icon: '📈', type: 'sparkline', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.vo2max), goodDir: 'up', special: 'vo2max' },
  { id: 'endurance', name: 'Endurance Score', icon: '🏅', type: 'sparkline', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.endurance_score), goodDir: 'up' },
  { id: 'hill', name: 'Hill Score', icon: '⛰️', type: 'sparkline', group: 'B', defaultVisible: false, src: 'scores', get: (r) => numN(r.hill_score), goodDir: 'up' },
  { id: 'fitness_age', name: 'Fitness Age', icon: '🎂', type: 'kennzahl-ziel', group: 'B', defaultVisible: true, src: 'scores', get: (r) => numN(r.fitness_age), target: (r) => numN(r.fitness_age_chronological), goodDir: 'down', fmt: (v) => v.toFixed(1).replace('.', ',') },
  { id: 'race', name: 'Race Predictions', icon: '🏁', type: 'sparkline', group: 'B', defaultVisible: false, src: 'scores', get: (r) => numN(r.race_5k_sec), goodDir: 'down', fmt: fmtMMSS },
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

type Layout = { visible: string[]; hidden: string[] }
function defaultLayout(): Layout { return { visible: WIDGETS.filter((w) => w.defaultVisible).map((w) => w.id), hidden: WIDGETS.filter((w) => !w.defaultVisible).map((w) => w.id) } }
function reconcile(l: Layout): Layout {
  const known = new Set(WIDGETS.map((w) => w.id))
  const visible = (l.visible || []).filter((id) => known.has(id))
  const hidden = (l.hidden || []).filter((id) => known.has(id) && !visible.includes(id))
  const placed = new Set([...visible, ...hidden])
  for (const w of WIDGETS) if (!placed.has(w.id)) (w.defaultVisible ? visible : hidden).push(w.id)
  return { visible, hidden }
}

type Maps = Record<Src, Map<string, Record<string, unknown>>>
function buildSeries(w: WidgetDef, maps: Maps, days: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = days - 1; i >= 0; i--) {
    const r = maps[w.src].get(dayKey(addDays(new Date(), -i)))
    out.push(r ? w.get(r) : null)
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

function WidgetBody({ w, maps }: { w: WidgetDef; maps: Maps }) {
  const accent = 'var(--accent)'
  const vals = buildSeries(w, maps, 90)
  const st = statsOf(vals)
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
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 46, marginTop: 8 }}>
          {last.map((v, i) => <div key={i} style={{ flex: 1, height: v != null ? `${(v / mx) * 100}%` : 0, background: accent, borderRadius: '3px 3px 1px 1px', opacity: 0.85 }} />)}
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
      <svg width="100%" height="46" viewBox="0 0 200 46" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible', marginTop: 8 }}>
        <path d={linePathGapped(vals, 200, 46, 4)} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {dots.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2.6" fill={accent} />)}
      </svg>
      {w.special === 'vo2max' && <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)', marginTop: 4 }}>Punkte = gemessen · Linie fortgeschrieben</div>}
    </div>
  )
}

function ZoomModal({ w, maps, onClose }: { w: WidgetDef; maps: Maps; onClose: () => void }) {
  const [period, setPeriod] = useState<'week' | 'month' | 'year' | 'all'>('month')
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 365
  const vals = buildSeries(w, maps, days)
  const st = statsOf(vals)
  const dots = w.special === 'vo2max' ? changeDots(vals, 900, 260, 10) : []
  const bars = w.type === 'tagesverlauf'
  const mx = Math.max(1, ...vals.filter((v): v is number => v != null))
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', zIndex: 2, width: 960, maxWidth: '100%', borderRadius: 28, background: 'var(--glass-strong)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: '24px 28px', animation: 'popIn .2s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', fontSize: 20, background: 'var(--track)' }}>{w.icon}</div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px', flex: 1 }}>{w.name}</div>
          <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, background: 'var(--track)' }}>
            {(['week', 'month', 'year', 'all'] as const).map((p) => <div key={p} onClick={() => setPeriod(p)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', color: period === p ? 'var(--ink)' : 'var(--ink3)', background: period === p ? 'var(--seg-active, #fff)' : 'transparent' }}>{{ week: 'Woche', month: 'Monat', year: 'Jahr', all: 'Alles' }[p]}</div>)}
          </div>
          <div onClick={onClose} style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--track)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></div>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 18, padding: '18px 16px', marginTop: 20 }}>
          {st ? (
            bars ? (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 260 }}>{vals.map((v, i) => <div key={i} style={{ flex: 1, height: v != null ? `${(v / mx) * 100}%` : 0, background: 'var(--accent)', opacity: 0.85, borderRadius: '2px 2px 0 0' }} />)}</div>
            ) : (
              <svg width="100%" height="260" viewBox="0 0 900 260" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                <path d={linePathGapped(vals, 900, 260, 10)} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                {dots.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.4" fill="var(--accent)" />)}
              </svg>
            )
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
  const [daily, setDaily] = useState<Record<string, unknown>[]>([])
  const [sleepR, setSleepR] = useState<Record<string, unknown>[]>([])
  const [scores, setScores] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    api.getSettings().then((s) => {
      try { const p = JSON.parse(s.puls_trends_layout || 'null'); if (p && Array.isArray(p.visible)) { setLayout(reconcile(p)); return } } catch { /* Default */ }
      const def = defaultLayout(); setLayout(def); void api.updateSettings({ puls_trends_layout: JSON.stringify(def) })
    }).catch(() => setLayout(defaultLayout()))
    const from = dayKey(addDays(new Date(), -365)), to = dayKey(new Date())
    api.getGarminDaily(from, to).then((r) => setDaily(r as unknown as Record<string, unknown>[])).catch(() => {})
    api.getGarminSleep(from, to).then((r) => setSleepR(r as unknown as Record<string, unknown>[])).catch(() => {})
    api.getGarminScores(from, to).then((r) => setScores(r as unknown as Record<string, unknown>[])).catch(() => {})
  }, [])

  const maps = useMemo<Maps>(() => ({
    daily: new Map(daily.map((r) => [String(r.calendar_date), r])),
    sleep: new Map(sleepR.map((r) => [String(r.calendar_date), r])),
    scores: new Map(scores.map((r) => [String(r.calendar_date), r])),
  }), [daily, sleepR, scores])

  function persist(next: Layout) { setLayout(next); void api.updateSettings({ puls_trends_layout: JSON.stringify(next) }) }
  function remove(id: string) { if (!layout) return; persist({ visible: layout.visible.filter((x) => x !== id), hidden: [id, ...layout.hidden.filter((x) => x !== id)] }) }
  function add(id: string) { if (!layout) return; persist({ visible: [...layout.visible.filter((x) => x !== id), id], hidden: layout.hidden.filter((x) => x !== id) }) }
  function reorder(from: number, to: number) { if (!layout || from === to) return; const v = [...layout.visible]; const [m] = v.splice(from, 1); v.splice(to, 0, m); setLayout({ visible: v, hidden: layout.hidden }) }

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
            <div key={id} draggable={editing} onDragStart={() => setDragIdx(i)} onDragOver={(e) => { if (!editing || dragIdx === null) return; e.preventDefault(); if (dragIdx !== i) { reorder(dragIdx, i); setDragIdx(i) } }} onDragEnd={() => { setDragIdx(null); setLayout((cur) => { if (cur) void api.updateSettings({ puls_trends_layout: JSON.stringify(cur) }); return cur }) }} onClick={() => { if (!editing) setZoom(id) }} style={{ ...CARD, borderRadius: 22, padding: '18px 20px', opacity: dragIdx === i ? 0.5 : 1, cursor: editing ? 'grab' : 'pointer', outline: editing ? '1.5px dashed var(--hair)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <div style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 15, background: 'var(--track)' }}>{w.icon}</div>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</div>
                {editing ? (<>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--ink3)', flex: 'none' }}><circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" /></svg>
                  <div onClick={(e) => { e.stopPropagation(); remove(id) }} title="Entfernen" style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#E5484D', background: 'var(--track)', flex: 'none' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg></div>
                </>) : <div style={{ ...kicker, fontSize: 9.5, color: 'var(--ink3)' }}>{w.type}</div>}
              </div>
              <WidgetBody w={w} maps={maps} />
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

      {zoomW && <ZoomModal w={zoomW} maps={maps} onClose={() => setZoom(null)} />}
    </div>
  )
}
