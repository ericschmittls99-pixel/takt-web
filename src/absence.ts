// Verteilt die Abwesenheits-Minuten anteilig nach Soll-Stunden auf die Bereiche.
// Ganzer Tag = Summe der Soll-Minuten; Zeitfenster = Fensterdauer (gedeckelt aufs Soll).
// Rundung per "größter Rest", damit die Summe exakt aufgeht.
export function distributeAbsenceMinutes(
  sollByEmp: { id: number; soll: number }[],
  allDay: boolean,
  startMin: number | null,
  endMin: number | null,
): Map<number, number> {
  const areas = sollByEmp.filter((e) => e.soll > 0)
  const total = areas.reduce((s, e) => s + e.soll, 0)
  const out = new Map<number, number>()
  if (total <= 0) return out
  const amount = allDay ? total : Math.min((endMin ?? 0) - (startMin ?? 0), total)
  const rows = areas.map((e) => {
    const val = amount * (e.soll / total)
    return { id: e.id, floor: Math.floor(val), frac: val - Math.floor(val) }
  })
  for (const r of rows) out.set(r.id, r.floor)
  const assigned = rows.reduce((s, r) => s + r.floor, 0)
  let rem = Math.round(amount) - assigned
  const order = [...rows].sort((a, b) => b.frac - a.frac)
  for (let i = 0; rem > 0 && i < order.length; i++, rem--) out.set(order[i].id, (out.get(order[i].id) ?? 0) + 1)
  return out
}
