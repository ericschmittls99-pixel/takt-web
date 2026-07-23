// Kurzer, angenehmer Bestätigungs-Ton beim To-Do-Abhaken (Web Audio, kein Asset).
// System-Lautstärke/-Stummschaltung wird respektiert (Ausgabe läuft über die System-Route);
// zusätzlich per Einstellung abschaltbar (siehe Aufrufer, settings.todo_sound).
let ctx: AudioContext | null = null

export function playCheckChime(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    if (!ctx) ctx = new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    // sanfte Hüllkurve, leise
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    // freundlicher Zwei-Ton-Aufwärts-Klang (C6 → E6)
    for (const [freq, t] of [[1046.5, 0], [1318.5, 0.09]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(now + t)
      osc.stop(now + t + 0.28)
    }
  } catch {
    /* Audio nicht verfügbar → still ignorieren */
  }
}
