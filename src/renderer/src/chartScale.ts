// Pure scale/tick helpers for the hand-rolled SVG charts (Statistics view).
// Scan times are shown in local time; review buckets are UTC (see main/shopStats.ts),
// so every time helper takes a `utc` flag.

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** "Nice" round ticks (1/2/5 × 10^k) covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 4, minStep = 0): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const raw = Math.max((max - min) / Math.max(1, count), minStep)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(min / step + 1e-9) * step
  const hi = Math.ceil(max / step - 1e-9) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step)
  return out
}

/**
 * The y domain + ticks for a series. Bars always include 0 (they grow from a
 * baseline); lines don't have to — they fit the data with a 10 % margin (never
 * below 0 for a non-negative series), so a real change is visible however
 * large the value. Only a flat series gets invented room (2 % of its value,
 * at least 1) so it sits mid-plot instead of on an edge. `minSpan` is an
 * explicit floor (a rating moving 4,80 → 4,81 shouldn't fill the plot);
 * `ceil` a value the axis never goes past (a rating's 5).
 */
export function yScaleDomain(
  values: Array<number | null | undefined>,
  opts: { zero?: boolean; minSpan?: number; count?: number; integer?: boolean; ceil?: number } = {}
): { min: number; max: number; ticks: number[] } {
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (!xs.length) return { min: 0, max: 1, ticks: [0, 1] }
  let min = Infinity
  let max = -Infinity
  for (const v of xs) {
    if (v < min) min = v
    if (v > max) max = v
  }
  const nonNegative = min >= 0
  const dataMax = max
  if (opts.zero) {
    min = Math.min(0, min)
    max = Math.max(0, max)
  }
  const want = opts.minSpan ?? (max === min ? Math.max(1, Math.abs(max) * 0.02) : 0)
  if (max - min < want) {
    if (opts.zero && min === 0) max = Math.max(max, want)
    else {
      const mid = (min + max) / 2
      // A flat non-negative line near 0 (e.g. all zeros) starts at 0, never below.
      if (nonNegative && mid - want / 2 < 0) {
        min = 0
        max = Math.max(max, want)
      } else {
        min = mid - want / 2
        max = mid + want / 2
      }
    }
  } else if (!opts.zero) {
    const m = (max - min) * 0.1
    min = nonNegative ? Math.max(0, min - m) : min - m
    max += m
  }
  if (opts.ceil != null && max > opts.ceil && dataMax <= opts.ceil) {
    max = opts.ceil
    if (max - min < want) min = max - want
  }
  const ticks = niceTicks(min, max, opts.count ?? 4, opts.integer ? 1 : 0)
  return { min: Math.min(min, ticks[0]), max: Math.max(max, ticks[ticks.length - 1]), ticks }
}

/** A [t0, t1] domain (ms) around the given times, padded; a single time gets ±1 h. */
export function timeDomain(times: number[], pad = 0.04): [number, number] {
  if (!times.length) return [0, 1]
  let t0 = Infinity
  let t1 = -Infinity
  for (const t of times) {
    if (t < t0) t0 = t
    if (t > t1) t1 = t
  }
  if (t1 - t0 < HOUR) {
    const mid = (t0 + t1) / 2
    t0 = mid - HOUR
    t1 = mid + HOUR
  }
  const p = (t1 - t0) * pad
  return [t0 - p, t1 + p]
}

export interface TimeTick {
  t: number
  label: string
}

const STEPS: Array<{ ms: number; unit: 'h' | 'd' | 'm'; n: number }> = [
  { ms: HOUR, unit: 'h', n: 1 },
  { ms: 3 * HOUR, unit: 'h', n: 3 },
  { ms: 6 * HOUR, unit: 'h', n: 6 },
  { ms: 12 * HOUR, unit: 'h', n: 12 },
  { ms: DAY, unit: 'd', n: 1 },
  { ms: 2 * DAY, unit: 'd', n: 2 },
  { ms: 7 * DAY, unit: 'd', n: 7 },
  { ms: 14 * DAY, unit: 'd', n: 14 },
  { ms: 30 * DAY, unit: 'm', n: 1 },
  { ms: 61 * DAY, unit: 'm', n: 2 },
  { ms: 91 * DAY, unit: 'm', n: 3 },
  { ms: 182 * DAY, unit: 'm', n: 6 },
  { ms: 365 * DAY, unit: 'm', n: 12 }
]

const pad2 = (n: number): string => String(n).padStart(2, '0')

interface Parts {
  y: number
  mo: number
  d: number
  h: number
  mi: number
}
function parts(t: number, utc: boolean): Parts {
  const x = new Date(t)
  return utc
    ? { y: x.getUTCFullYear(), mo: x.getUTCMonth(), d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes() }
    : { y: x.getFullYear(), mo: x.getMonth(), d: x.getDate(), h: x.getHours(), mi: x.getMinutes() }
}
function make(y: number, mo: number, d: number, h: number, utc: boolean): number {
  return utc ? Date.UTC(y, mo, d, h) : new Date(y, mo, d, h).getTime()
}

