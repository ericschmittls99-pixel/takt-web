import type { Employer, Project } from './api'

// Gemeinsame Schnell-Eingabe-Logik: @Bereich, #Projekt, +Frist / natürliche Datumsangaben.

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const WEEKDAYS: Record<string, number> = { sonntag: 0, montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6 }

function resolvePhrase(p: string): string | null {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (p === 'heute') return dayKey(today)
  if (p === 'morgen') return dayKey(addDays(today, 1))
  if (p === 'übermorgen' || p === 'uebermorgen') return dayKey(addDays(today, 2))
  let mm = /^in\s+(\d+)\s+(?:tag|tage|tagen)$/.exec(p)
  if (mm) return dayKey(addDays(today, parseInt(mm[1], 10)))
  mm = /^in\s+(\d+)\s+(?:woche|wochen)$/.exec(p)
  if (mm) return dayKey(addDays(today, 7 * parseInt(mm[1], 10)))
  if (/^n[äa]chste\s+woche$/.test(p)) return dayKey(addDays(today, 7))
  if (p in WEEKDAYS) {
    const delta = (WEEKDAYS[p] - today.getDay() + 7) % 7
    return dayKey(addDays(today, delta))
  }
  mm = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(p)
  if (mm) {
    const day = +mm[1]
    const mon = +mm[2] - 1
    const yr = mm[3] ? (mm[3].length === 2 ? 2000 + +mm[3] : +mm[3]) : today.getFullYear()
    let d = new Date(yr, mon, day)
    d.setHours(0, 0, 0, 0)
    if (!mm[3] && d.getTime() < today.getTime()) d = new Date(yr + 1, mon, day)
    if (Number.isNaN(d.getTime()) || d.getMonth() !== mon) return null
    return dayKey(d)
  }
  return null
}

const DATE_RE =
  /(^|\s)(\+?)(heute|morgen|übermorgen|uebermorgen|in\s+\d+\s+(?:tag|tage|tagen|woche|wochen)|n[äa]chste\s+woche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)(?=\s|$)/gi

function parseDate(text: string): { date: string; clean: string } | null {
  DATE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = DATE_RE.exec(text)) !== null) last = m
  if (!last) return null
  const date = resolvePhrase(last[3].toLowerCase())
  if (!date) return null
  const start = last.index + last[1].length
  const end = start + last[2].length + last[3].length
  const clean = (text.slice(0, start) + text.slice(end)).replace(/\s{2,}/g, ' ').trim()
  return { date, clean }
}

export interface QuickTodo {
  title: string
  employer_id: number | null
  project_id: number | null
  due_date: string | null
}

/** @Bereich / #Projekt / +Frist (und natürliche Datumsangaben) aus dem Titel lösen. */
export function parseQuickTodo(raw: string, employers: Employer[], projects: Project[]): QuickTodo {
  let emp: number | null = null
  let proj: number | null = null
  const re = /([@#])([^\s@#]+)/g
  const strip: [number, number][] = []
  let m: RegExpExecArray | null
  let text = raw
  while ((m = re.exec(raw)) !== null) {
    const q = m[2].toLowerCase()
    if (m[1] === '@') {
      const hit = employers.find((e) => e.name.toLowerCase() === q) ?? employers.find((e) => e.name.toLowerCase().startsWith(q))
      if (hit) { emp = hit.id; strip.push([m.index, m.index + m[0].length]) }
    } else {
      const pool: Project[] = emp != null ? projects.filter((p) => p.employer_id === emp) : projects
      const hit: Project | undefined = pool.find((p) => p.name.toLowerCase() === q) ?? pool.find((p) => p.name.toLowerCase().startsWith(q))
      if (hit) { proj = hit.id; emp = hit.employer_id; strip.push([m.index, m.index + m[0].length]) }
    }
  }
  for (let i = strip.length - 1; i >= 0; i--) text = text.slice(0, strip[i][0]) + text.slice(strip[i][1])
  text = text.replace(/\s{2,}/g, ' ').trim()
  let due: string | null = null
  const dp = parseDate(text)
  if (dp) { due = dp.date; text = dp.clean }
  return { title: text.trim(), employer_id: emp, project_id: proj, due_date: due }
}
