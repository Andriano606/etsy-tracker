// Hand-rolled SVG charts for the Statistics view: no dependency, CSP-safe (no
// eval, no remote fonts), crisp at any DPI, styled by the app's tokens.
//
// Mark specs (dataviz method): 2px lines with round joins, ≥ 8px markers with a
// 2px surface ring, columns ≤ 24px with a 4px rounded data end and a square
// baseline (a rate over an interval spans that interval instead), a 2px
// surface gap between stacked segments and adjacent bars, solid hairline grid.
// Points before the domain (a period's anchor scan) are drawn clipped: the
// line enters at the left edge; they get no dot and no readout.
// Hover: a crosshair snapping to the nearest point (lines) / the nearest bar
// (bars, which lifts); the whole plot is the hit area. Keyboard: the chart is
// focusable, ←/→/Home/End move the readout. The tooltip only enhances — every
// value is also in the card's "Дані" table.

import { type ReactNode, type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import { axisLabels, nearestIndex, timeTicks, yScaleDomain } from '../chartScale'

export const M = { top: 12, right: 64, bottom: 26, left: 58 }

/** The element's width, kept current with a ResizeObserver (jsdom: `fallback`). */
export function useWidth<T extends HTMLElement>(fallback = 640): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const cw = el.clientWidth
      if (cw > 0) setW(Math.round(cw))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export interface ChartPoint {
  t: number
  v: number | null
  /** An incomplete bucket: its segments are dashed, its dot hollow, no end label. */
  partial?: boolean
}

interface Frame {
  width: number
  plotW: number
  plotH: number
  x: (t: number) => number
  y: (v: number) => number
  yTicks: number[]
}

function makeFrame(
  width: number,
  plotH: number,
  domain: [number, number],
  y: { min: number; max: number; ticks: number[] }
): Frame {
  const plotW = Math.max(40, width - M.left - M.right)
  const [t0, t1] = domain
  return {
    width,
    plotW,
    plotH,
    x: (t) => M.left + ((t - t0) / (t1 - t0 || 1)) * plotW,
    y: (v) => M.top + plotH - ((v - y.min) / (y.max - y.min || 1)) * plotH,
    yTicks: y.ticks
  }
}

function Axes({ f, domain, utc }: { f: Frame; domain: [number, number]; utc: boolean }): JSX.Element {
  const ticks = timeTicks(domain[0], domain[1], Math.max(2, Math.floor(f.plotW / 92)), utc)
  const bottom = M.top + f.plotH
  const labels = axisLabels(f.yTicks)
  return (
    <g className="axes" aria-hidden="true">
      {f.yTicks.map((v, i) => (
        <g key={v}>
          <line className="grid" x1={M.left} x2={M.left + f.plotW} y1={f.y(v)} y2={f.y(v)} />
          <text className="tick y" x={M.left - 8} y={f.y(v)} dy="0.32em" textAnchor="end">
            {labels[i]}
          </text>
        </g>
      ))}
      <line className="baseline" x1={M.left} x2={M.left + f.plotW} y1={bottom} y2={bottom} />
      {ticks.map((tk) => (
        <text key={tk.t} className="tick x" x={f.x(tk.t)} y={bottom + 17} textAnchor="middle">
          {tk.label}
        </text>
      ))}
    </g>
  )
}

/** Where a tooltip `tipW` wide goes: right of the crosshair, else left of it, always inside [0, width]. */
export function tipLeft(x: number, tipW: number, width: number): number {
  const left = x + 10 + tipW > width ? x - 10 - tipW : x + 10
  return Math.max(0, Math.min(left, width - tipW))
}

/** The hover readout: the value leads, the date/series follow. */
export function Tip({ x, width, children }: { x: number; width: number; children: ReactNode }): JSX.Element {
  // Measured, so a wide box (a review week's rating mix) never leaves the card.
  const ref = useRef<HTMLDivElement>(null)
  const [tipW, setTipW] = useState(0)
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 0
    if (w !== tipW) setTipW(w)
  })
  return (
    <div ref={ref} className="chart-tip" role="status" style={{ left: tipLeft(x, tipW, width) }}>
      {children}
    </div>
  )
}

/** Clip path of the plot area (horizontally), so marks before the domain enter at its left edge. */
function PlotClip({ id, f }: { id: string; f: Frame }): JSX.Element {
  return (
    <defs>
      <clipPath id={id}>
        <rect x={M.left} y={0} width={f.plotW} height={M.top + f.plotH + 2} />
      </clipPath>
    </defs>
  )
}

/**
 * Keyboard + pointer readout over a sorted list of x positions. With `spans`
 * ([x0, x1] per item) the pointer picks the item whose span holds it.
 */
