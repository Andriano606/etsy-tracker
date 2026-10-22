import type { ReactNode } from 'react'

/** A link that opens in the system browser via main (only https etsy.com URLs pass). */
export function ExternalLink({
  href,
  children,
  className
}: {
  href: string
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <a
      href={href}
      className={className ?? 'ext-link'}
      onClick={(e) => {
        e.preventDefault()
        void window.api.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}
