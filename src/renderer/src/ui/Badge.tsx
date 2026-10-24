import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Tooltip } from './Tip'

// A small pill for a status or a count: neutral, accent (good / new), info,
// warn, danger. `hint` adds a tooltip explaining what it means.

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'warn' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone
  icon?: IconName
  children: ReactNode
  hint?: ReactNode
  /** Filled (stronger) instead of tinted. */
  solid?: boolean
  className?: string
}

export function Badge({ tone = 'neutral', icon, children, hint, solid, className }: BadgeProps): JSX.Element {
  const b = (
    <span className={`ui-badge ui-badge--${tone}` + (solid ? ' ui-badge--solid' : '') + (className ? ' ' + className : '')} tabIndex={hint ? 0 : undefined}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  )
  return hint ? <Tooltip content={hint}>{b}</Tooltip> : b
}
