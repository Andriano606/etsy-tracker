import type { ReactNode } from 'react'
import { Icon, type IconName } from './icons'

// A message block inside a screen: info / success / warn / error, with an icon,
// an optional bold title, the text and optional actions (buttons) or a close ×.
// error → role="alert" (announced at once); the others → role="status".

export type CalloutTone = 'info' | 'success' | 'warn' | 'error'

export interface CalloutProps {
  tone?: CalloutTone
  title?: ReactNode
  children?: ReactNode
  /** Buttons on the right (they wrap under the text when narrow). */
  action?: ReactNode
  /** Shows a × that calls this. */
  onClose?: () => void
  icon?: IconName | false
  /** Override the ARIA role (e.g. "note" for a static explanation). */
  role?: 'alert' | 'status' | 'note'
  compact?: boolean
  className?: string
}

const ICON: Record<CalloutTone, IconName> = { info: 'info', success: 'success', warn: 'warning', error: 'error' }

export function Callout({ tone = 'info', title, children, action, onClose, icon, role, compact, className }: CalloutProps): JSX.Element {
  const r = role ?? (tone === 'error' ? 'alert' : 'status')
  return (
    <div className={`ui-callout ui-callout--${tone}` + (compact ? ' ui-callout--compact' : '') + (className ? ' ' + className : '')} role={r}>
      {icon !== false && <Icon name={icon ?? ICON[tone]} size={compact ? 15 : 17} className="ui-callout-icon" />}
      <div className="ui-callout-main">
        {title && <div className="ui-callout-title">{title}</div>}
        {children && <div className="ui-callout-text">{children}</div>}
      </div>
      {action && <div className="ui-callout-action">{action}</div>}
      {onClose && (
        <button type="button" className="ui-callout-close" aria-label="Закрити повідомлення" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      )}
    </div>
  )
}
