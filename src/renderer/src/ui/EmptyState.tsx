import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'

// What a screen / section shows when there is nothing yet: an icon, a title
// saying what is missing, a sentence on why / what to do, and the action.

export interface EmptyStateProps {
  icon?: IconName
  title: ReactNode
  children?: ReactNode
  /** The way out — usually one primary <Button>. */
  action?: ReactNode
  /** Smaller, for a section inside a card. */
  compact?: boolean
  className?: string
}

export function EmptyState({ icon, title, children, action, compact, className }: EmptyStateProps): JSX.Element {
  return (
    <div className={'ui-empty' + (compact ? ' ui-empty--compact' : '') + (className ? ' ' + className : '')}>
      {icon && (
        <div className="ui-empty-icon">
          <Icon name={icon} size={compact ? 20 : 28} />
        </div>
      )}
      <div className="ui-empty-title">{title}</div>
      {children && <div className="ui-empty-text">{children}</div>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  )
}
