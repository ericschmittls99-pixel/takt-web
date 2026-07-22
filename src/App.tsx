import { useEffect, useMemo, useRef, useState } from 'react'
import MeinTag from './pages/MeinTag'
import Todos from './pages/Todos'
import Calendar from './pages/Calendar'
import Auswertung from './pages/Auswertung'
import Verwalten from './pages/Verwalten'
import Puls from './pages/Puls'
import Spotlight from './components/Spotlight'
import { api, type AppSettings, type Entry } from './api'
import { COMMANDS, DEFAULT_HOTKEYS, eventToHotkey, type CommandId } from './commands'

type View = 'mein-tag' | 'todos' | 'calendar' | 'auswertung' | 'verwalten' | 'puls'

type AuswMode = 'week' | 'month' | 'year' | 'gesamt'
// Durchgängige Zoom-Leiter (Variante B): Tag (Mein Tag) ↔ Woche/Monat/Jahr/Gesamt (Auswertung).
type Level = 'tag' | AuswMode
const LEVELS: Level[] = ['tag', 'week', 'month', 'year', 'gesamt']

// Seiten-interne Aktionen, die per Command ausgelöst werden. `nonce` erzwingt,
// dass ein wiederholtes Auslösen derselben Aktion erneut greift.
export type PageIntent = {
  action: 'new-entry' | 'toggle-tracking' | 'new-todo' | 'new-absence' | 'period-prev' | 'period-next' | 'planner-toggle' | 'plan-split' | 'level-up' | 'level-down' | 'filter-toggle' | 'export-open' | 'list-view' | 'open-entry' | 'open-planned'
  nonce: number
  entry?: Entry
  plan?: { id: number; weekday: number; employer_id: number; project_id: number | null; start_min: number; end_min: number }
}

