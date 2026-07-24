import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { api } from '../api'

// WP-Karte v1: 2D-Streckenkarte im Deep-Dive. GPS aus activity.details.gps ([lng,lat][]),
// eingefärbt nach Pace/Speed (Quantil-Zonen), mit Abspiel-Animation beim Öffnen.
type LngLat = [number, number]
// langsam → schnell (rot/gelb → grün/blau), Garmin-artig
const SPEED_COLORS = ['#EF4444', '#F59E0B', '#EAB308', '#22C55E', '#2563EB']
const pad2 = (n: number) => String(n).padStart(2, '0')
const paceStr = (mps: number): string => { if (mps <= 0) return '–'; const sec = 1000 / mps; return `${Math.floor(sec / 60)}:${pad2(Math.round(sec % 60))}` }
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q, base = Math.floor(pos), rest = pos - base
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base]
}
const pointFC = (c: LngLat): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }] })

// Steuerbarer Zugriff für die synchronisierte Header-Animation (vom Deep-Dive-Kopf getaktet).
export interface RouteHandle { drawTo: (p: number) => void; showFull: () => void }
export default function RouteMap({ gps, speed, hr, hero, reduced, onReady }: { gps: LngLat[]; speed?: (number | null)[]; hr?: (number | null)[]; hero?: boolean; reduced?: boolean; onReady?: (h: RouteHandle) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const loadedRef = useRef(false)
  const [mapKey, setMapKey] = useState<string | undefined>(undefined) // undefined = lädt, '' = nicht konfiguriert
  const [hover, setHover] = useState<{ x: number; y: number; pace: string; hr: string } | null>(null)

  // Speed/HR am GPS-Index (Indizes können leicht abweichen → proportional mappen)
  const sampleAt = (arr: (number | null)[] | undefined, i: number): number | null => {
    if (!arr || arr.length === 0) return null
    const j = gps.length > 1 ? Math.round((i / (gps.length - 1)) * (arr.length - 1)) : 0
    const v = arr[j]; return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  const { segFeatures, minS, maxS } = useMemo(() => {
    const spds: number[] = []
    for (let i = 0; i < gps.length; i++) { const s = sampleAt(speed, i); if (s != null && s > 0.3) spds.push(s) }
    const sorted = [...spds].sort((a, b) => a - b)
    const th = [0.2, 0.4, 0.6, 0.8].map((q) => quantile(sorted, q))
    const zoneOf = (s: number) => { let z = 0; while (z < 4 && s >= th[z]) z++; return z }
    const features: GeoJSON.Feature<GeoJSON.LineString>[] = []
    for (let i = 0; i < gps.length - 1; i++) {
      const s0 = sampleAt(speed, i), s1 = sampleAt(speed, i + 1)
      const s = s0 != null && s1 != null ? (s0 + s1) / 2 : (s0 ?? s1 ?? 0)
      features.push({ type: 'Feature', properties: { color: SPEED_COLORS[zoneOf(s)], idx: i }, geometry: { type: 'LineString', coordinates: [gps[i], gps[i + 1]] } })
    }
    return { segFeatures: features, minS: sorted[0] ?? 0, maxS: sorted[sorted.length - 1] ?? 0 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps, speed])

  useEffect(() => { api.getMapConfig().then((c) => setMapKey(c.key ?? '')).catch(() => setMapKey('')) }, [])

  useEffect(() => {
    if (!mapKey || !containerRef.current || mapRef.current || gps.length < 2) return
    // Bounds vorab berechnen und der Kamera schon im Konstruktor mitgeben → kein Welt-Flash/-Sprung vor der Animation.
    const b = new maplibregl.LngLatBounds(gps[0], gps[0])
    for (const p of gps) b.extend(p)
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapKey}`,
      bounds: b,
      fitBoundsOptions: { padding: hero ? 22 : 36, maxZoom: 16 },
      attributionControl: { compact: true },
      interactive: !hero, // Hero = dekorativer Hintergrund hinter Titel/Tags
      cooperativeGestures: !hero, // im scrollbaren Deep-Dive kein Scroll-Trap
    })
    mapRef.current = map
    if (!hero) map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), 'top-right')
    map.on('load', () => {
      loadedRef.current = true
      map.fitBounds(b, { padding: hero ? 22 : 36, duration: 0, maxZoom: 16 }) // Sicherheits-Fit (instant), falls Layout erst spät steht
      map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 4.5 } })
      map.addSource('head', { type: 'geojson', data: pointFC(gps[0]) })
      map.addLayer({ id: 'head', type: 'circle', source: 'head', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2.5 } })
      if (!hero) {
        map.on('mousemove', 'route', (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0]; if (!f) return
          const idx = (f.properties?.idx as number) ?? 0
          const s = sampleAt(speed, idx), h = sampleAt(hr, idx)
          setHover({ x: e.point.x, y: e.point.y, pace: s != null && s > 0 ? `${paceStr(s)} /km` : '–', hr: h != null ? `${Math.round(h)} bpm` : '–' })
          map.getCanvas().style.cursor = 'crosshair'
        })
        map.on('mouseleave', 'route', () => { setHover(null); map.getCanvas().style.cursor = '' })
      }
      // Strecke + Marker werden extern getaktet (synchron zum Deep-Dive-Kopf).
      const routeSrc = () => map.getSource('route') as maplibregl.GeoJSONSource
      const headSrc = () => map.getSource('head') as maplibregl.GeoJSONSource
      const handle: RouteHandle = {
        drawTo(p) { const nSeg = segFeatures.length; if (!nSeg) return; const k = Math.max(1, Math.floor(p * nSeg)); routeSrc().setData({ type: 'FeatureCollection', features: segFeatures.slice(0, k) }); headSrc().setData(pointFC(gps[Math.min(gps.length - 1, Math.floor(p * (gps.length - 1)))])) },
        showFull() { routeSrc().setData({ type: 'FeatureCollection', features: segFeatures }); headSrc().setData(pointFC(gps[gps.length - 1])) },
      }
      if (reduced || !onReady) handle.showFull() // reduced-motion oder kein Controller → sofort volle Strecke
      onReady?.(handle)
    })
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); map.remove(); mapRef.current = null; loadedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey])

  if (mapKey === '') return hero ? (
    <div style={{ width: '100%', height: '100%', background: 'var(--track)' }} /> // Hero: neutraler Hintergrund, kein Hinweistext hinter dem Titel
  ) : (
    <div style={{ height: 120, borderRadius: 18, border: '1px dashed var(--hair)', background: 'var(--track)', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '0 20px' }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--ink2)' }}>Karten-Key nicht konfiguriert</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink3)', marginTop: 4 }}>MAPTILER_KEY in den Umgebungsvariablen setzen, dann erscheint hier die Strecke.</div>
      </div>
    </div>
  )

  const badge: CSSProperties = { position: 'absolute', zIndex: 2, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 12, background: 'var(--glass-strong, var(--card))', border: '1px solid var(--border)', boxShadow: '0 6px 18px -10px rgba(0,0,0,0.4)', fontSize: 11.5, fontWeight: 800, color: 'var(--ink2)' }
  return (
    <div style={{ position: 'relative', width: '100%', height: hero ? '100%' : 340, borderRadius: hero ? 0 : 18, overflow: 'hidden', border: hero ? 'none' : '1px solid var(--hair)' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {mapKey === undefined && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink3)', fontWeight: 700, fontSize: 13 }}>Karte lädt…</div>}
      {/* Pace-Farblegende */}
      <div style={{ ...badge, left: 12, bottom: 12, flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><span>schnell</span><span>langsam</span></div>
        <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', width: 132 }}>{[...SPEED_COLORS].reverse().map((c) => <div key={c} style={{ flex: 1, background: c }} />)}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, color: 'var(--ink3)', fontVariantNumeric: 'tabular-nums' }}><span>{paceStr(maxS)}</span><span>{paceStr(minS)}</span></div>
      </div>
      {hover && (
        <div style={{ position: 'absolute', left: hover.x, top: hover.y, transform: 'translate(-50%, calc(-100% - 12px))', pointerEvents: 'none', zIndex: 3, background: 'var(--glass-strong, var(--card))', border: '1px solid var(--border)', borderRadius: 9, padding: '5px 9px', boxShadow: '0 8px 22px -12px rgba(0,0,0,0.5)', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{hover.pace} · {hover.hr}</div>
      )}
    </div>
  )
}
