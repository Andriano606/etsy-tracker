import { isValidElement, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Menu } from './Menu'
import { useOverflow } from './overflow'
import { Tooltip } from './Tip'

// Tabs that never overflow. Horizontal: tabs that don't fit move into a "Ще ▾"
// menu at the end (the active tab always stays visible). Vertical: a scrollable
// column beside the panel for many tabs in a wide modal; below ~640 px of
// container width it turns into a horizontally scrolling row above the panel.
// WAI-ARIA tabs: role=tablist/tab/tabpanel, roving tabindex, ←/→ (and ↑/↓),
// Home/End select the previous/next/first/last enabled tab.

export interface TabItem<T extends string = string> {
  id: T
  label: ReactNode
  icon?: IconName
  /** A count or a dot after the label ("3", "нове"). */
  badge?: ReactNode
  /** A tooltip explaining the tab. */
  hint?: ReactNode
  disabled?: boolean
}

export interface TabsProps<T extends string = string> {
  tabs: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (id: T) => void
  /** Accessible name of the tab list. */
  label: string
  orientation?: 'horizontal' | 'vertical'
  /** The active tab's content (rendered in the tabpanel). Omit to render the panel yourself with tabPanelProps(). */
  children?: ReactNode
  className?: string
  panelClassName?: string
  /** Stable id prefix (else generated). */
  idBase?: string
}

const text = (n: ReactNode): string =>
  n == null || typeof n === 'boolean'
    ? ''
    : typeof n === 'string' || typeof n === 'number'
      ? String(n)
      : Array.isArray(n)
        ? n.map(text).join('')
        : isValidElement(n)
          ? text((n.props as { children?: ReactNode }).children)
          : ''

export function tabIds(base: string, id: string): { tab: string; panel: string } {
  return { tab: `${base}-tab-${id}`, panel: `${base}-panel` }
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  orientation = 'horizontal',
  children,
  className,
  panelClassName,
  idBase
}: TabsProps<T>): JSX.Element {
  const auto = useId()
  const base = idBase ?? auto.replace(/:/g, '')
  const vertical = orientation === 'vertical'
  const signature = tabs.map((t) => `${t.id}:${text(t.label)}:${text(t.badge)}:${t.icon ?? ''}`).join('|') + '#' + value
  const o = useOverflow(
    tabs.map((t) => t.id),
    vertical ? 'v' : signature,
    (id) => id === value
  )
  const hidden = vertical ? new Set<string>() : o.hidden
  const els = useRef(new Map<string, HTMLButtonElement>())
  const pendingFocus = useRef<string | null>(null)

  useLayoutEffect(() => {
    const id = pendingFocus.current
    if (!id) return
    const el = els.current.get(id)
    if (el && !o.measuring) {
      el.focus()
      pendingFocus.current = null
    }
  })

  const select = (id: T, focus: boolean): void => {
    if (focus) pendingFocus.current = id
    if (id !== value) onChange(id)
    else if (focus) els.current.get(id)?.focus()
  }

  const onKey = (e: KeyboardEvent): void => {
    const enabled = tabs.filter((t) => !t.disabled)
    const i = enabled.findIndex((t) => t.id === value)
    let j: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = i + 1
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = i - 1
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = enabled.length - 1
    if (j === null || !enabled.length) return
    e.preventDefault()
    select(enabled[(j + enabled.length) % enabled.length].id, true)
  }

  const shown = tabs.filter((t) => !hidden.has(t.id))
  const more = tabs.filter((t) => hidden.has(t.id))
  const ids = tabIds(base, value)
  const cls = ['ui-tabs', vertical ? 'ui-tabs--vertical' : 'ui-tabs--horizontal', className ?? ''].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <div className="ui-tablist-wrap" ref={vertical ? undefined : o.containerRef}>
        <div
          role="tablist"
          aria-label={label}
          aria-orientation={orientation}
          className={'ui-tablist' + (o.measuring && !vertical ? ' is-measuring' : '')}
          onKeyDown={onKey}
        >
          {shown.map((t) => {
            const on = t.id === value
            const b = (
              <button
                key={t.id}
                ref={(el) => {
                  if (el) els.current.set(t.id, el)
                  else els.current.delete(t.id)
                  o.register(t.id)(el)
                }}
                type="button"
                role="tab"
                id={tabIds(base, t.id).tab}
                aria-selected={on}
                aria-controls={on ? ids.panel : undefined}
                tabIndex={on ? 0 : -1}
                disabled={t.disabled}
                className={'ui-tab' + (on ? ' is-active' : '')}
                onClick={() => select(t.id, false)}
              >
                {t.icon && <Icon name={t.icon} size={15} />}
                <span className="ui-tab-label">{t.label}</span>
                {t.badge != null && t.badge !== false && <span className="ui-tab-badge">{t.badge}</span>}
              </button>
            )
            return t.hint ? (
              <Tooltip key={t.id} content={t.hint}>
                {b}
              </Tooltip>
            ) : (
              b
            )
          })}
        </div>
        {!vertical && (o.measuring || more.length > 0) && (
          <div className={'ui-tabs-more' + (o.measuring && more.length === 0 ? ' is-measuring' : '')}>
            <Menu
              label={`Ще вкладки${more.length ? ` (${more.length})` : ''}`}
              trigger={
                <>
                  <span>Ще</span>
                  {more.length > 0 && <span className="ui-tab-badge">{more.length}</span>}
                  <Icon name="chevron-down" size={14} />
                </>
              }
              buttonClassName="ui-tab ui-tabs-more-btn"
              buttonRef={o.moreRef}
              items={more.map((t) => ({
                id: t.id,
                label: t.badge != null && t.badge !== false ? `${text(t.label)} (${text(t.badge)})` : t.label,
                icon: t.icon,
                disabled: t.disabled,
                onSelect: () => select(t.id, true)
              }))}
            />
          </div>
        )}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={ids.panel} aria-labelledby={ids.tab} tabIndex={0} className={'ui-tabpanel' + (panelClassName ? ' ' + panelClassName : '')}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Props for a tabpanel rendered outside <Tabs> (pass the same idBase). */
export function tabPanelProps(idBase: string, value: string): { role: 'tabpanel'; id: string; 'aria-labelledby': string; tabIndex: 0 } {
  const ids = tabIds(idBase, value)
  return { role: 'tabpanel', id: ids.panel, 'aria-labelledby': ids.tab, tabIndex: 0 }
}
