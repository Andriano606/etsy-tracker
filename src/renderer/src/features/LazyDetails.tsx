import { useState } from 'react'

/**
 * A collapsible section whose content mounts only once opened (so a feature's
 * section loads its data only when the user looks at it) and stays mounted.
 */
export function LazyDetails({
  label,
  testId,
  className = 'feature-details',
  children
}: {
  label: string
  testId?: string
  className?: string
  children: () => JSX.Element
}): JSX.Element {
  const [opened, setOpened] = useState(false)
  return (
    <details
      className={className}
      data-testid={testId}
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setOpened(true)
      }}
    >
      <summary>{label}</summary>
      {opened && <div className="feature-body">{children()}</div>}
    </details>
  )
}
