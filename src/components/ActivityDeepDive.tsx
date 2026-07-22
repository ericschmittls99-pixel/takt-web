import { useEffect, useState, type CSSProperties } from 'react'
import { api, type Employer, type GarminActivityDetail, type Project } from '../api'
import { employerColor } from '../colors'

// Deep-Dive-Modal (WP3). Öffnet aus der PULS-Pill (Mein Tag/Kalender). Datenquelle:
// GET /api/garmin/activities/:id inkl. details-Payload. Alle Blöcke konditional.
// Bei source='manual' sind Kopf-KPIs + Bereich/Projekt editierbar (JSON-Kurven nicht).

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const TYPE_EMOJI: Record<string, string> = {
  running: '🏃', treadmill_running: '🏃', trail_running: '🏃', track_running: '🏃',
  strength_training: '🏋️', indoor_cardio: '🤸', hiit: '🔥',
  road_biking: '🚴', cycling: '🚴', indoor_cycling: '🚴', mountain_biking: '🚵', gravel_cycling: '🚴',
  lap_swimming: '🏊', open_water_swimming: '🏊', swimming: '🏊', yoga: '🧘', pilates: '🧘', walking: '🚶', hiking: '🥾',
}
const TYPE_LABEL: Record<string, string> = {
  running: 'Lauf', treadmill_running: 'Laufband', trail_running: 'Trailrun', track_running: 'Bahnlauf',
  strength_training: 'Krafttraining', indoor_cardio: 'Cardio', hiit: 'HIIT',
  road_biking: 'Radfahrt', cycling: 'Radfahrt', indoor_cycling: 'Indoor-Rad', mountain_biking: 'Mountainbike', gravel_cycling: 'Gravel',
  lap_swimming: 'Schwimmen', swimming: 'Schwimmen', yoga: 'Yoga', pilates: 'Pilates', walking: 'Gehen', hiking: 'Wandern',
}
const ZC = ['#94A3B8', '#2563EB', '#22C55E', '#F59E0B', '#EF4444']
const ZLAB = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']
const ZNAME = ['Aufwärmen', 'Fettverbr.', 'Aerob', 'Schwelle', 'Maximal']

