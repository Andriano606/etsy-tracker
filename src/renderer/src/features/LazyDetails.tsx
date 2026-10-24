import { useState, type ReactNode } from 'react'
import { Icon, type IconName } from '../ui'

/**
 * A collapsible card whose content mounts only once opened (so a feature's
 * section loads its data only when the user looks at it) and stays mounted.
 * The summary row: an optional icon, the label, a one-line description of
 * what is inside (visible while collapsed) and a chevron.
 */
export function LazyDetails({
  label,
  description,
  icon,
  testId,
  className,
  children
}: {
  label: string
  /** One short line under the label: what the section shows and why it matters. */
  description?: ReactNode
  icon?: IconName
  testId?: string
  /** Extra class(es) on the <details> (the card style always applies). */
  className?: string
  children: () => JSX.Element
}): JSX.Element {
  const [opened, setOpened] = useState(false)
  return (
    <details
      className={'feature-details' + (className ? ' ' + className : '')}
      data-testid={testId}
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setOpened(true)
      }}
    >
      <summary className="feature-summary">
        {icon && (
          <span className="feature-summary-icon">
            <Icon name={icon} size={16} />
          </span>
        )}
        <span className="feature-summary-text">
          <span className="feature-summary-label">{label}</span>
          {description && <span className="feature-summary-desc">{description}</span>}
        </span>
        <Icon name="chevron-down" size={16} className="feature-summary-chevron" />
      </summary>
      {opened && <div className="feature-body">{children()}</div>}
    </details>
  )
}

/** What a registry panel may carry besides its label (ShopPanel / ListingPanel entries of the features). */
export interface PanelMeta {
  description?: string
  icon?: IconName
}

/** The description + icon of a registry panel, when its feature gave them (for the hosts' LazyDetails). */
export function panelMeta(p: object): PanelMeta {
  const m = p as PanelMeta
  return { description: typeof m.description === 'string' ? m.description : undefined, icon: m.icon }
}
