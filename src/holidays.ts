// Gesetzliche Feiertage für alle 16 Bundesländer, pro Jahr berechnet.

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
function keyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function plus(d: Date, days: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + days)
  return x
}

// Ostersonntag (Anonymous Gregorian / Meeus-Algorithmus).
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

export interface BundeslandOption {
  code: string
  name: string
}

export const BUNDESLAENDER: BundeslandOption[] = [
  { code: 'BW', name: 'Baden-Württemberg' },
  { code: 'BY', name: 'Bayern' },
  { code: 'BE', name: 'Berlin' },
  { code: 'BB', name: 'Brandenburg' },
  { code: 'HB', name: 'Bremen' },
  { code: 'HH', name: 'Hamburg' },
  { code: 'HE', name: 'Hessen' },
  { code: 'MV', name: 'Mecklenburg-Vorpommern' },
  { code: 'NI', name: 'Niedersachsen' },
  { code: 'NW', name: 'Nordrhein-Westfalen' },
  { code: 'RP', name: 'Rheinland-Pfalz' },
  { code: 'SL', name: 'Saarland' },
  { code: 'SN', name: 'Sachsen' },
  { code: 'ST', name: 'Sachsen-Anhalt' },
  { code: 'SH', name: 'Schleswig-Holstein' },
  { code: 'TH', name: 'Thüringen' },
]

export function bundeslandName(code: string): string {
  return BUNDESLAENDER.find((b) => b.code === code)?.name ?? code
}

// Buß- und Bettag: Mittwoch vor dem 23. November.
function bussUndBettag(year: number): Date {
  const d = new Date(year, 10, 23)
  const back = (d.getDay() + 4) % 7 || 7
  return plus(d, -back)
}

function holidaysFor(year: number, bl: string): Map<string, string> {
  const m = new Map<string, string>()
  const E = easterSunday(year)
  const add = (d: Date, name: string) => m.set(keyOf(d), name)

  // Bundesweit einheitliche Feiertage.
  add(new Date(year, 0, 1), 'Neujahr')
  add(plus(E, -2), 'Karfreitag')
  add(plus(E, 1), 'Ostermontag')
  add(new Date(year, 4, 1), 'Tag der Arbeit')
  add(plus(E, 39), 'Christi Himmelfahrt')
  add(plus(E, 50), 'Pfingstmontag')
  add(new Date(year, 9, 3), 'Tag der Deutschen Einheit')
  add(new Date(year, 11, 25), '1. Weihnachtstag')
  add(new Date(year, 11, 26), '2. Weihnachtstag')

  // Heilige Drei Könige: BW, BY, ST.
  if (['BW', 'BY', 'ST'].includes(bl)) add(new Date(year, 0, 6), 'Heilige Drei Könige')

  // Internationaler Frauentag: BE, MV.
  if (['BE', 'MV'].includes(bl)) add(new Date(year, 2, 8), 'Internationaler Frauentag')

  // Fronleichnam: BW, BY, HE, NW, RP, SL.
  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(bl)) add(plus(E, 60), 'Fronleichnam')

  // Mariä Himmelfahrt: SL (landesweit).
  if (bl === 'SL') add(new Date(year, 7, 15), 'Mariä Himmelfahrt')

  // Weltkindertag: TH.
  if (bl === 'TH') add(new Date(year, 8, 20), 'Weltkindertag')

  // Reformationstag: BB, HB, HH, MV, NI, SN, ST, SH, TH.
  if (['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'].includes(bl)) add(new Date(year, 9, 31), 'Reformationstag')

  // Allerheiligen: BW, BY, NW, RP, SL.
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(bl)) add(new Date(year, 10, 1), 'Allerheiligen')

  // Buß- und Bettag: SN.
  if (bl === 'SN') add(bussUndBettag(year), 'Buß- und Bettag')

  return m
}

const cache = new Map<string, Map<string, string>>()
function forYear(year: number, bl: string): Map<string, string> {
  const ck = `${bl}:${year}`
  let y = cache.get(ck)
  if (!y) {
    y = holidaysFor(year, bl)
    cache.set(ck, y)
  }
  return y
}

/**
 * Feiertagsname für ein Datum (oder null). Akzeptiert Date oder "YYYY-MM-DD".
 * Das Bundesland wird als Kürzel übergeben (Default RP, für Abwärtskompatibilität).
 */
export function holidayName(date: Date | string, bundesland = 'RP'): string | null {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date
  return forYear(d.getFullYear(), bundesland).get(keyOf(d)) ?? null
}
