import type { ReactNode } from 'react'

// A small spinning ring (currentColor). Alone it is a role="status" with a label;
// inside a button pass `decorative` (the button says what is happening).

export interface SpinnerProps {
  size?: number
  /** Screen-reader text; default "Завантаження…". */
  label?: string
  decorative?: boolean
  className?: string
}

export function Spinner({ size = 16, label = 'Завантаження…', decorative, className }: SpinnerProps): JSX.Element {
  return (
    <span
      className={'ui-spinner' + (className ? ' ' + className : '')}
      style={{ width: size, height: size }}
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    />
  )
}

/** A centred "spinner + text" line for a section that is loading. */
export function Loading({ children = 'Завантаження…', inline }: { children?: ReactNode; inline?: boolean }): JSX.Element {
  return (
    <div className={'ui-loading' + (inline ? ' ui-loading--inline' : '')} role="status">
      <Spinner decorative size={inline ? 14 : 18} />
      <span>{children}</span>
    </div>
  )
}
