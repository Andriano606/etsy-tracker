import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// "Priority+" overflow shared by ActionBar and Tabs: render every item once,
// measure them, then keep as many as fit in the container's width and move the
// rest into a "⋯" / "Ще" menu. Widths are cached per key, so hidden items need
// not be in the DOM; a change of `signature` (the items' keys + labels)
// re-measures everything. A ResizeObserver on the container re-fits on resize.

/**
 * Which items stay visible. `pinned` items always stay (and are counted first);
 * the others are kept in order while they fit. When not everything fits, the
 * "more" button's width (+ a gap) is reserved.
 */
export function fitItems(widths: number[], available: number, moreWidth: number, gap: number, pinned: boolean[] = []): boolean[] {
  const n = widths.length
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, n - 1)
  if (total <= available + 0.5) return widths.map(() => true)
  const visible = widths.map((_, i) => !!pinned[i])
  let used = moreWidth
  let count = 0
  for (let i = 0; i < n; i++) {
    if (!visible[i]) continue
    used += widths[i] + gap
    count++
  }
  for (let i = 0; i < n; i++) {
    if (visible[i]) continue
    const next = used + widths[i] + gap
    if (next > available + 0.5) break
    visible[i] = true
    used = next
    count++
  }
  return count === n ? widths.map(() => true) : visible
}

export interface Overflow {
  /** Put on the container (the flex row whose width limits the items). */
  containerRef: (el: HTMLElement | null) => void
  /** Put on each item (or its wrapper): `ref={register(key)}`. */
  register: (key: string) => (el: HTMLElement | null) => void
  /** Put on the "more" button. */
  moreRef: (el: HTMLElement | null) => void
  /** True during the measuring render (render every item + the more button). */
  measuring: boolean
  /** Keys moved into the menu (empty = everything fits). */
  hidden: ReadonlySet<string>
  /** Width of the pinned items + the more button: use as the container's min-width. */
  minWidth: number
}

const width = (el: HTMLElement | null | undefined): number => (el ? el.getBoundingClientRect().width : 0)

export function useOverflow(keys: string[], signature: string, pinned: (key: string) => boolean = () => false): Overflow {
  const container = useRef<HTMLElement | null>(null)
  const items = useRef(new Map<string, HTMLElement>())
  const widths = useRef(new Map<string, number>())
  const more = useRef<HTMLElement | null>(null)
  const moreW = useRef(0)
  const [measuring, setMeasuring] = useState(true)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [minWidth, setMinWidth] = useState(0)
  const keysRef = useRef(keys)
  keysRef.current = keys
  const pinnedRef = useRef(pinned)
  pinnedRef.current = pinned

  const fit = useCallback(() => {
    const c = container.current
    if (!c) return
    const ks = keysRef.current
    // Visible items may have changed width (fonts loaded, a badge appeared).
    for (const k of ks) {
      const el = items.current.get(k)
      if (el && el.isConnected) widths.current.set(k, width(el))
    }
    if (more.current?.isConnected) moreW.current = width(more.current)
    const cs = getComputedStyle(c)
    const gap = parseFloat(cs.columnGap) || 0
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    const ws = ks.map((k) => widths.current.get(k) ?? 0)
    const pins = ks.map((k) => pinnedRef.current(k))
    const vis = fitItems(ws, width(c) - pad, moreW.current, gap, pins)
    const next = new Set(ks.filter((_, i) => !vis[i]))
    setHidden((old) => (old.size === next.size && [...next].every((k) => old.has(k)) ? old : next))
    const mw = ws.reduce((a, w, i) => (pins[i] ? a + w + gap : a), next.size ? moreW.current : 0) + pad
    setMinWidth((old) => (Math.abs(old - mw) < 0.5 ? old : mw))
  }, [])

  useLayoutEffect(() => {
    setMeasuring(true)
  }, [signature])

  useLayoutEffect(() => {
    if (!measuring) return
    fit()
    setMeasuring(false)
  }, [measuring, fit])

  useLayoutEffect(() => {
    const c = container.current
    if (!c || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => fit())
    ro.observe(c)
    return () => ro.disconnect()
  }, [fit])

  const containerRef = useCallback((el: HTMLElement | null) => {
    container.current = el
  }, [])
  const moreRef = useCallback((el: HTMLElement | null) => {
    more.current = el
  }, [])
  const registry = useRef(new Map<string, (el: HTMLElement | null) => void>())
  const register = useCallback((key: string) => {
    let cb = registry.current.get(key)
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) items.current.set(key, el)
        else items.current.delete(key)
      }
      registry.current.set(key, cb)
    }
    return cb
  }, [])

  return { containerRef, register, moreRef, measuring, hidden: measuring ? EMPTY : hidden, minWidth }
}

const EMPTY: ReadonlySet<string> = new Set()
