import { useId, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'
import { Tooltip } from './Tip'

// A segmented control for 2–5 mutually exclusive options (a period, a view
// mode). Native radio inputs (visually hidden) inside labels, so it is a real
// radio group: arrow keys move the choice, getByRole('radio', {name}) +
// toBeChecked() work. Wraps onto a second row instead of overflowing.

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: IconName
  /** A tooltip explaining the option. */
  hint?: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  /** Accessible name of the group (also shown by screen readers only). */
  label: string
  size?: 'sm' | 'md'
  /** Stretch to the container width, options sharing it equally. */
  fullWidth?: boolean
  disabled?: boolean
  className?: string
}

export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', fullWidth, disabled, className }: SegmentedProps<T>): JSX.Element {
  const name = useId()
  const cls = ['ui-seg', `ui-seg--${size}`, fullWidth ? 'ui-seg--full' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div role="radiogroup" aria-label={label} className={cls} aria-disabled={disabled || undefined}>
      {options.map((o) => {
        const item = (
          <label key={o.value} className={'ui-seg-item' + (o.value === value ? ' is-on' : '')}>
            <input
              type="radio"
              className="ui-seg-input"
              name={name}
              value={o.value}
              checked={o.value === value}
              disabled={disabled || o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span className="ui-seg-face">
              {o.icon && <Icon name={o.icon} size={14} />}
              <span className="ui-seg-text">{o.label}</span>
            </span>
          </label>
        )
        return o.hint ? (
          <Tooltip key={o.value} content={o.hint} describe={false}>
            {item}
          </Tooltip>
        ) : (
          item
        )
      })}
    </div>
  )
}
