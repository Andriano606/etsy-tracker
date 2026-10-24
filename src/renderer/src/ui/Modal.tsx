import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useEscape } from '../components/useEscape'
import { Icon } from './icons'

// The modal shell every dialog uses: a sticky header (title, subtitle, ×), a
// body that scrolls, an optional sticky footer for the actions. It always fits
// the window: max-width min(<size>, 100vw − 32px), max-height 100vh − 32px.
// Escape (through the shared useEscape stack — only the topmost modal closes)
// and a click on the backdrop close it. Focus moves into the dialog on open,
// Tab cycles inside it, and returns to where it was on close.
//
// Rendered in place (not portalled) like the app's other modals, so the one
// rendered later in App sits on top.

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ModalProps {
  /** Render nothing while false (default true: mount the Modal only while open). */
  open?: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  /** sm 420 · md 560 · lg 820 · xl 1120 px (never wider than the window). */
  size?: ModalSize
  /** Sticky footer, usually buttons or an <ActionBar align="end">. */
  footer?: ReactNode
  /** Extra content in the header row, before × (a period switch, a badge). */
  headerExtra?: ReactNode
  children: ReactNode
  /** Class on the dialog box (e.g. "settings-modal"). The scrolling element is `.ui-modal-body`. */
  className?: string
  bodyClassName?: string
  /** Close on a backdrop click (default true). */
  closeOnBackdrop?: boolean
  /** Hide the × (a modal that must be answered, e.g. a confirmation — still closes on Escape). */
  hideClose?: boolean
  /** Accessible name when the title is not plain text. */
  ariaLabel?: string
  /** role="alertdialog" for confirmations. */
  role?: 'dialog' | 'alertdialog'
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary'

export function Modal({
  open = true,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  headerExtra,
  children,
  className,
  bodyClassName,
  closeOnBackdrop = true,
  hideClose,
  ariaLabel,
  role = 'dialog'
}: ModalProps): JSX.Element | null {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const downInside = useRef(false)
  useEscape(onClose, open)

  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const el = box.current
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      if (before && before.isConnected && typeof before.focus === 'function') before.focus({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !box.current) return
    // Skip what is not rendered (closed <details>, display:none) — when there is layout at all (not in jsdom).
    const layout = box.current.getClientRects().length > 0
    const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (x) => !x.closest('[hidden], [inert]') && (!layout || x.getClientRects().length > 0 || x === document.activeElement)
    )
    if (!all.length) return
    const first = all[0]
    const last = all[all.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const onBackdropDown = (e: MouseEvent): void => {
    downInside.current = e.target !== e.currentTarget
  }
  const onBackdropClick = (e: MouseEvent): void => {
    // Not when a press inside the box ended on the backdrop (a text selection dragged out of it).
    if (closeOnBackdrop && e.target === e.currentTarget && !downInside.current) onClose()
    downInside.current = false
  }

  return (
    <div className="modal-backdrop ui-backdrop" onMouseDown={onBackdropDown} onClick={onBackdropClick}>
      <div
        ref={box}
        className={`ui-modal ui-modal--${size}` + (className ? ' ' + className : '')}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : `${id}-title`}
        aria-label={ariaLabel}
        aria-describedby={subtitle ? `${id}-sub` : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ui-modal-head">
          <div className="ui-modal-titles">
            <h2 className="ui-modal-title" id={`${id}-title`}>
              {title}
            </h2>
            {subtitle && (
              <div className="ui-modal-subtitle" id={`${id}-sub`}>
                {subtitle}
              </div>
            )}
          </div>
          {headerExtra && <div className="ui-modal-extra">{headerExtra}</div>}
          {!hideClose && (
            <button type="button" className="ui-modal-close" aria-label="Закрити" title="Закрити (Esc)" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
        <div className={'ui-modal-body' + (bodyClassName ? ' ' + bodyClassName : '')}>{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
