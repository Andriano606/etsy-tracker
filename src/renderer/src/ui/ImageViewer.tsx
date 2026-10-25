import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useEscape } from '../components/useEscape'
import { useStore, type ViewerImage } from '../store'
import { Icon } from './icons'
import { COPY_FOR_CLAUDE, COPY_FOR_CLAUDE_HINT, copyFeedbackText, useCopyFeedback } from './useCopyFeedback'

// The full-size image viewer: mounted once, last in App, over every modal.
// Opened through the store (`openImage`), usually by ZoomImage / ZoomButton.
//
// Keyboard while it is open: Escape closes only the viewer (it is the top of
// the shared useEscape stack); ←/→ step through a gallery; Tab stays inside.
// Arrows and Tab are handled by a window capture-phase listener, so nothing
// under the viewer sees an arrow (the listing gallery listens on document) and
// it works wherever focus happens to be (e.g. on <body> after the focused
// button got disabled).

export function ImageViewer(): JSX.Element | null {
  const viewer = useStore((s) => s.viewer)
  if (!viewer) return null
  // A new set (or the same set opened at another image) starts afresh.
  const key = `${viewer.index}#${viewer.images.map((i) => i.src).join('|')}`
  return <ViewerDialog key={key} images={viewer.images} start={viewer.index} />
}

function ViewerDialog({ images, start }: { images: ViewerImage[]; start: number }): JSX.Element {
  const close = useStore((s) => s.closeImage)
  const n = images.length
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), n - 1))
  const [actual, setActual] = useState(false)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const downOnStage = useRef(false)
  const img = images[index] ?? images[0]
  useEscape(close)

  const go = (step: number): void => {
    if (n < 2) return
    setIndex((i) => (i + step + n) % n)
    setActual(false)
    setState('loading')
  }
  const goRef = useRef(go)
  goRef.current = go

  // Focus moves in on open and returns to the opener on close.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.focus({ preventScroll: true })
    return () => {
      if (before && before.isConnected && typeof before.focus === 'function') before.focus({ preventScroll: true })
    }
  }, [])

  // A new image starts at the top-left of the stage, and focus never drops out
  // of the viewer (the focused "1:1" button is disabled while the next one loads).
  useEffect(() => {
    const s = stage.current
    if (s) {
      s.scrollTop = 0
      s.scrollLeft = 0
    }
  }, [index])
  useEffect(() => {
    const b = box.current
    if (b && !b.contains(document.activeElement)) b.focus({ preventScroll: true })
  }, [index, state])

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const b = box.current
      if (!b) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.stopPropagation()
        if (n < 2 || e.altKey || e.ctrlKey || e.metaKey) return
        e.preventDefault()
        goRef.current(e.key === 'ArrowLeft' ? -1 : 1)
        return
      }
      if (e.key !== 'Tab') return
      const all = [...b.querySelectorAll<HTMLElement>('button:not([disabled])')]
      const active = document.activeElement
      if (!all.length) {
        e.preventDefault()
        b.focus({ preventScroll: true })
        return
      }
      const first = all[0]
      const last = all[all.length - 1]
      if (!b.contains(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === b)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [n])

  const caption = img.caption ?? img.alt ?? ''
  const alt = img.alt || caption || (n > 1 ? `Зображення ${index + 1} з ${n}` : 'Зображення')
  // Only a click that both started and ended on the dark area closes (not a drag out of the image, not the scrollbar).
  const onStageDown = (e: MouseEvent): void => {
    downOnStage.current = e.target === e.currentTarget
  }
  const onStageClick = (e: MouseEvent): void => {
    if (e.target === e.currentTarget && downOnStage.current) close()
    downOnStage.current = false
  }
  return (
    <div className="ui-viewer" role="dialog" aria-modal="true" aria-label="Перегляд зображення" ref={box} tabIndex={-1}>
      <div className="ui-viewer-bar">
        <span className="ui-viewer-caption truncate" title={caption || undefined}>
          {caption}
        </span>
        {n > 1 && (
          <span className="ui-viewer-count num" aria-live="polite">
            {index + 1} / {n}
          </span>
        )}
        {/* Not keyed per image (focus would jump to the dialog on ←/→): its feedback resets per picture. */}
        {img.ref && <CopyRefButton text={img.ref} resetKey={`${index}:${img.ref}`} />}
        <ViewerButton
          icon={actual ? 'minimize' : 'maximize'}
          label={actual ? 'Вмістити у вікно' : 'Справжній розмір (1:1)'}
          onClick={() => setActual((a) => !a)}
          disabled={state !== 'ok'}
        />
        <ViewerButton icon="close" label="Закрити (Esc)" onClick={close} />
      </div>
      <div
        ref={stage}
        className={`ui-viewer-stage${actual ? ' is-actual' : ''}`}
        onMouseDown={onStageDown}
        onClick={onStageClick}
        data-testid="viewer-stage"
      >
        {state === 'loading' && <span className="ui-viewer-note">Завантаження…</span>}
        {state === 'error' && (
          <span className="ui-viewer-note" role="alert">
            Не вдалося завантажити зображення.
          </span>
        )}
        <img
          key={`${index}:${img.src}`}
          className="ui-viewer-img"
          src={img.src}
          alt={alt}
          referrerPolicy="no-referrer"
          hidden={state === 'error'}
          onLoad={() => setState('ok')}
          onError={() => setState('error')}
          onClick={() => state === 'ok' && setActual((a) => !a)}
          title={state !== 'ok' ? undefined : actual ? 'Клацніть, щоб вмістити у вікно' : 'Клацніть, щоб побачити справжній розмір'}
        />
      </div>
      {n > 1 && (
        <>
          <ViewerButton className="ui-viewer-nav is-prev" icon="chevron-left" label="Попереднє (←)" onClick={() => go(-1)} />
          <ViewerButton className="ui-viewer-nav is-next" icon="chevron-right" label="Наступне (→)" onClick={() => go(1)} />
        </>
      )}
    </div>
  )
}