const pad = (n: number) => String(n).padStart(2, '0')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
function km(m: number) { return (m / 1000).toFixed(1).replace('.', ',') }
function fmtDur(sec: number) { const m = Math.round(sec / 60); if (m < 60) return `${m} min`; return `${Math.floor(m / 60)}h ${pad(m % 60)}` }
function paceLbl(distM: number, durSec: number) { const s = durSec / (distM / 1000); return `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}` }
const nn = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
const avg = (vs: number[]) => vs.reduce((s, v) => s + v, 0) / vs.length
const paceStr = (secPerKm: number) => `${Math.floor(secPerKm / 60)}:${pad(Math.round(secPerKm % 60))}`
// Power-Zonen-Farben (z1..z7)
const PZC = ['#94A3B8', '#38BDF8', '#22C55E', '#EAB308', '#F97316', '#EF4444', '#A21CAF']
function humanize(s: unknown) { return String(s ?? '').toLowerCase().split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') }
function fmtKg(w: number) { return Number.isInteger(w) ? String(w) : w.toFixed(1).replace('.', ',') }
function fmtDate(ts: string | null) {
  if (!ts) return ''
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function geom(vals: number[], w: number, h: number, p: number) {
  const mn = Math.min(...vals), mx = Math.max(...vals), range = mx - mn || 1, sx = w / (vals.length - 1)
  return vals.map((v, i) => [i * sx, p + (h - 2 * p) - ((v - mn) / range) * (h - 2 * p)] as [number, number])
}
const lineD = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
const areaD = (pts: [number, number][], h: number) => `M${pts[0][0].toFixed(1)} ${h} ${pts.map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0].toFixed(1)} ${h} Z`
function hexA(hex: string, a: number) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return `color-mix(in srgb, ${hex} ${Math.round(a * 100)}%, transparent)`
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`
}

type Form = { duration_min: string; distance_km: string; calories: string; avg_hr: string; max_hr: string }
const GLASS_STRONG: CSSProperties = { background: 'var(--glass-strong)', backdropFilter: 'blur(30px) saturate(180%)', WebkitBackdropFilter: 'blur(30px) saturate(180%)' }
const kicker: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }

export default function ActivityDeepDive({ activityId, employers, projects, onClose, onChanged, onEditEntry }: {
  activityId: number
  employers: Employer[]
  projects: Project[]
  onClose: () => void
  onChanged: () => void
  onEditEntry?: (entryId: number) => void
}) {
  const [a, setA] = useState<GarminActivityDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>({ duration_min: '', distance_km: '', calories: '', avg_hr: '', max_hr: '' })
  const [saving, setSaving] = useState(false)
  const [editingEx, setEditingEx] = useState(false)
  const [savingEx, setSavingEx] = useState(false)
  const [exForm, setExForm] = useState<{ name: string; sets: string; reps: string; max_weight: string }[]>([])
  const [gm, setGm] = useState<string[]>(['hr'])  // aktive Verlaufs-Metriken (überlagerbar)

  function load() {
    setLoading(true)
    api.getGarminActivity(activityId).then((d) => { setA(d); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(load, [activityId])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const color = a ? (employers.find((e) => e.id === a.employer_id)?.color ?? (a.employer_id != null ? employerColor(a.employer_id) : '#8A9B2E')) : '#8A9B2E'
  const sportAreas = employers.filter((e) => e.is_sport === 1)

  function startEdit() {
    if (!a) return
    setForm({
      duration_min: a.duration_sec != null ? String(Math.round(a.duration_sec / 60)) : '',
      distance_km: a.distance_m != null ? String(a.distance_m / 1000) : '',
      calories: a.calories != null ? String(Math.round(a.calories)) : '',
      avg_hr: a.avg_hr != null ? String(Math.round(a.avg_hr)) : '',
      max_hr: a.max_hr != null ? String(Math.round(a.max_hr)) : '',
    })
    setEditing(true)
  }
  async function save() {
    setSaving(true)
    const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
    try {
      await api.editGarminActivity(activityId, {
        duration_sec: form.duration_min.trim() === '' ? null : Math.round(Number(form.duration_min.replace(',', '.')) * 60),
        distance_m: form.distance_km.trim() === '' ? null : Math.round(Number(form.distance_km.replace(',', '.')) * 1000),
        calories: toNum(form.calories),
        avg_hr: toNum(form.avg_hr),
        max_hr: toNum(form.max_hr),
      })
      setEditing(false)
      load()
      onChanged()
    } finally {
      setSaving(false)
    }
  }
  async function assign(employerId: number, projectId: number | null) {
    if (!a) return
    try {
      await api.patchGarminActivity(activityId, { action: 'assign', employer_id: employerId, project_id: projectId, note: a.note })
      load()
      onChanged()
    } catch { /* ignore */ }
  }

  function startEditEx() {
    const cur = (a?.details?.exercise_sets ?? []) as Record<string, unknown>[]
    const rows = cur.map((e) => {
      const w = num(e.maxWeight)
      return {
        name: typeof e.name === 'string' && e.name ? e.name : humanize(e.subCategory ?? e.category),
        sets: num(e.sets) != null ? String(num(e.sets)) : '',
        reps: num(e.reps) != null ? String(num(e.reps)) : '',
        max_weight: w != null && w > 0 ? String(w) : '',
      }
    })
    setExForm(rows.length ? rows : [{ name: '', sets: '', reps: '', max_weight: '' }])
    setEditingEx(true)
  }
  const setExRow = (i: number, key: 'name' | 'sets' | 'reps' | 'max_weight', val: string) =>
    setExForm((f) => f.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)))
  const addExRow = () => setExForm((f) => [...f, { name: '', sets: '', reps: '', max_weight: '' }])
  const removeExRow = (i: number) => setExForm((f) => f.filter((_, idx) => idx !== i))
  async function saveEx() {
    setSavingEx(true)
    const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
    const exercises = exForm.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), sets: toNum(r.sets), reps: toNum(r.reps), max_weight: toNum(r.max_weight) }))
    try {
      await api.editGarminExercises(activityId, exercises)
      setEditingEx(false)
      load()
      onChanged()
    } finally {
      setSavingEx(false)
    }
  }

  const details = a?.details ?? {}
  const type = a?.type ?? ''
  const isRun = /run/.test(type)
  const isBike = /(cycl|bik)/.test(type)

  // KPIs (konditional)
  const kpis: { k: string; v: string; u: string }[] = []
  if (a) {
    if (a.distance_m) kpis.push({ k: 'Distanz', v: km(a.distance_m), u: 'km' })
    if (a.distance_m && a.duration_sec && isRun) kpis.push({ k: 'Pace', v: paceLbl(a.distance_m, a.duration_sec), u: '/km' })
    else if (a.distance_m && a.duration_sec && isBike) kpis.push({ k: 'Ø-Tempo', v: ((a.distance_m / 1000) / (a.duration_sec / 3600)).toFixed(1).replace('.', ','), u: 'km/h' })
    if (a.duration_sec) kpis.push({ k: 'Dauer', v: fmtDur(a.duration_sec), u: '' })
    if (a.avg_hr) kpis.push({ k: 'Ø-HF', v: String(Math.round(a.avg_hr)), u: 'bpm' })
    if (a.max_hr) kpis.push({ k: 'Max-HF', v: String(Math.round(a.max_hr)), u: 'bpm' })
    if (a.calories) kpis.push({ k: 'Kalorien', v: Math.round(a.calories).toLocaleString('de-DE'), u: 'kcal' })
    if (a.elevation_gain_m) kpis.push({ k: 'Höhenmeter', v: String(Math.round(a.elevation_gain_m)), u: 'm' })
    if (a.training_load != null) kpis.push({ k: 'Load', v: String(Math.round(a.training_load)), u: '' })
    if (a.aerobic_te != null) kpis.push({ k: 'Aerober Effekt', v: a.aerobic_te.toFixed(1).replace('.', ','), u: '' })
    if (a.anaerobic_te != null) kpis.push({ k: 'Anaerober Effekt', v: a.anaerobic_te.toFixed(1).replace('.', ','), u: '' })
    if (a.vo2max != null) kpis.push({ k: 'VO₂max', v: String(Math.round(a.vo2max)), u: '' })
    if (a.total_sets) kpis.push({ k: 'Sätze', v: String(a.total_sets), u: '' })
    if (a.total_reps) kpis.push({ k: 'Wdh', v: a.total_reps.toLocaleString('de-DE'), u: '' })
    // Aus den Detailserien (nur falls im Payload vorhanden):
    const cadVals = (details.series?.cadence ?? []).filter(nn)
    if (cadVals.length > 1) {
      kpis.push({ k: 'Ø Cadence', v: String(Math.round(avg(cadVals))), u: isBike ? 'rpm' : 'spm' })
      kpis.push({ k: 'Max Cadence', v: String(Math.round(Math.max(...cadVals))), u: isBike ? 'rpm' : 'spm' })
    }
    const spdVals = (details.series?.speed ?? []).filter(nn).filter((v) => v > 0.3)
    if (spdVals.length > 1 && !isBike) kpis.push({ k: 'Beste Pace', v: paceStr(1000 / Math.max(...spdVals)), u: '/km' })
    const t = details.temp
    if (t && (t.min != null || t.max != null)) kpis.push({ k: 'Temperatur', v: t.max != null ? `${Math.round(t.max)}` : `${Math.round(t.min as number)}`, u: '°C' })
  }

  // HF-Zonen
  const zsec = details.hr_zones_sec ?? {}
  const zvals = [1, 2, 3, 4, 5].map((i) => num(zsec[`z${i}`]) ?? 0)
  const zTot = zvals.reduce((s, v) => s + v, 0)
  const hasZones = zvals.some((v) => v > 0)

  // Multi-Metrik-Verlauf (5.1): HF/Cadence/Pace/Elevation überlagerbar; Power nur bei Rad-mit-Power.
  const S = details.series ?? {}
  const hrArr: (number | null)[] = S.hr ?? (details.hr_curve ?? []).map((p) => (p && nn(p.v) ? p.v : null))
  const speedArr: (number | null)[] = S.speed ?? []
  type Metric = { key: string; label: string; color: string; unit: string; plot: (number | null)[]; stat: string }
  const metricDefs: Metric[] = []
  const addMetric = (key: string, label: string, color: string, unit: string, plot: (number | null)[], statFn: (vs: number[]) => string) => {
    const vs = plot.filter(nn)
    if (vs.length > 1) metricDefs.push({ key, label, color, unit, plot, stat: statFn(vs) })
  }
  const mm = (vs: number[]) => `ø ${Math.round(avg(vs))} · max ${Math.round(Math.max(...vs))}`
  addMetric('hr', 'Herzfrequenz', '#EF4444', 'bpm', hrArr, mm)
  addMetric('cadence', 'Cadence', '#7C5CFF', isBike ? 'rpm' : 'spm', S.cadence ?? [], mm)
  addMetric('pace', 'Pace', '#2563EB', '/km', speedArr, () => (a?.distance_m && a?.duration_sec ? `ø ${paceStr(a.duration_sec / (a.distance_m / 1000))} · best ${paceStr(1000 / Math.max(...speedArr.filter(nn).filter((v) => v > 0.3)))}` : ''))
  addMetric('elevation', 'Höhe', '#22C55E', 'm', S.elevation ?? [], (vs) => `${Math.round(Math.min(...vs))}–${Math.round(Math.max(...vs))}`)
  // Power im Graph nur bei Rad-mit-Power (Laufleistung wird bewusst nicht gezeigt).
  if (isBike && a?.avg_power != null) addMetric('power', 'Power', '#F59E0B', 'W', S.power ?? [], mm)
  const hasGraph = metricDefs.length > 0
  const activeKeys = (() => { const base = gm.filter((k) => metricDefs.some((m) => m.key === k)); return base.length ? base : metricDefs[0] ? [metricDefs[0].key] : [] })()

  // Power (5.4) — nur Rad-mit-Powermeter. Laufleistung (avg_power bei Läufen) wird NICHT als Block gezeigt.
  const hasPower = isBike && a?.avg_power != null
  const pz = (() => { try { return a?.power_zones ? (JSON.parse(a.power_zones) as Record<string, number>) : null } catch { return null } })()
  const pzVals = pz ? [1, 2, 3, 4, 5, 6, 7].map((i) => num(pz[`z${i}`]) ?? 0) : []
  const pzTot = pzVals.reduce((s, v) => s + v, 0)
  const powerKpis: { k: string; v: string; u: string; note?: string }[] = []
  if (a) {
    if (a.avg_power != null) powerKpis.push({ k: 'Ø Power', v: String(Math.round(a.avg_power)), u: 'W' })
    if (a.max_power != null) powerKpis.push({ k: 'Max Power', v: String(Math.round(a.max_power)), u: 'W' })
    if (a.norm_power != null) powerKpis.push({ k: 'NP', v: String(Math.round(a.norm_power)), u: 'W' })
    if (a.max_20min_power != null) powerKpis.push({ k: 'Max 20 min', v: String(Math.round(a.max_20min_power)), u: 'W' })
    if (a.intensity_factor != null) powerKpis.push({ k: 'IF', v: a.intensity_factor.toFixed(2).replace('.', ','), u: '' })
    if (a.training_stress_score != null) powerKpis.push({ k: 'TSS', v: String(Math.round(a.training_stress_score)), u: '' })
    if (a.avg_lr_balance != null) powerKpis.push({ k: 'L/R-Balance', v: `${Math.round(a.avg_lr_balance)}/${Math.round(100 - a.avg_lr_balance)}`, u: '%' })
    if (a.work_kj != null) powerKpis.push({ k: 'Work', v: Math.round(a.work_kj).toLocaleString('de-DE'), u: 'kJ', note: 'berechnet' })
    if (a.pedal_strokes != null) powerKpis.push({ k: 'Pedal Strokes', v: a.pedal_strokes.toLocaleString('de-DE'), u: '' })
  }

  // Splits (nur mit echter Distanz -> Kraft fällt raus)
  const splits = (details.splits ?? [])
    .map((s) => ({ dist: num(s.distance), dur: num(s.duration), type: s.splitType }))
    .filter((s) => s.dist != null && s.dist > 0)
    .map((s) => ({
      label: humanize(s.type) || 'Split',
      dist: km(s.dist as number) + ' km',
      metric: s.dur ? (isBike ? `${((s.dist as number / 1000) / (s.dur / 3600)).toFixed(1).replace('.', ',')} km/h` : `${paceLbl(s.dist as number, s.dur)} /km`) : fmtDur(s.dur ?? 0),
    }))
  const hasSplits = splits.length > 0

  // Übungssätze (Kraft)
  const exercises = (details.exercise_sets ?? []).map((e) => {
    const sets = num(e.sets), reps = num(e.reps), maxW = num(e.maxWeight)
    const nm = typeof e.name === 'string' && e.name ? e.name : humanize(e.subCategory ?? e.category)
    return {
      name: nm || 'Übung',
      summary: `${sets ?? '?'} Sätze · ${reps ?? 0} Wdh${maxW && maxW > 0 ? ` · max ${fmtKg(maxW)} kg` : ''}`,
    }
  })
  const hasSets = exercises.length > 0
  const isStrength = /strength/.test(type)
  const showExercises = hasSets || isStrength

  const emp = a ? employers.find((e) => e.id === a.employer_id) : undefined
  const proj = a ? projects.find((p) => p.id === a.project_id) : undefined
  const areaProjects = a ? projects.filter((p) => p.employer_id === a.employer_id && (p.active === 1 || p.id === a.project_id)) : []
  const canEdit = a?.source === 'manual'
  const field: CSSProperties = { width: '100%', boxSizing: 'border-box', borderRadius: 12, border: '1px solid var(--hair)', background: 'var(--track)', padding: '9px 11px', fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }
  const chip = (on: boolean): CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 11, cursor: 'pointer', background: on ? 'color-mix(in srgb, var(--accent) 13%, transparent)' : 'var(--track)', border: on ? '1.5px solid var(--accent)' : '1px solid var(--hair)', color: on ? 'var(--ink)' : 'var(--ink2)', fontSize: 13, fontWeight: 800 })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, boxSizing: 'border-box', background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0 }} />
      <div className="no-scrollbar" style={{ position: 'relative', zIndex: 2, width: 720, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', borderRadius: 30, ...GLASS_STRONG, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', animation: 'popIn .2s ease' }}>
        {loading || !a ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink3)', fontWeight: 700 }}>{loading ? 'Lädt…' : 'Keine Daten'}</div>
        ) : (
          <>
            {/* Head */}
            <div style={{ padding: '26px 28px 20px', borderBottom: '1px solid var(--hair)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, background: hexA(color, 0.16), flex: 'none' }}>{TYPE_EMOJI[type] ?? '🏅'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.6px', color: 'var(--ink)' }}>{a.name ?? TYPE_LABEL[type] ?? 'Workout'}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink2)', marginTop: 3 }}>{TYPE_LABEL[type] ?? type} · {fmtDate(a.start_ts)}</div>
                </div>
                {canEdit && !editing && (
                  <div onClick={startEdit} title="KPIs bearbeiten" style={{ padding: '8px 14px', borderRadius: 11, background: 'var(--track)', color: 'var(--ink)', fontWeight: 800, fontSize: 13, cursor: 'pointer', flex: 'none' }}>Bearbeiten</div>
                )}
                {a.entry_id != null && onEditEntry && (
                  <div onClick={() => { onEditEntry(a.entry_id!); onClose() }} title="Eintrag bearbeiten (Zeit/Bereich/Notiz)" style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--track)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink2)', flex: 'none' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </div>
                )}
                <div onClick={onClose} style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--track)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink2)', flex: 'none' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 16, flexWrap: 'wrap' }}>
                {emp && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 13px', borderRadius: 11, background: 'var(--track)' }}>
                    <div style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{emp.icon} {emp.name}</div>
                  </div>
                )}
                {proj && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 13px', borderRadius: 11, background: canEdit ? 'transparent' : 'var(--track)', border: canEdit ? '1px dashed var(--hair)' : '1px solid transparent' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink2)' }}>{proj.name}</div>
                  </div>
                )}
                {canEdit && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>Manueller Eintrag</div>}
              </div>

              {/* Bereich/Projekt bearbeiten (nur im Edit-Modus) */}
              {editing && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ ...kicker, marginBottom: 8 }}>Bereich</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    {sportAreas.map((e) => (
                      <div key={e.id} onClick={() => assign(e.id, null)} style={chip(e.id === a.employer_id)}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', background: e.color || employerColor(e.id) }} />
                        <span>{e.icon} {e.name}</span>
                      </div>
                    ))}
                  </div>
                  {areaProjects.length > 0 && (
                    <>
                      <div style={{ ...kicker, margin: '14px 0 8px' }}>Projekt</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                        {areaProjects.map((p) => (
                          <div key={p.id} onClick={() => assign(a.employer_id as number, p.id === a.project_id ? null : p.id)} style={chip(p.id === a.project_id)}>{p.name}</div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* KPI row bzw. Edit-Formular */}
            {editing ? (
              <div style={{ padding: '22px 28px 8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
                  {([['duration_min', 'Dauer (min)'], ['distance_km', 'Distanz (km)'], ['calories', 'Kalorien'], ['avg_hr', 'Ø-HF'], ['max_hr', 'Max-HF']] as [keyof Form, string][]).map(([key, lbl]) => (
                    <div key={key}>
                      <div style={{ ...kicker, marginBottom: 6 }}>{lbl}</div>
                      <input value={form[key]} inputMode="decimal" onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} style={field} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <div onClick={saving ? undefined : save} style={{ padding: '11px 22px', borderRadius: 12, background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Sichern…' : 'Sichern'}</div>
                  <div onClick={() => setEditing(false)} style={{ padding: '11px 18px', borderRadius: 12, color: 'var(--ink3)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Abbrechen</div>
                </div>
              </div>
            ) : kpis.length > 0 && (
              <div style={{ padding: '22px 28px 6px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(kpis.length, 6)}, 1fr)`, gap: 12 }}>
                  {kpis.map((k, i) => (
                    <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 16, padding: '14px 15px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{k.u}</div>
                      </div>
                      <div style={{ ...kicker, fontSize: 10.5, marginTop: 5 }}>{k.k}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* HF-Zonen */}
            {hasZones && (
              <div style={{ padding: '20px 28px 6px' }}>
                <div style={{ ...kicker, marginBottom: 12 }}>Herzfrequenz-Zonen</div>
                <div style={{ display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden', background: 'var(--track)' }}>
                  {zvals.map((sec, i) => (<div key={i} style={{ width: `${(sec / zTot) * 100}%`, background: ZC[i] }} />))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
                  {zvals.map((sec, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: ZC[i] }} />
                        <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--ink2)' }}>{ZLAB[i]}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{Math.round(sec / 60)}′</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--ink3)', marginTop: 1 }}>{ZNAME[i]}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Multi-Metrik-Verlauf (5.1) */}
            {hasGraph && (
              <div style={{ padding: '20px 28px 28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
                  <div style={kicker}>Verlauf</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {metricDefs.map((m) => { const on = activeKeys.includes(m.key); return (
                      <div key={m.key} onClick={() => setGm((cur) => { const base = cur.filter((k) => metricDefs.some((x) => x.key === k)); const next = base.includes(m.key) ? base.filter((k) => k !== m.key) : [...base, m.key]; return next.length ? next : [m.key] })}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 10, cursor: 'pointer', fontSize: 12, fontWeight: 800, border: `1px solid ${on ? m.color : 'var(--hair)'}`, background: on ? hexA(m.color, 0.14) : 'var(--track)', color: on ? m.color : 'var(--ink3)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, opacity: on ? 1 : 0.4 }} />{m.label}
                      </div>
                    ) })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                  {metricDefs.filter((m) => activeKeys.includes(m.key)).map((m) => (
                    <div key={m.key} style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: m.color }}>■</span> {m.label} <span style={{ color: 'var(--ink3)' }}>{m.stat} {m.unit}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 16, padding: '14px 12px' }}>
                  <svg width="100%" height="150" viewBox="0 0 620 150" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
                    <line x1="0" y1="37.5" x2="620" y2="37.5" stroke="var(--hair)" strokeWidth="1" />
                    <line x1="0" y1="75" x2="620" y2="75" stroke="var(--hair)" strokeWidth="1" />
                    <line x1="0" y1="112.5" x2="620" y2="112.5" stroke="var(--hair)" strokeWidth="1" />
                    {metricDefs.filter((m) => activeKeys.includes(m.key)).map((m) => { const gg = geom(m.plot.filter(nn), 620, 150, 8); return (
                      <g key={m.key}>
                        {activeKeys.length === 1 && <path d={areaD(gg, 150)} fill={hexA(m.color, 0.13)} stroke="none" />}
                        <path d={lineD(gg)} fill="none" stroke={m.color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    ) })}
                  </svg>
                </div>
              </div>
            )}

            {/* Power (5.4) — nur Rad-mit-Powermeter */}
            {hasPower && (
              <div style={{ padding: '4px 28px 20px' }}>
                <div style={{ ...kicker, marginBottom: 12 }}>Leistung (Power)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                  {powerKpis.map((k, i) => (
                    <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 16, padding: '14px 15px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.6px', color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)' }}>{k.u}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
                        <div style={{ ...kicker, fontSize: 10.5 }}>{k.k}</div>
                        {k.note && <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', padding: '1px 5px', borderRadius: 5, background: 'var(--track)', color: 'var(--ink3)', border: '1px dashed var(--hair)' }}>{k.note}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                {pzTot > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <div style={{ ...kicker, marginBottom: 12 }}>Power-Zonen</div>
                    <div style={{ display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden', background: 'var(--track)' }}>
                      {pzVals.map((sec, i) => (<div key={i} style={{ width: `${(sec / pzTot) * 100}%`, background: PZC[i] }} />))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 6 }}>
                      {pzVals.map((sec, i) => (
                        <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: PZC[i] }} />
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--ink2)' }}>Z{i + 1}</div>
                          </div>
                          <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--ink)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{Math.round(sec / 60)}′</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Splits */}
            {hasSplits && (
              <div style={{ padding: '4px 28px 8px' }}>
                <div style={{ ...kicker, marginBottom: 12 }}>Splits</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {splits.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 12px', borderRadius: 10, background: 'var(--track)' }}>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{s.label}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{s.dist}</div>
                      <div style={{ width: 90, textAlign: 'right', fontSize: 12.5, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{s.metric}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Übungssätze (editierbar; Bearbeitung wird vor Re-Sync geschützt) */}
            {showExercises && (
              <div style={{ padding: '16px 28px 28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={kicker}>Übungen &amp; Sätze</div>
                  {!editingEx && <div onClick={startEditEx} style={{ fontSize: 12, fontWeight: 800, color: 'var(--accent)', cursor: 'pointer' }}>{hasSets ? 'Bearbeiten' : '+ Übungen'}</div>}
                </div>

                {editingEx ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, padding: '0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>
                      <div style={{ flex: 1 }}>Übung</div>
                      <div style={{ width: 50, textAlign: 'center' }}>Sätze</div>
                      <div style={{ width: 50, textAlign: 'center' }}>Wdh</div>
                      <div style={{ width: 62, textAlign: 'center' }}>Max kg</div>
                      <div style={{ width: 22 }} />
                    </div>
                    {exForm.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input value={r.name} placeholder="Übung" onChange={(e) => setExRow(i, 'name', e.target.value)} style={{ ...field, flex: 1 }} />
                        <input value={r.sets} inputMode="numeric" onChange={(e) => setExRow(i, 'sets', e.target.value)} style={{ ...field, width: 50, textAlign: 'center', padding: '9px 5px' }} />
                        <input value={r.reps} inputMode="numeric" onChange={(e) => setExRow(i, 'reps', e.target.value)} style={{ ...field, width: 50, textAlign: 'center', padding: '9px 5px' }} />
                        <input value={r.max_weight} inputMode="decimal" onChange={(e) => setExRow(i, 'max_weight', e.target.value)} style={{ ...field, width: 62, textAlign: 'center', padding: '9px 5px' }} />
                        <div onClick={() => removeExRow(i)} title="Entfernen" style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ink3)', flex: 'none' }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </div>
                      </div>
                    ))}
                    <div onClick={addExRow} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: 'var(--ink3)', cursor: 'pointer', marginTop: 2 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      Übung hinzufügen
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                      <div onClick={savingEx ? undefined : saveEx} style={{ padding: '10px 20px', borderRadius: 12, background: 'var(--accent)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: savingEx ? 'default' : 'pointer', opacity: savingEx ? 0.6 : 1 }}>{savingEx ? 'Sichern…' : 'Sichern'}</div>
                      <div onClick={() => setEditingEx(false)} style={{ padding: '10px 16px', borderRadius: 12, color: 'var(--ink3)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Abbrechen</div>
                    </div>
                  </div>
                ) : hasSets ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {exercises.map((ex, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: 'var(--card)', border: '1px solid var(--hair)', borderRadius: 14, padding: '13px 16px' }}>
                        <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--ink)' }}>{ex.name}</div>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{ex.summary}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink3)' }}>Noch keine Übungen erfasst — „+ Übungen" zum Hinzufügen.</div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
