import type { ReactNode } from 'react'
import { Icon } from '../ui'

/** A link that opens in the system browser via main (only https etsy.com URLs pass). */
export function ExternalLink({
  href,
  children,
  className,
  icon
}: {
  href: string
  children: ReactNode
  className?: string
  /** Show the "opens outside" icon after the text. */
  icon?: boolean
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
      {icon && <Icon name="external" size={12} className="ext-link-icon" />}
    </a>
  )
}
