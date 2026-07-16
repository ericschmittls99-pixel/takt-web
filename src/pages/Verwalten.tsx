import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api, type AbsenceTypeConfig, type AppSettings, type AreaHours, type Employer, type EmployerKind, type Project } from '../api'
import { employerColor } from '../colors'
import { BUNDESLAENDER } from '../holidays'
import { EMOJI_CATEGORIES, SUGGESTED_ICONS, suggestIcons } from '../emojis'
import { COMMANDS, COMMAND_GROUPS, DEFAULT_HOTKEYS, eventToHotkey, formatHotkey, type CommandId } from '../commands'

const GLASS: CSSProperties = {
  background: 'var(--glass)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid var(--border)',
}

const ACCENT_SWATCHES = ['#22C55E', '#2563EB', '#7C5CFF', '#F59E0B', '#EC4899', '#06B6D4', '#E5484D', '#0EA5E9']
const AREA_SWATCHES = ['#2563EB', '#7C5CFF', '#22C55E', '#F59E0B', '#EC4899', '#06B6D4', '#E5484D', '#0EA5E9', '#14B8A6', '#8B5CF6']
// weekday index 0=So … 6=Sa, angezeigt in Reihenfolge Mo–So.
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]
const WD_LABEL: Record<number, string> = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 0: 'So' }

type SettingsTab = 'allgemein' | 'bereiche' | 'abwesenheit' | 'kuerzel'
const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'allgemein', label: 'Allgemein' },
  { key: 'bereiche', label: 'Bereiche & Projekte' },
  { key: 'abwesenheit', label: 'Abwesenheiten' },
  { key: 'kuerzel', label: 'Kürzel' },
]

interface VerwaltenProps {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onBack: () => void
  onOpenTodos: () => void
  onOpenCalendar: () => void
  onOpenSpotlight: () => void
  settings: AppSettings
  onSettingsChange: (s: AppSettings) => void
}

