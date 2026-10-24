import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react'

// A native <select> (every <select> in the app gets the dark style + chevron from
// base.css; this wrapper only adds `options` and onChange(value)). Native on
// purpose: the OS list is keyboard-, screen-reader- and touch-friendly and is
// never clipped by a scrolling container.

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string
  onChange: (value: string) => void
  options?: ReadonlyArray<SelectOption>
  children?: ReactNode
  /** Grow to the container width. */
  fullWidth?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { value, onChange, options, children, fullWidth, className, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={'ui-select' + (fullWidth ? ' ui-select--full' : '') + (className ? ' ' + className : '')}
      {...rest}
    >
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  )
})
