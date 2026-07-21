import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { api, type Absence, type AbsenceType, type AppSettings, type AreaHours, type Employer, type Entry, type PlannedBlock, type PlannedOverride, type Project, type Todo } from '../api'
import { employerColor } from '../colors'
import { holidayName } from '../holidays'
import { distributeAbsenceMinutes } from '../absence'
import { parseQuickTodo } from '../todoParse'
import EntryEditor from '../components/EntryEditor'
import InboxPopover from '../components/InboxPopover'
import ActivityDeepDive from '../components/ActivityDeepDive'
import TimeField from '../components/TimeField'
import type { PageIntent } from '../App'

const ABS_COLOR: Record<AbsenceType, string> = { urlaub: '#F59E0B', krank: '#E5484D', sonstiges: '#5B6577' }
const ABS_LABEL: Record<AbsenceType, string> = { urlaub: 'Urlaub', krank: 'Krank', sonstiges: 'Sonstiges' }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Minutes → "1:24" (h:mm). */
function fmtHM(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin))
  return `${Math.floor(m / 60)}:${pad2(m % 60)}`
}

/** Minutes → "4h" bzw. "3h 12" (Design-Stil fmtDur). */
function fmtDur(totalMin: number): string {
  const m = Math.max(0, Math.round(totalMin))
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return mm === 0 ? `${hh}h` : `${hh}h ${pad2(mm)}`
}

/** Vorzeichenbehaftete Dauer für den Saldo, z. B. "+0h 45" / "−1h 30". */
function fmtSigned(totalMin: number): string {
  const rounded = Math.round(totalMin)
  return (rounded < 0 ? '−' : '+') + fmtDur(Math.abs(rounded))
}

/** Beginn des Arbeitstags für die anteilige Soll-Hochrechnung (Annahme). */
const WORK_START_HOUR = 8

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']

/** ISO-8601-Kalenderwoche (Woche mit dem Donnerstag). */
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000))
}

function fmtClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Dezimale Stunde (0–24) einer Uhrzeit, z. B. 18:15 → 18.25. */
function hourOfDay(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600
}

/** Local YYYY-MM-DD key for a Date. */
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

/** Build an ISO timestamp from a day and an "HH:MM" string in local time. */
function isoFromDayTime(day: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = startOfDay(day)
  d.setHours(h || 0, m || 0, 0, 0)
  return d.toISOString()
}

// ---------------------------------------------------------------------------
// Small presentational bits
// ---------------------------------------------------------------------------

const GLASS: CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--border)',
}

interface RingSeg {
  s: number // Startstunde (0–24, dezimal)
  e: number // Endstunde (0–24, dezimal)
  color: string
  onClick?: () => void
}

