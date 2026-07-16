// Zentrale Registry aller per Hotkey/Spotlight auslösbaren App-Funktionen.
// Wird von App.tsx (Dispatcher), Verwalten.tsx (Konfiguration) und
// Spotlight.tsx (Suche) geteilt.

export type CommandGroup = 'Navigation' | 'Ansicht' | 'Aktionen' | 'Zeitraum'

export type CommandId =
  | 'nav-mein-tag'
  | 'nav-todos'
  | 'nav-calendar'
  | 'nav-auswertung'
  | 'nav-verwalten'
  | 'toggle-theme'
  | 'open-spotlight'
  | 'filter-toggle'
  | 'export-open'
  | 'new-entry'
  | 'toggle-tracking'
  | 'new-todo'
  | 'new-absence'
  | 'period-prev'
  | 'period-next'
  | 'level-up'
  | 'level-down'
  | 'plan-split'
  | 'planner-toggle'

export interface CommandDef {
  id: CommandId
  label: string
  group: CommandGroup
  icon: string
}

export const COMMANDS: CommandDef[] = [
  { id: 'nav-mein-tag', label: 'Mein Tag', group: 'Navigation', icon: '🕒' },
  { id: 'nav-todos', label: 'To-Dos', group: 'Navigation', icon: '✅' },
  { id: 'nav-calendar', label: 'Kalender', group: 'Navigation', icon: '📅' },
  { id: 'nav-auswertung', label: 'Auswertung', group: 'Navigation', icon: '📊' },
  { id: 'nav-verwalten', label: 'Verwalten', group: 'Navigation', icon: '⚙️' },
  { id: 'open-spotlight', label: 'Suche öffnen', group: 'Ansicht', icon: '🔍' },
  { id: 'toggle-theme', label: 'Farbschema wechseln', group: 'Ansicht', icon: '🌓' },
  { id: 'filter-toggle', label: 'Filter (Kalender)', group: 'Ansicht', icon: '🎚️' },
  { id: 'export-open', label: 'Export (Kalender)', group: 'Ansicht', icon: '📤' },
  { id: 'new-entry', label: 'Neue Aktivität', group: 'Aktionen', icon: '➕' },
  { id: 'toggle-tracking', label: 'Tracking Start/Stopp', group: 'Aktionen', icon: '⏱️' },
  { id: 'new-todo', label: 'Neues To-Do', group: 'Aktionen', icon: '📝' },
  { id: 'new-absence', label: 'Abwesenheit anlegen', group: 'Aktionen', icon: '🌴' },
  { id: 'period-prev', label: 'Periode zurück', group: 'Zeitraum', icon: '◀️' },
  { id: 'period-next', label: 'Periode vor', group: 'Zeitraum', icon: '▶️' },
  { id: 'level-down', label: 'Ebene runter (rein: Gesamt→Tag)', group: 'Zeitraum', icon: '🔽' },
  { id: 'level-up', label: 'Ebene hoch (raus: Tag→Gesamt)', group: 'Zeitraum', icon: '🔼' },
  { id: 'plan-split', label: 'Plan anzeigen im Kalender', group: 'Zeitraum', icon: '📐' },
  { id: 'planner-toggle', label: 'Planner öffnen', group: 'Zeitraum', icon: '✦' },
]

export const COMMAND_GROUPS: CommandGroup[] = ['Navigation', 'Ansicht', 'Aktionen', 'Zeitraum']

const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.id, c]))
export function commandById(id: CommandId): CommandDef | undefined {
  return COMMAND_MAP.get(id)
}

// Standard-Belegung. `mod` = ⌘ auf macOS, sonst Ctrl.
export const DEFAULT_HOTKEYS: Record<CommandId, string> = {
  'open-spotlight': 'mod+k',
  'nav-mein-tag': 'mod+1',
  'nav-todos': 'mod+2',
  'nav-calendar': 'mod+3',
  'nav-auswertung': 'mod+4',
  'nav-verwalten': 'mod+5',
  'toggle-theme': 'mod+j',
  'new-entry': 'mod+e',
  'toggle-tracking': 'mod+enter',
  'new-todo': 'mod+shift+e',
  'new-absence': 'mod+shift+a',
  'filter-toggle': 'mod+shift+f',
  'export-open': 'mod+shift+x',
  'period-prev': 'mod+shift+left',
  'period-next': 'mod+shift+right',
  'level-up': 'mod+shift+up',
  'level-down': 'mod+shift+down',
  'plan-split': 'mod+shift+i',
  'planner-toggle': 'mod+shift+p',
}

// ── Hotkey-Utilities ────────────────────────────────────────────────────────

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)
}

// Physische Taste unabhängig von Layout/Modifiern (Alt verändert e.key auf Mac).
function normalizeKey(e: KeyboardEvent): string | null {
  const code = e.code
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)
  if (code === 'Space') return 'space'
  if (code === 'Enter' || code === 'NumpadEnter') return 'enter'
  if (code === 'Escape') return 'esc'
  if (code === 'Tab') return 'tab'
  if (code === 'Backspace') return 'backspace'
  if (code.startsWith('Arrow')) return code.slice(5).toLowerCase()
  // Modifier alleine sind keine vollständige Kombi.
  if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)) {
    return null
  }
  const k = e.key
  return k.length === 1 ? k.toLowerCase() : k.toLowerCase()
}

// Wandelt ein KeyboardEvent in einen normalisierten Kombi-String
// (z. B. `mod+shift+k`). Gibt null zurück, wenn nur Modifier gedrückt sind.
export function eventToHotkey(e: KeyboardEvent): string | null {
  const key = normalizeKey(e)
  if (!key) return null
  const mac = isMac()
  const parts: string[] = []
  const primary = mac ? e.metaKey : e.ctrlKey
  if (primary) parts.push('mod')
  if (mac && e.ctrlKey) parts.push('ctrl')
  if (!mac && e.metaKey) parts.push('meta')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

export function matchHotkey(e: KeyboardEvent, combo: string): boolean {
  const got = eventToHotkey(e)
  return got !== null && got === combo
}

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  enter: '⏎',
  esc: 'Esc',
  tab: '⇥',
  backspace: '⌫',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
}

// Menschenlesbare Darstellung einer Kombi (z. B. `⌘⇧K` bzw. `Ctrl+Shift+K`).
export function formatHotkey(combo: string): string {
  if (!combo) return ''
  const mac = isMac()
  const tokens = combo.split('+')
  const out = tokens.map((t) => {
    switch (t) {
      case 'mod':
        return mac ? '⌘' : 'Ctrl'
      case 'ctrl':
        return mac ? '⌃' : 'Ctrl'
      case 'meta':
        return mac ? '⌘' : 'Win'
      case 'alt':
        return mac ? '⌥' : 'Alt'
      case 'shift':
        return mac ? '⇧' : 'Shift'
      default:
        return KEY_LABELS[t] ?? (t.length === 1 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1))
    }
  })
  return mac ? out.join('') : out.join('+')
}