function useReadout(xs: number[], spans?: Array<[number, number]>): {
  active: number | null
  bind: {
    tabIndex: number
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
    onMouseLeave: () => void
    onFocus: () => void
    onBlur: () => void
    onKeyDown: (e: React.KeyboardEvent) => void
  }
} {
  const [active, setActive] = useState<number | null>(null)
  const n = xs.length
  return {
    active: active != null && active < n ? active : null,
    bind: {
      tabIndex: n ? 0 : -1,
      onMouseMove: (e) => {
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left
        if (!Number.isFinite(x)) return
        const hit = spans ? spans.findIndex(([a, b]) => x >= a && x <= b) : -1
        const i = hit >= 0 ? hit : nearestIndex(xs, x)
        setActive(i >= 0 ? i : null)
      },
      onMouseLeave: () => setActive(null),
      onFocus: () => setActive((a) => (a == null ? n - 1 : a)),
      onBlur: () => setActive(null),
      onKeyDown: (e) => {
        if (!n) return
        const cur = active ?? n - 1
        let next = cur
        if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
        else if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = n - 1
        else return
        e.preventDefault()
        setActive(next)
      }
    }
  }
}

// ---------------------------------------------------------------------- line

export interface LineChartProps {
  /** Accessible name (the chart's title). */
  label: string
  points: ChartPoint[]
  domain: [number, number]
  utc?: boolean
  /** Fraction digits of axis labels. */
  digits?: number
  /** Smallest y span (e.g. 0.2 for a rating) so a flat line sits mid-plot. */
  minSpan?: number
  /** The axis never goes past this (a rating's 5). */
  ceil?: number
  height?: number
  /** Value text (tooltip, end label). */
  format: (v: number) => string
  /** Date text of a point (tooltip). */
  dateText: (t: number) => string
  /** Extra tooltip lines for a point. */
  extra?: (p: ChartPoint, i: number) => ReactNode
}

