// Pure placement of a floating layer (tooltip, menu) next to its anchor so that
// it always stays inside the viewport: flip to the other side when the preferred
// one has no room, then clamp into the window with a margin.

export interface RectLike {
  top: number
  left: number
  width: number
  height: number
}

export type Side = 'top' | 'bottom'
export type Align = 'start' | 'center' | 'end'

export interface PlaceOptions {
  side?: Side
  align?: Align
  /** Distance between the anchor and the layer. */
  gap?: number
  /** Minimum distance between the layer and the window edges. */
  margin?: number
}

export interface Placement {
  top: number
  left: number
  side: Side
  /** The layer is taller than the room on either side — it should scroll inside. */
  maxHeight: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))

export function place(
  anchor: RectLike,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  { side = 'top', align = 'center', gap = 6, margin = 8 }: PlaceOptions = {}
): Placement {
  const above = anchor.top - gap - margin
  const below = viewport.height - (anchor.top + anchor.height) - gap - margin
  let s: Side = side
  if (side === 'top' && size.height > above && below > above) s = 'bottom'
  if (side === 'bottom' && size.height > below && above > below) s = 'top'
  const room = Math.max(0, s === 'top' ? above : below)
  const h = Math.min(size.height, room)
  let top = s === 'top' ? anchor.top - gap - h : anchor.top + anchor.height + gap
  top = clamp(top, margin, Math.max(margin, viewport.height - margin - h))

  let left =
    align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - size.width
        : anchor.left + anchor.width / 2 - size.width / 2
  left = clamp(left, margin, Math.max(margin, viewport.width - margin - size.width))
  return { top: Math.round(top), left: Math.round(left), side: s, maxHeight: Math.max(room, 0) }
}
