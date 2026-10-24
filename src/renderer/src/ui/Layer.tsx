import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { place, type Align, type Side } from './position'

// A floating layer (tooltip bubble, menu list) portalled into <body> with
// position: fixed, so no overflow:hidden / scrolling container can clip it, and
// placed next to its anchor inside the viewport (see position.ts). Re-placed on
// window resize and on any scroll.

export interface LayerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  anchor: HTMLElement | null
  side?: Side
  align?: Align
  gap?: number
  children: ReactNode
}

export function Layer({ anchor, side = 'top', align = 'center', gap = 6, className, style, children, ...rest }: LayerProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; side: Side; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    const update = (): void => {
      const el = ref.current
      if (!el || !anchor) return
      const a = anchor.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const vw = document.documentElement.clientWidth || window.innerWidth
      const vh = document.documentElement.clientHeight || window.innerHeight
      const p = place(a, { width: r.width, height: el.scrollHeight || r.height }, { width: vw, height: vh }, { side, align, gap })
      setPos((old) => (old && old.top === p.top && old.left === p.left && old.side === p.side && old.maxHeight === p.maxHeight ? old : p))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  })

  const s: CSSProperties = {
    position: 'fixed',
    top: pos?.top ?? 0,
    left: pos?.left ?? 0,
    maxHeight: pos ? Math.max(pos.maxHeight, 80) : undefined,
    visibility: pos ? undefined : 'hidden',
    ...style
  }
  return createPortal(
    <div ref={ref} className={'ui-layer' + (className ? ' ' + className : '')} data-side={pos?.side ?? side} style={s} {...rest}>
      {children}
    </div>,
    document.body
  )
}
