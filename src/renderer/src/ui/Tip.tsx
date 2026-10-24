import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { glossaryEntry, type GlossaryKey } from '@shared/glossary'
import { useEscape } from '../components/useEscape'
import { Layer } from './Layer'
import type { Align, Side } from './position'
import { Icon } from './icons'

// Tooltips: InfoTip (an ⓘ button), Term (dotted-underlined text) and Tooltip
// (wraps any control, e.g. an icon-only button). One behaviour for all:
// hover or keyboard focus shows it, a click / tap pins it open (and shows the
// long text, if any), Escape / a click elsewhere / blur closes it. The text is
// always in the DOM (a `hidden` span) and referenced by aria-describedby, so a
// screen reader gets it without opening anything.

const CLOSE_DELAY = 120

interface TipState {
  open: boolean
  pinned: boolean
  anchorRef: React.MutableRefObject<HTMLElement | null>
  layerRef: React.MutableRefObject<HTMLDivElement | null>
  show: () => void
  hideSoon: () => void
  keep: () => void
  toggle: () => void
  close: () => void
}

function useTip(): TipState {
  const [open, setOpen] = useState(false)
  const [pinned, setPinnedState] = useState(false)
  const pinnedRef = useRef(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const setPinned = useCallback((p: boolean) => {
    pinnedRef.current = p
    setPinnedState(p)
  }, [])
  const keep = useCallback(() => clearTimeout(timer.current), [])
  const close = useCallback(() => {
    clearTimeout(timer.current)
    setOpen(false)
    setPinned(false)
  }, [setPinned])
  const show = useCallback(() => {
    clearTimeout(timer.current)
    setOpen(true)
  }, [])
  const hideSoon = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!pinnedRef.current) setOpen(false)
    }, CLOSE_DELAY)
  }, [])
  const toggle = useCallback(() => {
    clearTimeout(timer.current)
    const p = !pinnedRef.current
    setPinned(p)
    setOpen(p)
  }, [setPinned])
  useEffect(() => () => clearTimeout(timer.current), [])
  useEscape(close, open)

  // A pinned tip closes on a press anywhere else.
  useEffect(() => {
    if (!pinned) return
    const onDown = (e: PointerEvent | globalThis.MouseEvent): void => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t) || layerRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned, close])

  return { open, pinned, anchorRef, layerRef, show, hideSoon, keep, toggle, close }
}

function Bubble({
  tip,
  id,
  side,
  align,
  children
}: {
  tip: TipState
  id: string
  side: Side
  align: Align
  children: ReactNode
}): JSX.Element | null {
  if (!tip.open) return null
  return (
    <Layer
      anchor={tip.anchorRef.current}
      side={side}
      align={align}
      gap={8}
      className="ui-tip"
      role="tooltip"
      id={id}
      onMouseEnter={tip.keep}
      onMouseLeave={tip.hideSoon}
    >
      <div ref={tip.layerRef}>{children}</div>
    </Layer>
  )
}

/** Resolves a glossary key or explicit texts into what a tip shows. */
function useTipText(glossary: GlossaryKey | undefined, term?: ReactNode, text?: ReactNode, long?: ReactNode) {
  const entry = glossary ? glossaryEntry(glossary) : undefined
  return {
    term: term ?? entry?.term,
    short: text ?? entry?.short,
    long: long ?? entry?.long
  }
}

function TipContent({ term, short, long, pinned }: { term?: ReactNode; short?: ReactNode; long?: ReactNode; pinned: boolean }): JSX.Element {
  return (
    <>
      {term && <div className="ui-tip-term">{term}</div>}
      {short && <div className="ui-tip-short">{short}</div>}
      {long && pinned && <div className="ui-tip-long">{long}</div>}
      {long && !pinned && <div className="ui-tip-more">Натисніть, щоб прочитати більше</div>}
    </>
  )
}

function plainText(n: ReactNode): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(plainText).join('')
  if (isValidElement(n)) return plainText((n.props as { children?: ReactNode }).children)
  return ''
}

export interface InfoTipProps {
  /** A glossary key: term + short (+ long) come from the glossary. */
  glossary?: GlossaryKey
  /** Explicit text (wins over the glossary's `short`). */
  text?: ReactNode
  /** Heading of the bubble (wins over the glossary's `term`). */
  term?: ReactNode
  /** Extra text shown once the tip is pinned by a click. */
  long?: ReactNode
  /** Accessible name of the ⓘ button; default "Що таке «term»?" / "Пояснення". */
  label?: string
  side?: Side
  align?: Align
  size?: number
  className?: string
}