const DEFAULT_SETTINGS: AppSettings = {
  accent_color: '#22C55E',
  start_date: '2000-01-01',
  bundesland: 'RP',
  absence_types: '[]',
  hotkeys: JSON.stringify(DEFAULT_HOTKEYS),
  puls_trends_layout: '',
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function isEditable(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

export default function App() {
  const [view, setView] = useState<View>('mein-tag')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()))
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [spotlightOpen, setSpotlightOpen] = useState(false)
  const [intent, setIntent] = useState<PageIntent | null>(null)
  const [auswMode, setAuswMode] = useState<AuswMode>('week')
  const [zoomLevel, setZoomLevel] = useState<Level>('tag')
  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  // Zoom-Ebene mit der sichtbaren Seite synchron halten (Mein Tag = Tag, Auswertung = Modus).
  useEffect(() => {
    if (view === 'mein-tag') setZoomLevel('tag')
    else if (view === 'auswertung') setZoomLevel(auswMode)
  }, [view, auswMode])

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setSettings({ ...DEFAULT_SETTINGS, ...s }))
      .catch(() => {})
  }, [])

  // Akzentfarbe global als CSS-Variable bereitstellen.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.accent_color)
  }, [settings.accent_color])

  // Belegte Kürzel: Default + gespeicherte Overrides (leerer Wert = entbunden).
  const hotkeys = useMemo<Record<string, string>>(() => {
    try {
      return { ...DEFAULT_HOTKEYS, ...(JSON.parse(settings.hotkeys || '{}') as Record<string, string>) }
    } catch {
      return { ...DEFAULT_HOTKEYS }
    }
  }, [settings.hotkeys])

  // Umkehrindex Kombi → Command für den globalen Dispatcher.
  const comboToId = useMemo(() => {
    const m = new Map<string, CommandId>()
    for (const c of COMMANDS) {
      const combo = hotkeys[c.id]
      if (combo) m.set(combo, c.id)
    }
    return m
  }, [hotkeys])

  function runCommand(id: CommandId) {
    setSpotlightOpen(false)
    switch (id) {
      case 'nav-mein-tag':
        setView('mein-tag')
        break
      case 'nav-todos':
        setView('todos')
        break
      case 'nav-calendar':
        setView('calendar')
        break
      case 'nav-auswertung':
        setView('auswertung')
        break
      case 'nav-verwalten':
        setView('verwalten')
        break
      case 'nav-puls':
        setView('puls')
        break
      case 'toggle-theme':
        toggleTheme()
        break
      case 'open-spotlight':
        setSpotlightOpen(true)
        break
      case 'new-entry':
        setView('mein-tag')
        setIntent({ action: 'new-entry', nonce: Date.now() })
        break
      case 'toggle-tracking':
        setView('mein-tag')
        setIntent({ action: 'toggle-tracking', nonce: Date.now() })
        break
      case 'new-todo':
        setView('todos')
        setIntent({ action: 'new-todo', nonce: Date.now() })
        break
      case 'period-prev':
      case 'period-next': {
        const dir = id === 'period-next' ? 1 : -1
        if (view === 'mein-tag') {
          setSelectedDay((d) => { const x = new Date(d); x.setDate(x.getDate() + dir); x.setHours(0, 0, 0, 0); return x })
        } else if (view === 'calendar' || view === 'auswertung') {
          setIntent({ action: id, nonce: Date.now() })
        }
        break
      }
      case 'planner-toggle':
        setView('calendar')
        setIntent({ action: 'planner-toggle', nonce: Date.now() })
        break
      case 'plan-split':
        setView('calendar')
        setIntent({ action: 'plan-split', nonce: Date.now() })
        break
      case 'level-up':
      case 'level-down': {
        // Im Kalender bleibt die Ebene im Kalender (Woche/Monat/Jahr) statt in die Zoom-Leiter zu springen.
        if (view === 'calendar') {
          setIntent({ action: id, nonce: Date.now() })
          break
        }
        const idx = LEVELS.indexOf(zoomLevel)
        const level = LEVELS[id === 'level-up' ? Math.min(idx + 1, LEVELS.length - 1) : Math.max(idx - 1, 0)]
        setZoomLevel(level)
        if (level === 'tag') setView('mein-tag')
        else { setAuswMode(level); setView('auswertung') }
        break
      }
      case 'new-absence':
        setView('calendar')
        setIntent({ action: 'new-absence', nonce: Date.now() })
        break
      case 'filter-toggle':
        setView('calendar')
        setIntent({ action: 'filter-toggle', nonce: Date.now() })
        break
      case 'export-open':
        setView('calendar')
        setIntent({ action: 'export-open', nonce: Date.now() })
        break
      case 'list-view':
        setView('calendar')
        setIntent({ action: 'list-view', nonce: Date.now() })
        break
    }
  }

  // Immer die frischeste runCommand-Referenz im globalen Listener nutzen.
  const runCommandRef = useRef(runCommand)
  runCommandRef.current = runCommand

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const combo = eventToHotkey(e)
      if (!combo) return
      const id = comboToId.get(combo)
      if (!id) return
      // In Eingabefeldern nur das Öffnen der Suche zulassen.
      if (isEditable(document.activeElement) && id !== 'open-spotlight') return
      e.preventDefault()
      runCommandRef.current(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [comboToId])

  const openSpotlight = () => setSpotlightOpen(true)
  const clearIntent = () => setIntent(null)

  let screen: React.ReactNode
  if (view === 'todos') {
    screen = (
      <Todos
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={() => setView('mein-tag')}
        onOpenCalendar={() => setView('calendar')}
        onOpenSpotlight={openSpotlight}
        intent={intent}
        onIntentDone={clearIntent}
      />
    )
  } else if (view === 'calendar') {
    screen = (
      <Calendar
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={() => setView('mein-tag')}
        onOpenTodos={() => setView('todos')}
        onOpenSpotlight={openSpotlight}
        settings={settings}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        intent={intent}
        onIntentDone={clearIntent}
      />
    )
  } else if (view === 'verwalten') {
    screen = (
      <Verwalten
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={() => setView('mein-tag')}
        onOpenTodos={() => setView('todos')}
        onOpenCalendar={() => setView('calendar')}
        onOpenSpotlight={openSpotlight}
        settings={settings}
        onSettingsChange={setSettings}
      />
    )
  } else if (view === 'puls') {
    screen = (
      <Puls
        theme={theme}
        onBack={() => setView('mein-tag')}
        onOpenTodos={() => setView('todos')}
        onOpenCalendar={() => setView('calendar')}
        onOpenSpotlight={openSpotlight}
        settings={settings}
        selectedDay={selectedDay}
        onOpenDay={(day: Date) => { setSelectedDay(startOfDay(day)); setView('mein-tag') }}
      />
    )
  } else if (view === 'auswertung') {
    screen = (
      <Auswertung
        theme={theme}
        onToggleTheme={toggleTheme}
        onBack={() => setView('mein-tag')}
        onOpenCalendar={() => setView('calendar')}
        onOpenTodos={() => setView('todos')}
        onOpenSpotlight={openSpotlight}
        settings={settings}
        setSelectedDay={setSelectedDay}
        mode={auswMode}
        onModeChange={setAuswMode}
        intent={intent}
        onIntentDone={clearIntent}
      />
    )
  } else {
    screen = (
      <MeinTag
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenTodos={() => setView('todos')}
        onOpenCalendar={() => setView('calendar')}
        onOpenAuswertung={() => setView('auswertung')}
        onOpenVerwalten={() => setView('verwalten')}
        onOpenPuls={() => setView('puls')}
        onOpenSpotlight={openSpotlight}
        settings={settings}
        selectedDay={selectedDay}
        setSelectedDay={setSelectedDay}
        intent={intent}
        onIntentDone={clearIntent}
      />
    )
  }

  return (
    <>
      {screen}
      <Spotlight
        open={spotlightOpen}
        theme={theme}
        hotkeys={hotkeys}
        onClose={() => setSpotlightOpen(false)}
        onRunCommand={runCommand}
        onOpenEntry={(entry: Entry) => {
          setSelectedDay(startOfDay(new Date(entry.start_ts)))
          setView('calendar')
          setIntent({ action: 'open-entry', entry, nonce: Date.now() })
        }}
        onOpenPlanned={(b) => {
          setView('calendar')
          setIntent({ action: 'open-planned', plan: b, nonce: Date.now() })
        }}
        onOpenTodos={() => setView('todos')}
      />
    </>
  )
}
