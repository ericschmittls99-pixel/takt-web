// Bereichsfarben (Arbeitgeber) – geteilt zwischen Mein Tag und To-Dos.

export const AREA_COLORS = ['#2563EB', '#7C5CFF', '#22C55E', '#F59E0B', '#EC4899', '#06B6D4']

export function employerColor(id: number): string {
  return AREA_COLORS[Math.abs(id) % AREA_COLORS.length]
}