/** An ⓘ button next to a label that explains it. Renders nothing when there is no text. */
export function InfoTip({ glossary, text, term, long, label, side = 'top', align = 'center', size = 14, className }: InfoTipProps): JSX.Element | null {
  const tip = useTip()
  const id = useId()
  const t = useTipText(glossary, term, text, long)
  if (!t.short) return null
  const termText = plainText(t.term)
  const name = label ?? (termText ? `Що таке «${termText}»?` : 'Пояснення')
  return (
    <>
      <button
        type="button"
        ref={(el) => (tip.anchorRef.current = el)}
        className={'ui-infotip' + (className ? ' ' + className : '')}
        aria-label={name}
        aria-describedby={`${id}-d`}
        aria-expanded={tip.open}
        data-open={tip.open || undefined}
        onMouseEnter={tip.show}
        onMouseLeave={tip.hideSoon}
        onFocus={tip.show}
        onBlur={(e: FocusEvent) => {
          if (!tip.layerRef.current?.contains(e.relatedTarget as Node)) tip.close()
        }}
        onClick={(e: MouseEvent) => {
          // Inside a <label> a click would also toggle the labelled control.
          e.preventDefault()
          e.stopPropagation()
          tip.toggle()
        }}
      >
        <Icon name="info" size={size} />
      </button>
      <span hidden id={`${id}-d`}>
        {plainText(t.short)}
      </span>
      <Bubble tip={tip} id={`${id}-t`} side={side} align={align}>
        <TipContent term={t.term} short={t.short} long={t.long} pinned={tip.pinned} />
      </Bubble>
    </>
  )
}

export interface TermProps {
  glossary?: GlossaryKey
  /** The visible text; default the glossary's term. */
  children?: ReactNode
  text?: ReactNode
  long?: ReactNode
  side?: Side
  className?: string
}

/** Inline text with a dotted underline that explains itself on hover / focus / tap. */
export function Term({ glossary, children, text, long, side = 'top', className }: TermProps): JSX.Element {
  const tip = useTip()
  const id = useId()
  const t = useTipText(glossary, undefined, text, long)
  const shown = children ?? t.term ?? glossary
  if (!t.short) return <span className={className}>{shown}</span>
  return (
    <>
      <span
        ref={(el) => (tip.anchorRef.current = el)}
        className={'ui-term' + (className ? ' ' + className : '')}
        tabIndex={0}
        aria-describedby={`${id}-d`}
        data-open={tip.open || undefined}
        onMouseEnter={tip.show}
        onMouseLeave={tip.hideSoon}
        onFocus={tip.show}
        onBlur={tip.close}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          tip.toggle()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            tip.toggle()
          }
        }}
      >
        {shown}
      </span>
      <span hidden id={`${id}-d`}>
        {plainText(t.short)}
      </span>
      <Bubble tip={tip} id={`${id}-t`} side={side} align="center">
        <TipContent term={children && t.term && plainText(children) !== plainText(t.term) ? t.term : undefined} short={t.short} long={t.long} pinned={tip.pinned} />
      </Bubble>
    </>
  )
}

export interface TooltipProps {
  /** What the bubble says. Nothing → the child is rendered as is. */
  content: ReactNode
  /** One focusable element (a button, a link…). */
  children: ReactElement
  side?: Side
  align?: Align
  /** Also describe the child with the text (default true; set false when it already is its accessible name). */
  describe?: boolean
}

/** A tooltip for any control — e.g. an icon-only button (give it an aria-label too). */
export function Tooltip({ content, children, side = 'top', align = 'center', describe = true }: TooltipProps): JSX.Element {
  const tip = useTip()
  const id = useId()
  if (content == null || content === '' || content === false) return children
  return (
    <span
      className="ui-tooltip-anchor"
      ref={(el) => (tip.anchorRef.current = el)}
      onMouseEnter={tip.show}
      onMouseLeave={tip.hideSoon}
      onFocus={tip.show}
      onBlur={tip.close}
      onClick={tip.close}
    >
      {describe ? cloneElement(children, { 'aria-describedby': `${id}-d` } as Record<string, unknown>) : children}
      {describe && (
        <span hidden id={`${id}-d`}>
          {plainText(content)}
        </span>
      )}
      <Bubble tip={tip} id={`${id}-t`} side={side} align={align}>
        <div className="ui-tip-short">{content}</div>
      </Bubble>
    </span>
  )
}