function hourAngle(h: number): number {
  // 0 Uhr oben (12-Uhr-Position), im Uhrzeigersinn, 24 h = Vollkreis
  return ((-90 + (h / 24) * 360) * Math.PI) / 180
}

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function arcPath(cx: number, cy: number, r: number, h0: number, h1: number, gap: number): string {
  const g = h1 - h0 > gap * 2 ? gap : 0
  const a0 = hourAngle(h0 + g / 2)
  const a1 = hourAngle(h1 - g / 2)
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a1)
  const large = h1 - h0 > 12 ? 1 : 0
  return `M${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

/** 24-Stunden-Uhr: innerer Ring = Soll/geplant, äußerer Ring = Ist/erfasst. Mitte bleibt leer. */
function Ring24({
  size,
  tracked,
  planned,
  absence = [],
  nowHour,
}: {
  size: number
  tracked: RingSeg[]
  planned: RingSeg[]
  absence?: RingSeg[]
  nowHour: number | null
}) {
  const cx = size / 2
  const cy = size / 2
  const outerR = size / 2 - 22
  const innerR = outerR - 30
  const stroke = 16
  const gap = 0.07

  const nowA = nowHour != null ? hourAngle(nowHour) : null
  const [nlx1, nly1] = nowA != null ? polar(cx, cy, outerR + 11, nowA) : [0, 0]
  const [nlx2, nly2] = nowA != null ? polar(cx, cy, innerR - 11, nowA) : [0, 0]
  const [ndx, ndy] = nowA != null ? polar(cx, cy, outerR, nowA) : [0, 0]

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Tracks */}
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="var(--track)" strokeWidth={stroke} />
      <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="var(--track)" strokeWidth={stroke} />
      {/* innerer Ring: Soll / geplant */}
      {planned.map((p, i) => (
        <path key={`p${i}`} onClick={p.onClick} d={arcPath(cx, cy, innerR, p.s, p.e, gap)} stroke={p.color} strokeWidth={stroke} fill="none" strokeLinecap="round" style={{ cursor: p.onClick ? 'pointer' : 'default' }} />
      ))}
      {/* Abwesenheit (auf dem Ist-Ring, hinter den erfassten Segmenten) */}
      {absence.map((p, i) => (
        <path key={`a${i}`} onClick={p.onClick} d={arcPath(cx, cy, outerR, p.s, p.e, gap)} stroke={p.color} strokeWidth={stroke} fill="none" strokeLinecap="round" opacity={0.4} style={{ cursor: p.onClick ? 'pointer' : 'default' }} />
      ))}
      {/* äußerer Ring: Ist / erfasst */}
      {tracked.map((p, i) => (
        <path key={`t${i}`} onClick={p.onClick} d={arcPath(cx, cy, outerR, p.s, p.e, gap)} stroke={p.color} strokeWidth={stroke} fill="none" strokeLinecap="round" style={{ cursor: p.onClick ? 'pointer' : 'default' }} />
      ))}
      {/* Stundenmarken 0 / 6 / 12 / 18 */}
      {[0, 6, 12, 18].map((hh) => {
        const [tx, ty] = polar(cx, cy, outerR + 16, hourAngle(hh))
        return (
          <text key={`h${hh}`} x={tx} y={ty} fill="var(--ink3)" fontSize={11} fontWeight={700} textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'inherit' }}>
            {hh}
          </text>
        )
      })}
      {/* aktuelle Uhrzeit */}
      {nowA != null && (
        <>
          <line x1={nlx1} y1={nly1} x2={nlx2} y2={nly2} stroke="var(--ink)" strokeWidth={2} strokeLinecap="round" opacity={0.35} />
          <circle cx={ndx} cy={ndy} r={6} fill="var(--accent, #22C55E)" stroke="var(--screen-solid)" strokeWidth={3} />
        </>
      )}
    </svg>
  )
}

interface TlPlanned { id: number; start_min: number; end_min: number; color: string; label: string }
interface TlTracked { id: number; s: number; e: number; color: string; name: string }
interface HeroTodo { id: number; title: string; color: string; due: string; dueColor: string; done: boolean; onToggle: () => void }

/** Hero-Tile: Swipe zwischen 24-Stunden-Uhr (Ansicht 1) und Timeline (Ansicht 2).
 *  Klick/Tap auf die Timeline öffnet den Kalender. */
function HeroTile({
  tracked,
  planned,
  absence,
  nowHour,
  plannedBlocks,
  trackedBlocks,
  isToday,
  nowMin,
  onOpenCalendar,
  onOpenEntry,
  onOpenPlan,
  todos,
  onOpenTodos,
  onAddTodo,
}: {
  tracked: RingSeg[]
  planned: RingSeg[]
  absence: RingSeg[]
  nowHour: number | null
  plannedBlocks: TlPlanned[]
  trackedBlocks: TlTracked[]
  isToday: boolean
  nowMin: number
  onOpenCalendar: () => void
  onOpenEntry: (id: number) => void
  onOpenPlan: (b: TlPlanned) => void
  todos: HeroTodo[]
  onOpenTodos: () => void
  onAddTodo: (title: string) => Promise<void>
}) {
  const [view, setView] = useState(0)
  const [dragDx, setDragDx] = useState(0)
  const [newTodo, setNewTodo] = useState('')
  const [addingTodo, setAddingTodo] = useState(false)

  async function submitTodo() {
    const title = newTodo.trim()
    if (!title || addingTodo) return
    setAddingTodo(true)
    setNewTodo('')
    try {
      await onAddTodo(title)
    } catch {
      setNewTodo(title)
    } finally {
      setAddingTodo(false)
    }
  }
  const suppressRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const HOUR_H = 30
  const totalH = 24 * HOUR_H

  useEffect(() => {
    if (view === 1 && scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H - 12
  }, [view])

  function onPointerDown(e: React.PointerEvent) {
    const startX = e.clientX
    const startY = e.clientY
    suppressRef.current = false
    const width = e.currentTarget.getBoundingClientRect().width
    // Während der Swipe-Geste global keine Textmarkierung – auch wenn der Zeiger
    // über andere Widgets hinausläuft (selectstart unterdrücken ist zuverlässiger als user-select).
    document.body.style.userSelect = 'none'
    const noSelect = (ev: Event) => ev.preventDefault()
    document.addEventListener('selectstart', noSelect)
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      setDragDx(dx)
      if (Math.abs(dx) > 6 || Math.abs(ev.clientY - startY) > 6) suppressRef.current = true
    }
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('selectstart', noSelect)
      document.body.style.userSelect = ''
      if (suppressRef.current) window.getSelection?.()?.removeAllRanges()
      const dx = ev.clientX - startX
      setDragDx(0)
      const th = Math.min(70, width * 0.2)
      if (dx <= -th) setView((v) => Math.min(2, v + 1))
      else if (dx >= th) setView((v) => Math.max(0, v - 1))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const hours = Array.from({ length: 25 }, (_, i) => i)
  const hm = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
  const colLabel: CSSProperties = { flex: 1, fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', textAlign: 'center' }

  return (
    <div style={{ width: 380, flex: 'none', borderRadius: 28, ...GLASS, boxShadow: '0 10px 30px var(--hair)', padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.4px' }}>Mein Tag</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 2 }}>
          {view === 0 ? '24-Stunden-Uhr · Soll & Ist' : view === 1 ? 'Timeline · Plan & Ist' : 'To-Dos'}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', marginTop: 6 }}>
        <div
          onPointerDown={onPointerDown}
          style={{ display: 'flex', height: '100%', width: '300%', touchAction: 'pan-y', transform: `translateX(calc(${(-view * 100) / 3}% + ${dragDx}px))`, transition: dragDx !== 0 ? 'none' : 'transform .35s cubic-bezier(.22,.61,.36,1)' }}
        >
          {/* Ansicht 1: Ring */}
          <div style={{ width: '33.3333%', flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <Ring24 size={240} tracked={tracked} planned={planned} absence={absence} nowHour={nowHour} />
            <div style={{ display: 'flex', gap: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--ink2)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 4, border: '2px solid var(--ink3)' }} />
                Innen · geplant
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--ink2)' }}>
                <div style={{ width: 12, height: 12, borderRadius: 4, background: 'var(--ink3)' }} />
                Außen · erfasst
              </div>
            </div>
          </div>

          {/* Ansicht 2: Timeline (Klick öffnet Kalender) */}
          <div
            onClick={() => { if (!suppressRef.current) onOpenCalendar() }}
            style={{ width: '33.3333%', flex: 'none', height: '100%', display: 'flex', flexDirection: 'column', cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', padding: '0 4px 8px 44px' }}>
              <div style={colLabel}>Geplant</div>
              <div style={colLabel}>Erfasst</div>
            </div>
            <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
              <div style={{ position: 'relative', height: totalH }}>
                {hours.map((h) => (
                  <div key={h}>
                    <div style={{ position: 'absolute', left: 40, right: 4, top: h * HOUR_H, height: 1, background: 'var(--hair)' }} />
                    <div style={{ position: 'absolute', left: 0, top: h * HOUR_H, width: 34, textAlign: 'right', transform: 'translateY(-50%)', fontSize: 10, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{h < 24 ? pad2(h) : ''}</div>
                  </div>
                ))}
                {plannedBlocks.map((b) => {
                  const h = Math.max(14, ((b.end_min - b.start_min) / 60) * HOUR_H - 2)
                  return (
                    <div key={`p${b.id}`} title={`${b.label} – geplant`} onClick={(ev) => { ev.stopPropagation(); onOpenPlan(b) }} onPointerDown={(ev) => ev.stopPropagation()} style={{ position: 'absolute', left: 44, width: 'calc(50% - 52px)', top: (b.start_min / 60) * HOUR_H, height: h, borderRadius: 8, background: `color-mix(in srgb, ${b.color} 22%, transparent)`, border: `1.5px solid ${b.color}`, boxSizing: 'border-box', padding: '2px 6px', overflow: 'hidden', cursor: 'pointer' }}>
                      {h >= 22 && <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.label}</div>}
                      {h >= 40 && <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{hm(b.start_min)}–{hm(b.end_min)}</div>}
                    </div>
                  )
                })}
                {trackedBlocks.map((b) => {
                  const h = Math.max(14, ((b.e - b.s) / 60) * HOUR_H - 2)
                  return (
                    <div key={`t${b.id}`} title={`${b.name} – Details`} onClick={(ev) => { ev.stopPropagation(); onOpenEntry(b.id) }} onPointerDown={(ev) => ev.stopPropagation()} style={{ position: 'absolute', left: 'calc(50% + 8px)', width: 'calc(50% - 44px)', top: (b.s / 60) * HOUR_H, height: h, borderRadius: 8, background: b.color, boxShadow: '0 3px 10px var(--hair)', boxSizing: 'border-box', padding: '2px 6px', overflow: 'hidden', cursor: 'pointer' }}>
                      {h >= 22 && <div style={{ fontSize: 10, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</div>}
                      {h >= 40 && <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>{hm(b.s)}–{hm(b.e)}</div>}
                    </div>
                  )
                })}
                {isToday && (
                  <div style={{ position: 'absolute', left: 40, right: 4, top: (nowMin / 60) * HOUR_H, height: 0, borderTop: '2px solid var(--accent, #22C55E)', zIndex: 4 }}>
                    <div style={{ position: 'absolute', left: -5, top: -4, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent, #22C55E)' }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Ansicht 3: To-Dos (Klick öffnet die Liste) */}
          <div style={{ width: '33.3333%', flex: 'none', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
              {todos.length === 0 ? (
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink3)', padding: '8px 2px' }}>Keine offenen To-Dos 🎉</div>
              ) : (
                todos.map((td) => (
                  <div key={td.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px' }}>
                    <div onPointerDown={(e) => e.stopPropagation()} onClick={td.onToggle} style={{ width: 20, height: 20, borderRadius: 7, border: `2px solid ${td.done ? td.color : 'var(--ink3)'}`, background: td.done ? td.color : 'transparent', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 12, fontWeight: 800, flex: 'none', cursor: 'pointer' }}>{td.done ? '✓' : ''}</div>
                    <div onClick={onOpenTodos} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: td.done ? 'var(--ink3)' : 'var(--ink)', textDecoration: td.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{td.title}</div>
                    {td.due && <div style={{ fontSize: 11, fontWeight: 700, color: td.dueColor, fontVariantNumeric: 'tabular-nums', flex: 'none' }}>{td.due}</div>}
                  </div>
                ))
              )}
            </div>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 2px 2px', borderTop: '1px solid var(--hair)', marginTop: 4 }}>
              <div style={{ width: 20, height: 20, borderRadius: 7, border: '2px dashed var(--ink3)', flex: 'none' }} />
              <input
                value={newTodo}
                onChange={(e) => setNewTodo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitTodo() }}
                onPointerDown={(e) => e.stopPropagation()}
                placeholder="Neue Aufgabe …"
                style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', outline: 'none', fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit' }}
              />
              {newTodo.trim().length > 0 && (
                <div onClick={() => void submitTodo()} onPointerDown={(e) => e.stopPropagation()} title="Hinzufügen (Enter)" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 8, background: 'var(--accent, #22C55E)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>↵</div>
              )}
              <div onClick={onOpenTodos} onPointerDown={(e) => e.stopPropagation()} title="In To-Dos öffnen" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 8, ...GLASS, color: 'var(--ink2)', cursor: 'pointer' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M9 21H3v-6" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 21l7-7" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} onClick={() => setView(i)} style={{ height: 8, width: i === view ? '26px' : '8px', borderRadius: 4, background: i === view ? 'var(--accent, #22C55E)' : 'var(--track)', cursor: 'pointer', transition: 'width .3s ease, background .3s ease' }} />
        ))}
      </div>
    </div>
  )
}

/** Einfacher Fortschritts-Donut (Ist/Soll) wie im Design für die Bereichs-Kacheln. */
function Donut({ size, frac, color }: { size: number; frac: number; color: string }) {
  const w = size * 0.14
  const r = size / 2 - w / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, frac))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={w} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeDasharray={`${c * clamped} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .5s ease' }}
      />
    </svg>
  )
}

interface KontoDaySeg {
  label: string
  flex: number
  fillPct: number
  color: string
  bookedMin: number
  sollMin: number
  isTod: boolean
}

interface KontoPage {
  label: string
  accent: string
  saldoMin: number
  bookedMin: number
  sollMin: number
  days: KontoDaySeg[]
}

/** Wisch-Widget: Wochen-Füllstand (Soll vs. gebucht), segmentiert pro Tag.
 *  Seite 0 = Gesamt, danach je Arbeitgeber. Immer aktuelle KW. */