function formatH(min: number): string {
  const h = min / 60
  const txt = Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${txt.replace('.', ',')} h`
}

function parseAbsenceTypes(raw: string): AbsenceTypeConfig[] {
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

const pencil = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

export default function Verwalten({ theme, onToggleTheme, onBack, onOpenTodos, onOpenCalendar, onOpenSpotlight, settings, onSettingsChange }: VerwaltenProps) {
  const [employers, setEmployers] = useState<Employer[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [areaHours, setAreaHours] = useState<AreaHours[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Bereich-Editor
  const [editArea, setEditArea] = useState<Employer | null>(null)
  const [aName, setAName] = useState('')
  const [aColor, setAColor] = useState('#2563EB')
  const [aIcon, setAIcon] = useState('💼')
  const [aKind, setAKind] = useState<EmployerKind>('work')
  const [aGoalMin, setAGoalMin] = useState(0)
  const [aHours, setAHours] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]) // Minuten je weekday 0..6
  const [aActive, setAActive] = useState(true)
  const [editErr, setEditErr] = useState<string | null>(null)

  // Emoji-Tabellen-Popup (merkt sich, welches Icon-Feld es setzt)
  const [emojiPick, setEmojiPick] = useState<{ current: string; pick: (e: string) => void; suggestions: string[] } | null>(null)

  // Projekt-Editor
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [pName, setPName] = useState('')
  const [pEmployerId, setPEmployerId] = useState<number>(0)

  // Abwesenheitstyp-Editor
  const absTypes = useMemo(() => parseAbsenceTypes(settings.absence_types), [settings.absence_types])
  const [editAbsIdx, setEditAbsIdx] = useState<number | null>(null)
  const [absLabel, setAbsLabel] = useState('')
  const [absColor, setAbsColor] = useState('#F59E0B')
  const [absIcon, setAbsIcon] = useState('📌')
  const [pActive, setPActive] = useState(true)
  // Drag & Drop: index des Bereichs bzw. {emp, idx} des Projekts, dessen Griff gepackt wurde.
  const [areaGrip, setAreaGrip] = useState<number | null>(null)
  const [projGrip, setProjGrip] = useState<{ emp: number; idx: number } | null>(null)

  // Aktiver Themen-Tab.
  const [tab, setTab] = useState<SettingsTab>('allgemein')

  // Hotkey-Konfiguration: welcher Befehl nimmt gerade eine Taste auf?
  const [recording, setRecording] = useState<CommandId | null>(null)
  const hotkeys = useMemo<Record<string, string>>(() => {
    try {
      return { ...DEFAULT_HOTKEYS, ...(JSON.parse(settings.hotkeys || '{}') as Record<string, string>) }
    } catch {
      return { ...DEFAULT_HOTKEYS }
    }
  }, [settings.hotkeys])

  async function reload() {
    const [emp, proj, ah] = await Promise.all([api.getEmployers(), api.getProjects(), api.getAreaHours()])
    setEmployers(emp)
    setProjects(proj)
    setAreaHours(ah)
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [emp, proj, ah] = await Promise.all([api.getEmployers(), api.getProjects(), api.getAreaHours()])
        if (!alive) return
        setEmployers(emp)
        setProjects(proj)
        setAreaHours(ah)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Fehler beim Laden')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  function hoursFor(empId: number): number[] {
    const out = [0, 0, 0, 0, 0, 0, 0]
    for (const r of areaHours) if (r.employer_id === empId) out[r.weekday] = r.minutes
    return out
  }
  function weekTotal(empId: number): number {
    return hoursFor(empId).reduce((a, b) => a + b, 0)
  }

  const projectsByEmployer = useMemo(() => {
    const map = new Map<number, Project[]>()
    for (const p of projects) {
      const arr = map.get(p.employer_id) ?? []
      arr.push(p)
      map.set(p.employer_id, arr)
    }
    return map
  }, [projects])

  // ---- globale Einstellungen ----
  async function persistSettings(partial: Partial<AppSettings>) {
    onSettingsChange({ ...settings, ...partial }) // optimistisch (u. a. für Live-Akzent)
    try {
      const saved = await api.updateSettings(partial)
      onSettingsChange(saved)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    }
  }

  // ---- Hotkeys ----
  function setHotkey(id: CommandId, combo: string) {
    void persistSettings({ hotkeys: JSON.stringify({ ...hotkeys, [id]: combo }) })
  }

  // Während der Aufnahme die nächste Tastenkombi einfangen.
  useEffect(() => {
    if (!recording) return
    const rec = recording
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = eventToHotkey(e)
      if (!combo) return // nur Modifier gedrückt → weiter warten
      e.preventDefault()
      e.stopPropagation()
      setHotkey(rec, combo)
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, hotkeys])

  // ---- Bereich ----
  function openArea(e: Employer) {
    setEditErr(null)
    setEditArea(e)
    setAName(e.name)
    setAColor(e.color)
    setAIcon(e.icon)
    setAKind(e.kind)
    setAGoalMin(e.weekly_goal_min)
    setAHours(hoursFor(e.id))
    setAActive(e.active === 1)
  }

  async function newArea() {
    if (busy) return
    setBusy(true)
    try {
      const e = await api.createEmployer({ name: 'Neuer Bereich', kind: 'work' })
      await reload()
      openArea(e)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function reorderAreas(from: number, to: number) {
    if (from === to || busy) return
    const arr = [...employers]
    const [m] = arr.splice(from, 1)
    arr.splice(to, 0, m)
    setEmployers(arr) // sofortiges Feedback
    setBusy(true)
    try {
      await Promise.all(arr.map((e, i) => (e.sort_order === i ? null : api.updateEmployer(e.id, { sort_order: i }))))
      await reload()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Sortieren fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function reorderProjects(empId: number, from: number, to: number) {
    if (from === to || busy) return
    const list = projectsByEmployer.get(empId) ?? []
    const arr = [...list]
    const [m] = arr.splice(from, 1)
    arr.splice(to, 0, m)
    setProjects((prev) => [...prev.filter((p) => p.employer_id !== empId), ...arr.map((p, i) => ({ ...p, sort_order: i }))])
    setBusy(true)
    try {
      await Promise.all(arr.map((p, i) => (p.sort_order === i ? null : api.updateProject(p.id, { sort_order: i }))))
      await reload()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Sortieren fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function deleteArea() {
    if (!editArea || busy) return
    setBusy(true)
    setEditErr(null)
    try {
      await api.deleteEmployer(editArea.id)
      await reload()
      setEditArea(null)
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function saveArea() {
    if (!editArea || busy) return
    const name = aName.trim()
    if (!name) return
    setBusy(true)
    try {
      await api.updateEmployer(editArea.id, { name, color: aColor, icon: aIcon, kind: aKind, weekly_goal_min: Math.max(0, Math.round(aGoalMin)), active: aActive })
      if (aKind === 'work') await api.setAreaHours(editArea.id, aHours.map((m) => Math.max(0, Math.round(m))))
      await reload()
      setEditArea(null)
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  // ---- Projekt ----
  function openProject(p: Project) {
    setEditErr(null)
    setEditProject(p)
    setPName(p.name)
    setPEmployerId(p.employer_id)
    setPActive(p.active === 1)
  }
  async function newProject(employerId: number) {
    if (busy) return
    setBusy(true)
    try {
      const p = await api.createProject({ name: 'Neues Projekt', employer_id: employerId })
      await reload()
      openProject(p)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }
  async function deleteProject() {
    if (!editProject || busy) return
    setBusy(true)
    setEditErr(null)
    try {
      await api.deleteProject(editProject.id)
      await reload()
      setEditProject(null)
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }
  async function saveProject() {
    if (!editProject || busy) return
    const name = pName.trim()
    if (!name) return
    setBusy(true)
    try {
      await api.updateProject(editProject.id, { name, employer_id: pEmployerId, active: pActive })
      await reload()
      setEditProject(null)
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  // ---- Abwesenheitstyp ----
  function openAbs(idx: number) {
    const t = absTypes[idx]
    setEditAbsIdx(idx)
    setAbsLabel(t.label)
    setAbsColor(t.color)
    setAbsIcon(t.icon)
  }
  async function saveAbs() {
    if (editAbsIdx === null) return
    const next = absTypes.map((t, i) => (i === editAbsIdx ? { ...t, label: absLabel.trim() || t.label, color: absColor, icon: absIcon } : t))
    setEditAbsIdx(null)
    await persistSettings({ absence_types: JSON.stringify(next) })
  }

  const iconBtn: CSSProperties = { width: 40, height: 40, borderRadius: '50%', ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }
  const label: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 9 }
  const field: CSSProperties = { width: '100%', boxSizing: 'border-box', borderRadius: 14, border: '1.5px solid var(--border)', background: 'var(--glass)', padding: '13px 15px', fontSize: 16, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }
  const cardStyle: CSSProperties = { borderRadius: 22, ...GLASS, padding: '18px 20px' }

  const swatchRow = (colors: string[], current: string, pick: (c: string) => void) => {
    const cur = current.toLowerCase()
    const custom = !colors.some((c) => c.toLowerCase() === cur)
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        {colors.map((c) => {
          const on = c.toLowerCase() === cur
          return (
            <div
              key={c}
              onClick={() => pick(c)}
              title={c}
              style={{ width: 32, height: 32, borderRadius: '50%', background: c, cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 15, fontWeight: 900, boxShadow: on ? '0 0 0 2px var(--screen), 0 0 0 4px var(--ink)' : 'inset 0 0 0 1px rgba(0,0,0,0.12)' }}
            >
              {on ? '✓' : ''}
            </div>
          )
        })}
        <label title="Eigene Farbe" style={{ width: 32, height: 32, borderRadius: '50%', border: `2px ${custom ? 'solid var(--ink)' : 'dashed var(--border)'}`, background: custom ? current : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer', position: 'relative', overflow: 'hidden', color: custom ? '#fff' : 'var(--ink3)', fontSize: 14 }}>
          {custom ? '✓' : '🎨'}
          <input type="color" value={current} onChange={(e) => pick(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
        </label>
      </div>
    )
  }

  // 5–6 (ggf. kontextabhängige) Vorschläge inline + Button, der die Emoji-Tabelle öffnet.
  const iconRow = (current: string, pick: (e: string) => void, suggestions: string[] = SUGGESTED_ICONS) => {
    const items = suggestions.includes(current) ? suggestions : [current, ...suggestions].slice(0, 6)
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {items.map((em) => (
          <div key={em} onClick={() => pick(em)} style={{ width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', fontSize: 22, cursor: 'pointer', background: current === em ? 'var(--glass-strong)' : 'var(--glass)', border: `2px solid ${current === em ? 'var(--ink)' : 'var(--border)'}` }}>
            {em}
          </div>
        ))}
        <div onClick={() => setEmojiPick({ current, pick, suggestions })} title="Weitere Emojis …" style={{ width: 44, height: 44, borderRadius: 13, display: 'grid', placeItems: 'center', cursor: 'pointer', ...GLASS, color: 'var(--ink2)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M8.5 14a4 4 0 0 0 7 0" />
            <path d="M9 9.5h.01M15 9.5h.01" />
          </svg>
        </div>
      </div>
    )
  }

  return (
    <div data-theme={theme} style={{ fontFamily: "-apple-system, system-ui, 'Manrope', sans-serif", height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div style={{ zoom: 0.9, width: 'calc(100vw / 0.9)', height: 'calc(100vh / 0.9)', background: 'var(--screen)', overflow: 'hidden', position: 'relative', padding: '44px 68px', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        {/* top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 45 }}>
          <div onClick={onBack} title="Zurück zu Mein Tag" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 16, ...GLASS, cursor: 'pointer', color: 'var(--ink)', fontSize: 14, fontWeight: 800 }}>‹ Mein Tag</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div onClick={onOpenSpotlight} title="Suche (Spotlight)" style={iconBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            </div>
            <div onClick={onOpenTodos} title="To-Dos" style={iconBtn}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4 6l1 1 2-2" /><path d="M4 12l1 1 2-2" /><path d="M4 18l1 1 2-2" /></svg>
            </div>
            <div onClick={onOpenCalendar} title="Kalender" style={iconBtn}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18" /><path d="M8 2.5v4" /><path d="M16 2.5v4" /></svg>
            </div>
            <div onClick={onToggleTheme} title="Farbschema wechseln" style={iconBtn}>
              {theme === 'light' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              )}
            </div>
          </div>
        </div>

        {/* hero */}
        <div style={{ marginTop: 22, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '3px', color: 'var(--ink2)', textTransform: 'uppercase' }}>Einstellungen</div>
          <div style={{ fontSize: 60, lineHeight: 0.9, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-2px', marginTop: 6 }}>Verwalten</div>
        </div>

        {loading ? (
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink3)' }}>Lädt …</div>
        ) : loadError ? (
          <div style={{ fontSize: 15, fontWeight: 700, color: '#E5484D' }}>{loadError}</div>
        ) : (
          <>
            {/* Themen-Tabs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 5, borderRadius: 16, ...GLASS, marginBottom: 16, width: 'fit-content' }}>
              {TABS.map((t) => (
                <div
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{ padding: '9px 16px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 800, whiteSpace: 'nowrap', color: tab === t.key ? '#fff' : 'var(--ink2)', background: tab === t.key ? 'var(--accent, #22C55E)' : 'transparent' }}
                >
                  {t.label}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, paddingRight: 4 }}>
            {/* Allgemein */}
            {tab === 'allgemein' && (
            <div style={cardStyle}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 16 }}>Allgemein</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <div style={label}>Hauptakzentfarbe</div>
                  {swatchRow(ACCENT_SWATCHES, settings.accent_color, (c) => void persistSettings({ accent_color: c }))}
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={label}>Startdatum (Zählung ab)</div>
                    <input type="date" lang="de-DE" value={settings.start_date} onChange={(e) => void persistSettings({ start_date: e.target.value })} style={{ ...field, fontSize: 15 }} />
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={label}>Bundesland (Feiertage)</div>
                    <select value={settings.bundesland} onChange={(e) => void persistSettings({ bundesland: e.target.value })} style={{ ...field, fontSize: 15, cursor: 'pointer' }}>
                      {BUNDESLAENDER.map((b) => (
                        <option key={b.code} value={b.code}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>
            )}

            {/* Kürzel */}
            {tab === 'kuerzel' && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Befehle & Kürzel</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>frei belegbar · in der Suche auslösbar</div>
              </div>
              {(() => {
                const counts: Record<string, number> = {}
                for (const c of COMMANDS) {
                  const k = hotkeys[c.id]
                  if (k) counts[k] = (counts[k] ?? 0) + 1
                }
                return COMMAND_GROUPS.map((group) => (
                  <div key={group} style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>{group}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {COMMANDS.filter((c) => c.group === group).map((c) => {
                        const combo = hotkeys[c.id] || ''
                        const isRec = recording === c.id
                        const conflict = !!combo && counts[combo] > 1
                        return (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 13, background: 'var(--screen)', border: '1px solid var(--hair)' }}>
                            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--glass)', border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', fontSize: 17, flex: 'none' }}>{c.icon}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{c.label}</div>
                              {conflict && <div style={{ fontSize: 11, fontWeight: 700, color: '#E5484D', marginTop: 1 }}>Kürzel doppelt belegt</div>}
                            </div>
                            <div
                              onClick={() => setRecording(isRec ? null : c.id)}
                              title={isRec ? 'Abbrechen (Esc)' : 'Kürzel aufnehmen'}
                              style={{
                                minWidth: 96,
                                textAlign: 'center',
                                padding: '7px 12px',
                                borderRadius: 11,
                                cursor: 'pointer',
                                fontSize: 13,
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                                color: isRec ? 'var(--accent, #22C55E)' : combo ? 'var(--ink)' : 'var(--ink3)',
                                background: isRec ? 'color-mix(in srgb, var(--accent, #22C55E) 14%, transparent)' : 'var(--glass)',
                                border: `1.5px solid ${isRec ? 'var(--accent, #22C55E)' : conflict ? '#E5484D' : 'var(--border)'}`,
                              }}
                            >
                              {isRec ? 'Taste drücken …' : combo ? formatHotkey(combo) : 'Nicht belegt'}
                            </div>
                            <div
                              onClick={() => setHotkey(c.id, DEFAULT_HOTKEYS[c.id] ?? '')}
                              title="Auf Standard zurücksetzen"
                              style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink3)', flex: 'none' }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                            </div>
                            <div
                              onClick={() => setHotkey(c.id, '')}
                              title="Kürzel entfernen"
                              style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink3)', flex: 'none' }}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              })()}
            </div>
            )}

            {/* Bereiche & Projekte */}
            {tab === 'bereiche' && (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 2px 0' }}>
              <div style={{ flex: 1, fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)' }}>Bereiche</div>
              <div onClick={() => void newArea()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 12, background: 'color-mix(in srgb, var(--accent, #22C55E) 14%, transparent)', border: '1.5px solid var(--accent, #22C55E)', cursor: 'pointer', fontSize: 13, fontWeight: 800, color: 'var(--accent, #22C55E)' }}>+ Bereich</div>
            </div>
            {employers.map((e, idx) => {
              const color = e.color || employerColor(e.id)
              const projs = projectsByEmployer.get(e.id) ?? []
              const sub = e.kind === 'private' ? `Ziel ${formatH(e.weekly_goal_min)} / Woche` : `${formatH(weekTotal(e.id))} / Woche`
              const inactive = e.active !== 1
              const dragging = areaGrip === idx
              return (
                <div
                  key={e.id}
                  draggable
                  onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; setAreaGrip(idx) }}
                  onDragOver={(ev) => { if (areaGrip !== null) ev.preventDefault() }}
                  onDrop={(ev) => { ev.preventDefault(); if (areaGrip !== null && areaGrip !== idx) void reorderAreas(areaGrip, idx); setAreaGrip(null) }}
                  onDragEnd={() => setAreaGrip(null)}
                  style={{ ...cardStyle, opacity: dragging ? 0.4 : inactive ? 0.55 : 1, boxShadow: dragging ? '0 12px 30px var(--hair)' : undefined }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div title="Ziehen zum Sortieren" style={{ flex: 'none', cursor: 'grab', color: 'var(--ink3)', fontSize: 18, lineHeight: 1, padding: '0 2px', userSelect: 'none' }}>⠿</div>
                    <div style={{ width: 38, height: 38, borderRadius: 12, background: `color-mix(in srgb, ${color} 18%, transparent)`, display: 'grid', placeItems: 'center', fontSize: 20, flex: 'none' }}>{e.icon}</div>
                    <div onClick={() => openArea(e)} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.3px' }}>{e.name}</div>
                        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', color: '#fff', background: color, padding: '2px 7px', borderRadius: 7 }}>{e.kind === 'private' ? 'Privat' : 'Arbeit'}</div>
                        {inactive && <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--ink3)', border: '1px solid var(--hair)', padding: '1px 6px', borderRadius: 7 }}>Inaktiv</div>}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink2)', marginTop: 1 }}>{sub}</div>
                    </div>
                    <div onClick={async () => { await api.updateEmployer(e.id, { active: inactive }); await reload() }} title={inactive ? 'Aktivieren' : 'Deaktivieren'} style={{ padding: '7px 12px', borderRadius: 11, border: '1px solid var(--hair)', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>{inactive ? 'Aktivieren' : 'Aktiv'}</div>
                    <div onClick={() => openArea(e)} title="Bearbeiten" style={{ width: 36, height: 36, borderRadius: 11, border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>{pencil}</div>
                  </div>
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--hair)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {projs.map((p, pIdx) => {
                      const pDragging = projGrip?.emp === e.id && projGrip.idx === pIdx
                      return (
                        <div
                          key={p.id}
                          draggable
                          onDragStart={(ev) => { ev.stopPropagation(); ev.dataTransfer.effectAllowed = 'move'; setProjGrip({ emp: e.id, idx: pIdx }) }}
                          onDragOver={(ev) => { if (projGrip?.emp === e.id) { ev.preventDefault(); ev.stopPropagation() } }}
                          onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (projGrip?.emp === e.id && projGrip.idx !== pIdx) void reorderProjects(e.id, projGrip.idx, pIdx); setProjGrip(null) }}
                          onDragEnd={() => setProjGrip(null)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 13, background: 'var(--screen)', border: '1px solid var(--hair)', opacity: pDragging ? 0.4 : p.active !== 1 ? 0.5 : 1, boxShadow: pDragging ? '0 8px 20px var(--hair)' : undefined }}
                        >
                          <div title="Ziehen zum Sortieren" style={{ flex: 'none', cursor: 'grab', color: 'var(--ink3)', fontSize: 15, lineHeight: 1, userSelect: 'none' }}>⠿</div>
                          <div style={{ width: 9, height: 9, borderRadius: 3, background: color, flex: 'none' }} />
                          <div onClick={() => openProject(p)} style={{ flex: 1, minWidth: 0, cursor: 'pointer', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{p.name}{p.active !== 1 ? ' · inaktiv' : ''}</div>
                          <div onClick={() => openProject(p)} title="Bearbeiten" style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)' }}>{pencil}</div>
                        </div>
                      )
                    })}
                    <div onClick={() => void newProject(e.id)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderRadius: 13, border: '1.5px dashed var(--border)', color: 'var(--ink2)', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>+ Projekt in {e.name}</div>
                  </div>
                </div>
              )
            })}
            </>
            )}

            {/* Abwesenheiten */}
            {tab === 'abwesenheit' && (
            <>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--ink3)', margin: '6px 2px 0' }}>Abwesenheitstypen</div>
            <div style={cardStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {absTypes.map((t, i) => (
                  <div key={t.key} onClick={() => openAbs(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 13, background: 'var(--screen)', border: '1px solid var(--hair)', cursor: 'pointer' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: `color-mix(in srgb, ${t.color} 18%, transparent)`, display: 'grid', placeItems: 'center', fontSize: 18, flex: 'none' }}>{t.icon}</div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{t.label}</div>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: t.color, flex: 'none' }} />
                    <div style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--hair)', display: 'grid', placeItems: 'center', color: 'var(--ink2)' }}>{pencil}</div>
                  </div>
                ))}
              </div>
            </div>
            </>
            )}
          </div>
          </>
        )}
      </div>

      {/* Bereich-Editor */}
      {editArea && (
        <div onClick={() => setEditArea(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ width: 480, maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px 16px' }}>
              <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>Bereich bearbeiten</div>
              <div onClick={() => setEditArea(null)} style={{ width: 38, height: 38, borderRadius: 12, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 17, fontWeight: 600 }}>✕</div>
            </div>
            <div style={{ padding: '4px 28px 26px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={label}>Name</div>
                <input value={aName} onChange={(ev) => setAName(ev.target.value)} placeholder="Bezeichnung" style={field} />
              </div>
              <div>
                <div style={label}>Typ</div>
                <div style={{ display: 'flex', padding: 4, gap: 4, borderRadius: 14, ...GLASS, width: 'fit-content' }}>
                  {(['work', 'private'] as const).map((k) => (
                    <div key={k} onClick={() => setAKind(k)} style={{ padding: '9px 18px', borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: 'pointer', color: aKind === k ? '#fff' : 'var(--ink2)', background: aKind === k ? (k === 'private' ? '#7C5CFF' : 'var(--accent, #22C55E)') : 'transparent' }}>{k === 'work' ? 'Arbeit · Sollzeit' : 'Privat · Zielzeit'}</div>
                  ))}
                </div>
              </div>
              <div>
                <div style={label}>Farbe</div>
                {swatchRow(AREA_SWATCHES, aColor, setAColor)}
              </div>
              <div>
                <div style={label}>Icon</div>
                {iconRow(aIcon, setAIcon, suggestIcons(aName))}
              </div>
              {aKind === 'work' ? (
                <div>
                  <div style={label}>Sollstunden pro Wochentag</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {WD_ORDER.map((wd) => (
                      <div key={wd} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink3)' }}>{WD_LABEL[wd]}</div>
                        <input
                          type="number"
                          min={0}
                          step={0.25}
                          value={aHours[wd] ? (aHours[wd] / 60).toString() : ''}
                          placeholder="0"
                          onChange={(ev) => {
                            const h = parseFloat(ev.target.value.replace(',', '.'))
                            setAHours((prev) => prev.map((m, i) => (i === wd ? (Number.isFinite(h) ? Math.round(h * 60) : 0) : m)))
                          }}
                          style={{ width: 52, boxSizing: 'border-box', textAlign: 'center', borderRadius: 12, border: '1.5px solid var(--border)', background: 'var(--glass)', padding: '10px 4px', fontSize: 15, fontWeight: 700, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }}
                        />
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginTop: 8 }}>Summe: {formatH(aHours.reduce((a, b) => a + b, 0))} / Woche · 0 = kein Arbeitstag</div>
                </div>
              ) : (
                <div>
                  <div style={label}>Wochenziel</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div onClick={() => setAGoalMin((m) => Math.max(0, m - 15))} style={{ width: 46, height: 48, borderRadius: 14, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink)', fontSize: 22, fontWeight: 700 }}>−</div>
                    <div style={{ flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{formatH(aGoalMin)}</div>
                    <div onClick={() => setAGoalMin((m) => m + 15)} style={{ width: 46, height: 48, borderRadius: 14, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink)', fontSize: 22, fontWeight: 700 }}>+</div>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink3)', marginTop: 8 }}>Private Bereiche laufen gegen ein Wochenziel — kein Minus, keine Feiertags-/Abwesenheitskürzung.</div>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Aktiv</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>Inaktive fallen aus künftigen Auswahllisten; alte Buchungen bleiben.</div>
                </div>
                <div onClick={() => setAActive((v) => !v)} style={{ width: 46, height: 26, borderRadius: 13, background: aActive ? 'var(--accent, #22C55E)' : 'var(--track)', position: 'relative', cursor: 'pointer', flex: 'none', transition: 'background .2s ease' }}>
                  <div style={{ position: 'absolute', top: 2, left: aActive ? 22 : 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left .2s ease' }} />
                </div>
              </div>
              {editErr && <div style={{ fontSize: 13, fontWeight: 700, color: '#E5484D' }}>{editErr}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
                <div onClick={() => void deleteArea()} title="Bereich löschen" style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid var(--hair)', color: '#E5484D', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Löschen</div>
                <div style={{ flex: 1 }} />
                <div onClick={() => setEditArea(null)} style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid var(--hair)', color: 'var(--ink2)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Abbrechen</div>
                <div onClick={() => void saveArea()} style={{ padding: '14px 28px', borderRadius: 14, background: 'var(--accent, #22C55E)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>Sichern</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Projekt-Editor */}
      {editProject && (
        <div onClick={() => setEditProject(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ width: 460, maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px 16px' }}>
              <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>Projekt bearbeiten</div>
              <div onClick={() => setEditProject(null)} style={{ width: 38, height: 38, borderRadius: 12, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 17, fontWeight: 600 }}>✕</div>
            </div>
            <div style={{ padding: '4px 28px 26px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={label}>Name</div>
                <input value={pName} onChange={(ev) => setPName(ev.target.value)} placeholder="Projektname" style={field} />
              </div>
              <div>
                <div style={label}>Bereich</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {employers.map((e) => {
                    const on = pEmployerId === e.id
                    const color = e.color || employerColor(e.id)
                    return (
                      <div key={e.id} onClick={() => setPEmployerId(e.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 13, cursor: 'pointer', background: on ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--glass)', border: `1.5px solid ${on ? color : 'var(--border)'}` }}>
                        <div style={{ fontSize: 15 }}>{e.icon}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: on ? 'var(--ink)' : 'var(--ink2)' }}>{e.name}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink)' }}>Aktiv</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)' }}>Inaktive fallen aus künftigen Auswahllisten; alte Buchungen bleiben.</div>
                </div>
                <div onClick={() => setPActive((v) => !v)} style={{ width: 46, height: 26, borderRadius: 13, background: pActive ? 'var(--accent, #22C55E)' : 'var(--track)', position: 'relative', cursor: 'pointer', flex: 'none', transition: 'background .2s ease' }}>
                  <div style={{ position: 'absolute', top: 2, left: pActive ? 22 : 2, width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left .2s ease' }} />
                </div>
              </div>
              {editErr && <div style={{ fontSize: 13, fontWeight: 700, color: '#E5484D' }}>{editErr}</div>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
                <div onClick={() => void deleteProject()} title="Projekt löschen" style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid var(--hair)', color: '#E5484D', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Löschen</div>
                <div style={{ flex: 1 }} />
                <div onClick={() => setEditProject(null)} style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid var(--hair)', color: 'var(--ink2)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Abbrechen</div>
                <div onClick={() => void saveProject()} style={{ padding: '14px 28px', borderRadius: 14, background: 'var(--accent, #22C55E)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>Sichern</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Abwesenheitstyp-Editor */}
      {editAbsIdx !== null && (
        <div onClick={() => setEditAbsIdx(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ width: 460, maxHeight: '88%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '24px 28px 16px' }}>
              <div style={{ fontSize: 23, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.5px' }}>Abwesenheit bearbeiten</div>
              <div onClick={() => setEditAbsIdx(null)} style={{ width: 38, height: 38, borderRadius: 12, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 17, fontWeight: 600 }}>✕</div>
            </div>
            <div style={{ padding: '4px 28px 26px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <div style={label}>Bezeichnung</div>
                <input value={absLabel} onChange={(ev) => setAbsLabel(ev.target.value)} placeholder="z. B. Urlaub" style={field} />
              </div>
              <div>
                <div style={label}>Farbe</div>
                {swatchRow(AREA_SWATCHES, absColor, setAbsColor)}
              </div>
              <div>
                <div style={label}>Icon</div>
                {iconRow(absIcon, setAbsIcon)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 2 }}>
                <div style={{ flex: 1 }} />
                <div onClick={() => setEditAbsIdx(null)} style={{ padding: '14px 18px', borderRadius: 14, border: '1px solid var(--hair)', color: 'var(--ink2)', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Abbrechen</div>
                <div onClick={() => void saveAbs()} style={{ padding: '14px 28px', borderRadius: 14, background: 'var(--accent, #22C55E)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Sichern</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Emoji-Tabelle */}
      {emojiPick && (
        <div onClick={() => setEmojiPick(null)} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'var(--veil)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
          <div onClick={(ev) => ev.stopPropagation()} style={{ width: 460, maxHeight: '80%', display: 'flex', flexDirection: 'column', borderRadius: 30, background: 'var(--screen)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 26px 14px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.4px' }}>Emoji wählen</div>
              <div onClick={() => setEmojiPick(null)} style={{ width: 36, height: 36, borderRadius: 12, ...GLASS, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--ink2)', fontSize: 16, fontWeight: 600 }}>✕</div>
            </div>
            <div style={{ padding: '0 26px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[{ label: 'Vorschläge', icons: emojiPick.suggestions }, ...EMOJI_CATEGORIES].map((g) => (
                <div key={g.label}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--ink3)', marginBottom: 8 }}>{g.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {g.icons.map((em) => (
                      <div key={em} onClick={() => { emojiPick.pick(em); setEmojiPick(null) }} style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', fontSize: 20, cursor: 'pointer', background: emojiPick.current === em ? 'var(--glass-strong)' : 'var(--glass)', border: `2px solid ${emojiPick.current === em ? 'var(--ink)' : 'var(--border)'}` }}>
                        {em}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
