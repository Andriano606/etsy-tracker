import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useEscape } from '../components/useEscape'
import { Icon, type IconName } from './icons'
import { Layer } from './Layer'
import type { Align, Side } from './position'

// A dropdown menu: a trigger button + a floating list (portalled, kept inside
// the window). ARIA menu-button pattern: ↓/↑/Home/End move between items,
// Enter/Space choose, Escape closes and returns focus to the trigger, Tab or a
// click elsewhere closes. Escape goes through useEscape, so an open menu inside
// a modal closes first, not the modal.

export interface MenuItem {
  id: string
  label: ReactNode
  icon?: IconName
  onSelect: () => void
  /** A second, dimmer line (what the action does). */
  hint?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** Shows a check mark (the current choice, e.g. the active tab). */
  checked?: boolean
}

export interface MenuProps {
  items: ReadonlyArray<MenuItem>
  /** Accessible name of the trigger (e.g. "Ще дії"). */
  label: string
  /** Visible content of the trigger; default the "⋯" icon. A string is the button's name; any other node keeps `label` as its aria-label. */
  trigger?: ReactNode
  /** Class of the trigger button (default "btn ui-menu-trigger"). */
  buttonClassName?: string
  /** A tooltip on the trigger (the native title). */
  title?: string
  side?: Side
  align?: Align
  disabled?: boolean
  /** Forwarded to the trigger (ActionBar measures it). */
  buttonRef?: (el: HTMLButtonElement | null) => void
}

export function Menu({
  items,
  label,
  trigger,
  buttonClassName,
  title,
  side = 'bottom',
  align = 'end',
  disabled,
  buttonRef
}: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement | null>(null)
  const list = useRef<HTMLDivElement | null>(null)
  const firstFocus = useRef<'first' | 'last'>('first')
  const id = useId()

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }, [])
  useEscape(() => close(), open)

  const enabled = (): HTMLButtonElement[] =>
    list.current ? [...list.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])')] : []

  useEffect(() => {
    if (!open) return
    const all = enabled()
    ;(firstFocus.current === 'last' ? all[all.length - 1] : all[0])?.focus()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (btn.current?.contains(t) || list.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const onListKey = (e: KeyboardEvent): void => {
    const all = enabled()
    const i = all.indexOf(document.activeElement as HTMLButtonElement)
    const go = (j: number): void => {
      e.preventDefault()
      all[(j + all.length) % all.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
    else if (e.key === 'Tab') close(false)
  }

  return (
    <>
      <button
        type="button"
        ref={(el) => {
          btn.current = el
          buttonRef?.(el)
        }}
        className={buttonClassName ?? 'btn ui-menu-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-m` : undefined}
        aria-label={typeof trigger === 'string' ? undefined : label}
        title={title}
        disabled={disabled}
        data-open={open || undefined}
        onClick={() => {
          firstFocus.current = 'first'
          setOpen((o) => !o)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            firstFocus.current = e.key === 'ArrowUp' ? 'last' : 'first'
            setOpen(true)
          }
        }}
      >
        {trigger ?? <Icon name="more" size={18} />}
      </button>
      {open && (
        <Layer anchor={btn.current} side={side} align={align} gap={4} className="ui-menu" role="menu" id={`${id}-m`} aria-label={label} onKeyDown={onListKey}>
          <div ref={list} className="ui-menu-list">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={it.checked === undefined ? undefined : it.checked}
                tabIndex={-1}
                disabled={it.disabled}
                className={'ui-menu-item' + (it.danger ? ' is-danger' : '') + (it.checked ? ' is-checked' : '')}
                onClick={() => {
                  close()
                  it.onSelect()
                }}
              >
                <span className="ui-menu-icon">{it.icon ? <Icon name={it.icon} size={15} /> : it.checked ? <Icon name="check" size={15} /> : null}</span>
                <span className="ui-menu-text">
                  <span className="ui-menu-label">{it.label}</span>
                  {it.hint && <span className="ui-menu-hint">{it.hint}</span>}
                </span>
              </button>
            ))}
          </div>
        </Layer>
      )}
    </>
  )
}
