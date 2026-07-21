import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { api, type AppSettings, type Employer, type GarminDaily, type GarminSleep, type PlannedBlock, type PlannedOverride, type Project, type Workout } from '../api'
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
const parseTs = (ts: string) => new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'))
function fmtDur(min: number) { if (min < 60) return `${Math.round(min)} min`; return `${Math.floor(min / 60)}h ${pad(Math.round(min % 60))}` }
function kmStr(m: number | null) { return m ? (m / 1000).toFixed(1).replace('.', ',') + ' km' : '–' }
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
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
  const [daily, setDaily] = useState<GarminDaily | null>(null)
  const [sleep, setSleep] = useState<GarminSleep | null>(null)
  const [planned, setPlanned] = useState<PlannedBlock[]>([])
  const [overrides, setOverrides] = useState<PlannedOverride[]>([])
  const [deepId, setDeepId] = useState<number | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('alle')
  const [areaFilter, setAreaFilter] = useState<number | 'all'>('all')
  const [rangeFilter, setRangeFilter] = useState<'week' | 'month' | 'all'>('all')

  const todayKey = dayKey(new Date())
  function loadAll() {
    api.getEmployers().then(setEmployers).catch(() => {})
    api.getProjects().then(setProjects).catch(() => {})
    api.getGarminWorkouts().then(setWorkouts).catch(() => {})
    api.getPlanned().then(setPlanned).catch(() => {})
    api.getOverrides().then(setOverrides).catch(() => {})
    api.getGarminDaily(todayKey, todayKey).then((r) => setDaily(r[0] ?? null)).catch(() => {})
    api.getGarminSleep(todayKey, todayKey).then((r) => setSleep(r[0] ?? null)).catch(() => {})
  }
  useEffect(loadAll, [todayKey])

  const empById = useMemo(() => new Map(employers.map((e) => [e.id, e])), [employers])
  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const sportIds = useMemo(() => new Set(employers.filter((e) => e.is_sport === 1).map((e) => e.id)), [employers])
  const colorOf = (id: number) => empById.get(id)?.color ?? employerColor(id)

  // Ein Workout „vermenschlichen".
  function view(w: Workout) {
    const emp = empById.get(w.employer_id)
    const emoji = (w.type && TYPE_EMOJI[w.type]) || emp?.icon || '🏅'
    const typeName = (w.type && (TYPE_LABEL[w.type] || w.type)) || emp?.name || 'Workout'
    const name = w.name || w.note || typeName
    const project = w.project_id != null ? projById.get(w.project_id)?.name ?? emp?.name ?? '' : emp?.name ?? ''
    const durMin = w.duration_min ?? (w.end_ts ? (parseTs(w.end_ts).getTime() - parseTs(w.start_ts).getTime()) / 60000 : 0)
    return { emoji, typeName, name, project, durMin, color: colorOf(w.employer_id) }
  }

  // ---- aktuelle Woche (Mo–So), Heute markiert ----
  const monday = useMemo(() => { const t = startOfDay(new Date()); return addDays(t, -((t.getDay() + 6) % 7)) }, [])
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday])
  const weekWorkouts = useMemo(() => workouts.filter((w) => { const k = dayKey(parseTs(w.start_ts)); return k >= dayKey(weekDates[0]) && k <= dayKey(weekDates[6]) }), [workouts, weekDates])
  const weekPlanned = useMemo(() => weekDates.flatMap((d) => resolvePlanned(planned, overrides, d, settings.bundesland).filter((b) => sportIds.has(b.employer_id)).map((b) => ({ ...b, date: d }))), [planned, overrides, weekDates, settings.bundesland, sportIds])

  // ---- Deep-Dive öffnen (nur bei verknüpfter Aktivität) ----
  const openWorkout = (w: Workout) => { if (w.activity_id != null) setDeepId(w.activity_id); else onOpenDay(startOfDay(parseTs(w.start_ts))) }

  const seg1: CSSProperties = { padding: '9px 18px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 800, letterSpacing: '-0.2px', whiteSpace: 'nowrap', transition: 'background .18s ease, color .18s ease' }
  const segStyle = (on: boolean): CSSProperties => ({ ...seg1, background: on ? 'var(--seg-active, #fff)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink3)', boxShadow: on ? '0 4px 12px -4px rgba(17,24,39,0.28)' : 'none' })

  const viewTitle = { heute: 'Heute', workouts: 'Workouts', schlaf: 'Schlaf & Erholung', trends: 'Trends' }[seg]

  return (
    <div data-theme={theme} style={{ minHeight: '100vh', boxSizing: 'border-box', background: 'var(--screen)', color: 'var(--ink)', padding: '26px 40px 60px', zoom: 0.9 }}>
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

        {seg === 'heute' && <Heute daily={daily} sleep={sleep} workouts={workouts} weekWorkouts={weekWorkouts} weekPlanned={weekPlanned} weekDates={weekDates} todayKey={todayKey} view={view} colorOf={colorOf} openWorkout={openWorkout} onOpenDay={onOpenDay} />}
        {seg === 'workouts' && <Workouts workouts={workouts} employers={employers} view={view} colorOf={colorOf} openWorkout={openWorkout} typeFilter={typeFilter} setTypeFilter={setTypeFilter} areaFilter={areaFilter} setAreaFilter={setAreaFilter} rangeFilter={rangeFilter} setRangeFilter={setRangeFilter} monday={monday} />}
        {(seg === 'schlaf' || seg === 'trends') && (
          <div style={{ ...CARD, borderRadius: 24, padding: '60px 26px', textAlign: 'center', color: 'var(--ink3)', fontWeight: 700 }}>
            {seg === 'schlaf' ? 'Schlaf & Erholung' : 'Trends'} — kommt in {seg === 'schlaf' ? 'WP4c' : 'WP4d'}.
          </div>
        )}
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

function Heute({ daily, sleep, workouts, weekWorkouts, weekPlanned, weekDates, todayKey, view, colorOf, openWorkout, onOpenDay }: any) {
  const kpis: ReactNode[] = []
  if (daily?.bb_high != null) kpis.push(<KpiCard key="bb" kickerText="Body Battery" emoji="🔋" tint={hexA('#22C55E', 0.15)} val={String(daily.bb_high)} unit="/ 100" color="#22C55E" barW={daily.bb_high} sub={daily.bb_low != null ? `Tief ${daily.bb_low} · Hoch ${daily.bb_high}` : 'Ladezustand'} />)
  if (daily?.stress_avg != null) kpis.push(<KpiCard key="st" kickerText="Stress" emoji="🌀" tint={hexA('#F59E0B', 0.15)} val={String(daily.stress_avg)} unit="/ 100" color="#F59E0B" barW={daily.stress_avg} sub={daily.stress_avg < 30 ? 'Niedrig' : daily.stress_avg < 60 ? 'Moderat' : 'Erhöht'} />)
  if (sleep?.score != null) kpis.push(<KpiCard key="sl" kickerText="Schlaf-Score" emoji="😴" tint={hexA('#7C5CFF', 0.15)} val={String(sleep.score)} unit="/ 100" color="#7C5CFF" barW={sleep.score} sub={sleep.total_sec ? `${fmtDur(sleep.total_sec / 60)} · ${sleep.score_qualifier ?? ''}` : (sleep.score_qualifier ?? '')} />)
  if (daily?.steps != null) { const goal = daily.step_goal || 10000; kpis.push(<KpiCard key="sp" kickerText="Schritte" emoji="👣" tint={hexA('#2563EB', 0.15)} val={daily.steps.toLocaleString('de-DE')} unit="" color="#2563EB" barW={(daily.steps / goal) * 100} sub={`Ziel ${goal.toLocaleString('de-DE')} · ${Math.round((daily.steps / goal) * 100)} %`} />) }

  const last: Workout | undefined = workouts[0]
  const lv = last ? view(last) : null
  const r = reco(daily, workouts)

  return (
    <div>
      {kpis.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(kpis.length, 4)}, 1fr)`, gap: 18 }}>{kpis}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 18, marginTop: kpis.length > 0 ? 18 : 0 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 12, background: 'var(--track)' }}>
              <div style={{ width: 9, height: 9, borderRadius: '50%', background: r.dot }} />
              <div style={{ fontSize: 13, fontWeight: 800 }}>Bereitschaft: {r.readiness}</div>
            </div>
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
            const isToday = k === todayKey
            const dayWo = weekWorkouts.filter((w: Workout) => dayKey(parseTs(w.start_ts)) === k)
            const dayPl = weekPlanned.filter((b: any) => dayKey(b.date) === k)
            const rest = dayWo.length === 0 && dayPl.length === 0
            return (
              <div key={k} onClick={() => onOpenDay(startOfDay(d))} title="Zu diesem Tag in Mein Tag" style={{ borderRadius: 16, background: isToday ? 'color-mix(in srgb, var(--accent) 9%, var(--track))' : 'var(--track)', border: isToday ? '1.5px solid color-mix(in srgb, var(--accent) 45%, transparent)' : '1px solid var(--hair)', padding: '12px 10px', minHeight: 118, display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: isToday ? 'var(--accent)' : 'var(--ink2)' }}>{WD[d.getDay()]}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{d.getDate()}.</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 11 }}>
                  {dayWo.map((w: Workout) => { const v = view(w); return (
                    <div key={w.entry_id} title={v.name} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', borderRadius: 10, background: hexA(v.color, 0.2), border: `1px solid ${hexA(v.color, 0.35)}` }}>
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

function Workouts({ workouts, employers, view, colorOf, openWorkout, typeFilter, setTypeFilter, areaFilter, setAreaFilter, rangeFilter, setRangeFilter, monday }: any) {
  const sportEmps: Employer[] = employers.filter((e: Employer) => e.is_sport === 1)
  // Typ-Segmente aus den vorkommenden Typen ableiten (Alle + häufigste).
  const typeSegs = useMemo(() => {
    const counts = new Map<string, number>()
    for (const w of workouts as Workout[]) { const key = w.type ? (TYPE_LABEL[w.type] ? w.type : 'sonstige') : 'sonstige'; counts.set(key, (counts.get(key) ?? 0) + 1) }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
    return ['alle', ...top]
  }, [workouts])

  const filtered = useMemo(() => (workouts as Workout[]).filter((w) => {
    if (areaFilter !== 'all' && w.employer_id !== areaFilter) return false
    if (typeFilter !== 'alle') { const key = w.type ? (TYPE_LABEL[w.type] ? w.type : 'sonstige') : 'sonstige'; if (key !== typeFilter) return false }
    if (rangeFilter !== 'all') { const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30); const cut = rangeFilter === 'week' ? dayKey(monday) : dayKey(monthAgo); if (dayKey(parseTs(w.start_ts)) < cut) return false }
    return true
  }), [workouts, areaFilter, typeFilter, rangeFilter, monday])

  // Zeit-Kopplung (aus gefilterten Workouts)
  const areaTime = useMemo(() => {
    const m = new Map<number, number>()
    for (const w of filtered) m.set(w.employer_id, (m.get(w.employer_id) ?? 0) + (w.duration_min ?? 0))
    const max = Math.max(1, ...m.values())
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, min]) => ({ id, name: employers.find((e: Employer) => e.id === id)?.name ?? '—', color: colorOf(id), min, w: `${(min / max) * 100}%` }))
  }, [filtered, employers, colorOf])
  const loadWeek = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    const per = days.map((d) => filtered.filter((w) => dayKey(parseTs(w.start_ts)) === dayKey(d)).reduce((s, w) => s + (w.training_load ?? (w.duration_min ?? 0)), 0))
    const max = Math.max(1, ...per)
    return days.map((d, i) => ({ wd: WD[d.getDay()], v: per[i], h: `${Math.max(4, (per[i] / max) * 100)}%`, color: per[i] > 0 ? colorOf(filtered.find((w) => dayKey(parseTs(w.start_ts)) === dayKey(d))?.employer_id ?? 0) : 'var(--track)' }))
  }, [filtered, monday, colorOf])

  const filterBtn: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 15px', borderRadius: 12, ...GLASS, fontSize: 13, fontWeight: 800, color: 'var(--ink2)', cursor: 'pointer' }
  const cols = '2.4fr 0.9fr 0.9fr 0.9fr 0.9fr 0.8fr'

  return (
    <div>
      {/* Filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
          {typeSegs.map((t: string) => (
            <div key={t} onClick={() => setTypeFilter(t)} style={{ padding: '7px 15px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 800, background: typeFilter === t ? 'var(--seg-active, #fff)' : 'transparent', color: typeFilter === t ? 'var(--ink)' : 'var(--ink3)', boxShadow: typeFilter === t ? '0 4px 12px -4px rgba(17,24,39,0.28)' : 'none' }}>{t === 'alle' ? 'Alle' : (TYPE_LABEL[t] ?? 'Sonstige')}</div>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <select value={String(areaFilter)} onChange={(e) => setAreaFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ ...filterBtn, appearance: 'none', paddingRight: 28 }}>
          <option value="all">Bereich: Alle</option>
          {sportEmps.map((e: Employer) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={rangeFilter} onChange={(e) => setRangeFilter(e.target.value as 'week' | 'month' | 'all')} style={{ ...filterBtn, appearance: 'none', paddingRight: 28 }}>
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
            <div key={w.entry_id} onClick={() => openWorkout(w)} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', padding: '15px 24px', borderBottom: '1px solid var(--hair)', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div style={{ width: 42, height: 42, borderRadius: 13, display: 'grid', placeItems: 'center', fontSize: 20, background: hexA(v.color, 0.16), flex: 'none' }}>{v.emoji}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 800, letterSpacing: '-0.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.name}</div>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 18, marginTop: 18 }}>
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
