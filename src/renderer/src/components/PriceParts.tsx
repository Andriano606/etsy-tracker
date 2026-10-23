import type { ReactNode } from 'react'

/**
 * The struck-through pre-discount price. Screen readers mostly don't announce
 * strikethrough, so a visually hidden "стара ціна" says which price it is.
 */
export function WasPrice({ children, testId }: { children: ReactNode; testId?: string }): JSX.Element {
  return (
    <>
      <span className="sr-only"> стара ціна </span>
      <s className="price-was" data-testid={testId}>
        {children}
      </s>
    </>
  )
}

/** The sale price, bold; a visually hidden "ціна зі знижкою" names it for screen readers. */
export function NowPrice({ children }: { children: ReactNode }): JSX.Element {
  return (
    <>
      <span className="sr-only">ціна зі знижкою </span>
      <span className="price-now">{children}</span>
    </>
  )
}