/** dd.MM */
export function shortDate(t: number, utc = false): string {
  const p = parts(t, utc)
  return `${pad2(p.d)}.${pad2(p.mo + 1)}`
}
/** dd.MM.yyyy */
export function fullDate(t: number, utc = false): string {
  const p = parts(t, utc)
  return `${pad2(p.d)}.${pad2(p.mo + 1)}.${p.y}`
}
/** dd.MM.yyyy, HH:mm */
export function fullDateTime(t: number, utc = false): string {
  const p = parts(t, utc)
  return `${fullDate(t, utc)}, ${pad2(p.h)}:${pad2(p.mi)}`
}

/**
 * Calendar-aligned ticks for a time axis at most `maxTicks` wide: hours
 * ("HH:mm", "dd.MM" at midnight / the first tick), days ("dd.MM"), months
 * ("MM.yyyy"). When the step that fits leaves fewer than 3 ticks (calendar
 * alignment loses one at each end), the next finer step is used if it stays
 * within `maxTicks + 1`.
 */
export function timeTicks(t0: number, t1: number, maxTicks: number, utc = false): TimeTick[] {
  if (!(t1 > t0)) return []
  const span = t1 - t0
  let idx = STEPS.findIndex((s) => span / s.ms <= Math.max(1, maxTicks))
  if (idx < 0) idx = STEPS.length - 1
  const out = ticksFor(STEPS[idx], t0, t1, utc)
  if (out.length < 3 && idx > 0) {
    const finer = ticksFor(STEPS[idx - 1], t0, t1, utc)
    if (finer.length > out.length && finer.length <= Math.max(1, maxTicks) + 1) return finer
  }
  return out
}

function ticksFor(step: (typeof STEPS)[number], t0: number, t1: number, utc: boolean): TimeTick[] {
  const p = parts(t0, utc)
  const out: TimeTick[] = []
  let t: number
  let i = 0
  const next = (k: number): number => {
    if (step.unit === 'h') return make(p.y, p.mo, p.d, Math.floor(p.h / step.n) * step.n + k * step.n, utc)
    if (step.unit === 'd') {
      if (step.n === 7 || step.n === 14) {
        // Weeks start on Monday.
        const dow = (new Date(make(p.y, p.mo, p.d, 0, utc))[utc ? 'getUTCDay' : 'getDay']() + 6) % 7
        return make(p.y, p.mo, p.d - dow + k * step.n, 0, utc)
      }
      return make(p.y, p.mo, p.d + k * step.n, 0, utc)
    }
    const m0 = Math.floor(p.mo / step.n) * step.n
    return make(p.y, m0 + k * step.n, 1, 0, utc)
  }
  let prevDay = ''
  while ((t = next(i++)) <= t1 && i < 500) {
    if (t < t0) continue
    let label: string
    if (step.unit === 'h') {
      const q = parts(t, utc)
      const day = shortDate(t, utc)
      label = day !== prevDay ? `${day} ${pad2(q.h)}:${pad2(q.mi)}` : `${pad2(q.h)}:${pad2(q.mi)}`
      prevDay = day
    } else if (step.unit === 'd') label = shortDate(t, utc)
    else {
      const q = parts(t, utc)
      label = `${pad2(q.mo + 1)}.${q.y}`
    }
    out.push({ t, label })
  }
  return out
}

/** Index of the item whose x is nearest to `x` (items sorted by x). */
export function nearestIndex(xs: number[], x: number): number {
  if (!xs.length) return -1
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < x) lo = mid
    else hi = mid
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi
}

/** Fraction digits a tick step needs (0.05 → 2, 0.5 → 1, 5 → 0). */
function stepDigits(step: number): number {
  if (!(step > 0)) return 0
  for (let d = 0; d <= 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d
  return 6
}

const allDistinct = (xs: string[]): boolean => new Set(xs).size === xs.length

/**
 * Labels for a set of ticks, one format per axis: every label has the same
 * number of decimals ("4,70", "4,75", "5,00"). From 10 000 up the whole axis
 * is compact ("58,0 тис.", "58,5 тис."; "2,54 млн") at the smallest precision
 * that keeps the labels distinct, else full grouped numbers — never two equal
 * labels — and full numbers below a million when compact would need 2+
 * decimals ("110 650", not "110,65 тис."). 0 is always "0".
 */
export function axisLabels(ticks: number[]): string[] {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0
  if (ticks.some((v) => Math.abs(v) >= 10_000)) {
    // Enough decimals for the step in each tick's compact unit (тис. / млн / …).
    let need = 0
    for (const v of ticks) {
      if (v === 0) continue
      const unit = 10 ** (3 * Math.floor(Math.log10(Math.abs(v)) / 3))
      need = Math.max(need, stepDigits(step / unit))
    }
    const big = ticks.some((v) => Math.abs(v) >= 1_000_000)
    for (let p = need; p <= (big ? 3 : 1); p++) {
      const fmt = new Intl.NumberFormat('uk-UA', {
        notation: 'compact',
        minimumFractionDigits: p,
        maximumFractionDigits: p
      })
      const labels = ticks.map((v) => (v === 0 ? '0' : fmt.format(v)))
      if (allDistinct(labels)) return labels
    }
  }
  const d = stepDigits(step)
  return ticks.map((v) =>
    v === 0 ? '0' : v.toLocaleString('uk-UA', { minimumFractionDigits: d, maximumFractionDigits: d })
  )
}