function ViewerButton({
  icon,
  label,
  onClick,
  className = '',
  disabled
}: {
  icon: Parameters<typeof Icon>[0]['name']
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      className={`ui-viewer-btn ${className}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={20} />
    </button>
  )
}

/**
 * "Копіювати для Claude" in the viewer's bar: copies the current picture's
 * etsy-tracker:// reference. Icon + text on wide windows, the icon alone on
 * narrow ones (the feedback text still shows for its 2 s).
 */
function CopyRefButton({ text, resetKey }: { text: string; resetKey: string }): JSX.Element {
  const [state, copy] = useCopyFeedback(resetKey)
  const feedback = copyFeedbackText(state)
  return (
    <>
      {/* The name stays "Копіювати для Claude"; the outcome is announced once, by the status below. */}
      <button
        type="button"
        aria-label={COPY_FOR_CLAUDE}
        className={`ui-viewer-copy${state === 'copied' ? ' copied' : state === 'failed' ? ' copy-failed' : ''}`}
        data-state={state}
        title={`${COPY_FOR_CLAUDE} — ${COPY_FOR_CLAUDE_HINT}`}
        data-testid="viewer-copy-ref"
        onClick={() => void copy(text)}
      >
        <Icon name={state === 'copied' ? 'check' : state === 'failed' ? 'warning' : 'copy'} size={18} />
        {/* The button's name; on narrow windows only visually hidden while idle. */}
        <span className="ui-viewer-copy-label">{feedback ?? COPY_FOR_CLAUDE}</span>
      </button>
      <span className="sr-only" role="status">
        {feedback ?? ''}
      </span>
    </>
  )
}

const OPEN_LABEL = 'Відкрити на весь розмір'

/** Enter/Space on a zoom control must not also reach a clickable parent's own key handler. */
function stopActivationKeys(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}

/**
 * A picture that opens the viewer when clicked: the image itself is the button
 * (with a magnifier on hover/focus). `full` = the biggest URL (defaults to
 * `src`); `gallery` + `index` open a set to step through. Never put it inside
 * another button or link — use `ZoomButton` there.
 */
export function ZoomImage({
  src,
  full,
  alt = '',
  caption,
  gallery,
  index = 0,
  className = '',
  imgClassName,
  loading,
  claudeRef,
  children
}: {
  src: string
  full?: string
  alt?: string
  caption?: string
  /** The single picture's etsy-tracker:// reference (a gallery carries its own per image). */
  claudeRef?: string
  gallery?: ViewerImage[]
  index?: number
  className?: string
  imgClassName?: string
  loading?: 'lazy' | 'eager'
  /** Extra content over the image (badges). */
  children?: ReactNode
}): JSX.Element {
  const openImage = useStore((s) => s.openImage)
  return (
    <button
      type="button"
      className={`ui-zoom ${className}`}
      aria-label={alt ? `${OPEN_LABEL}: ${alt}` : OPEN_LABEL}
      title={OPEN_LABEL}
      onClick={(e) => {
        e.stopPropagation()
        if (gallery?.length) openImage(gallery, index)
        else openImage({ src: full ?? src, alt, caption, ref: claudeRef })
      }}
      onKeyDown={stopActivationKeys}
    >
      <img className={imgClassName} src={src} alt={alt} loading={loading} referrerPolicy="no-referrer" />
      <span className="ui-zoom-badge" aria-hidden="true">
        <Icon name="zoom-in" size={14} />
      </span>
      {children}
    </button>
  )
}

/**
 * A small magnifier button that opens the viewer — for a picture that sits
 * inside something clickable (a card, a row): render it as a sibling, placed
 * over the picture's corner (`.ui-zoom-corner` in a positioned wrapper).
 */
export function ZoomButton({
  images,
  index = 0,
  label = OPEN_LABEL,
  className = ''
}: {
  images: ViewerImage | ViewerImage[]
  index?: number
  label?: string
  className?: string
}): JSX.Element {
  const openImage = useStore((s) => s.openImage)
  return (
    <button
      type="button"
      className={`ui-zoom-btn ${className}`}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        e.preventDefault()
        openImage(images, index)
      }}
      onKeyDown={stopActivationKeys}
    >
      <Icon name="zoom-in" size={15} />
    </button>
  )
}
