import type { ReactNode } from 'react'
import type { GlossaryKey } from '@shared/glossary'
import { Icon, type IconName } from './icons'
import { InfoTip } from './Tip'

// A number tile: label (+ ⓘ explaining what the number means), the big value,
// a change (+12 / −3, coloured: growth is good unless `lowerIsBetter`) and a
// caption ("з 01.10", "за 30 днів").

export interface StatProps {
  label: ReactNode
  value: ReactNode
  /** The change; a number is formatted with a sign (uk-UA), a node is shown as is. null/undefined = none. */
  delta?: number | ReactNode | null
  /** Tooltip of the change ("з 01.10 14:00 до 24.10 09:30"). */
  deltaHint?: string
  /** A rise is bad (e.g. removed listings). */
  lowerIsBetter?: boolean
  caption?: ReactNode
  glossary?: GlossaryKey
  info?: ReactNode
  icon?: IconName
  /** Smaller value (for dense rows). */
  compact?: boolean
  className?: string
}

const NF = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 })

/** "+1 234", "−3", "0" — a typographic minus. */
export function formatSigned(n: number): string {
  if (n === 0) return '0'
  return (n > 0 ? '+' : '−') + NF.format(Math.abs(n))
}

export function Stat({ label, value, delta, deltaHint, lowerIsBetter, caption, glossary, info, icon, compact, className }: StatProps): JSX.Element {
  let d: ReactNode = null
  if (typeof delta === 'number') {
    const good = delta === 0 ? 'flat' : delta > 0 !== !!lowerIsBetter ? 'up' : 'down'
    d = (
      <span className={`ui-stat-delta is-${good}`} title={deltaHint}>
        {delta !== 0 && <Icon name={delta > 0 ? 'arrow-up' : 'arrow-down'} size={12} />}
        {formatSigned(delta)}
      </span>
    )
  } else if (delta != null && delta !== false) {
    d = (
      <span className="ui-stat-delta" title={deltaHint}>
        {delta}
      </span>
    )
  }
  return (
    <div className={'ui-stat' + (compact ? ' ui-stat--compact' : '') + (className ? ' ' + className : '')}>
      <div className="ui-stat-label">
        {icon && <Icon name={icon} size={14} />}
        <span className="ui-stat-label-text">{label}</span>
        {(glossary || info) && <InfoTip glossary={glossary} text={info} />}
      </div>
      <div className="ui-stat-value-row">
        <span className="ui-stat-value">{value}</span>
        {d}
      </div>
      {caption && <div className="ui-stat-caption">{caption}</div>}
    </div>
  )
}
