import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Spinner } from './Spinner'
import { Tooltip } from './Tip'

// A button in the app's style (the existing .btn classes) with an optional icon,
// a busy state and an icon-only form that always has a tooltip + aria-label.

export type ButtonVariant = 'secondary' | 'primary' | 'subtle' | 'danger' | 'danger-solid' | 'ghost'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  icon?: IconName
  /** Show only the icon; `label` (or a string child) becomes aria-label + tooltip. */
  iconOnly?: boolean
  /** Accessible name / tooltip of an icon-only button. */
  label?: string
  /** A tooltip (the hint of what the button does). */
  tooltip?: ReactNode
  /** Working: a spinner instead of the icon, disabled, aria-busy. */
  busy?: boolean
  /** Stretch to the container width. */
  fullWidth?: boolean
}

const VARIANT: Record<ButtonVariant, string> = {
  secondary: '',
  primary: 'primary',
  subtle: 'subtle',
  danger: 'danger',
  'danger-solid': 'stop',
  ghost: 'ui-btn-ghost'
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: 'sm' | 'md' = 'md', extra?: string): string {
  return ['btn', 'ui-btn', VARIANT[variant], size === 'sm' ? 'ui-btn-sm' : '', extra ?? ''].filter(Boolean).join(' ')
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconOnly, label, tooltip, busy, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref
) {
  const name = label ?? (typeof children === 'string' ? children : undefined)
  const iconSize = size === 'sm' ? 14 : 16
  const b = (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, [iconOnly ? 'ui-btn-icon' : '', fullWidth ? 'full' : '', className ?? ''].filter(Boolean).join(' '))}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={iconOnly ? name : rest['aria-label']}
      {...rest}
    >
      {busy ? <Spinner decorative size={iconSize} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {!iconOnly && children != null && <span className="ui-btn-text">{children}</span>}
    </button>
  )
  const tip = tooltip ?? (iconOnly ? name : undefined)
  return tip ? (
    <Tooltip content={tip} describe={!iconOnly || tooltip != null}>
      {b}
    </Tooltip>
  ) : (
    b
  )
})