function WeekKonto({
  pages,
  kw,
  span,
  onOpenWeek,
  onPickDay,
}: {
  pages: KontoPage[]
  kw: number
  span: string
  onOpenWeek: (page: number) => void
  onPickDay: (dayIndex: number) => void
}) {
  const [page, setPage] = useState(0)
  const [dragDx, setDragDx] = useState(0)
  const n = pages.length
  const idx = Math.max(0, Math.min(n - 1, page))
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lockRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressClickRef = useRef(false)

  const go = (dir: number) => setPage((p) => Math.max(0, Math.min(n - 1, p + dir)))

  function onPointerDown(e: React.PointerEvent) {
    const startX = e.clientX
    const width = e.currentTarget.getBoundingClientRect().width
    const move = (ev: PointerEvent) => setDragDx(ev.clientX - startX)
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      const dx = ev.clientX - startX
      setDragDx(0)
      if (Math.abs(dx) > 6) {
        // echte Wischbewegung → folgenden Klick (Popup) unterdrücken
        suppressClickRef.current = true
        setTimeout(() => (suppressClickRef.current = false), 60)
      }
      const th = Math.min(80, width * 0.18)
      if (dx <= -th) go(1)
      else if (dx >= th) go(-1)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  // Trackpad: horizontales Wischen (deltaX). Nativer, nicht-passiver Listener,
  // damit preventDefault() die OS-/Browser-Zurück-Geste auf dem Widget blockiert.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 12) return
      e.preventDefault()
      if (lockRef.current) return
      lockRef.current = true
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => (lockRef.current = false), 260)
      setPage((p) => Math.max(0, Math.min(n - 1, p + (e.deltaX > 0 ? 1 : -1))))
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [n])

  if (n === 0) return null
  const accent = pages[idx].accent

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onClick={() => {
        if (suppressClickRef.current) return
        onOpenWeek(idx)
      }}
      title="Wochenübersicht öffnen"
      style={{ flex: 'none', borderRadius: 24, ...GLASS, boxShadow: '0 10px 30px var(--hair)', padding: '18px 22px', position: 'relative', overflow: 'hidden', touchAction: 'pan-y', overscrollBehaviorX: 'contain', cursor: 'pointer', userSelect: 'none' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: accent, zIndex: 2 }} />
      <div style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', width: `${n * 100}%`, transform: `translateX(calc(${-idx * (100 / n)}% + ${dragDx}px))`, transition: dragDx !== 0 ? 'none' : 'transform .35s cubic-bezier(.22,.61,.36,1)' }}>
          {pages.map((p) => (
            <div key={p.label} style={{ width: `${100 / n}%`, flex: 'none', boxSizing: 'border-box', paddingLeft: 4, paddingRight: 6 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Saldo · {p.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', marginTop: 2 }}>KW {kw} · {span}</div>
                </div>
                <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
                  {fmtSigned(p.saldoMin)}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 4 }}>
                  {p.days.map((s, i) => (
                    <div
                      key={i}
                      onClick={(e) => {
                        e.stopPropagation()
                        onPickDay(i)
                      }}
                      title={`${s.label}: ${fmtDur(s.bookedMin)} / ${s.sollMin > 0 ? fmtDur(s.sollMin) : '—'}`}
                      style={{ flex: s.flex, cursor: 'pointer' }}
                    >
                      <div style={{ height: 10, borderRadius: 4, background: 'var(--track)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${s.fillPct}%`, background: s.color, borderRadius: 4, transition: 'width .4s ease' }} />
                      </div>
                      <div style={{ textAlign: 'center', fontSize: 10, fontWeight: s.isTod ? 800 : 700, color: s.isTod ? 'var(--accent, #16A34A)' : 'var(--ink3)', marginTop: 6 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', flex: 'none' }}>
                  {fmtDur(p.bookedMin)} / {fmtDur(p.sollMin)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}>
        {pages.map((p, i) => (
          <div
            key={p.label}
            onClick={(e) => {
              e.stopPropagation()
              setPage(i)
            }}
            style={{ height: 8, width: i === idx ? '26px' : '8px', borderRadius: 4, background: i === idx ? 'var(--accent, #22C55E)' : 'var(--track)', cursor: 'pointer', transition: 'width .3s ease, background .3s ease' }}
          />
        ))}
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      title={title}
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        ...GLASS,
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        color: 'var(--ink2)',
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add / Start-Stop modal
// ---------------------------------------------------------------------------

interface AddModalProps {
  employers: Employer[]
  projects: Project[]
  plannedBlocks: { employer_id: number; project_id: number | null; start_min: number; end_min: number }[]
  onClose: () => void
  onCreated: () => void
}

// Neue Aktivität anlegen. Aufbau wie der EntryEditor (Bereich → Projekt → Notiz),
// „Erfassen" ergänzt Start/Ende, „Live" startet stattdessen den Timer.
function AddModal({ employers, projects, plannedBlocks, onClose, onCreated }: AddModalProps) {
  const [mode, setMode] = useState<'live' | 'log'>('live')
  const [employerId, setEmployerId] = useState<number | null>(employers.find((e) => e.active === 1)?.id ?? employers[0]?.id ?? null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [startTime, setStartTime] = useState(fmtClock(new Date()))
  const [endTime, setEndTime] = useState(fmtClock(new Date()))
  const [logDate, setLogDate] = useState(dayKey(new Date())) // Erfassen-Datum, Default heute
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planQuery, setPlanQuery] = useState('') // Planblock-Suchtext
  const [planOpen, setPlanOpen] = useState(false) // Planblock-Liste offen
  const [projQuery, setProjQuery] = useState('') // Projekt-Suchtext
  const [projOpen, setProjOpen] = useState(false) // Projekt-Liste offen

  const colorFor = (id: number) => employers.find((e) => e.id === id)?.color ?? employerColor(id)
  const areaList = employers.filter((e) => e.active === 1 || e.id === employerId)
  const areaProjects = useMemo(
    () => projects.filter((p) => p.employer_id === employerId && (p.active === 1 || p.id === projectId)),
    [projects, employerId, projectId],
  )

  async function submit() {
    if (employerId === null) {
      setError('Bitte einen Bereich wählen')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const n = note.trim() ? note.trim() : null
      if (mode === 'live') {
        await api.createEntry({ start_ts: new Date().toISOString(), employer_id: employerId, project_id: projectId, note: n })
      } else {
        const day = new Date(`${logDate}T00:00:00`)
        const created = await api.createEntry({ start_ts: isoFromDayTime(day, startTime), employer_id: employerId, project_id: projectId, note: n })
        await api.updateEntry(created.id, { end_ts: isoFromDayTime(day, endTime) })
      }
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  const label: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }
  const timeField: CSSProperties = { width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }
  const chip = (on: boolean, color: string): CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 12, background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--glass)', border: `1.5px solid ${on ? color : 'var(--border)'}`, color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: 'pointer' })

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 34 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxHeight: '88%', overflowY: 'auto', borderRadius: 28, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: '24px 26px', animation: 'popIn .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)' }}>Neue Aktivität</div>
          <div style={{ display: 'flex', padding: 3, gap: 3, borderRadius: 12, background: 'var(--glass)', border: '1px solid var(--border)', flex: 'none' }}>
            {(['live', 'log'] as const).map((m) => (
              <div key={m} onClick={() => setMode(m)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', color: mode === m ? 'var(--ink)' : 'var(--ink3)', background: mode === m ? 'var(--glass-strong)' : 'transparent', boxShadow: mode === m ? '0 2px 8px var(--hair)' : 'none' }}>
                {m === 'live' ? 'Live' : 'Erfassen'}
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 2 }}>{mode === 'live' ? 'Timer jetzt starten' : 'Zeiten manuell erfassen'}</div>

        {/* Planblock übernehmen: Bereich, Projekt & Zeitfenster in die Erfassen-Felder */}
        {plannedBlocks.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={label}>Planblock übernehmen <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· Bereich, Projekt &amp; Zeit</span></div>
            <input
              value={planQuery}
              onFocus={() => setPlanOpen(true)}
              onChange={(e) => { setPlanQuery(e.target.value); setPlanOpen(true) }}
              onBlur={() => window.setTimeout(() => setPlanOpen(false), 150)}
              placeholder="Planblock suchen oder wählen …"
              style={{ ...timeField, fontSize: 15 }}
            />
            {planOpen && (() => {
              const ql = planQuery.trim().toLowerCase()
              const items = [...plannedBlocks]
                .sort((a, b) => a.start_min - b.start_min)
                .map((b) => {
                  const proj = b.project_id != null ? projects.find((p) => p.id === b.project_id) : undefined
                  const emp = employers.find((e) => e.id === b.employer_id)
                  return { b, name: proj?.name ?? emp?.name ?? 'Block', projName: proj?.name ?? '', time: `${pad2(Math.floor(b.start_min / 60))}:${pad2(b.start_min % 60)}–${pad2(Math.floor(b.end_min / 60))}:${pad2(b.end_min % 60)}`, color: emp?.color || employerColor(b.employer_id) }
                })
                .filter((it) => !ql || `${it.name} ${it.time}`.toLowerCase().includes(ql))
              return (
                <div className="no-scrollbar" style={{ marginTop: 8, maxHeight: 190, overflowY: 'auto', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--glass)', display: 'flex', flexDirection: 'column', gap: 2, padding: 6 }}>
                  {items.length === 0 && <div style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Kein passender Planblock</div>}
                  {items.map((it, i) => (
                    <div key={i} onMouseDown={(e) => { e.preventDefault(); setMode('log'); setEmployerId(it.b.employer_id); setProjectId(it.b.project_id); setProjQuery(it.projName); setStartTime(`${pad2(Math.floor(it.b.start_min / 60))}:${pad2(it.b.start_min % 60)}`); setEndTime(`${pad2(Math.floor(it.b.end_min / 60))}:${pad2(it.b.end_min % 60)}`); setPlanQuery(`${it.name} · ${it.time}`); setPlanOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer' }}>
                      <div style={{ width: 9, height: 9, borderRadius: 3, background: it.color, flex: 'none' }} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}>{it.time}</div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>
        )}

        {/* Bereich */}
        <div style={{ marginTop: 16 }}>
          <div style={label}>Bereich</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {areaList.map((emp) => {
              const on = emp.id === employerId
              const color = emp.color || employerColor(emp.id)
              return (
                <div key={emp.id} onClick={() => { setEmployerId(emp.id); if (emp.id !== employerId) { setProjectId(null); setProjQuery('') } }} style={chip(on, color)}>
                  <div style={{ fontSize: 15 }}>{emp.icon}</div>
                  {emp.name}
                </div>
              )
            })}
          </div>
        </div>

        {/* Projekt – Suchleiste mit gefilterter Liste */}
        {areaProjects.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={label}>Projekt <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· optional</span></div>
            <input
              value={projQuery}
              onFocus={() => setProjOpen(true)}
              onChange={(e) => { setProjQuery(e.target.value); setProjectId(null); setProjOpen(true) }}
              onBlur={() => window.setTimeout(() => setProjOpen(false), 150)}
              placeholder="Projekt suchen oder wählen …"
              style={{ ...timeField, fontSize: 15 }}
            />
            {projOpen && (() => {
              const ql = projQuery.trim().toLowerCase()
              const filtered = areaProjects.filter((p) => !ql || p.name.toLowerCase().includes(ql))
              return (
                <div className="no-scrollbar" style={{ marginTop: 8, maxHeight: 190, overflowY: 'auto', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--glass)', display: 'flex', flexDirection: 'column', gap: 2, padding: 6 }}>
                  {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 13, fontWeight: 600, color: 'var(--ink3)' }}>Kein passendes Projekt</div>}
                  {filtered.map((p) => {
                    const color = colorFor(p.employer_id)
                    const on = p.id === projectId
                    return (
                      <div key={p.id} onMouseDown={(e) => { e.preventDefault(); setProjectId(p.id); setProjQuery(p.name); setProjOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', background: on ? `color-mix(in srgb, ${color} 16%, transparent)` : 'transparent' }}>
                        <div style={{ width: 9, height: 9, borderRadius: 3, background: color, flex: 'none' }} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {/* Notiz */}
        <div style={{ marginTop: 16 }}>
          <div style={label}>Notiz <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>· optional</span></div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Woran arbeitest du?" style={{ width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1px solid var(--hair)', background: 'var(--glass)', padding: '12px 14px', fontSize: 15, fontWeight: 600, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
        </div>

        {/* Datum + Start / Ende (nur Erfassen) */}
        {mode === 'log' && (
          <>
            <div style={{ marginTop: 16 }}>
              <div style={label}>Datum</div>
              <input type="date" lang="de-DE" value={logDate} onChange={(e) => setLogDate(e.target.value)} style={{ ...timeField, fontSize: 15 }} />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <div style={{ flex: 1 }}><div style={label}>Start</div><TimeField value={startTime} onChange={setStartTime} style={timeField} /></div>
              <div style={{ flex: 1 }}><div style={label}>Ende</div><TimeField value={endTime} onChange={setEndTime} style={timeField} /></div>
            </div>
          </>
        )}

        {error && <div style={{ fontSize: 13, fontWeight: 700, color: '#E5484D', marginTop: 14 }}>{error}</div>}

        <div onClick={busy ? undefined : submit} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 15, borderRadius: 16, marginTop: 20, background: 'var(--accent, #22C55E)', color: '#fff', fontWeight: 800, fontSize: 16, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, boxShadow: '0 10px 24px color-mix(in srgb, var(--accent, #22C55E) 40%, transparent)' }}>
          {busy ? 'Speichern…' : mode === 'live' ? '▶ Timer starten' : 'Aktivität erfassen'}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

interface MeinTagProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onOpenTodos: () => void
  onOpenCalendar: () => void
  onOpenAuswertung: () => void
  onOpenVerwalten: () => void
  onOpenPuls: () => void
  onOpenSpotlight: () => void
  settings: AppSettings
  selectedDay: Date
  setSelectedDay: Dispatch<SetStateAction<Date>>
  intent: PageIntent | null
  onIntentDone: () => void
}

type SegPopup =
  | { kind: 'entry'; entry: Entry }
  | { kind: 'plan'; label: string; s: number; e: number; color: string }
  | { kind: 'absence'; absence: Absence }

export default function MeinTag({ theme, onOpenTodos, onOpenCalendar, onOpenAuswertung, onOpenVerwalten, onOpenPuls, onOpenSpotlight, settings, selectedDay, setSelectedDay, intent, onIntentDone }: MeinTagProps) {
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [areaHours, setAreaHours] = useState<AreaHours[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [todos, setTodos] = useState<Todo[]>([])
  const [planned, setPlanned] = useState<PlannedBlock[]>([])
  const [overrides, setOverrides] = useState<PlannedOverride[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [now, setNow] = useState(() => new Date())
  const [addOpen, setAddOpen] = useState(false)
  const [editEntry, setEditEntry] = useState<Entry | null>(null)
  const [deepDiveId, setDeepDiveId] = useState<number | null>(null)
  const [segPopup, setSegPopup] = useState<SegPopup | null>(null)
  const [areaPopup, setAreaPopup] = useState<number | null>(null) // Bereichs-Detail (employer_id)
  const [areaProjOpen, setAreaProjOpen] = useState<string | null>(null) // aufgeklappte Projektzeile im Bereichs-Popup
  const [livePopoverOpen, setLivePopoverOpen] = useState(false)
  const [weekPopupPage, setWeekPopupPage] = useState<number | null>(null)
  const [actFilter, setActFilter] = useState<'all' | 'work' | 'private'>('all')
  const [pauseStartMs, setPauseStartMs] = useState<number | null>(null)
  const [pauseAccumMs, setPauseAccumMs] = useState(0)

  // ticking clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  async function loadEntries() {
    setEntries(await api.getEntries())
  }

  useEffect(() => {
    let alive = true
    Promise.all([api.getEmployers(), api.getProjects(), api.getAreaHours(), api.getEntries(), api.getTodos(), api.getPlanned(), api.getOverrides(), api.getAbsences()])
      .then(([emp, proj, ah, ent, tds, pl, ov, abs]) => {
        if (!alive) return
        setEmployers(emp)
        setProjects(proj)
        setAreaHours(ah)
        setEntries(ent)
        setTodos(tds)
        setPlanned(pl)
        setOverrides(ov)
        setAbsences(abs)
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

  // Bereichsfarbe: bevorzugt die gespeicherte Farbe, sonst aus der id abgeleitet.
  const colorFor = (empId: number): string => employersById.get(empId)?.color ?? employerColor(empId)

  // Abwesenheitstypen (Farbe/Label/Icon) aus den Einstellungen, mit Fallback.
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

  // Tages-Soll (Minuten) eines Arbeitsbereichs an einem Datum. Private Bereiche haben
  // kein Tages-Soll (Wochenziel). An Feiertagen (Bundesland): 0.
  function dailySoll(empId: number, key: string): number {
    if (key < settings.start_date) return 0 // harter Stichtag: davor zählt nichts in den Saldo
    const emp = employersById.get(empId)
    if (emp && emp.kind === 'private') return 0
    if (holidayName(key, settings.bundesland)) return 0
    const wd = new Date(`${key}T00:00:00`).getDay()
    for (const r of areaHours) if (r.employer_id === empId && r.weekday === wd) return r.minutes
    return 0
  }
  // Abwesenheits-Ist (Minuten) für Datum+Bereich: zählt, sobald das Fenster begonnen
  // hat; ganzer Tag = Tages-Soll, Zeitfenster = Dauer (bei "Alle" gleichmäßig verteilt).
  function absenceIst(key: string, empId: number): number {
    const todayK = dayKey(startOfDay(now))
    const nMin = now.getHours() * 60 + now.getMinutes()
    let total = 0
    for (const a of absences) {
      if (!(a.start_date <= key && key <= a.end_date)) continue
      if (!(a.employer_id == null || a.employer_id === empId)) continue
      const begun = key < todayK || (key === todayK && (a.all_day === 1 || (a.start_min ?? 0) <= nMin))
      if (!begun) continue
      const areaIds = a.employer_id == null ? employers.map((e) => e.id) : [a.employer_id]
      const dist = distributeAbsenceMinutes(areaIds.map((id) => ({ id, soll: dailySoll(id, key) })), a.all_day === 1, a.start_min, a.end_min)
      total += dist.get(empId) ?? 0
    }
    return total
  }

  const running = useMemo(() => entries.find((e) => e.end_ts === null) ?? null, [entries])

  // To-Dos: offene und überfällige Anzahl für die Kachel.
  const todoOpenCount = useMemo(() => todos.filter((t) => t.done === 0).length, [todos])
  const todoOverdueCount = useMemo(() => {
    const today = dayKey(startOfDay(now))
    return todos.filter((t) => t.done === 0 && t.due_date != null && t.due_date < today).length
  }, [todos, now])

  async function toggleTodo(t: Todo) {
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: x.done === 1 ? 0 : 1 } : x)))
    try {
      await api.updateTodo(t.id, { done: t.done !== 1 })
    } catch {
      setTodos(await api.getTodos())
    }
  }

  async function addTodoQuick(raw: string) {
    const p = parseQuickTodo(raw, employers, projects)
    if (!p.title) return
    await api.createTodo({ title: p.title, employer_id: p.employer_id, project_id: p.project_id, due_date: p.due_date })
    setTodos(await api.getTodos())
  }

  // Offene To-Dos für die 3. Hero-Ansicht.
  const heroTodos = useMemo<HeroTodo[]>(() => {
    const todayK = dayKey(startOfDay(now))
    const dueInfo = (due: string | null): { label: string; color: string } => {
      if (!due) return { label: '', color: 'var(--ink2)' }
      if (due < todayK) return { label: 'überf.', color: '#E5484D' }
      if (due === todayK) return { label: 'heute', color: 'var(--accent, #16A34A)' }
      return { label: new Date(`${due}T00:00:00`).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }), color: 'var(--ink2)' }
    }
    return todos
      .filter((t) => t.done === 0)
      .sort((a, b) => (a.due_date ?? '9999') < (b.due_date ?? '9999') ? -1 : (a.due_date ?? '9999') > (b.due_date ?? '9999') ? 1 : 0)
      .map((t) => {
        const di = dueInfo(t.due_date)
        return { id: t.id, title: t.title, color: t.employer_id != null ? colorFor(t.employer_id) : 'var(--accent, #22C55E)', due: di.label, dueColor: di.color, done: t.done === 1, onToggle: () => void toggleTodo(t) }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, now])

  // Pause ist client-seitig (nur Anzeige) und wird bei Wechsel der laufenden
  // Aktivität zurückgesetzt; endet die Erfassung, Popover schließen.
  const runningId = running?.id ?? null
  useEffect(() => {
    setPauseStartMs(null)
    setPauseAccumMs(0)
    if (runningId === null) setLivePopoverOpen(false)
  }, [runningId])

  const dayEntries = useMemo(() => {
    const key = dayKey(selectedDay)
    return entries
      .filter((e) => dayKey(new Date(e.start_ts)) === key)
      .sort((a, b) => Date.parse(b.start_ts) - Date.parse(a.start_ts))
  }, [entries, selectedDay])

  // total tracked minutes for the selected day (running entry counts live)
  const trackedMin = useMemo(() => {
    let sum = dayEntries.reduce((s, e) => {
      if (e.end_ts === null) return s + (now.getTime() - Date.parse(e.start_ts)) / 60000
      return s + (e.duration_min ?? 0)
    }, 0)
    const key = dayKey(selectedDay)
    for (const emp of employers) sum += absenceIst(key, emp.id)
    return sum
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayEntries, now, selectedDay, employers, absences, areaHours])

  const isToday = dayKey(selectedDay) === dayKey(now)
  const nowHour = isToday ? hourOfDay(now) : null

  // Ist-Buchungen als Ring-Segmente (dezimale Stunden); laufender Eintrag bis jetzt.
  const trackedSegs = useMemo<RingSeg[]>(() => {
    return dayEntries
      .map((e) => {
        const s = hourOfDay(new Date(e.start_ts))
        const end = e.end_ts ? hourOfDay(new Date(e.end_ts)) : isToday ? hourOfDay(now) : s
        return {
          s: Math.max(0, Math.min(24, s)),
          e: Math.max(0, Math.min(24, end)),
          color: colorFor(e.employer_id),
          onClick: () => setSegPopup({ kind: 'entry', entry: e }),
        }
      })
      .filter((seg) => seg.e > seg.s)
  }, [dayEntries, isToday, now])

  // Geplante Blöcke des gewählten Tags = Standardwoche + Tages-Overrides.
  const plannedDayResolved = useMemo(() => {
    const wd = selectedDay.getDay()
    const key = dayKey(selectedDay)
    // Feiertag: Standardwoche ignorieren, nur explizit hier geplante Blöcke.
    const templates = holidayName(key, settings.bundesland) ? [] : planned.filter((b) => b.weekday === wd)
    const dayOv = overrides.filter((o) => o.date === key)
    const out: { employer_id: number; project_id: number | null; start_min: number; end_min: number }[] = []
    for (const t of templates) {
      const ov = dayOv.find((o) => o.source_block_id === t.id)
      if (ov) {
        if (ov.deleted) continue
        out.push({ employer_id: ov.employer_id ?? t.employer_id, project_id: ov.project_id ?? t.project_id, start_min: ov.start_min ?? t.start_min, end_min: ov.end_min ?? t.end_min })
      } else {
        out.push({ employer_id: t.employer_id, project_id: t.project_id, start_min: t.start_min, end_min: t.end_min })
      }
    }
    for (const o of dayOv) {
      if (o.source_block_id == null && !o.deleted && o.employer_id != null && o.start_min != null && o.end_min != null)
        out.push({ employer_id: o.employer_id, project_id: o.project_id, start_min: o.start_min, end_min: o.end_min })
    }
    return out.filter((b) => b.end_min > b.start_min)
  }, [planned, overrides, selectedDay])

  // Innerer Ring (Soll/geplant).
  const plannedSegs = useMemo<RingSeg[]>(
    () =>
      plannedDayResolved
        .map((b) => {
          const proj = b.project_id != null ? projectsById.get(b.project_id) : undefined
          const emp = employersById.get(b.employer_id)
          const color = colorFor(b.employer_id)
          const label = proj?.name ?? emp?.name ?? 'Geplant'
          return { s: Math.max(0, Math.min(24, b.start_min / 60)), e: Math.max(0, Math.min(24, b.end_min / 60)), color, onClick: () => setSegPopup({ kind: 'plan', label, s: b.start_min / 60, e: b.end_min / 60, color }) }
        })
        .filter((seg) => seg.e > seg.s),
    [plannedDayResolved, employersById, projectsById],
  )

  const nowMin = now.getHours() * 60 + now.getMinutes()

  // Abwesenheiten des Tages als Ring-Segmente (ganzer Tag = 0–24).
  const absenceSegs = useMemo<RingSeg[]>(() => {
    const key = dayKey(selectedDay)
    return absences
      .filter((a) => a.start_date <= key && key <= a.end_date)
      .map((a) => ({ s: a.all_day === 1 ? 0 : (a.start_min ?? 0) / 60, e: a.all_day === 1 ? 24 : (a.end_min ?? 0) / 60, color: absColor(a.type), onClick: () => setSegPopup({ kind: 'absence', absence: a }) }))
      .filter((seg) => seg.e > seg.s)
  }, [absences, selectedDay])

  // Timeline-Blöcke (Minuten) für die 2. Hero-Ansicht.
  const plannedTlBlocks = useMemo<TlPlanned[]>(
    () =>
      plannedDayResolved.map((b, i) => {
        const proj = b.project_id != null ? projectsById.get(b.project_id) : undefined
        const emp = employersById.get(b.employer_id)
        return { id: i, start_min: b.start_min, end_min: b.end_min, color: colorFor(b.employer_id), label: proj?.name ?? emp?.name ?? 'Block' }
      }),
    [plannedDayResolved, employersById, projectsById],
  )

  const trackedTlBlocks = useMemo<TlTracked[]>(() => {
    return dayEntries
      .map((e) => {
        const s = new Date(e.start_ts)
        const sMin = s.getHours() * 60 + s.getMinutes()
        let end = sMin
        if (e.end_ts) {
          const d = new Date(e.end_ts)
          end = d.getHours() * 60 + d.getMinutes()
        } else if (isToday) {
          end = nowMin
        }
        const emp = employersById.get(e.employer_id)
        const proj = e.project_id != null ? projectsById.get(e.project_id) : undefined
        return { id: e.id, s: sMin, e: end, color: colorFor(e.employer_id), name: proj?.name ?? emp?.name ?? 'Aktivität' }
      })
      .filter((b) => b.e > b.s)
  }, [dayEntries, isToday, nowMin, employersById, projectsById])

  // Tages-Soll je Arbeitgeber (Feiertage → 0).
  const sollDayMin = (employerId: number): number => dailySoll(employerId, dayKey(selectedDay))

  // Ist-Minuten je Arbeitgeber am gewählten Tag (laufender Eintrag bis jetzt).
  const istByEmployer = useMemo(() => {
    const m = new Map<number, number>()
    for (const e of dayEntries) {
      const dur = e.end_ts === null ? (now.getTime() - Date.parse(e.start_ts)) / 60000 : e.duration_min ?? 0
      m.set(e.employer_id, (m.get(e.employer_id) ?? 0) + dur)
    }
    const key = dayKey(selectedDay)
    for (const emp of employers) {
      const add = absenceIst(key, emp.id)
      if (add > 0) m.set(emp.id, (m.get(emp.id) ?? 0) + add)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayEntries, now, selectedDay, employers, absences, areaHours])

  // Erfasste Minuten je Bereich in der Woche (Mo–So) des gewählten Tags – für das
  // Wochenziel privater Bereiche.
  const weekIstByEmployer = useMemo(() => {
    const m = new Map<number, number>()
    const mon = addDays(startOfDay(selectedDay), -((selectedDay.getDay() + 6) % 7))
    const monK = dayKey(mon)
    const sunK = dayKey(addDays(mon, 6))
    for (const e of entries) {
      const k = dayKey(new Date(e.start_ts))
      if (k < monK || k > sunK) continue
      const dur = e.end_ts === null ? (now.getTime() - Date.parse(e.start_ts)) / 60000 : e.duration_min ?? 0
      m.set(e.employer_id, (m.get(e.employer_id) ?? 0) + Math.max(0, dur))
    }
    return m
  }, [entries, selectedDay, now])

  // Aggregat über alle Arbeitgeber mit Vorgabe.
  const sollDayTotalMin = useMemo(() => {
    const key = dayKey(selectedDay)
    return employers.reduce((sum, e) => sum + dailySoll(e.id, key), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employers, areaHours, selectedDay, settings.start_date])

  // GEPLANT BIS JETZT: anteiliges Tages-Soll bis zur aktuellen Uhrzeit.
  // Vergangene Tage → volles Tages-Soll, künftige → 0, heute → ab WORK_START linear.
  const cmpToday = dayKey(selectedDay).localeCompare(dayKey(now))
  const geplantMin = useMemo(() => {
    if (cmpToday > 0) return 0
    if (cmpToday < 0) return sollDayTotalMin
    const elapsed = (hourOfDay(now) - WORK_START_HOUR) * 60
    return Math.max(0, Math.min(sollDayTotalMin, elapsed))
  }, [cmpToday, sollDayTotalMin, now])

  // Wochen-Konto: Füllstand Soll vs. gebucht der KW des ausgewählten Tages, pro Tag segmentiert.
  // Seite 0 = Gesamt, danach je Arbeitgeber. Zeitpunkt-Bezug für „Soll bis jetzt" bleibt heute.
  const konto = useMemo(() => {
    const anchor = startOfDay(selectedDay)
    const monday = addDays(anchor, -((selectedDay.getDay() + 6) % 7))
    const sunday = addDays(monday, 6)
    const dayKeys = Array.from({ length: 7 }, (_, i) => dayKey(addDays(monday, i)))
    const today = startOfDay(now)
    const todayKey = dayKey(today)
    const selIdx = dayKeys.indexOf(dayKey(anchor))
    const kw = isoWeek(monday)
    const span = `${monday.getDate()}.–${sunday.getDate()}. ${MONTHS_SHORT[sunday.getMonth()]}`

    // Gebuchte Minuten je Arbeitgeber je Wochentag (laufender Eintrag bis jetzt).
    const bookedByEmp = new Map<number, number[]>()
    for (const e of entries) {
      const i = dayKeys.indexOf(dayKey(new Date(e.start_ts)))
      if (i < 0) continue
      if (dayKeys[i] < settings.start_date) continue // vor Stichtag: kein Ist in den Saldo
      const dur = e.end_ts === null ? (now.getTime() - Date.parse(e.start_ts)) / 60000 : e.duration_min ?? 0
      let arr = bookedByEmp.get(e.employer_id)
      if (!arr) {
        arr = new Array(7).fill(0)
        bookedByEmp.set(e.employer_id, arr)
      }
      arr[i] += dur
    }

    // Begonnene Abwesenheiten (Mo–Fr) zählen wie gebuchte Zeit → füllen das Tages-Soll.
    for (const emp of employers) {
      for (let i = 0; i <= 4; i++) {
        if (dayKeys[i] < settings.start_date) continue // vor Stichtag: keine Abwesenheits-Gutschrift
        const add = absenceIst(dayKeys[i], emp.id)
        if (add > 0) {
          let arr = bookedByEmp.get(emp.id)
          if (!arr) {
            arr = new Array(7).fill(0)
            bookedByEmp.set(emp.id, arr)
          }
          arr[i] += add
        }
      }
    }

    // Gesamtsaldo nur aus Arbeitsbereichen; private Bereiche separat ans Ende (nicht im Gesamt).
    const workEmps = employers.filter((e) => e.kind === 'work')
    const privEmps = employers.filter((e) => e.kind === 'private')
    const scopes = [
      { label: 'Gesamt', accent: 'var(--accent, #22C55E)', empIds: workEmps.map((e) => e.id), priv: false, goal: 0 },
      ...workEmps.map((e) => ({ label: e.name, accent: colorFor(e.id), empIds: [e.id], priv: false, goal: 0 })),
      ...privEmps.map((e) => ({ label: e.name, accent: colorFor(e.id), empIds: [e.id], priv: true, goal: e.weekly_goal_min })),
    ]
    const pages: KontoPage[] = scopes.map((sc) => {
      // Privat: Wochenziel gleichmäßig auf 7 Tage als Tagesreferenz; Saldo gegen das ganze Wochenziel.
      const dailyRef = sc.priv ? sc.goal / 7 : 0
      const sollDay: number[] = []
      const bookedDay: number[] = []
      for (let i = 0; i < 7; i++) {
        let s = 0
        let b = 0
        for (const id of sc.empIds) {
          s += sc.priv ? dailyRef : dailySoll(id, dayKeys[i]) // Arbeit: area_hours; Privat: Wochenziel/7
          b += bookedByEmp.get(id)?.[i] ?? 0
        }
        sollDay.push(s)
        bookedDay.push(b)
      }
      const sollMin = sc.priv ? sc.goal : sollDay.reduce((a, b) => a + b, 0)
      const bookedMin = bookedDay.reduce((a, b) => a + b, 0)
      let sollElapsed = 0
      if (sc.priv) {
        sollElapsed = sc.goal // privat: ganzes Wochenziel gegen bisher Erfasstes rechnen
      } else {
        // Soll bis heute: alle Wochentage ≤ heute (vergangene Woche = ganze Woche mit vollem
        // Soll, künftige Woche = 0). Der heutige Tag zählt mit vollem Tages-Soll.
        for (let i = 0; i < 7; i++) {
          if (dayKeys[i] <= todayKey) sollElapsed += sollDay[i]
        }
      }
      const days: KontoDaySeg[] = sollDay.map((s, i) => ({
        label: DAY_LABELS[i],
        flex: s > 0 ? s : 0.4,
        fillPct: s > 0 ? Math.min(100, (bookedDay[i] / s) * 100) : bookedDay[i] > 0 ? 100 : 0,
        color: sc.accent,
        bookedMin: bookedDay[i],
        sollMin: s,
        isTod: i === selIdx,
      }))
      return { label: sc.label, accent: sc.accent, saldoMin: bookedMin - sollElapsed, bookedMin, sollMin, days }
    })

    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
    return { pages, kw, span, weekDays }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, now, selectedDay, areaHours, employers, absences, settings.start_date])

  function entryLabel(e: Entry): { name: string; sub: string; color: string } {
    const emp = employersById.get(e.employer_id)
    const proj = e.project_id != null ? projectsById.get(e.project_id) : undefined
    const color = emp?.color ?? colorFor(e.employer_id)
    return {
      name: proj?.name ?? emp?.name ?? 'Aktivität',
      sub: proj ? (emp?.name ?? '') : '',
      color,
    }
  }

  async function stopRunning() {
    if (!running) return
    await api.updateEntry(running.id, { end_ts: new Date().toISOString() })
    await loadEntries()
  }

  // Per Hotkey/Spotlight ausgelöste Aktionen abarbeiten.
  const lastIntentNonce = useRef(0)
  useEffect(() => {
    if (!intent || intent.nonce === lastIntentNonce.current) return
    lastIntentNonce.current = intent.nonce
    if (intent.action === 'new-entry') {
      setAddOpen(true)
    } else if (intent.action === 'toggle-tracking') {
      if (running) void stopRunning()
      else setAddOpen(true)
    }
    onIntentDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  const heroWeekday = selectedDay.toLocaleDateString('de-DE', { weekday: 'long' }).toUpperCase()
  const heroBig = selectedDay.toLocaleDateString('de-DE', { day: 'numeric', month: 'long' })
  const datePill = selectedDay.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' })

  const isPaused = pauseStartMs != null
  const pausedMs = pauseAccumMs + (pauseStartMs != null ? now.getTime() - pauseStartMs : 0)
  const runColor = running ? colorFor(running.employer_id) : 'var(--accent, #22C55E)'
  const runningLabel = running ? entryLabel(running) : null
  const runningElapsed = running ? Math.max(0, (now.getTime() - Date.parse(running.start_ts) - pausedMs) / 60000) : 0

  function togglePause() {
    if (pauseStartMs != null) {
      setPauseAccumMs((a) => a + (Date.now() - pauseStartMs))
      setPauseStartMs(null)
    } else {
      setPauseStartMs(Date.now())
    }
  }

  function onPickWeekDay(dayIndex: number) {
    setSelectedDay(startOfDay(konto.weekDays[dayIndex]))
    setWeekPopupPage(null)
  }

  return (
    <div
      data-theme={theme}
      style={{ fontFamily: "-apple-system, system-ui, 'Manrope', sans-serif", height: '100vh', width: '100vw', overflow: 'hidden' }}
    >
      <div
        style={{
          // 10 % herausgezoomt, damit alles auf eine Seite passt; Größe entsprechend
          // hochgerechnet, damit der Screen den Viewport weiterhin exakt ausfüllt.
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
        {/* ---------- top bar ---------- */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ display: 'flex', padding: 4, gap: 3, borderRadius: 14, ...GLASS }}>
              <div style={{ padding: '8px 13px', borderRadius: 10, background: 'var(--glass-strong)', boxShadow: '0 2px 8px var(--hair)', color: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.4V12l3.2 1.9" />
                </svg>
              </div>
              <div onClick={onOpenAuswertung} title="Auswertung" style={{ padding: '8px 14px', borderRadius: 10, color: 'var(--ink3)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20V11" />
                  <path d="M10 20V4" />
                  <path d="M16 20v-7" />
                  <path d="M21 20H3" />
                </svg>
              </div>
            </div>
          </div>

          {/* date navigator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '9px 18px', borderRadius: 16, ...GLASS }}>
            <div onClick={() => setSelectedDay((d) => addDays(d, -1))} style={{ color: 'var(--ink3)', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}>
              ‹
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)', minWidth: 96, textAlign: 'center' }}>{datePill}</div>
            <div
              onClick={() => {
                const next = addDays(selectedDay, 1)
                // Über heute hinaus gibt es keinen Tages-View → Kalender öffnen.
                if (startOfDay(next).getTime() > startOfDay(now).getTime()) onOpenCalendar()
                else setSelectedDay(next)
              }}
              title="Nächster Tag (über heute hinaus: Kalender)"
              style={{ color: 'var(--ink3)', fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}
            >
              ›
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
            {!isToday && (
              <div
                onClick={() => setSelectedDay(startOfDay(new Date()))}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 16, background: 'color-mix(in srgb, var(--accent, #22C55E) 14%, transparent)', border: '1.5px solid var(--accent, #22C55E)', cursor: 'pointer', fontSize: 14, fontWeight: 800, color: 'var(--accent, #16A34A)', whiteSpace: 'nowrap' }}
              >
                ↩ Heute
              </div>
            )}
            <IconBtn title="Suche (Spotlight)" onClick={onOpenSpotlight}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </IconBtn>
            <IconBtn title="To-Dos" onClick={onOpenTodos}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6h11" />
                <path d="M9 12h11" />
                <path d="M9 18h11" />
                <path d="M4 6l1 1 2-2" />
                <path d="M4 12l1 1 2-2" />
                <path d="M4 18l1 1 2-2" />
              </svg>
            </IconBtn>
            <IconBtn title="Kalender" onClick={onOpenCalendar}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
                <path d="M3 9.5h18" />
                <path d="M8 2.5v4" />
                <path d="M16 2.5v4" />
              </svg>
            </IconBtn>
            <IconBtn title="Bereiche & Projekte" onClick={onOpenVerwalten}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="3" />
                <circle cx="17" cy="17" r="3" />
                <path d="M3 17h6" />
                <path d="M15 7h6" />
              </svg>
            </IconBtn>
            <IconBtn title="Puls" onClick={onOpenPuls}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12h4l2 5 4-11 2 6h6" />
              </svg>
            </IconBtn>
            <InboxPopover onChanged={loadEntries} onOpenTodos={onOpenTodos} />

            {running && runningLabel && (
              <div
                onClick={() => setLivePopoverOpen((o) => !o)}
                title="Aktivität – Infos, Pause & Stopp"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 16, ...GLASS, cursor: 'pointer' }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: runColor, animation: isPaused ? 'none' : 'pulseDot 1.6s ease-in-out infinite', flex: 'none' }} />
                <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtHM(runningElapsed)}</div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink2)' }}>· {runningLabel.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* ---------- hero ---------- */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 22 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '3px', color: 'var(--ink2)', textTransform: 'uppercase' }}>{heroWeekday}</div>
            <div style={{ fontSize: 60, lineHeight: 0.9, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-2px', marginTop: 6 }}>{heroBig}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 54, lineHeight: 0.86, fontWeight: 800, color: 'var(--ink3)', letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(now)}</div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '2px', color: 'var(--ink3)', textTransform: 'uppercase', marginTop: 4 }}>Uhrzeit</div>
          </div>
        </div>

        {/* ---------- body ---------- */}
        <div style={{ display: 'flex', gap: 24, marginTop: 20, flex: 1, minHeight: 0 }}>
          {/* left: ring tile */}
          <HeroTile
            tracked={trackedSegs}
            planned={plannedSegs}
            absence={absenceSegs}
            nowHour={nowHour}
            plannedBlocks={plannedTlBlocks}
            trackedBlocks={trackedTlBlocks}
            isToday={isToday}
            nowMin={nowMin}
            onOpenCalendar={onOpenCalendar}
            onOpenEntry={(id) => { const e = entries.find((x) => x.id === id); if (e) setSegPopup({ kind: 'entry', entry: e }) }}
            onOpenPlan={(b) => setSegPopup({ kind: 'plan', label: b.label, s: b.start_min / 60, e: b.end_min / 60, color: b.color })}
            todos={heroTodos}
            onOpenTodos={onOpenTodos}
            onAddTodo={addTodoQuick}
          />

          {/* right: live card + stats + activity list — oben fix, nur die Aktivitäten scrollen.
              Grid mit minmax(0,1fr) begrenzt die Aktivitäten-Zeile zuverlässig (nested flex versagt hier). */}
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', gap: 18 }}>
            {/* Dreierreihe: Erfasst · Geplant · To-Dos */}
            <div style={{ display: 'flex', gap: 14, flex: 'none' }}>
              <div style={{ flex: 1, minWidth: 0, borderRadius: 20, ...GLASS, padding: '19px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>{isToday ? 'Erfasst heute' : 'Erfasst'}</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-1px', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(trackedMin)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0, borderRadius: 20, ...GLASS, padding: '19px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Geplant</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink3)', letterSpacing: '-1px', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(geplantMin)}</div>
              </div>

              {/* To-Dos (öffnet den To-Dos-Screen) */}
              <div
                onClick={onOpenTodos}
                title="To-Dos öffnen"
                style={{ flex: 1, minWidth: 0, borderRadius: 20, background: 'linear-gradient(150deg, #2F6BFF 0%, #2563EB 55%, #4F46E5 100%)', border: '1px solid #2563EB', boxShadow: '0 12px 32px rgba(37,99,235,0.4)', padding: '19px 20px', position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>To-Dos</div>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: 'rgba(255,255,255,0.22)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 14, fontWeight: 800 }}>☰</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                  <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>{todoOpenCount}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.9)' }}>offen</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: todoOverdueCount > 0 ? '#FECACA' : 'rgba(255,255,255,0.9)', marginTop: 3 }}>
                  {todoOverdueCount > 0 ? `${todoOverdueCount} überfällig` : 'Alles im Plan'}
                </div>
              </div>
            </div>

            {/* Wochen-Saldo als segmentierter Füllstandsbalken (wischbar) */}
            <WeekKonto pages={konto.pages} kw={konto.kw} span={konto.span} onOpenWeek={setWeekPopupPage} onPickDay={onPickWeekDay} />

            {/* activity tiles — Ring + Prozent pro Bereich (füllt die 1fr-Zeile) */}
            <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.2px' }}>
                  Deine Aktivitäten <span style={{ color: 'var(--ink3)', fontWeight: 600 }}>· Ist / Soll pro Bereich</span>
                </div>
                <div style={{ display: 'flex', padding: 3, gap: 2, borderRadius: 11, ...GLASS, flex: 'none' }}>
                  {([['all', 'Alle'], ['work', 'Arbeit'], ['private', 'Privat']] as const).map(([k, lbl]) => (
                    <div key={k} onClick={() => setActFilter(k)} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', color: actFilter === k ? 'var(--ink)' : 'var(--ink3)', background: actFilter === k ? 'var(--glass-strong)' : 'transparent', boxShadow: actFilter === k ? '0 2px 8px var(--hair)' : 'none' }}>{lbl}</div>
                  ))}
                </div>
              </div>
              {loading ? (
                <div style={{ color: 'var(--ink3)', fontWeight: 600, padding: '8px 2px' }}>Lädt…</div>
              ) : loadError ? (
                <div style={{ color: '#E5484D', fontWeight: 700, padding: '8px 2px' }}>{loadError}</div>
              ) : (
                <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, gridAutoRows: 'minmax(96px, max-content)', alignContent: 'start', maskImage: 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 calc(100% - 26px), transparent)' }}>
                  {employers.filter((emp) => actFilter === 'all' || emp.kind === actFilter).map((emp) => {
                    const ist = istByEmployer.get(emp.id) ?? 0
                    const isPrivate = emp.kind === 'private'
                    const goal = emp.weekly_goal_min
                    const weekIst = weekIstByEmployer.get(emp.id) ?? 0
                    const soll = sollDayMin(emp.id)
                    // Privat: Donut = Wochenziel-Fortschritt (Woche-Ist / Ziel). Arbeit: Tag-Ist / Tag-Soll.
                    // Ohne Sollzeit (soll=0), aber gebucht → automatisch 100 %.
                    const frac = isPrivate ? (goal > 0 ? Math.min(1, weekIst / goal) : 0) : soll > 0 ? ist / soll : ist > 0 ? 1 : 0
                    const pct = isPrivate ? (goal > 0 ? Math.round((weekIst / goal) * 100) : 0) : soll > 0 ? Math.round((ist / soll) * 100) : ist > 0 ? 100 : 0
                    const color = colorFor(emp.id)
                    return (
                      <div key={emp.id} onClick={() => { setAreaPopup(emp.id); setAreaProjOpen(null) }} title={`${emp.name} – Projekte & Details`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 22, ...GLASS, cursor: 'pointer' }}>
                        <div style={{ position: 'relative', width: 64, height: 64, flex: 'none' }}>
                          <Donut size={64} frac={frac} color={color} />
                          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</div>
                        </div>
                        <div style={{ width: 34, height: 34, borderRadius: 11, background: `color-mix(in srgb, ${color} 18%, transparent)`, display: 'grid', placeItems: 'center', fontSize: 18, flex: 'none' }}>{emp.icon}</div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                            {isPrivate ? (goal > 0 ? `${fmtDur(ist)} heute · ${pct}% Wochenziel` : `${fmtDur(ist)} heute`) : `${fmtDur(ist)} / ${soll > 0 ? fmtDur(soll) : '—'}`}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- FAB (nur ohne laufende Erfassung) ---------- */}
        {!running && (
          <div
            onClick={() => setAddOpen(true)}
            title="Neue Aktivität"
            style={{ position: 'absolute', right: 36, bottom: 36, width: 64, height: 64, borderRadius: 22, background: 'var(--accent, #22C55E)', boxShadow: '0 12px 30px color-mix(in srgb, var(--accent, #22C55E) 45%, transparent)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 34, fontWeight: 500, zIndex: 8, cursor: 'pointer' }}
          >
            +
          </div>
        )}

        {/* Live-Popover: Kurzinfos zur Aktivität + Pause & Stopp */}
        {livePopoverOpen && running && runningLabel && (
          <>
            <div onClick={() => setLivePopoverOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 88 }} />
            <div style={{ position: 'absolute', top: 92, right: 44, zIndex: 89, width: 300, borderRadius: 22, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .16s ease' }}>
              <div style={{ padding: '18px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: runColor, animation: isPaused ? 'none' : 'pulseDot 1.6s ease-in-out infinite' }} />
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: isPaused ? 'var(--ink3)' : 'var(--accent, #16A34A)' }}>{isPaused ? 'Pausiert' : 'Läuft'}</div>
                  <div style={{ flex: 1 }} />
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtHM(runningElapsed)}</div>
                </div>
                <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginTop: 12, letterSpacing: '-0.3px' }}>{runningLabel.name}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 1 }}>Bereich · {runningLabel.sub || '—'}</div>
                {running.note && <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginTop: 8, lineHeight: 1.45 }}>{running.note}</div>}
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <div onClick={togglePause} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>{isPaused ? 'Fortsetzen' : 'Pause'}</div>
                  <div onClick={() => { setLivePopoverOpen(false); void stopRunning() }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, borderRadius: 13, background: '#E5484D', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 6px 16px rgba(229,72,77,0.35)' }}>Stopp</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Wochenübersicht-Popup (Saldo) */}
        {weekPopupPage !== null && konto.pages[weekPopupPage] && (
          <div onClick={() => setWeekPopupPage(null)} style={{ position: 'absolute', inset: 0, zIndex: 62, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxHeight: '86%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .18s ease' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '24px 28px 16px' }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>Woche · KW {konto.kw}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)' }}>Saldo · {konto.pages[weekPopupPage].label} · {konto.span}</div>
                </div>
                <div onClick={() => setWeekPopupPage(null)} style={{ width: 38, height: 38, borderRadius: 12, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 17, fontWeight: 600 }}>✕</div>
              </div>
              <div style={{ padding: '0 28px 26px', overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <div style={{ fontSize: 44, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums' }}>{fmtSigned(konto.pages[weekPopupPage].saldoMin)}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink2)' }}>Saldo · bis heute Abend</div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Gebucht</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(konto.pages[weekPopupPage].bookedMin)}</div>
                  </div>
                  <div style={{ flex: 1, borderRadius: 14, ...GLASS, padding: '11px 14px' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Soll / Woche</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(konto.pages[weekPopupPage].sollMin)}</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', margin: '20px 0 8px' }}>Tage · tippen zum Öffnen</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {konto.pages[weekPopupPage].days.map((d, i) => (
                    <div key={i} onClick={() => onPickWeekDay(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'var(--glass)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                      <div style={{ width: 46, fontSize: 13, fontWeight: 800, color: 'var(--ink)' }}>{d.label} {konto.weekDays[i].getDate()}.</div>
                      <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--track)', position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${d.fillPct}%`, background: d.color, borderRadius: 4 }} />
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtDur(d.bookedMin)} / {d.sollMin > 0 ? fmtDur(d.sollMin) : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {addOpen && (
          <AddModal
            employers={employers}
            projects={projects}
            plannedBlocks={plannedDayResolved}
            onClose={() => setAddOpen(false)}
            onCreated={loadEntries}
          />
        )}

        {editEntry && (
          <EntryEditor
            entry={editEntry}
            employers={employers}
            projects={projects}
            onClose={() => setEditEntry(null)}
            onSaved={loadEntries}
          />
        )}

        {deepDiveId != null && (
          <ActivityDeepDive activityId={deepDiveId} employers={employers} projects={projects} onClose={() => setDeepDiveId(null)} onChanged={loadEntries} onEditEntry={(entryId) => { setDeepDiveId(null); const en = entries.find((x) => x.id === entryId); if (en) setEditEntry(en) }} />
        )}

        {/* Klick-Popup für Uhr-Segmente */}
        {segPopup && (
          <div onClick={() => setSegPopup(null)} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 34 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 360, borderRadius: 24, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .16s ease' }}>
              <div style={{ padding: '22px 24px' }}>
                {segPopup.kind === 'entry' && (() => {
                  const e = segPopup.entry
                  const lbl = entryLabel(e)
                  const s = new Date(e.start_ts)
                  const end = e.end_ts ? new Date(e.end_ts) : null
                  const durMin = ((end ? end.getTime() : now.getTime()) - s.getTime()) / 60000
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 4, background: lbl.color }} />
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: end ? 'var(--ink3)' : 'var(--accent, #16A34A)' }}>{end ? 'Erfasst' : 'Läuft'}</div>
                        {e.activity_id != null && (
                          <div onClick={() => { setSegPopup(null); setDeepDiveId(e.activity_id!) }} title="Workout-Details (Deep-Dive)" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8, background: 'color-mix(in srgb, var(--accent, #16A34A) 14%, transparent)', color: 'var(--accent, #16A34A)', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.5px', cursor: 'pointer' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l2 5 4-10 2 5h6" /></svg>
                            PULS
                          </div>
                        )}
                        <div style={{ flex: 1 }} />
                        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtHM(durMin)}</div>
                      </div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginTop: 12 }}>{lbl.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 1 }}>Bereich · {lbl.sub || '—'} · {fmtClock(s)}–{end ? fmtClock(end) : 'jetzt'}</div>
                      {e.note && <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginTop: 8, lineHeight: 1.45 }}>{e.note}</div>}
                      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                        <div onClick={() => { setSegPopup(null); setEditEntry(e) }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Bearbeiten</div>
                        <div onClick={() => { setSegPopup(null); void (async () => { await api.deleteEntry(e.id); await loadEntries() })() }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 11, borderRadius: 13, background: '#E5484D', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Löschen</div>
                      </div>
                    </>
                  )
                })()}
                {segPopup.kind === 'plan' && (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 12, height: 12, borderRadius: 4, border: `2px solid ${segPopup.color}` }} />
                      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Geplant</div>
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginTop: 12 }}>{segPopup.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>{pad2(Math.floor(segPopup.s))}:{pad2(Math.round((segPopup.s % 1) * 60))}–{pad2(Math.floor(segPopup.e))}:{pad2(Math.round((segPopup.e % 1) * 60))}</div>
                    <div onClick={() => { setSegPopup(null); onOpenCalendar() }} style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Im Kalender bearbeiten →</div>
                  </>
                )}
                {segPopup.kind === 'absence' && (() => {
                  const a = segPopup.absence
                  const area = a.employer_id == null ? 'Alle Bereiche' : employersById.get(a.employer_id)?.name ?? ''
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 4, background: absColor(a.type) }} />
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: absColor(a.type) }}>Abwesenheit</div>
                      </div>
                      <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', marginTop: 12 }}>{absIcon(a.type)} {absLabel(a.type)} · {area}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 1 }}>{a.all_day === 1 ? 'Ganzer Tag' : `${pad2(Math.floor((a.start_min ?? 0) / 60))}:${pad2((a.start_min ?? 0) % 60)}–${pad2(Math.floor((a.end_min ?? 0) / 60))}:${pad2((a.end_min ?? 0) % 60)}`}{a.note ? ` · ${a.note}` : ''}</div>
                      <div onClick={() => { setSegPopup(null); onOpenCalendar() }} style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--ink)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Im Kalender bearbeiten →</div>
                    </>
                  )
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Bereichs-Detail: Projekte, Erfasst gesamt, Geplant (gewählter Tag) */}
        {areaPopup !== null && (() => {
          const emp = employersById.get(areaPopup)
          if (!emp) return null
          const color = colorFor(emp.id)
          const byProj = new Map<string, { pid: number | null; entries: Entry[]; total: number }>()
          for (const e of dayEntries) {
            if (e.employer_id !== emp.id) continue
            const dur = e.end_ts === null ? (now.getTime() - Date.parse(e.start_ts)) / 60000 : e.duration_min ?? 0
            const key = String(e.project_id ?? 'none')
            let g = byProj.get(key)
            if (!g) { g = { pid: e.project_id, entries: [], total: 0 }; byProj.set(key, g) }
            g.entries.push(e)
            g.total += Math.max(0, dur)
          }
          const projRows = [...byProj.entries()].sort((a, b) => b[1].total - a[1].total)
          const bookedSum = projRows.reduce((s, [, g]) => s + g.total, 0)
          const totalIst = istByEmployer.get(emp.id) ?? 0
          const absMin = Math.max(0, totalIst - bookedSum)
          const geplant = sollDayMin(emp.id)
          const isPriv = emp.kind === 'private'
          const goal = emp.weekly_goal_min
          const goalPct = goal > 0 ? Math.round((totalIst / goal) * 100) : 0
          return (
            <div onClick={() => setAreaPopup(null)} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'var(--veil)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 34 }}>
              <div onClick={(ev) => ev.stopPropagation()} style={{ width: 380, maxHeight: '86%', display: 'flex', flexDirection: 'column', borderRadius: 24, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden', animation: 'popIn .16s ease' }}>
                <div style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 12, background: `color-mix(in srgb, ${color} 18%, transparent)`, display: 'grid', placeItems: 'center', fontSize: 20, flex: 'none' }}>{emp.icon}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.3px' }}>{emp.name}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>{heroBig}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                    <div style={{ flex: 1, borderRadius: 16, ...GLASS, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Erfasst gesamt</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(totalIst)}</div>
                    </div>
                    <div style={{ flex: 1, borderRadius: 16, ...GLASS, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)' }}>{isPriv ? '% Wochenziel' : 'Geplant'}</div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink3)', letterSpacing: '-0.5px', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{isPriv ? (goal > 0 ? `${goalPct}%` : '—') : geplant > 0 ? fmtDur(geplant) : '—'}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', margin: '18px 0 10px' }}>Projekte</div>
                  <div className="no-scrollbar" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {projRows.length === 0 && absMin === 0 && (
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink3)', padding: '4px 0' }}>Keine Buchungen an diesem Tag.</div>
                    )}
                    {projRows.map(([key, g]) => {
                      const open = areaProjOpen === key
                      const name = g.pid != null ? projectsById.get(g.pid)?.name ?? 'Projekt' : 'Ohne Projekt'
                      return (
                        <div key={key} style={{ borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--hair)', overflow: 'hidden' }}>
                          <div onClick={() => setAreaProjOpen(open ? null : key)} title="Zeiten & Notizen anzeigen" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
                            <div style={{ width: 9, height: 9, borderRadius: 3, background: color, flex: 'none' }} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(g.total)}</div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flex: 'none' }}>›</div>
                          </div>
                          {open && (
                            <div>
                              {[...g.entries].sort((a, b) => Date.parse(a.start_ts) - Date.parse(b.start_ts)).map((e) => {
                                const s = new Date(e.start_ts)
                                const end = e.end_ts ? new Date(e.end_ts) : null
                                return (
                                  <div key={e.id} style={{ padding: '8px 12px 8px 31px', borderTop: '1px solid var(--hair)' }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtClock(s)}–{end ? fmtClock(end) : 'jetzt'}</div>
                                    {e.note && <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', marginTop: 3, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{e.note}</div>}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                    {absMin > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 13, background: 'var(--glass)', border: '1px solid var(--hair)' }}>
                        <div style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--ink3)', flex: 'none' }} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--ink2)' }}>Abwesenheit</div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ink2)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(absMin)}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
