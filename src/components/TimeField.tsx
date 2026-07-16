import { useEffect, useRef, useState, type CSSProperties } from 'react'

// Eigenes 24h-Zeitfeld als Ersatz für <input type="time"> — immer deutsche
// 24-Stunden-Darstellung, unabhängig von Browser/OS (Safari zeigt beim nativen
// Picker sonst AM/PM). Wert bleibt "HH:MM".

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function normalize(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length === 0) return null
  let h: number
  let m: number
  if (digits.length <= 2) {
    h = parseInt(digits, 10)
    m = 0
  } else {
    h = parseInt(digits.slice(0, 2), 10)
    m = parseInt(digits.slice(2), 10)
  }
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return `${pad2(Math.min(23, h))}:${pad2(Math.min(59, m))}`
}

export default function TimeField({
  value,
  onChange,
  style,
}: {
  value: string
  onChange: (v: string) => void
  style?: CSSProperties
}) {
  const [text, setText] = useState(value)
  const focused = useRef(false)

  // Externe Wertänderungen übernehmen, solange nicht gerade getippt wird.
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])

  function step(delta: number) {
    const base = normalize(text) ?? value ?? '00:00'
    const [hh, mm] = base.split(':').map((x) => parseInt(x, 10))
    let total = hh * 60 + mm + delta
    total = ((total % 1440) + 1440) % 1440
    const v = `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`
    setText(v)
    onChange(v)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      value={text}
      onFocus={(e) => {
        focused.current = true
        e.currentTarget.select()
      }}
      onChange={(e) => {
        const t = e.target.value
        setText(t)
        if (t.replace(/\D/g, '').length >= 4) {
          const n = normalize(t)
          if (n) {
            setText(n)
            onChange(n)
          }
        }
      }}
      onBlur={(e) => {
        focused.current = false
        const n = normalize(e.target.value)
        if (n) {
          setText(n)
          onChange(n)
        } else {
          setText(value)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 60 : 5))
        }
      }}
      style={style}
    />
  )
}