export function LineChart({
  label,
  points,
  domain,
  utc = false,
  digits = 0,
  minSpan,
  ceil,
  height = 132,
  format,
  dateText,
  extra
}: LineChartProps): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>()
  const clip = `clip${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const known = points.filter((p): p is ChartPoint & { v: number } => p.v != null)
  // Every known value shapes the y axis (also a clipped anchor: its segment enters inside the plot).
  const f = makeFrame(width, height, domain, yScaleDomain(known.map((p) => p.v), { minSpan, ceil, integer: digits === 0 }))
  const inside = known.filter((p) => p.t >= domain[0] && p.t <= domain[1])
  const xs = inside.map((p) => f.x(p.t))
  const { active, bind } = useReadout(xs)

  // Solid runs between known neighbours; a segment touching a partial point is
  // dashed; a point with no known neighbour is a lone dot (else it would vanish).
  const xy = (p: ChartPoint): string => `${f.x(p.t).toFixed(1)},${f.y(p.v!).toFixed(1)}`
  const solid: string[] = []
  const dashed: Array<[ChartPoint, ChartPoint]> = []
  const lone = new Set<ChartPoint>()
  let cur: string[] = []
  const flush = (): void => {
    if (cur.length > 1) solid.push(cur.join(' '))
    cur = []
  }
  points.forEach((p, i) => {
    if (p.v == null) return flush()
    const prev = i > 0 && points[i - 1].v != null ? points[i - 1] : null
    const next = i < points.length - 1 && points[i + 1].v != null ? points[i + 1] : null
    if (!prev && !next) lone.add(p)
    if (prev && (prev.partial || p.partial)) {
      flush()
      dashed.push([prev, p])
    }
    cur.push(xy(p))
  })
  flush()
  const showDots = inside.length <= 40
  const last = known[known.length - 1]
  const endLabel = last && inside.includes(last) && !last.partial ? last : null
  const a = active != null ? inside[active] : null

  return (
    <div className="chart" ref={ref} aria-label={label} role="group" {...bind}>
      <svg width={width} height={height + M.top + M.bottom} aria-hidden="true">
        <PlotClip id={clip} f={f} />
        <Axes f={f} domain={domain} utc={utc} />
        <g clipPath={`url(#${clip})`}>
          {solid.map((s, i) => (
            <polyline key={i} className="line" points={s} />
          ))}
          {dashed.map(([p, q]) => (
            <line key={p.t} className="line dashed" x1={f.x(p.t)} y1={f.y(p.v!)} x2={f.x(q.t)} y2={f.y(q.v!)} />
          ))}
        </g>
        {inside
          .filter((p) => showDots || lone.has(p) || p.partial)
          .map((p) => (
            <circle key={p.t} className={`dot${p.partial ? ' partial' : ''}`} cx={f.x(p.t)} cy={f.y(p.v)} r={4} />
          ))}
        {endLabel && (
          <text className="end-label" x={f.x(endLabel.t) + 9} y={f.y(endLabel.v)} dy="0.32em">
            {format(endLabel.v)}
          </text>
        )}
        {a && (
          <g className="hover">
            <line className="crosshair" x1={f.x(a.t)} x2={f.x(a.t)} y1={M.top} y2={M.top + height} />
            <circle className="dot active" cx={f.x(a.t)} cy={f.y(a.v)} r={5} />
          </g>
        )}
      </svg>
      {a && active != null && (
        <Tip x={f.x(a.t)} width={width}>
          <div className="tip-value">{format(a.v)}</div>
          <div className="tip-label">{dateText(a.t)}</div>
          {extra?.(a, active)}
        </Tip>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------- bars

/** A column path with a 4px rounded data end and a square baseline end. */
export function barPath(cx: number, y0: number, y1: number, w: number, r = 4): string {
  const x0 = cx - w / 2
  const x1 = cx + w / 2
  const h = Math.abs(y1 - y0)
  const rr = Math.min(r, w / 2, h)
  if (y1 <= y0) {
    // Grows upwards: round the top.
    return `M${x0},${y0}V${y1 + rr}Q${x0},${y1} ${x0 + rr},${y1}H${x1 - rr}Q${x1},${y1} ${x1},${y1 + rr}V${y0}Z`
  }
  return `M${x0},${y0}V${y1 - rr}Q${x0},${y1} ${x0 + rr},${y1}H${x1 - rr}Q${x1},${y1} ${x1},${y1 - rr}V${y0}Z`
}

/** Column width: the room to the nearest neighbour (or the interval it spans), 3–24px. */
function barWidths(centers: number[], spans: Array<number | null>): number[] {
  return centers.map((c, i) => {
    const span = spans[i]
    let room = span ?? Infinity
    if (span == null) {
      if (i > 0) room = Math.min(room, c - centers[i - 1])
      if (i < centers.length - 1) room = Math.min(room, centers[i + 1] - c)
      if (!Number.isFinite(room)) room = 24
    }
    return Math.max(3, Math.min(24, room - 2))
  })
}

export interface Bar {
  /** Where the column stands (ms). */
  t: number
  /** Optional time span it covers (ms) — its width then follows the span (≤ 24px; all of it with `spanning`). */
  t0?: number
  t1?: number
  v: number
  /** Drawn as an outline: an incomplete week/month. */
  partial?: boolean
  tip: ReactNode
}

export function BarChart({
  label,
  bars,
  domain,
  utc = false,
  digits = 0,
  height = 132,
  spanning = false
}: {
  label: string
  bars: Bar[]
  domain: [number, number]
  utc?: boolean
  digits?: number
  height?: number
  /**
   * A rate over an interval: every bar spans its whole [t0, t1] (minus a 2px
   * gap), so it shows the time it covers and its area is the total.
   */
  spanning?: boolean
}): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>()
  const f = makeFrame(width, height, domain, yScaleDomain(bars.map((b) => b.v), { zero: true, minSpan: 1, integer: digits === 0 }))
  const lo = M.left
  const hi = M.left + f.plotW
  let xs: number[]
  let ws: number[]
  let spans: Array<[number, number]> | undefined
  if (spanning) {
    // Clamped to the plot: an interval from the anchor scan starts at its left edge.
    spans = bars.map((b) => {
      const a = Math.max(lo, f.x(b.t0 ?? b.t) + 1)
      const z = Math.min(hi, f.x(b.t1 ?? b.t) - 1)
      return [a, Math.max(a + 1, z)]
    })
    xs = spans.map(([a, z]) => (a + z) / 2)
    ws = spans.map(([a, z]) => z - a)
  } else {
    xs = bars.map((b) => f.x(b.t))
    ws = barWidths(
      xs,
      bars.map((b) => (b.t0 != null && b.t1 != null ? f.x(b.t1) - f.x(b.t0) : null))
    )
  }
  const { active, bind } = useReadout(xs, spans)
  const base = f.y(0)
  return (
    <div className="chart" ref={ref} aria-label={label} role="group" {...bind}>
      <svg width={width} height={height + M.top + M.bottom} aria-hidden="true">
        <Axes f={f} domain={domain} utc={utc} />
        {bars.map((b, i) =>
          b.v === 0 ? null : (
            <path
              key={b.t}
              className={`bar${b.partial ? ' partial' : ''}${i === active ? ' active' : ''}`}
              d={barPath(xs[i], base, f.y(b.v), ws[i])}
            />
          )
        )}
        {active != null && (
          <line className="crosshair" x1={xs[active]} x2={xs[active]} y1={M.top} y2={M.top + height} />
        )}
      </svg>
      {active != null && (
        <Tip x={xs[active]} width={width}>
          {bars[active].tip}
        </Tip>
      )}
    </div>
  )
}

// -------------------------------------------------------------- stacked bars

export interface StackSeries {
  key: string
  label: string
  /** CSS class giving the segment its fill. */
  className: string
}

export interface Stack {
  t: number
  values: number[]
  /** Marked on the axis with a ring (e.g. a baseline scan). */
  marker?: boolean
  tip: ReactNode
}

export function StackedBarChart({
  label,
  series,
  stacks,
  domain,
  height = 132
}: {
  label: string
  series: StackSeries[]
  stacks: Stack[]
  domain: [number, number]
  height?: number
}): JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>()
  const totals = stacks.map((s) => s.values.reduce((a, b) => a + b, 0))
  const f = makeFrame(width, height, domain, yScaleDomain(totals, { zero: true, minSpan: 4, integer: true }))
  const xs = stacks.map((s) => f.x(s.t))
  // One width for every column (width encodes nothing here): the median gap
  // between scans, 4–12px — a pair of close scans can't shrink all of them
  // (scans minutes apart may overlap; the readout and the table list each).
  const gaps = xs.slice(1).map((x, i) => x - xs[i]).sort((a, b) => a - b)
  const median = gaps.length ? gaps[gaps.length >> 1] : 24
  const w = Math.max(4, Math.min(12, median - 2))
  const { active, bind } = useReadout(xs)
  const base = f.y(0)
  const GAP = 2
  return (
    <div className="chart" ref={ref} aria-label={label} role="group" {...bind}>
      <svg width={width} height={height + M.top + M.bottom} aria-hidden="true">
        <Axes f={f} domain={domain} utc={false} />
        {stacks.map((s, i) => {
          let y = base
          const top = s.values.reduce((k, v, j) => (v > 0 ? j : k), -1)
          return (
            <g key={s.t} className={i === active ? 'stack active' : 'stack'}>
              {s.values.map((v, j) => {
                if (v <= 0) return null
                const h = base - f.y(v)
                const y1 = y - h
                // A 2px surface gap separates touching segments.
                const y0 = j === s.values.findIndex((x) => x > 0) ? y : y - GAP
                const seg = (
                  <path
                    key={series[j].key}
                    className={`seg ${series[j].className}`}
                    d={j === top ? barPath(xs[i], y0, Math.min(y1, y0 - 1), w) : `M${xs[i] - w / 2},${y0}V${Math.min(y1, y0 - 1)}H${xs[i] + w / 2}V${y0}Z`}
                  />
                )
                y = y1
                return seg
              })}
              {/* Every scan is marked on the axis, so "scanned, no changes" is visible too. */}
              {s.marker ? (
                <circle className="marker" cx={xs[i]} cy={base} r={4} />
              ) : (
                <circle className="scan-tick" cx={xs[i]} cy={base} r={2.5} />
              )}
            </g>
          )
        })}
        {active != null && (
          <line className="crosshair" x1={xs[active]} x2={xs[active]} y1={M.top} y2={M.top + height} />
        )}
      </svg>
      {active != null && (
        <Tip x={xs[active]} width={width}>
          {stacks[active].tip}
        </Tip>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ sparkline

/** A tiny trend; with `times` the points sit on a time axis (irregular scans keep their spacing). */
export function Sparkline({
  values,
  times,
  label
}: {
  values: Array<number | null>
  times?: number[]
  label?: string
}): JSX.Element {
  const W = 72
  const H = 22
  const pts = values
    .map((v, i) => (v == null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p != null)
  const vs = pts.map((p) => p.v)
  const min = vs.length ? vs.reduce((a, b) => Math.min(a, b)) : 0
  const max = vs.length ? vs.reduce((a, b) => Math.max(a, b)) : 0
  const timed = times && times.length === values.length && times[times.length - 1] > times[0] ? times : null
  const x = (i: number): number =>
    2 +
    (timed
      ? ((timed[i] - timed[0]) / (timed[timed.length - 1] - timed[0])) * (W - 6)
      : values.length > 1
        ? (i / (values.length - 1)) * (W - 6)
        : (W - 6) / 2)
  const y = (v: number): number => (max === min ? H / 2 : 3 + (1 - (v - min) / (max - min)) * (H - 6))
  const last = pts[pts.length - 1]
  return (
    <svg className="sparkline" width={W} height={H} role="img" aria-label={label ?? 'тренд'}>
      {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} />}
      {last && <circle cx={x(last.i)} cy={y(last.v)} r={2.5} />}
    </svg>
  )
}

// ------------------------------------------------------------------- legend

export function Legend({
  items
}: {
  items: Array<{ label: string; className: string; kind?: 'rect' | 'ring' | 'dot' | 'outline' }>
}): JSX.Element {
  return (
    <ul className="chart-legend">
      {items.map((it) => (
        <li key={it.label}>
          <span className={`key ${it.kind ?? 'rect'} ${it.className}`} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  )
}
