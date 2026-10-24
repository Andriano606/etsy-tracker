import type { ReactNode } from 'react'
import { Button, type ButtonVariant } from './Button'
import type { IconName } from './icons'
import { Menu, type MenuItem } from './Menu'
import { useOverflow } from './overflow'

// A responsive row of buttons that never overflows: it measures the room it has
// (ResizeObserver) and moves the actions that don't fit — from the end — into a
// "⋯" menu. Primary and `pinned` actions always stay visible. List the actions
// in priority order: the primary one first.

export interface Action {
  id: string
  label: string
  icon?: IconName
  onClick: () => void
  variant?: ButtonVariant
  disabled?: boolean
  busy?: boolean
  /** Tooltip on the button and a second line in the menu. */
  hint?: ReactNode
  /** Always an icon-only button (with `label` as its tooltip). */
  iconOnly?: boolean
  /** Never moved into the menu (primary actions are pinned anyway). */
  pinned?: boolean
}

export interface ActionBarProps {
  actions: ReadonlyArray<Action | false | null | undefined>
  /** Accessible name of the group, e.g. "Дії з магазином". */
  label?: string
  /** Where the buttons sit when there is room to spare (default start). */
  align?: 'start' | 'end'
  size?: 'sm' | 'md'
  /** Accessible name of the "⋯" button. */
  moreLabel?: string
  className?: string
}

export function ActionBar({ actions, label, align = 'start', size = 'md', moreLabel = 'Ще дії', className }: ActionBarProps): JSX.Element {
  const list = actions.filter((a): a is Action => !!a)
  const signature = list.map((a) => `${a.id}:${a.label}:${a.icon ?? ''}:${a.iconOnly ? 1 : 0}:${a.busy ? 1 : 0}`).join('|') + size
  const isPinned = (id: string): boolean => {
    const a = list.find((x) => x.id === id)
    return !!a && (a.pinned === true || a.variant === 'primary')
  }
  const o = useOverflow(
    list.map((a) => a.id),
    signature,
    isPinned
  )
  const shown = list.filter((a) => !o.hidden.has(a.id))
  const menu: MenuItem[] = list
    .filter((a) => o.hidden.has(a.id))
    .map((a) => ({
      id: a.id,
      label: a.busy ? `${a.label}…` : a.label,
      icon: a.icon,
      hint: a.hint,
      danger: a.variant === 'danger' || a.variant === 'danger-solid',
      disabled: a.disabled || a.busy,
      onSelect: a.onClick
    }))
  const cls = ['ui-actionbar', align === 'end' ? 'ui-actionbar--end' : '', o.measuring ? 'is-measuring' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div ref={o.containerRef} className={cls} role="group" aria-label={label} style={{ minWidth: o.minWidth || undefined }}>
      {shown.map((a) => (
        <div key={a.id} ref={o.register(a.id)} className="ui-actionbar-item">
          <Button
            variant={a.variant}
            size={size}
            icon={a.icon}
            iconOnly={a.iconOnly}
            label={a.label}
            tooltip={a.hint}
            busy={a.busy}
            disabled={a.disabled}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        </div>
      ))}
      {(o.measuring || menu.length > 0) && (
        <div className="ui-actionbar-item ui-actionbar-more" aria-hidden={o.measuring && menu.length === 0 ? true : undefined}>
          <Menu items={menu} label={moreLabel} title={moreLabel} buttonClassName={`btn ui-btn ui-btn-icon ui-menu-trigger${size === 'sm' ? ' ui-btn-sm' : ''}`} buttonRef={o.moreRef} />
        </div>
      )}
    </div>
  )
}
